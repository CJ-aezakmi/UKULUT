use std::env;
use std::fs;
use std::path::{Path, PathBuf};
use std::process::Command;

#[cfg(target_os = "windows")]
use std::os::windows::process::CommandExt;

use crate::models::Profile;
use crate::proxy_relay::ProxyRelay;

/// WebGL renderer presets (current Chrome-on-Windows ANGLE format, with PCI device id).
/// One is picked per profile from the profile seed.
const WEBGL_RENDERERS: &[&str] = &[
    "ANGLE (Intel, Intel(R) UHD Graphics 620 (0x00005917) Direct3D11 vs_5_0 ps_5_0, D3D11)",
    "ANGLE (Intel, Intel(R) UHD Graphics 630 (0x00003E9B) Direct3D11 vs_5_0 ps_5_0, D3D11)",
    "ANGLE (Intel, Intel(R) UHD Graphics 770 (0x00004680) Direct3D11 vs_5_0 ps_5_0, D3D11)",
    "ANGLE (Intel, Intel(R) Iris(R) Xe Graphics (0x00009A49) Direct3D11 vs_5_0 ps_5_0, D3D11)",
    "ANGLE (NVIDIA, NVIDIA GeForce GTX 1650 (0x00001F82) Direct3D11 vs_5_0 ps_5_0, D3D11)",
    "ANGLE (NVIDIA, NVIDIA GeForce GTX 1660 SUPER (0x000021C4) Direct3D11 vs_5_0 ps_5_0, D3D11)",
    "ANGLE (NVIDIA, NVIDIA GeForce RTX 3060 (0x00002504) Direct3D11 vs_5_0 ps_5_0, D3D11)",
    "ANGLE (NVIDIA, NVIDIA GeForce RTX 3070 (0x00002484) Direct3D11 vs_5_0 ps_5_0, D3D11)",
    "ANGLE (NVIDIA, NVIDIA GeForce RTX 4060 (0x00002882) Direct3D11 vs_5_0 ps_5_0, D3D11)",
    "ANGLE (AMD, AMD Radeon RX 580 2048SP (0x00006FDF) Direct3D11 vs_5_0 ps_5_0, D3D11)",
    "ANGLE (AMD, AMD Radeon RX 6600 (0x000073FF) Direct3D11 vs_5_0 ps_5_0, D3D11)",
    "ANGLE (AMD, AMD Radeon(TM) Graphics (0x00001638) Direct3D11 vs_5_0 ps_5_0, D3D11)",
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
        "UA" => LocaleInfo { timezone: "Europe/Kyiv", lang: "uk-UA" },
        "JP" => LocaleInfo { timezone: "Asia/Tokyo", lang: "ja-JP" },
        "CN" => LocaleInfo { timezone: "Asia/Shanghai", lang: "zh-CN" },
        "KR" => LocaleInfo { timezone: "Asia/Seoul", lang: "ko-KR" },
        "IN" => LocaleInfo { timezone: "Asia/Kolkata", lang: "en-IN" },
        "AU" => LocaleInfo { timezone: "Australia/Sydney", lang: "en-AU" },
        "CA" => LocaleInfo { timezone: "America/Toronto", lang: "en-CA" },
        "SE" => LocaleInfo { timezone: "Europe/Stockholm", lang: "sv-SE" },
        "NO" => LocaleInfo { timezone: "Europe/Oslo", lang: "nb-NO" },
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
        "IE" => LocaleInfo { timezone: "Europe/Dublin", lang: "en-IE" },
        "NZ" => LocaleInfo { timezone: "Pacific/Auckland", lang: "en-NZ" },
        "ZA" => LocaleInfo { timezone: "Africa/Johannesburg", lang: "en-ZA" },
        "SG" => LocaleInfo { timezone: "Asia/Singapore", lang: "en-SG" },
        "HK" => LocaleInfo { timezone: "Asia/Hong_Kong", lang: "zh-HK" },
        "TW" => LocaleInfo { timezone: "Asia/Taipei", lang: "zh-TW" },
        "TH" => LocaleInfo { timezone: "Asia/Bangkok", lang: "th-TH" },
        "VN" => LocaleInfo { timezone: "Asia/Ho_Chi_Minh", lang: "vi-VN" },
        "ID" => LocaleInfo { timezone: "Asia/Jakarta", lang: "id-ID" },
        "MY" => LocaleInfo { timezone: "Asia/Kuala_Lumpur", lang: "ms-MY" },
        "PH" => LocaleInfo { timezone: "Asia/Manila", lang: "en-PH" },
        "AE" => LocaleInfo { timezone: "Asia/Dubai", lang: "ar-AE" },
        "SA" => LocaleInfo { timezone: "Asia/Riyadh", lang: "ar-SA" },
        "IL" => LocaleInfo { timezone: "Asia/Jerusalem", lang: "he-IL" },
        "EG" => LocaleInfo { timezone: "Africa/Cairo", lang: "ar-EG" },
        "HU" => LocaleInfo { timezone: "Europe/Budapest", lang: "hu-HU" },
        "RO" => LocaleInfo { timezone: "Europe/Bucharest", lang: "ro-RO" },
        "BG" => LocaleInfo { timezone: "Europe/Sofia", lang: "bg-BG" },
        "RS" => LocaleInfo { timezone: "Europe/Belgrade", lang: "sr-RS" },
        "HR" => LocaleInfo { timezone: "Europe/Zagreb", lang: "hr-HR" },
        "SK" => LocaleInfo { timezone: "Europe/Bratislava", lang: "sk-SK" },
        "LT" => LocaleInfo { timezone: "Europe/Vilnius", lang: "lt-LT" },
        "LV" => LocaleInfo { timezone: "Europe/Riga", lang: "lv-LV" },
        "EE" => LocaleInfo { timezone: "Europe/Tallinn", lang: "et-EE" },
        "BY" => LocaleInfo { timezone: "Europe/Minsk", lang: "ru-BY" },
        "KZ" => LocaleInfo { timezone: "Asia/Almaty", lang: "ru-KZ" },
        "GE" => LocaleInfo { timezone: "Asia/Tbilisi", lang: "ka-GE" },
        "AM" => LocaleInfo { timezone: "Asia/Yerevan", lang: "hy-AM" },
        "AZ" => LocaleInfo { timezone: "Asia/Baku", lang: "az-AZ" },
        "UZ" => LocaleInfo { timezone: "Asia/Tashkent", lang: "uz-UZ" },
        "MD" => LocaleInfo { timezone: "Europe/Chisinau", lang: "ro-MD" },
        "CO" => LocaleInfo { timezone: "America/Bogota", lang: "es-CO" },
        "PE" => LocaleInfo { timezone: "America/Lima", lang: "es-PE" },
        "PK" => LocaleInfo { timezone: "Asia/Karachi", lang: "en-PK" },
        "BD" => LocaleInfo { timezone: "Asia/Dhaka", lang: "bn-BD" },
        "NG" => LocaleInfo { timezone: "Africa/Lagos", lang: "en-NG" },
        _ => LocaleInfo { timezone: "America/New_York", lang: "en-US" },
    }
}

/// Find Playwright Chromium binary (preferred) or system Chrome as fallback.
pub fn find_chrome() -> Option<PathBuf> {
    // First priority: Playwright Chromium (installed by the launcher)
    if let Some(pw_chromium) = find_playwright_chromium() {
        println!("[Browser] Using Playwright Chromium: {:?}", pw_chromium);
        return Some(pw_chromium);
    }

    println!("[Browser] WARNING: Playwright Chromium not found, falling back to system Chrome.");

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

/// Fingerprint script injected into every page and worker (see src/cdp.rs).
const STEALTH_JS: &str = include_str!("stealth.js");

/// Location settings resolved right before launch (profile values + proxy geo).
#[derive(Debug, Clone, Default)]
pub struct ResolvedLocale {
    /// IANA timezone; `None` keeps the system timezone (no proxy and "auto").
    pub timezone: Option<String>,
    /// BCP-47 language; `None` keeps the system language.
    pub lang: Option<String>,
}

pub const AUTO: &str = "auto";

fn is_auto(v: &str) -> bool {
    v.is_empty() || v.eq_ignore_ascii_case(AUTO)
}

/// Profiles created before "auto" existed were saved with these untouched defaults.
/// For a profile with a proxy they meant "pick from the proxy country" (old behaviour).
fn is_legacy_default(profile: &Profile) -> bool {
    profile.timezone == "America/New_York" && profile.lang == "en-US"
}

/// Combine the profile settings with the proxy exit location.
/// `geo` = (country code, timezone) of the proxy exit IP, if it could be looked up.
pub fn resolve_locale(profile: &Profile, proxy_country: Option<&str>, geo: Option<(String, String)>) -> ResolvedLocale {
    let has_proxy = profile.proxy.as_deref().map(|p| !p.trim().is_empty()).unwrap_or(false);
    let legacy_auto = has_proxy && is_legacy_default(profile);

    let country = geo
        .as_ref()
        .map(|(c, _)| c.clone())
        .or_else(|| proxy_country.map(|c| c.to_uppercase()))
        .or_else(|| profile.proxy.as_deref().and_then(extract_country_from_proxy));

    let timezone = if is_auto(&profile.timezone) || legacy_auto {
        geo.as_ref()
            .map(|(_, tz)| tz.clone())
            .filter(|tz| !tz.is_empty())
            .or_else(|| country.as_deref().map(|c| get_locale_for_country(c).timezone.to_string()))
    } else {
        Some(profile.timezone.clone())
    };

    let lang = if is_auto(&profile.lang) || legacy_auto {
        country.as_deref().map(|c| get_locale_for_country(c).lang.to_string())
    } else {
        Some(profile.lang.clone())
    };

    ResolvedLocale { timezone, lang }
}

/// Looks up the exit IP location of a proxy via ip-api.com (through the proxy itself).
/// Returns (country code, IANA timezone).
pub async fn lookup_proxy_geo(proxy_str: &str) -> Option<(String, String)> {
    let parts = parse_proxy_url(proxy_str)?;
    // socks5h → DNS through the proxy, same as the browser does
    let scheme = match parts.scheme.as_str() {
        "socks5" | "socks5h" => "socks5h",
        "socks4" => "socks4",
        "https" => "https",
        _ => "http",
    };
    let auth = match (&parts.username, &parts.password) {
        (Some(u), Some(p)) => format!("{}:{}@", url_encode(u), url_encode(p)),
        (Some(u), None) => format!("{}@", url_encode(u)),
        _ => String::new(),
    };
    let proxy_url = format!("{}://{}{}:{}", scheme, auth, parts.host, parts.port);
    let proxy = reqwest::Proxy::all(&proxy_url).ok()?;
    let client = reqwest::Client::builder()
        .proxy(proxy)
        .timeout(std::time::Duration::from_secs(10))
        .build()
        .ok()?;
    let data: serde_json::Value = client
        .get("http://ip-api.com/json/?fields=status,countryCode,timezone")
        .send()
        .await
        .ok()?
        .json()
        .await
        .ok()?;
    if data["status"] != "success" {
        return None;
    }
    Some((
        data["countryCode"].as_str()?.to_string(),
        data["timezone"].as_str().unwrap_or_default().to_string(),
    ))
}

fn url_encode(s: &str) -> String {
    let mut out = String::new();
    for b in s.bytes() {
        match b {
            b'A'..=b'Z' | b'a'..=b'z' | b'0'..=b'9' | b'-' | b'_' | b'.' | b'~' => out.push(b as char),
            _ => out.push_str(&format!("%{:02X}", b)),
        }
    }
    out
}

/// Stable 32-bit hash of the profile name — the fingerprint seed (canvas/audio noise,
/// WebGL preset) so a profile looks the same on every launch.
fn profile_seed(name: &str) -> u32 {
    let mut h: u32 = 0x811c9dc5;
    for b in name.bytes() {
        h ^= b as u32;
        h = h.wrapping_mul(0x01000193);
    }
    h
}

/// Builds the script source: `const __CFG__ = {...};` + stealth.js.
fn build_stealth_script(profile: &Profile) -> String {
    let seed = profile_seed(&profile.name);
    let renderer = WEBGL_RENDERERS[(seed as usize) % WEBGL_RENDERERS.len()];
    let vendor = if renderer.contains("NVIDIA") {
        "Google Inc. (NVIDIA)"
    } else if renderer.contains("AMD") {
        "Google Inc. (AMD)"
    } else {
        "Google Inc. (Intel)"
    };
    let cfg = serde_json::json!({
        "seed": seed,
        "deviceMemory": profile.ram,
        "screenWidth": profile.screen_width,
        "screenHeight": profile.screen_height,
        "touch": profile.is_touch,
        "webglVendor": vendor,
        "webglRenderer": renderer,
    });
    format!("const __CFG__ = {};\n{}", cfg, STEALTH_JS)
}

/// `de-DE` → `de-DE,de,en-US,en`
fn accept_languages(lang: &str) -> String {
    let mut list = vec![lang.to_string()];
    if let Some((base, _)) = lang.split_once('-') {
        list.push(base.to_string());
    }
    for extra in ["en-US", "en"] {
        if !list.iter().any(|l| l.eq_ignore_ascii_case(extra)) {
            list.push(extra.to_string());
        }
    }
    list.join(",")
}

/// Writes profile preferences Chromium reads at startup: languages, WebRTC policy and a
/// clean exit flag (prevents the "Restore pages?" bubble).
fn write_preferences(profile_dir: &Path, lang: Option<&str>) {
    let prefs_path = profile_dir.join("Default").join("Preferences");
    let mut prefs: serde_json::Value = fs::read_to_string(&prefs_path)
        .ok()
        .and_then(|c| serde_json::from_str(&c).ok())
        .filter(|v: &serde_json::Value| v.is_object())
        .unwrap_or_else(|| serde_json::json!({}));

    let set = |root: &mut serde_json::Value, path: &[&str], value: serde_json::Value| {
        let mut node = root;
        for key in &path[..path.len() - 1] {
            if !node.get(*key).map(|v| v.is_object()).unwrap_or(false) {
                node[*key] = serde_json::json!({});
            }
            node = node.get_mut(*key).unwrap();
        }
        node[path[path.len() - 1]] = value;
    };

    if let Some(lang) = lang {
        let langs = accept_languages(lang);
        set(&mut prefs, &["intl", "accept_languages"], serde_json::json!(langs));
        set(&mut prefs, &["intl", "selected_languages"], serde_json::json!(langs));
    }
    // WebRTC must not reveal the real IP: no UDP outside the proxy.
    set(&mut prefs, &["webrtc", "ip_handling_policy"], serde_json::json!("disable_non_proxied_udp"));
    set(&mut prefs, &["webrtc", "multiple_routes_enabled"], serde_json::json!(false));
    set(&mut prefs, &["webrtc", "nonproxied_udp_enabled"], serde_json::json!(false));
    set(&mut prefs, &["profile", "exit_type"], serde_json::json!("Normal"));
    set(&mut prefs, &["profile", "exited_cleanly"], serde_json::json!(true));

    if let Some(dir) = prefs_path.parent() {
        let _ = fs::create_dir_all(dir);
    }
    if let Ok(json) = serde_json::to_string(&prefs) {
        let _ = fs::write(&prefs_path, json);
    }
}

/// Percent-decode proxy credentials (UTF-8 aware; '+' stays literal in userinfo).
fn url_decode(s: &str) -> String {
    let bytes = s.as_bytes();
    let mut out = Vec::with_capacity(bytes.len());
    let mut i = 0;
    while i < bytes.len() {
        if bytes[i] == b'%' && i + 2 < bytes.len() {
            if let Some(b) = std::str::from_utf8(&bytes[i + 1..i + 3]).ok().and_then(|h| u8::from_str_radix(h, 16).ok()) {
                out.push(b);
                i += 3;
                continue;
            }
        }
        out.push(bytes[i]);
        i += 1;
    }
    String::from_utf8_lossy(&out).into_owned()
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
    let (scheme, rest) = proxy_str.trim().split_once("://")?;

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
        scheme: scheme.to_ascii_lowercase(),
        host: host.to_string(),
        port,
        username,
        password,
    })
}

/// Chromium `--proxy-server` value for proxies without credentials.
fn chrome_proxy_server(parts: &ProxyParts) -> String {
    let scheme = match parts.scheme.as_str() {
        "https" => "https",
        "socks4" => "socks4",
        "socks5" | "socks5h" | "socks" => "socks5",
        _ => "http",
    };
    format!("{}://{}:{}", scheme, parts.host, parts.port)
}

/// Build Chromium launch arguments.
fn build_chrome_args(profile: &Profile, profile_dir: &Path, proxy_server: Option<String>, lang: Option<&str>) -> Vec<String> {
    // Window slightly smaller than the spoofed screen: a window larger than `screen`
    // is an obvious inconsistency for fingerprinting scripts.
    let win_w = (profile.screen_width as f64 * 0.9).round() as u32;
    let win_h = (profile.screen_height as f64 * 0.9).round() as u32;

    let mut args = vec![
        format!("--user-data-dir={}", profile_dir.display()),
        // CDP endpoint for src/cdp.rs (random free port, localhost only)
        "--remote-debugging-port=0".to_string(),
        // Keeps navigator.webdriver = false although a debugger is attached
        "--disable-blink-features=AutomationControlled".to_string(),
        // Hides the "Chrome for Testing" / unsupported-flag bars
        "--disable-infobars".to_string(),
        "--no-first-run".to_string(),
        "--no-default-browser-check".to_string(),
        // The sandbox cannot read Playwright's chrome.exe (folder ACL) and the network
        // service crashes without this flag.
        "--no-sandbox".to_string(),
        // Single renderer per site group: frames are instrumented together with their page.
        "--disable-features=IsolateOrigins,site-per-process,GlobalMediaControls,MediaRouter,ChromeWhatsNewUI,PrivacySandboxSettings4,AutofillServerCommunication,TranslateUI".to_string(),
        "--disable-site-isolation-trials".to_string(),
        "--disable-background-mode".to_string(),
        "--disable-client-side-phishing-detection".to_string(),
        "--disable-default-apps".to_string(),
        "--disable-component-extensions-with-background-pages".to_string(),
        "--password-store=basic".to_string(),
        "--search-engine-choice-country=US".to_string(),
        // No UDP outside the proxy: no WebRTC/QUIC leaks of the real IP
        "--force-webrtc-ip-handling-policy=disable_non_proxied_udp".to_string(),
        "--disable-quic".to_string(),
        format!("--window-size={},{}", win_w.max(800), win_h.max(600)),
    ];

    if !profile.webgl {
        args.push("--disable-webgl".to_string());
    }
    if let Some(lang) = lang {
        args.push(format!("--lang={}", lang));
    }
    if let Some(server) = proxy_server {
        args.push(format!("--proxy-server={}", server));
    }

    // Chromium opens about:blank; the CDP controller navigates it to the homepage once
    // the fingerprint is installed.
    args.push("about:blank".to_string());
    args
}

fn homepage(profile: &Profile) -> String {
    let url = profile.homepage.trim();
    if url.is_empty() || url == "https://whoer.net" {
        "https://2ip.ru".to_string()
    } else if url.contains("://") {
        url.to_string()
    } else {
        format!("https://{}", url)
    }
}

/// Chromium holds `lockfile` open while a profile is running.
fn profile_in_use(profile_dir: &Path) -> bool {
    let lock = profile_dir.join("lockfile");
    lock.exists() && fs::remove_file(&lock).is_err()
}

/// Launch Chromium with the anti-detect profile.
pub fn launch_chrome(profile: &Profile, locale: &ResolvedLocale) -> Result<std::process::Child, String> {
    let chrome_path = find_chrome()
        .ok_or_else(|| "Chromium не найден. Перезапустите Antic Browser через лаунчер — он установит браузер.".to_string())?;

    let profile_dir = get_profiles_dir().join(sanitize_profile_name(&profile.name));
    fs::create_dir_all(&profile_dir).map_err(|e| format!("Failed to create profile directory: {}", e))?;

    if profile_in_use(&profile_dir) {
        return Err(format!("Профиль «{}» уже запущен", profile.name));
    }
    // Old extension copy from versions ≤ 2.0.20 is no longer used.
    let _ = fs::remove_dir_all(profile_dir.join("antidetect-extension"));
    let _ = fs::remove_file(crate::cdp::active_port_file(&profile_dir));

    write_preferences(&profile_dir, locale.lang.as_deref());

    // Proxy: credentials → local relay (Chromium can't authenticate SOCKS5 and would
    // show an auth dialog for HTTP); otherwise Chromium talks to the proxy directly.
    let mut proxy_server = None;
    if let Some(proxy_str) = profile.proxy.as_deref().filter(|p| !p.trim().is_empty()) {
        let parts = parse_proxy_url(proxy_str).ok_or_else(|| format!("Неверный формат прокси: {}", proxy_str))?;
        let user = parts.username.clone().unwrap_or_default();
        if !user.is_empty() {
            let relay = ProxyRelay::start(&parts.scheme, &parts.host, parts.port, &user, parts.password.as_deref().unwrap_or(""))
                .map_err(|e| format!("Не удалось запустить прокси-релей: {}", e))?;
            proxy_server = Some(format!("http://127.0.0.1:{}", relay.local_port));
        } else {
            proxy_server = Some(chrome_proxy_server(&parts));
        }
    }

    let args = build_chrome_args(profile, &profile_dir, proxy_server, locale.lang.as_deref());

    #[cfg(debug_assertions)]
    {
        println!("[Browser] Chrome: {:?}", chrome_path);
        println!("[Browser] Locale: {:?}", locale);
        println!("[Browser] Args: {:?}", args);
    }

    let mut cmd = Command::new(&chrome_path);
    cmd.args(&args);
    #[cfg(target_os = "windows")]
    {
        const CREATE_NO_WINDOW: u32 = 0x08000000;
        cmd.creation_flags(CREATE_NO_WINDOW);
    }
    let child = cmd
        .spawn()
        .map_err(|e| format!("Failed to launch Chrome: {}. Path: {:?}", e, chrome_path))?;

    crate::cdp::attach(
        profile_dir,
        crate::cdp::Overrides {
            timezone: locale.timezone.clone(),
            hardware_concurrency: profile.cpu,
            script: build_stealth_script(profile),
            start_url: homepage(profile),
        },
    );

    Ok(child)
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

#[cfg(test)]
mod tests {
    use super::*;

    fn profile(tz: &str, lang: &str, proxy: Option<&str>) -> Profile {
        Profile {
            name: "p".into(),
            user_agent: String::new(),
            screen_width: 1920,
            screen_height: 1080,
            timezone: tz.into(),
            lang: lang.into(),
            proxy: proxy.map(String::from),
            cookies: None,
            webgl: true,
            vendor: "Google Inc.".into(),
            cpu: 8,
            ram: 8,
            is_touch: false,
            homepage: String::new(),
        }
    }

    #[test]
    fn auto_locale_follows_proxy_geo() {
        let p = profile("auto", "auto", Some("http://u:p@1.2.3.4:80"));
        let r = resolve_locale(&p, None, Some(("DE".into(), "Europe/Berlin".into())));
        assert_eq!(r.timezone.as_deref(), Some("Europe/Berlin"));
        assert_eq!(r.lang.as_deref(), Some("de-DE"));
    }

    #[test]
    fn explicit_locale_wins_and_no_proxy_keeps_system() {
        let p = profile("Asia/Tokyo", "ja-JP", Some("http://1.2.3.4:80"));
        let r = resolve_locale(&p, None, Some(("DE".into(), "Europe/Berlin".into())));
        assert_eq!(r.timezone.as_deref(), Some("Asia/Tokyo"));
        assert_eq!(r.lang.as_deref(), Some("ja-JP"));

        let r = resolve_locale(&profile("auto", "auto", None), None, None);
        assert!(r.timezone.is_none() && r.lang.is_none());
    }

    #[test]
    fn legacy_defaults_with_proxy_become_auto() {
        let p = profile("America/New_York", "en-US", Some("socks5://u:p@1.2.3.4:1080"));
        let r = resolve_locale(&p, Some("fr"), None);
        assert_eq!(r.timezone.as_deref(), Some("Europe/Paris"));
        assert_eq!(r.lang.as_deref(), Some("fr-FR"));
    }

    #[test]
    fn parses_proxy_urls() {
        let p = parse_proxy_url("SOCKS5://us%40er:p%C3%A4ss@host.com:1080").unwrap();
        assert_eq!(p.scheme, "socks5");
        assert_eq!(p.username.as_deref(), Some("us@er"));
        assert_eq!(p.password.as_deref(), Some("päss"));
        assert_eq!((p.host.as_str(), p.port), ("host.com", 1080));
        assert_eq!(accept_languages("de-DE"), "de-DE,de,en-US,en");
        assert_eq!(accept_languages("en-US"), "en-US,en");
    }
}

/// End-to-end launch through the real code path (not run by default):
/// E2E_URL=http://... E2E_PROXY=socks5://... E2E_TZ=Asia/Tokyo E2E_LANG=ja-JP \
///   cargo test --lib launch_e2e -- --ignored --nocapture
#[cfg(test)]
mod e2e {
    use super::*;

    #[tokio::test]
    #[ignore]
    async fn launch_e2e() {
        let env = |k: &str, d: &str| std::env::var(k).unwrap_or_else(|_| d.to_string());
        let profile = Profile {
            name: "antic-e2e-test".into(),
            user_agent: String::new(),
            screen_width: 1600,
            screen_height: 900,
            timezone: env("E2E_TZ", "auto"),
            lang: env("E2E_LANG", "auto"),
            proxy: std::env::var("E2E_PROXY").ok(),
            cookies: None,
            webgl: true,
            vendor: "Google Inc.".into(),
            cpu: 6,
            ram: 4,
            is_touch: false,
            homepage: env("E2E_URL", "https://2ip.ru"),
        };
        let geo = match &profile.proxy {
            Some(p) => lookup_proxy_geo(p).await,
            None => None,
        };
        println!("geo: {:?}", geo);
        let locale = resolve_locale(&profile, None, geo);
        println!("locale: {:?}", locale);
        let mut child = launch_chrome(&profile, &locale).expect("launch");
        tokio::time::sleep(std::time::Duration::from_secs(env("E2E_WAIT", "25").parse().unwrap())).await;
        let _ = child.kill();
        tokio::time::sleep(std::time::Duration::from_secs(2)).await;
        let _ = fs::remove_dir_all(get_profiles_dir().join("antic-e2e-test"));
    }
}
