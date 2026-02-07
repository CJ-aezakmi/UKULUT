use std::env;
use std::fs;
use std::path::{Path, PathBuf};
use std::process::Command;

#[cfg(target_os = "windows")]
use std::os::windows::process::CommandExt;

use crate::models::Profile;
use crate::proxy_relay::ProxyRelay;

/// CyberYozh extension ID (вычислен из public key в их manifest.json)
const CYBERYOZH_EXTENSION_ID: &str = "paljcopanhinogelplkpgfnljiomaapc";

/// WebGL renderer presets for realistic fingerprints
const WEBGL_RENDERERS: &[&str] = &[
    "ANGLE (Intel, Intel(R) UHD Graphics 620 Direct3D11 vs_5_0 ps_5_0, D3D11)",
    "ANGLE (Intel, Intel(R) UHD Graphics 630 Direct3D11 vs_5_0 ps_5_0, D3D11)",
    "ANGLE (Intel, Intel(R) HD Graphics 530 Direct3D11 vs_5_0 ps_5_0, D3D11)",
    "ANGLE (Intel, Intel(R) Iris(R) Xe Graphics Direct3D11 vs_5_0 ps_5_0, D3D11)",
    "ANGLE (NVIDIA, NVIDIA GeForce GTX 1060 Direct3D11 vs_5_0 ps_5_0, D3D11)",
    "ANGLE (NVIDIA, NVIDIA GeForce GTX 1650 Direct3D11 vs_5_0 ps_5_0, D3D11)",
    "ANGLE (NVIDIA, NVIDIA GeForce RTX 2060 Direct3D11 vs_5_0 ps_5_0, D3D11)",
    "ANGLE (NVIDIA, NVIDIA GeForce RTX 3060 Direct3D11 vs_5_0 ps_5_0, D3D11)",
    "ANGLE (AMD, AMD Radeon RX 580 Direct3D11 vs_5_0 ps_5_0, D3D11)",
    "ANGLE (AMD, AMD Radeon RX 5700 XT Direct3D11 vs_5_0 ps_5_0, D3D11)",
];

/// Country code to timezone/locale mapping
pub struct LocaleInfo {
    pub timezone: &'static str,
    pub lang: &'static str,
}

/// Extract country code from proxy string (e.g. "country-US" pattern)
fn extract_country_from_proxy(proxy: &str) -> Option<String> {
    let re_pattern = proxy.to_uppercase();
    // Look for country-XX pattern
    if let Some(pos) = re_pattern.find("COUNTRY-") {
        let start = pos + 8;
        if start + 2 <= re_pattern.len() {
            let code = &re_pattern[start..start + 2];
            if code.chars().all(|c| c.is_ascii_alphabetic()) {
                return Some(code.to_string());
            }
        }
    }
    None
}

/// Get locale info for a country code
pub fn get_locale_for_country(country: &str) -> LocaleInfo {
    match country {
        "US" => LocaleInfo { timezone: "America/New_York", lang: "en-US" },
        "GB" => LocaleInfo { timezone: "Europe/London", lang: "en-GB" },
        "DE" => LocaleInfo { timezone: "Europe/Berlin", lang: "de-DE" },
        "FR" => LocaleInfo { timezone: "Europe/Paris", lang: "fr-FR" },
        "ES" => LocaleInfo { timezone: "Europe/Madrid", lang: "es-ES" },
        "IT" => LocaleInfo { timezone: "Europe/Rome", lang: "it-IT" },
        "NL" => LocaleInfo { timezone: "Europe/Amsterdam", lang: "nl-NL" },
        "PL" => LocaleInfo { timezone: "Europe/Warsaw", lang: "pl-PL" },
        "BR" => LocaleInfo { timezone: "America/Sao_Paulo", lang: "pt-BR" },
        "RU" => LocaleInfo { timezone: "Europe/Moscow", lang: "ru-RU" },
        "UA" => LocaleInfo { timezone: "Europe/Kiev", lang: "uk-UA" },
        "JP" => LocaleInfo { timezone: "Asia/Tokyo", lang: "ja-JP" },
        "CN" => LocaleInfo { timezone: "Asia/Shanghai", lang: "zh-CN" },
        "KR" => LocaleInfo { timezone: "Asia/Seoul", lang: "ko-KR" },
        "IN" => LocaleInfo { timezone: "Asia/Kolkata", lang: "en-IN" },
        "AU" => LocaleInfo { timezone: "Australia/Sydney", lang: "en-AU" },
        "CA" => LocaleInfo { timezone: "America/Toronto", lang: "en-CA" },
        "SE" => LocaleInfo { timezone: "Europe/Stockholm", lang: "sv-SE" },
        "NO" => LocaleInfo { timezone: "Europe/Oslo", lang: "no-NO" },
        "DK" => LocaleInfo { timezone: "Europe/Copenhagen", lang: "da-DK" },
        "FI" => LocaleInfo { timezone: "Europe/Helsinki", lang: "fi-FI" },
        "CH" => LocaleInfo { timezone: "Europe/Zurich", lang: "de-CH" },
        "AT" => LocaleInfo { timezone: "Europe/Vienna", lang: "de-AT" },
        "BE" => LocaleInfo { timezone: "Europe/Brussels", lang: "nl-BE" },
        "CZ" => LocaleInfo { timezone: "Europe/Prague", lang: "cs-CZ" },
        "PT" => LocaleInfo { timezone: "Europe/Lisbon", lang: "pt-PT" },
        "GR" => LocaleInfo { timezone: "Europe/Athens", lang: "el-GR" },
        "TR" => LocaleInfo { timezone: "Europe/Istanbul", lang: "tr-TR" },
        "MX" => LocaleInfo { timezone: "America/Mexico_City", lang: "es-MX" },
        "AR" => LocaleInfo { timezone: "America/Argentina/Buenos_Aires", lang: "es-AR" },
        "CL" => LocaleInfo { timezone: "America/Santiago", lang: "es-CL" },
        _ => LocaleInfo { timezone: "America/New_York", lang: "en-US" },
    }
}

/// Find Playwright Chromium binary (preferred) or system Chrome as fallback.
/// Playwright Chromium is open-source and supports --load-extension, --disable-extensions-except
/// which are blocked in Google Chrome stable channel.
pub fn find_chrome() -> Option<PathBuf> {
    // First priority: Playwright Chromium (supports all extension flags)
    if let Some(pw_chromium) = find_playwright_chromium() {
        println!("[Browser] Using Playwright Chromium: {:?}", pw_chromium);
        return Some(pw_chromium);
    }

    println!("[Browser] WARNING: Playwright Chromium not found, falling back to system Chrome.");
    println!("[Browser] Extensions may not load in Google Chrome stable!");

    // Fallback: system browsers
    #[cfg(target_os = "windows")]
    {
        let candidates = vec![
            // Chromium (supports extensions)
            env::var("LOCALAPPDATA")
                .unwrap_or_else(|_| "C:\\Users\\Default\\AppData\\Local".to_string())
                + "\\Chromium\\Application\\chrome.exe",
            // Google Chrome
            env::var("PROGRAMFILES")
                .unwrap_or_else(|_| "C:\\Program Files".to_string())
                + "\\Google\\Chrome\\Application\\chrome.exe",
            env::var("PROGRAMFILES(X86)")
                .unwrap_or_else(|_| "C:\\Program Files (x86)".to_string())
                + "\\Google\\Chrome\\Application\\chrome.exe",
            env::var("LOCALAPPDATA")
                .unwrap_or_else(|_| "C:\\Users\\Default\\AppData\\Local".to_string())
                + "\\Google\\Chrome\\Application\\chrome.exe",
            // Edge
            env::var("PROGRAMFILES(X86)")
                .unwrap_or_else(|_| "C:\\Program Files (x86)".to_string())
                + "\\Microsoft\\Edge\\Application\\msedge.exe",
            env::var("PROGRAMFILES")
                .unwrap_or_else(|_| "C:\\Program Files".to_string())
                + "\\Microsoft\\Edge\\Application\\msedge.exe",
        ];

        for path in candidates {
            let p = PathBuf::from(&path);
            if p.exists() {
                return Some(p);
            }
        }
    }

    #[cfg(target_os = "linux")]
    {
        let candidates = vec![
            "/usr/bin/chromium-browser",
            "/usr/bin/chromium",
            "/snap/bin/chromium",
            "/usr/bin/google-chrome",
            "/usr/bin/google-chrome-stable",
        ];
        for path in candidates {
            let p = PathBuf::from(path);
            if p.exists() {
                return Some(p);
            }
        }
    }

    #[cfg(target_os = "macos")]
    {
        let candidates = vec![
            "/Applications/Chromium.app/Contents/MacOS/Chromium",
            "/Applications/Google Chrome.app/Contents/MacOS/Google Chrome",
        ];
        for path in candidates {
            let p = PathBuf::from(path);
            if p.exists() {
                return Some(p);
            }
        }
    }

    None
}

/// Find Playwright Chromium binary in known locations.
/// Searches ms-playwright cache, project-local playwright-cache, and bundled paths.
fn find_playwright_chromium() -> Option<PathBuf> {
    let mut search_dirs: Vec<PathBuf> = Vec::new();

    // 1. PLAYWRIGHT_BROWSERS_PATH environment variable
    if let Ok(pw_path) = env::var("PLAYWRIGHT_BROWSERS_PATH") {
        search_dirs.push(PathBuf::from(pw_path));
    }

    // 2. Default Playwright cache: %LOCALAPPDATA%/ms-playwright (Windows)
    //    or ~/.cache/ms-playwright (Linux/macOS)
    #[cfg(target_os = "windows")]
    {
        if let Ok(local_appdata) = env::var("LOCALAPPDATA") {
            // Launcher installs Chromium here:
            search_dirs.push(PathBuf::from(&local_appdata).join("AnticBrowser").join("runtime").join("ms-playwright"));
            // Default Playwright path:
            search_dirs.push(PathBuf::from(&local_appdata).join("ms-playwright"));
        }
        if let Ok(userprofile) = env::var("USERPROFILE") {
            search_dirs.push(PathBuf::from(&userprofile).join("AppData").join("Local").join("ms-playwright"));
        }
    }
    #[cfg(not(target_os = "windows"))]
    {
        if let Ok(home) = env::var("HOME") {
            search_dirs.push(PathBuf::from(&home).join(".cache").join("ms-playwright"));
        }
    }

    // 3. Project-local playwright-cache (like AZMI portable builds)
    if let Ok(exe) = env::current_exe() {
        if let Some(exe_dir) = exe.parent() {
            search_dirs.push(exe_dir.join("playwright-cache"));
            // Dev mode: go up from target/debug/ 
            if let Some(project_root) = exe_dir.parent().and_then(|p| p.parent()).and_then(|p| p.parent()) {
                search_dirs.push(project_root.join("playwright-cache"));
            }
        }
    }

    // Search for the latest chromium-XXXX directory
    for base_dir in &search_dirs {
        if !base_dir.exists() {
            continue;
        }

        // Collect all chromium-NNNN directories and sort by version (latest first)
        let mut chromium_dirs: Vec<(u64, PathBuf)> = Vec::new();

        if let Ok(entries) = fs::read_dir(base_dir) {
            for entry in entries.flatten() {
                let name = entry.file_name().to_string_lossy().to_string();
                if name.starts_with("chromium-") {
                    if let Ok(ver) = name["chromium-".len()..].parse::<u64>() {
                        chromium_dirs.push((ver, entry.path()));
                    }
                }
            }
        }

        // Sort descending — prefer latest version
        chromium_dirs.sort_by(|a, b| b.0.cmp(&a.0));

        for (_, chromium_dir) in &chromium_dirs {
            // Windows: chrome-win64/chrome.exe or chrome-win/chrome.exe
            #[cfg(target_os = "windows")]
            {
                for sub in &["chrome-win64", "chrome-win"] {
                    let exe = chromium_dir.join(sub).join("chrome.exe");
                    if exe.exists() {
                        return Some(exe);
                    }
                }
            }
            // Linux: chrome-linux/chrome
            #[cfg(target_os = "linux")]
            {
                let exe = chromium_dir.join("chrome-linux").join("chrome");
                if exe.exists() {
                    return Some(exe);
                }
            }
            // macOS: chrome-mac/Chromium.app/Contents/MacOS/Chromium
            #[cfg(target_os = "macos")]
            {
                let exe = chromium_dir
                    .join("chrome-mac")
                    .join("Chromium.app")
                    .join("Contents")
                    .join("MacOS")
                    .join("Chromium");
                if exe.exists() {
                    return Some(exe);
                }
            }
        }
    }

    None
}

/// Get the profiles data directory
pub fn get_profiles_dir() -> PathBuf {
    let local_appdata = env::var("LOCALAPPDATA")
        .unwrap_or_else(|_| {
            let home = env::var("HOME").unwrap_or_else(|_| ".".to_string());
            format!("{}/.local/share", home)
        });
    PathBuf::from(local_appdata).join("AnticBrowser")
}

/// Prepare the anti-detect extension for a specific profile
/// Copies the template extension and generates profile-specific config.js
pub fn prepare_extension_for_profile(
    profile: &Profile,
    profile_dir: &Path,
    extension_template_dir: &Path,
) -> Result<PathBuf, String> {
    let ext_dir = profile_dir.join("antidetect-extension");

    // Remove old extension to avoid stale files
    if ext_dir.exists() {
        let _ = fs::remove_dir_all(&ext_dir);
    }

    // Create extension directory
    fs::create_dir_all(&ext_dir)
        .map_err(|e| format!("Failed to create extension dir: {}", e))?;

    // Copy template files (manifest.json, inject.js, antidetect.js) — background.js and config.js are generated
    for file_name in &["manifest.json", "inject.js", "antidetect.js"] {
        let src = extension_template_dir.join(file_name);
        let dst = ext_dir.join(file_name);
        if src.exists() {
            fs::copy(&src, &dst)
                .map_err(|e| format!("Failed to copy {}: {}", file_name, e))?;
        }
    }

    // Determine effective timezone and lang (auto-detect from proxy if default)
    let mut timezone = profile.timezone.clone();
    let mut lang = profile.lang.clone();

    if let Some(proxy_str) = &profile.proxy {
        if let Some(country) = extract_country_from_proxy(proxy_str) {
            let locale = get_locale_for_country(&country);
            if timezone == "America/New_York" {
                timezone = locale.timezone.to_string();
            }
            if lang == "en-US" {
                lang = locale.lang.to_string();
            }
        }
    }

    // Pick a deterministic WebGL renderer based on profile name hash
    let name_hash: usize = profile.name.bytes().map(|b| b as usize).sum();
    let webgl_renderer = WEBGL_RENDERERS[name_hash % WEBGL_RENDERERS.len()];

    // Determine WebGL vendor from renderer
    let webgl_vendor = if webgl_renderer.contains("NVIDIA") {
        "Google Inc. (NVIDIA)"
    } else if webgl_renderer.contains("AMD") {
        "Google Inc. (AMD)"
    } else {
        "Google Inc. (Intel)"
    };

    // Generate config.js with profile-specific values
    let config_js = format!(
        r#"// Auto-generated config for profile: {}
window.__ANTIC_CONFIG__ = {{
  userAgent: "{}",
  screenWidth: {},
  screenHeight: {},
  timezone: "{}",
  lang: "{}",
  cpu: {},
  ram: {},
  vendor: "{}",
  webgl: {},
  touch: {},
  webglVendor: "{}",
  webglRenderer: "{}"
}};
"#,
        profile.name,
        profile.user_agent.replace('\\', "\\\\").replace('"', "\\\""),
        profile.screen_width,
        profile.screen_height,
        timezone,
        lang,
        profile.cpu,
        profile.ram,
        profile.vendor.replace('\\', "\\\\").replace('"', "\\\""),
        profile.webgl,
        profile.is_touch,
        webgl_vendor,
        webgl_renderer,
    );

    fs::write(ext_dir.join("config.js"), config_js)
        .map_err(|e| format!("Failed to write config.js: {}", e))?;

    Ok(ext_dir)
}

/// Simple URL-decode for proxy credentials
fn url_decode(s: &str) -> String {
    let mut result = String::with_capacity(s.len());
    let mut chars = s.chars();
    while let Some(c) = chars.next() {
        if c == '%' {
            let hex: String = chars.by_ref().take(2).collect();
            if hex.len() == 2 {
                if let Ok(byte) = u8::from_str_radix(&hex, 16) {
                    result.push(byte as char);
                    continue;
                }
            }
            result.push('%');
            result.push_str(&hex);
        } else if c == '+' {
            result.push(' ');
        } else {
            result.push(c);
        }
    }
    result
}

/// Parse proxy URL string like "scheme://user:pass@host:port"
pub struct ProxyParts {
    pub scheme: String,
    pub host: String,
    pub port: u16,
    pub username: Option<String>,
    pub password: Option<String>,
}

pub fn parse_proxy_url(proxy_str: &str) -> Option<ProxyParts> {
    // Expected format: scheme://[user:pass@]host:port
    let (scheme, rest) = proxy_str.split_once("://")?;
    
    let (auth_part, host_port) = if rest.contains('@') {
        let (auth, hp) = rest.rsplit_once('@')?;
        (Some(auth), hp)
    } else {
        (None, rest)
    };

    let (host, port_str) = host_port.rsplit_once(':')?;
    let port: u16 = port_str.trim_end_matches('/').parse().ok()?;

    let (username, password) = if let Some(auth) = auth_part {
        if let Some((u, p)) = auth.split_once(':') {
            (Some(url_decode(u)), Some(url_decode(p)))
        } else {
            (Some(url_decode(auth)), None)
        }
    } else {
        (None, None)
    };

    Some(ProxyParts {
        scheme: scheme.to_string(),
        host: host.to_string(),
        port,
        username,
        password,
    })
}

/// Parse proxy URL to extract credentials
fn parse_proxy_credentials(proxy_str: &str) -> Option<(String, String)> {
    let parts = parse_proxy_url(proxy_str)?;
    let username = parts.username?;
    let password = parts.password.unwrap_or_default();
    if !username.is_empty() {
        Some((username, password))
    } else {
        None
    }
}

/// Parse proxy string to get server address for --proxy-server flag
fn parse_proxy_server(proxy_str: &str) -> Option<String> {
    let parts = parse_proxy_url(proxy_str)?;
    let chrome_scheme = match parts.scheme.as_str() {
        "http" | "https" => &parts.scheme,
        "socks4" => "socks4",
        "socks5" => "socks5",
        _ => "http",
    };
    Some(format!("{}://{}:{}", chrome_scheme, parts.host, parts.port))
}

/// Build Chrome launch arguments for anti-detect
pub fn build_chrome_args(
    profile: &Profile,
    profile_dir: &Path,
    extension_dir: &Path,
    local_proxy_port: Option<u16>,
    cyberyozh_dir: Option<&Path>,
) -> Vec<String> {
    let mut args = vec![
        // Profile isolation - each profile gets its own data directory
        format!("--user-data-dir={}", profile_dir.display()),

        // ===== Core anti-detect flags =====
        "--disable-blink-features=AutomationControlled".to_string(),
        "--no-first-run".to_string(),
        "--no-default-browser-check".to_string(),
        "--disable-infobars".to_string(),
        "--disable-session-crashed-bubble".to_string(),
        "--disable-component-update".to_string(),

        // ===== Disable detection vectors =====
        "--disable-features=IsolateOrigins,site-per-process,GlobalMediaControls,MediaRouter,ChromeWhatsNewUI,PrivacySandboxSettings4,AutofillServerCommunication,TranslateUI".to_string(),
        "--enable-features=NetworkService,NetworkServiceInProcess".to_string(),
        "--disable-client-side-phishing-detection".to_string(),
        "--disable-default-apps".to_string(),
        "--disable-component-extensions-with-background-pages".to_string(),
        "--disable-site-isolation-trials".to_string(),

        // ===== Anti-automation detection =====
        // Playwright Chromium adds --enable-automation by default; we exclude it via ignoreDefaultArgs approach
        "--disable-blink-features=AutomationControlled".to_string(),

        // ===== Performance & stability =====
        "--disable-background-mode".to_string(),
        "--disable-background-timer-throttling".to_string(),
        "--disable-backgrounding-occluded-windows".to_string(),
        "--disable-renderer-backgrounding".to_string(),
        "--disable-ipc-flooding-protection".to_string(),
        "--disable-dev-shm-usage".to_string(),

        // ===== Security sandbox (required for extension loading) =====
        "--no-sandbox".to_string(),
        "--disable-setuid-sandbox".to_string(),

        // ===== Prevent fingerprint changes =====
        "--password-store=basic".to_string(),
        "--use-mock-keychain".to_string(),

        // ===== Search engine  =====
        "--search-engine-choice-country=US".to_string(),

        // ===== Disable QUIC protocol (can leak info) =====
        "--disable-quic".to_string(),
    ];

    // Window size
    args.push(format!(
        "--window-size={},{}",
        profile.screen_width, profile.screen_height
    ));

    // Disable WebGL if profile requests it
    if !profile.webgl {
        args.push("--disable-webgl".to_string());
    }

    // Language
    args.push(format!("--lang={}", profile.lang));
    args.push(format!("--accept-lang={},{},en-US,en",
        profile.lang,
        profile.lang.split('-').next().unwrap_or("en")
    ));

    // Load anti-detect extension (+ CyberYozh if available)
    let ext_path = extension_dir.display().to_string();
    if let Some(cyberyozh_path) = cyberyozh_dir {
        let cy_path = cyberyozh_path.display().to_string();
        args.push(format!("--disable-extensions-except={},{}", ext_path, cy_path));
        args.push(format!("--load-extension={},{}", ext_path, cy_path));
    } else {
        args.push(format!("--disable-extensions-except={}", ext_path));
        args.push(format!("--load-extension={}", ext_path));
    }

    // Proxy configuration — use local relay port if provided
    if let Some(local_port) = local_proxy_port {
        args.push(format!("--proxy-server=http://127.0.0.1:{}", local_port));
    } else if let Some(proxy_str) = &profile.proxy {
        if let Some(server) = parse_proxy_server(proxy_str) {
            args.push(format!("--proxy-server={}", server));
        }
    }

    // Homepage as the startup URL
    let homepage = if profile.homepage.is_empty() || profile.homepage == "https://whoer.net" {
        "https://2ip.ru".to_string()
    } else {
        profile.homepage.clone()
    };
    args.push(homepage);

    args
}

/// Pin an extension in Chrome's toolbar by writing to the Preferences file.
/// This makes the extension icon visible next to the address bar.
fn pin_extension_in_preferences(profile_dir: &Path, extension_id: &str) {
    let prefs_path = profile_dir.join("Default").join("Preferences");

    let mut prefs: serde_json::Value = if prefs_path.exists() {
        match fs::read_to_string(&prefs_path) {
            Ok(content) => serde_json::from_str(&content).unwrap_or_else(|_| serde_json::json!({})),
            Err(_) => serde_json::json!({}),
        }
    } else {
        // Ensure Default directory exists
        let _ = fs::create_dir_all(prefs_path.parent().unwrap());
        serde_json::json!({})
    };

    // Set pinned extensions in extensions.pinned_extensions
    let extensions = prefs
        .as_object_mut()
        .unwrap()
        .entry("extensions")
        .or_insert_with(|| serde_json::json!({}));

    let pinned = extensions
        .as_object_mut()
        .unwrap()
        .entry("pinned_extensions")
        .or_insert_with(|| serde_json::json!([]));

    if let Some(arr) = pinned.as_array_mut() {
        let id_val = serde_json::Value::String(extension_id.to_string());
        if !arr.contains(&id_val) {
            arr.push(id_val);
        }
    }

    // Also set toolbar pin state via browser.toolbar_pinned
    let browser = prefs
        .as_object_mut()
        .unwrap()
        .entry("browser")
        .or_insert_with(|| serde_json::json!({}));

    // Chrome 90+ uses "toolbar_pinned_extensions" 
    let toolbar_pinned = browser
        .as_object_mut()
        .unwrap()
        .entry("toolbar_pinned_extensions")
        .or_insert_with(|| serde_json::json!([]));

    if let Some(arr) = toolbar_pinned.as_array_mut() {
        let id_val = serde_json::Value::String(extension_id.to_string());
        if !arr.contains(&id_val) {
            arr.push(id_val);
        }
    }

    // Write back
    if let Ok(json_str) = serde_json::to_string_pretty(&prefs) {
        let _ = fs::write(&prefs_path, json_str);
    }

    #[cfg(debug_assertions)]
    println!("[Browser] Pinned extension {} in preferences", extension_id);
}

/// Launch Chrome with anti-detect profile
pub fn launch_chrome(
    profile: &Profile,
    extension_template_dir: &Path,
    cyberyozh_path: Option<PathBuf>,
) -> Result<std::process::Child, String> {
    // Find Playwright Chromium (preferred) or system Chrome
    let chrome_path = find_chrome()
        .ok_or_else(|| "Playwright Chromium not found. Please install Playwright: npx playwright install chromium".to_string())?;

    // Create profile directory
    let profiles_dir = get_profiles_dir();
    let safe_name = sanitize_profile_name(&profile.name);
    let profile_dir = profiles_dir.join(&safe_name);
    fs::create_dir_all(&profile_dir)
        .map_err(|e| format!("Failed to create profile directory: {}", e))?;

    // Prepare extension with profile-specific config
    let ext_dir = prepare_extension_for_profile(profile, &profile_dir, extension_template_dir)?;

    // Start local proxy relay if proxy has credentials
    let local_proxy_port = if let Some(proxy_str) = &profile.proxy {
        if let Some((user, pass)) = parse_proxy_credentials(proxy_str) {
            if let Some(parts) = parse_proxy_url(proxy_str) {
                match ProxyRelay::start(&parts.scheme, &parts.host, parts.port, &user, &pass) {
                    Ok(relay) => {
                        #[cfg(debug_assertions)]
                        println!("[Browser] Local proxy relay on port {}", relay.local_port);
                        Some(relay.local_port)
                    }
                    Err(e) => {
                        eprintln!("[Browser] Failed to start proxy relay: {}", e);
                        None
                    }
                }
            } else { None }
        } else { None }
    } else { None };

    // Build Chrome arguments
    let args = build_chrome_args(
        profile,
        &profile_dir,
        &ext_dir,
        local_proxy_port,
        cyberyozh_path.as_deref(),
    );

    // Pin CyberYozh extension in Chrome toolbar preferences
    if cyberyozh_path.is_some() {
        pin_extension_in_preferences(&profile_dir, CYBERYOZH_EXTENSION_ID);
    }

    // Determine effective timezone for environment variable
    let mut timezone = profile.timezone.clone();
    if let Some(proxy_str) = &profile.proxy {
        if let Some(country) = extract_country_from_proxy(proxy_str) {
            let locale = get_locale_for_country(&country);
            if timezone == "America/New_York" {
                timezone = locale.timezone.to_string();
            }
        }
    }

    #[cfg(debug_assertions)]
    {
        println!("[Browser] Chrome: {:?}", chrome_path);
        println!("[Browser] Profile dir: {:?}", profile_dir.display());
        println!("[Browser] Args: {:?}", args);
    }

    let mut cmd = Command::new(&chrome_path);
    cmd.args(&args);

    // Set timezone environment variable (Chrome respects TZ on some systems)
    cmd.env("TZ", &timezone);

    // Hide console window on Windows
    #[cfg(target_os = "windows")]
    {
        const CREATE_NO_WINDOW: u32 = 0x08000000;
        cmd.creation_flags(CREATE_NO_WINDOW);
    }

    cmd.spawn()
        .map_err(|e| format!("Failed to launch Chrome: {}. Path: {:?}", e, chrome_path))
}

/// Sanitize profile name for use as directory name
fn sanitize_profile_name(name: &str) -> String {
    name.chars()
        .map(|c| {
            if c.is_alphanumeric() || c == '-' || c == '_' {
                c
            } else {
                '_'
            }
        })
        .collect()
}
