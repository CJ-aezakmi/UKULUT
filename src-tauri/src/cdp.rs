//! Minimal Chrome DevTools Protocol controller that applies the profile fingerprint.
//!
//! Chromium is started with `--remote-debugging-port=0`; it writes the chosen port to
//! `<user-data-dir>/DevToolsActivePort`. We connect to the browser endpoint and use
//! `Target.setAutoAttach { waitForDebuggerOnStart: true, flatten: true }`, so every new
//! page, frame and worker is paused until our overrides are installed:
//!
//! * `Emulation.setTimezoneOverride`            — Date + Intl, all contexts
//! * `Emulation.setHardwareConcurrencyOverride` — navigator.hardwareConcurrency
//! * `Page.addScriptToEvaluateOnNewDocument`    — stealth.js in every document
//! * `Runtime.evaluate` (paused workers only)   — stealth.js in workers
//!
//! `Runtime.enable` / `Debugger.enable` are never sent: those are what anti-bot scripts
//! can observe. The connection lives as long as the browser; when Chromium exits the
//! socket closes and the thread ends.

use serde_json::{json, Value};
use std::net::TcpStream;
use std::path::{Path, PathBuf};
use std::thread;
use std::time::{Duration, Instant};
use tungstenite::stream::MaybeTlsStream;
use tungstenite::{Message, WebSocket};

/// What the controller enforces for one browser instance.
#[derive(Debug, Clone)]
pub struct Overrides {
    pub timezone: Option<String>,
    pub hardware_concurrency: u32,
    /// Full script source (config prefix + stealth.js).
    pub script: String,
    /// URL to open once the first tab is instrumented.
    pub start_url: String,
}

/// File Chromium writes when remote debugging is enabled.
pub fn active_port_file(profile_dir: &Path) -> PathBuf {
    profile_dir.join("DevToolsActivePort")
}

/// Spawns the controller thread. Returns immediately.
pub fn attach(profile_dir: PathBuf, overrides: Overrides) {
    thread::spawn(move || {
        if let Err(e) = run(&profile_dir, &overrides) {
            eprintln!("[CDP] controller stopped: {}", e);
        }
    });
}

fn run(profile_dir: &Path, o: &Overrides) -> Result<(), String> {
    let endpoint = wait_for_endpoint(profile_dir, Duration::from_secs(20))?;
    let (mut ws, _) = tungstenite::connect(endpoint.as_str())
        .map_err(|e| format!("connect {}: {}", endpoint, e))?;
    set_read_timeout(&mut ws, None);

    let mut cdp = Session { ws, next_id: 0 };
    cdp.send(None, "Target.setAutoAttach", auto_attach())?;

    let mut navigated = false;
    loop {
        let msg = match cdp.ws.read() {
            Ok(m) => m,
            Err(tungstenite::Error::ConnectionClosed) | Err(tungstenite::Error::AlreadyClosed) => return Ok(()),
            // Browser closed / killed: the socket is reset rather than closed cleanly.
            Err(tungstenite::Error::Io(e))
                if matches!(e.kind(), std::io::ErrorKind::ConnectionReset | std::io::ErrorKind::ConnectionAborted | std::io::ErrorKind::UnexpectedEof) =>
            {
                return Ok(())
            }
            Err(e) => return Err(format!("read: {}", e)),
        };
        let text = match msg {
            Message::Text(t) => t,
            Message::Close(_) => return Ok(()),
            _ => continue,
        };
        let value: Value = match serde_json::from_str(text.as_str()) {
            Ok(v) => v,
            Err(_) => continue,
        };

        #[cfg(debug_assertions)]
        if let Some(err) = value.get("error") {
            eprintln!("[CDP] command {} failed: {}", value["id"], err);
        }

        if value["method"] == "Target.attachedToTarget" {
            let session = value["params"]["sessionId"].as_str().unwrap_or_default().to_string();
            let info = &value["params"]["targetInfo"];
            let kind = info["type"].as_str().unwrap_or_default();
            let url = info["url"].as_str().unwrap_or_default();
            cdp.instrument(&session, kind, o)?;

            // The tab Chromium opened at startup (about:blank) is attached after it already
            // exists, so navigate it only once our overrides are in place.
            if !navigated && kind == "page" && url == "about:blank" {
                navigated = true;
                cdp.send(Some(&session), "Page.navigate", json!({ "url": o.start_url }))?;
            }
        }
    }
}

struct Session {
    ws: WebSocket<MaybeTlsStream<TcpStream>>,
    next_id: u64,
}

impl Session {
    fn send(&mut self, session: Option<&str>, method: &str, params: Value) -> Result<(), String> {
        self.next_id += 1;
        let mut msg = json!({ "id": self.next_id, "method": method, "params": params });
        if let Some(s) = session {
            msg["sessionId"] = json!(s);
        }
        self.ws
            .send(Message::text(msg.to_string()))
            .map_err(|e| format!("send {}: {}", method, e))
    }

    /// Installs the overrides into a freshly attached (paused) target, then resumes it.
    /// Commands on one session are processed in order, so no need to await responses.
    fn instrument(&mut self, session: &str, kind: &str, o: &Overrides) -> Result<(), String> {
        let s = Some(session);
        match kind {
            "page" | "iframe" => {
                self.send(s, "Page.enable", json!({}))?;
                self.send(s, "Page.addScriptToEvaluateOnNewDocument", json!({ "source": o.script }))?;
                self.emulate(session, o)?;
                self.send(s, "Target.setAutoAttach", auto_attach())?;
            }
            "worker" | "shared_worker" | "service_worker" => {
                self.send(s, "Runtime.evaluate", json!({ "expression": o.script, "silent": true }))?;
                self.emulate(session, o)?;
                self.send(s, "Target.setAutoAttach", auto_attach())?;
            }
            _ => {}
        }
        self.send(s, "Runtime.runIfWaitingForDebugger", json!({}))
    }

    fn emulate(&mut self, session: &str, o: &Overrides) -> Result<(), String> {
        let s = Some(session);
        if let Some(tz) = &o.timezone {
            self.send(s, "Emulation.setTimezoneOverride", json!({ "timezoneId": tz }))?;
        }
        if o.hardware_concurrency > 0 {
            self.send(
                s,
                "Emulation.setHardwareConcurrencyOverride",
                json!({ "hardwareConcurrency": o.hardware_concurrency }),
            )?;
        }
        Ok(())
    }
}

fn auto_attach() -> Value {
    json!({ "autoAttach": true, "waitForDebuggerOnStart": true, "flatten": true })
}

/// Waits for Chromium to publish its DevTools endpoint and returns `ws://127.0.0.1:<port><path>`.
fn wait_for_endpoint(profile_dir: &Path, timeout: Duration) -> Result<String, String> {
    let file = active_port_file(profile_dir);
    let started = Instant::now();
    while started.elapsed() < timeout {
        if let Ok(content) = std::fs::read_to_string(&file) {
            let mut lines = content.lines();
            if let (Some(port), Some(path)) = (lines.next(), lines.next()) {
                if !port.trim().is_empty() && path.starts_with("/devtools/browser/") {
                    return Ok(format!("ws://127.0.0.1:{}{}", port.trim(), path.trim()));
                }
            }
        }
        thread::sleep(Duration::from_millis(100));
    }
    Err("DevToolsActivePort did not appear (is this profile already open?)".into())
}

fn set_read_timeout(ws: &mut WebSocket<MaybeTlsStream<TcpStream>>, t: Option<Duration>) {
    if let MaybeTlsStream::Plain(stream) = ws.get_mut() {
        let _ = stream.set_read_timeout(t);
    }
}
