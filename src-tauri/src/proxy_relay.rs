//! Local proxy relay.
//!
//! Chromium cannot pass credentials for SOCKS5 proxies and asks the user for HTTP proxy
//! credentials in a dialog. So the browser is pointed at an unauthenticated HTTP proxy on
//! 127.0.0.1, and this relay forwards every connection to the real upstream proxy with
//! authentication:
//!
//! * upstream `http://` / `https://` — `CONNECT` / plain requests with `Proxy-Authorization`
//! * upstream `socks5://` / `socks5h://` — SOCKS5 with username/password (RFC 1928/1929);
//!   host names are resolved by the proxy (no local DNS leak).

use std::io::{Read, Write};
use std::net::{Shutdown, TcpListener, TcpStream, ToSocketAddrs};
use std::thread;
use std::time::Duration;

const HANDSHAKE_TIMEOUT: Duration = Duration::from_secs(30);
const MAX_HEADER: usize = 64 * 1024;

#[derive(Clone, Copy, Debug, PartialEq)]
enum Upstream {
    Http,
    Socks5,
}

#[derive(Clone)]
pub struct ProxyRelay {
    pub local_port: u16,
    kind: Upstream,
    host: String,
    port: u16,
    user: String,
    pass: String,
}

impl ProxyRelay {
    /// Starts listening on a free localhost port and returns immediately.
    pub fn start(scheme: &str, host: &str, port: u16, user: &str, pass: &str) -> Result<Self, String> {
        let kind = match scheme.to_ascii_lowercase().as_str() {
            "http" | "https" => Upstream::Http,
            "socks5" | "socks5h" | "socks" => Upstream::Socks5,
            other => return Err(format!("Unsupported upstream proxy scheme: {}", other)),
        };

        let listener = TcpListener::bind("127.0.0.1:0")
            .map_err(|e| format!("Failed to bind local proxy: {}", e))?;
        let local_port = listener
            .local_addr()
            .map_err(|e| format!("Failed to get local addr: {}", e))?
            .port();

        let relay = ProxyRelay {
            local_port,
            kind,
            host: host.to_string(),
            port,
            user: user.to_string(),
            pass: pass.to_string(),
        };

        let acceptor = relay.clone();
        thread::spawn(move || {
            for stream in listener.incoming() {
                let Ok(client) = stream else { continue };
                let relay = acceptor.clone();
                thread::spawn(move || {
                    if let Err(_e) = relay.handle_client(client) {
                        #[cfg(debug_assertions)]
                        eprintln!("[ProxyRelay] {}", _e);
                    }
                });
            }
        });

        Ok(relay)
    }

    fn handle_client(&self, mut client: TcpStream) -> Result<(), String> {
        client.set_read_timeout(Some(HANDSHAKE_TIMEOUT)).map_err(|e| e.to_string())?;
        let _ = client.set_nodelay(true);

        let (head, body_start) = read_http_head(&mut client)?;
        if head.is_empty() {
            return Ok(());
        }
        let head_text = String::from_utf8_lossy(&head).to_string();
        let request_line = head_text.lines().next().unwrap_or_default().to_string();
        let mut parts = request_line.split_whitespace();
        let method = parts.next().unwrap_or_default().to_string();
        let target = parts.next().unwrap_or_default().to_string();

        if method.eq_ignore_ascii_case("CONNECT") {
            let (host, port) = split_host_port(&target, 443)?;
            let upstream = match self.open_tunnel(&host, port) {
                Ok(s) => s,
                Err(e) => {
                    let _ = client.write_all(b"HTTP/1.1 502 Bad Gateway\r\nContent-Length: 0\r\n\r\n");
                    return Err(e);
                }
            };
            client
                .write_all(b"HTTP/1.1 200 Connection Established\r\n\r\n")
                .map_err(|e| format!("write 200: {}", e))?;
            if !body_start.is_empty() {
                // Client already sent bytes of the tunnelled stream (e.g. TLS ClientHello).
                (&upstream).write_all(&body_start).map_err(|e| e.to_string())?;
            }
            return pipe(client, upstream);
        }

        // Plain HTTP request through the proxy (absolute-form URI).
        let upstream = match self.kind {
            Upstream::Http => {
                let up = self.connect_upstream()?;
                let rewritten = rewrite_headers(&head_text, None, Some(&self.basic_auth()));
                (&up).write_all(rewritten.as_bytes()).map_err(|e| e.to_string())?;
                up
            }
            Upstream::Socks5 => {
                let (host, port, path) = split_absolute_uri(&target)?;
                let up = self.open_tunnel(&host, port)?;
                let rewritten = rewrite_headers(&head_text, Some(&path), None);
                (&up).write_all(rewritten.as_bytes()).map_err(|e| e.to_string())?;
                up
            }
        };
        if !body_start.is_empty() {
            (&upstream).write_all(&body_start).map_err(|e| e.to_string())?;
        }
        pipe(client, upstream)
    }

    fn basic_auth(&self) -> String {
        use base64::Engine;
        let token = base64::engine::general_purpose::STANDARD.encode(format!("{}:{}", self.user, self.pass));
        format!("Basic {}", token)
    }

    fn connect_upstream(&self) -> Result<TcpStream, String> {
        let addr = (self.host.as_str(), self.port)
            .to_socket_addrs()
            .map_err(|e| format!("resolve upstream {}: {}", self.host, e))?
            .next()
            .ok_or_else(|| format!("upstream {} has no address", self.host))?;
        let stream = TcpStream::connect_timeout(&addr, Duration::from_secs(20))
            .map_err(|e| format!("connect upstream {}:{}: {}", self.host, self.port, e))?;
        stream.set_read_timeout(Some(HANDSHAKE_TIMEOUT)).map_err(|e| e.to_string())?;
        let _ = stream.set_nodelay(true);
        Ok(stream)
    }

    /// Opens a raw TCP tunnel to `host:port` through the upstream proxy.
    fn open_tunnel(&self, host: &str, port: u16) -> Result<TcpStream, String> {
        let mut up = self.connect_upstream()?;
        match self.kind {
            Upstream::Http => {
                let req = format!(
                    "CONNECT {h}:{p} HTTP/1.1\r\nHost: {h}:{p}\r\nProxy-Authorization: {a}\r\nProxy-Connection: Keep-Alive\r\n\r\n",
                    h = host,
                    p = port,
                    a = self.basic_auth()
                );
                up.write_all(req.as_bytes()).map_err(|e| format!("write CONNECT: {}", e))?;
                let (resp, extra) = read_http_head(&mut up)?;
                let status = String::from_utf8_lossy(&resp);
                let code = status.split_whitespace().nth(1).unwrap_or_default();
                if code != "200" {
                    return Err(format!(
                        "upstream refused CONNECT {}:{}: {}",
                        host,
                        port,
                        status.lines().next().unwrap_or_default()
                    ));
                }
                if !extra.is_empty() {
                    return Err("upstream sent data before tunnel was established".into());
                }
            }
            Upstream::Socks5 => socks5_connect(&mut up, &self.user, &self.pass, host, port)?,
        }
        Ok(up)
    }
}

/// SOCKS5 handshake with optional username/password auth and a CONNECT by domain name.
fn socks5_connect(s: &mut TcpStream, user: &str, pass: &str, host: &str, port: u16) -> Result<(), String> {
    let io = |e: std::io::Error| format!("socks5: {}", e);
    let with_auth = !user.is_empty();
    if with_auth {
        s.write_all(&[0x05, 0x02, 0x00, 0x02]).map_err(io)?;
    } else {
        s.write_all(&[0x05, 0x01, 0x00]).map_err(io)?;
    }
    let mut choice = [0u8; 2];
    s.read_exact(&mut choice).map_err(io)?;
    if choice[0] != 0x05 {
        return Err("socks5: upstream is not a SOCKS5 proxy".into());
    }
    match choice[1] {
        0x00 => {}
        0x02 => {
            if user.len() > 255 || pass.len() > 255 {
                return Err("socks5: login/password too long".into());
            }
            let mut auth = vec![0x01, user.len() as u8];
            auth.extend_from_slice(user.as_bytes());
            auth.push(pass.len() as u8);
            auth.extend_from_slice(pass.as_bytes());
            s.write_all(&auth).map_err(io)?;
            let mut status = [0u8; 2];
            s.read_exact(&mut status).map_err(io)?;
            if status[1] != 0x00 {
                return Err("socks5: wrong login or password".into());
            }
        }
        0xFF => return Err("socks5: no acceptable auth method (credentials required?)".into()),
        m => return Err(format!("socks5: unsupported auth method {}", m)),
    }

    let host = host.trim_start_matches('[').trim_end_matches(']');
    let mut req = vec![0x05, 0x01, 0x00];
    if let Ok(ip) = host.parse::<std::net::IpAddr>() {
        match ip {
            std::net::IpAddr::V4(v4) => {
                req.push(0x01);
                req.extend_from_slice(&v4.octets());
            }
            std::net::IpAddr::V6(v6) => {
                req.push(0x04);
                req.extend_from_slice(&v6.octets());
            }
        }
    } else {
        if host.len() > 255 {
            return Err("socks5: host name too long".into());
        }
        req.push(0x03);
        req.push(host.len() as u8);
        req.extend_from_slice(host.as_bytes());
    }
    req.extend_from_slice(&port.to_be_bytes());
    s.write_all(&req).map_err(io)?;

    let mut head = [0u8; 4];
    s.read_exact(&mut head).map_err(io)?;
    if head[1] != 0x00 {
        let reason = match head[1] {
            0x01 => "general failure",
            0x02 => "not allowed by ruleset",
            0x03 => "network unreachable",
            0x04 => "host unreachable",
            0x05 => "connection refused",
            0x06 => "TTL expired",
            0x07 => "command not supported",
            0x08 => "address type not supported",
            _ => "unknown error",
        };
        return Err(format!("socks5: CONNECT {}:{} failed: {}", host, port, reason));
    }
    // Skip the bound address in the reply.
    let skip = match head[3] {
        0x01 => 4,
        0x04 => 16,
        0x03 => {
            let mut len = [0u8; 1];
            s.read_exact(&mut len).map_err(io)?;
            len[0] as usize
        }
        _ => return Err("socks5: bad reply address type".into()),
    };
    let mut rest = vec![0u8; skip + 2];
    s.read_exact(&mut rest).map_err(io)?;
    Ok(())
}

/// Reads until the end of HTTP headers. Returns (headers incl. CRLFCRLF, bytes read past them).
fn read_http_head(s: &mut TcpStream) -> Result<(Vec<u8>, Vec<u8>), String> {
    let mut buf = Vec::with_capacity(4096);
    let mut chunk = [0u8; 4096];
    loop {
        let n = s.read(&mut chunk).map_err(|e| format!("read headers: {}", e))?;
        if n == 0 {
            return Ok((buf, Vec::new()));
        }
        buf.extend_from_slice(&chunk[..n]);
        if let Some(pos) = find_subslice(&buf, b"\r\n\r\n") {
            let rest = buf.split_off(pos + 4);
            return Ok((buf, rest));
        }
        if buf.len() > MAX_HEADER {
            return Err("headers too large".into());
        }
    }
}

fn find_subslice(h: &[u8], n: &[u8]) -> Option<usize> {
    h.windows(n.len()).position(|w| w == n)
}

/// Rewrites a request head: optional new request target, strips hop-by-hop proxy headers,
/// forces `Connection: close` (each request gets its own authenticated upstream connection).
fn rewrite_headers(head: &str, new_target: Option<&str>, proxy_auth: Option<&str>) -> String {
    let mut lines = head.split("\r\n");
    let first = lines.next().unwrap_or_default();
    let first = match new_target {
        Some(t) => {
            let mut p = first.split_whitespace();
            let method = p.next().unwrap_or("GET");
            let _ = p.next();
            let version = p.next().unwrap_or("HTTP/1.1");
            format!("{} {} {}", method, t, version)
        }
        None => first.to_string(),
    };
    let mut out = first;
    out.push_str("\r\n");
    for line in lines {
        if line.is_empty() {
            continue;
        }
        let name = line.split(':').next().unwrap_or_default().trim().to_ascii_lowercase();
        if matches!(name.as_str(), "proxy-authorization" | "proxy-connection" | "connection" | "keep-alive") {
            continue;
        }
        out.push_str(line);
        out.push_str("\r\n");
    }
    if let Some(auth) = proxy_auth {
        out.push_str("Proxy-Authorization: ");
        out.push_str(auth);
        out.push_str("\r\n");
    }
    out.push_str("Connection: close\r\n\r\n");
    out
}

fn split_host_port(target: &str, default_port: u16) -> Result<(String, u16), String> {
    // [v6]:port | host:port | host
    if let Some(rest) = target.strip_prefix('[') {
        let end = rest.find(']').ok_or("bad IPv6 address")?;
        let host = rest[..end].to_string();
        let port = rest[end + 1..].strip_prefix(':').and_then(|p| p.parse().ok()).unwrap_or(default_port);
        return Ok((host, port));
    }
    match target.rsplit_once(':') {
        Some((h, p)) => Ok((h.to_string(), p.parse().map_err(|_| format!("bad port in {}", target))?)),
        None => Ok((target.to_string(), default_port)),
    }
}

/// `http://host[:port]/path?q` → (host, port, "/path?q")
fn split_absolute_uri(uri: &str) -> Result<(String, u16, String), String> {
    let (scheme, rest) = uri.split_once("://").ok_or_else(|| format!("not an absolute URI: {}", uri))?;
    let default_port = if scheme.eq_ignore_ascii_case("https") { 443 } else { 80 };
    let (authority, path) = match rest.find('/') {
        Some(i) => (&rest[..i], rest[i..].to_string()),
        None => (rest, "/".to_string()),
    };
    let authority = authority.rsplit('@').next().unwrap_or(authority);
    let (host, port) = split_host_port(authority, default_port)?;
    Ok((host, port, path))
}

/// Copies bytes both ways until either side closes, then closes both.
fn pipe(a: TcpStream, b: TcpStream) -> Result<(), String> {
    // Established tunnels may legitimately idle for a long time (WebSockets, HTTP/2).
    let _ = a.set_read_timeout(None);
    let _ = b.set_read_timeout(None);
    let (mut a_r, mut b_w) = (a.try_clone().map_err(|e| e.to_string())?, b.try_clone().map_err(|e| e.to_string())?);
    let up = thread::spawn(move || {
        let _ = std::io::copy(&mut a_r, &mut b_w);
        let _ = b_w.shutdown(Shutdown::Write);
    });
    let (mut b_r, mut a_w) = (b, a);
    let _ = std::io::copy(&mut b_r, &mut a_w);
    let _ = a_w.shutdown(Shutdown::Both);
    let _ = up.join();
    let _ = b_r.shutdown(Shutdown::Both);
    Ok(())
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn parses_targets() {
        assert_eq!(split_host_port("example.com:443", 1).unwrap(), ("example.com".into(), 443));
        assert_eq!(split_host_port("[::1]:8080", 1).unwrap(), ("::1".into(), 8080));
        assert_eq!(
            split_absolute_uri("http://user@example.com:8080/a?b=1").unwrap(),
            ("example.com".into(), 8080, "/a?b=1".into())
        );
        assert_eq!(split_absolute_uri("http://example.com").unwrap(), ("example.com".into(), 80, "/".into()));
    }

    #[test]
    fn rewrites_headers() {
        let head = "GET http://x.com/p HTTP/1.1\r\nHost: x.com\r\nProxy-Connection: keep-alive\r\nAccept: */*\r\n\r\n";
        let out = rewrite_headers(head, Some("/p"), None);
        assert_eq!(out, "GET /p HTTP/1.1\r\nHost: x.com\r\nAccept: */*\r\nConnection: close\r\n\r\n");
        let out = rewrite_headers(head, None, Some("Basic abc"));
        assert!(out.starts_with("GET http://x.com/p HTTP/1.1\r\n"));
        assert!(out.contains("Proxy-Authorization: Basic abc\r\n"));
    }
}

/// Live relay check against real upstreams (not run by default):
/// RELAY_UPSTREAM="socks5://user:pass@host:port" cargo test --lib relay_live -- --ignored --nocapture
#[cfg(test)]
mod live {
    use super::*;

    fn through(relay: &ProxyRelay, url: &str) -> Result<String, String> {
        let client = reqwest::blocking::Client::builder()
            .proxy(reqwest::Proxy::all(format!("http://127.0.0.1:{}", relay.local_port)).unwrap())
            .timeout(Duration::from_secs(20))
            .build()
            .unwrap();
        let r = client.get(url).send().map_err(|e| e.to_string())?;
        Ok(format!("{} {}", r.status(), r.text().unwrap_or_default().chars().take(120).collect::<String>()))
    }

    #[test]
    #[ignore]
    fn relay_live() {
        for up in std::env::var("RELAY_UPSTREAM").expect("RELAY_UPSTREAM").split_whitespace() {
            let p = crate::browser::parse_proxy_url(up).expect("bad upstream url");
            let relay = ProxyRelay::start(&p.scheme, &p.host, p.port, p.username.as_deref().unwrap_or(""), p.password.as_deref().unwrap_or("")).unwrap();
            println!("[{}] https: {:?}", p.scheme, through(&relay, "https://api.ipify.org?format=json"));
            println!("[{}] http : {:?}", p.scheme, through(&relay, "http://ip-api.com/json/?fields=status,query"));
            println!("[{}] http2: {:?}", p.scheme, through(&relay, "http://example.com/"));
        }
        // wrong password must fail cleanly, not hang
        let relay = ProxyRelay::start("socks5", "127.0.0.1", 1081, "tuser", "wrong").unwrap();
        println!("[bad auth] {:?}", through(&relay, "https://api.ipify.org"));
    }
}
