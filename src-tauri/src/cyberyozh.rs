//! CyberYozh (app.cyberyozh.com) proxy-shop integration.
//!
//! All HTTP traffic to CyberYozh goes through this module (the frontend never calls the
//! API directly, so no CSP change is needed). The API is inconsistent in places
//! (ports as numbers or strings, `"---"` placeholders, `expired` as bool or string), so
//! responses are parsed leniently via `serde_json::Value`.
//!
//! Never log the API key or proxy credentials from here.

use crate::models::Proxy;
use crate::storage::Storage;
use reqwest::{Client, Method, StatusCode};
use serde::{Deserialize, Serialize};
use serde_json::{json, Value};
use std::collections::HashSet;
use std::sync::{Arc, Mutex};
use std::time::{Duration, Instant};
use tauri::State;

const BASE_URL: &str = "https://app.cyberyozh.com";

/// Every throttling error starts with this text, so the UI can recognise it.
pub const THROTTLE_PREFIX: &str = "Слишком много запросов к CyberYozh";

/// UI category → (shop `proxy_category` filter, forced `access_type` filter).
///
/// The OpenAPI spec lists `datacenter_dedicated` / `datacenter_shared` for the shop filter,
/// but the live API (Nov 2026) rejects them with 400 "Select a valid choice" and instead
/// uses `datacenter` + `access_type=private|shared`.
const CATEGORIES: &[(&str, &str, Option<&str>)] = &[
    ("lte", "lte", None),
    ("residential_static", "residential_static", None),
    ("residential_rotating", "residential_rotating", None),
    ("datacenter_dedicated", "datacenter", Some("private")),
    ("datacenter_shared", "datacenter", Some("shared")),
];

const SESSION_TYPES: &[&str] = &["random", "short_session", "long_session"];

/// Max history pages fetched in one "my proxies" call (page_size = 100).
const HISTORY_MAX_PAGES: u32 = 10;

/// Shop pagination when loading a whole category.
const SHOP_PAGE_SIZE: u32 = 100;
const SHOP_MAX_PAGES: u32 = 5;

/// Client-side cooldown after the API throttled us: requests made before this instant
/// fail fast instead of hitting the API again (which would only extend the ban).
static THROTTLE_UNTIL: Mutex<Option<Instant>> = Mutex::new(None);

// ============================================================================
// DATA TYPES (serialized to the frontend, snake_case)
// ============================================================================

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct CyberYozhBalance {
    pub valid: bool,
    /// Balance in USD as returned by the API (e.g. "1.71").
    pub balance: Option<String>,
    pub message: String,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct CyberYozhShopProduct {
    pub id: String,
    pub title: String,
    pub country_codes: Vec<String>,
    pub price_usd: f64,
    pub price_per_day: Option<f64>,
    pub discounted_price: Option<f64>,
    pub days: Option<u32>,
    pub category: String,
    pub in_stock: bool,
    /// Traffic limit in MB; `None` = unlimited.
    pub traffic_limit_mb: Option<i64>,
    pub auto_renew_possible: bool,
    pub protocols: Vec<String>,
    pub max_quantity: Option<u32>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct CyberYozhShopGroup {
    /// Stable key for deduplication across pages.
    pub key: String,
    pub title: String,
    pub category: String,
    pub access_type: Option<String>,
    pub country_codes: Vec<String>,
    pub min_price_per_day: Option<f64>,
    /// True if at least one product of the group is in stock.
    pub in_stock: bool,
    pub products: Vec<CyberYozhShopProduct>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct CyberYozhShopPage {
    pub count: u32,
    pub page: u32,
    pub has_next: bool,
    pub groups: Vec<CyberYozhShopGroup>,
}

/// Whole in-stock catalog of one category (all pages merged and deduplicated).
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct CyberYozhShopCatalog {
    pub category: String,
    /// Group count reported by the API.
    pub total: u32,
    /// False if loading stopped early (throttling / page limit) — UI shows a hint.
    pub complete: bool,
    pub groups: Vec<CyberYozhShopGroup>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct CyberYozhBuyResult {
    /// "in_progress" (normal; provisioning is async) or another API status.
    pub status: String,
    pub message: Option<String>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct CyberYozhMyProxy {
    pub id: String,
    pub category: Option<String>,
    pub access_type: Option<String>,
    pub system_status: Option<String>,
    pub order_status: Option<String>,
    pub expired: bool,
    /// active, not expired, credentials issued → can be imported.
    pub importable: bool,
    /// "active" | "expired" | "deleted" | "pending"
    pub status: String,
    /// Scheme used for import ("http" | "socks5").
    pub protocol: String,
    pub host: Option<String>,
    /// Port used for import (http port when available).
    pub port: Option<u16>,
    /// `protocol://host:port` without credentials, for display.
    pub display: Option<String>,
    /// Full proxy string with credentials, used for import.
    pub proxy_str: Option<String>,
    pub country: Option<String>,
    pub public_ip: Option<String>,
    pub access_starts_at: Option<String>,
    pub access_expires_at: Option<String>,
    /// Remaining traffic in bytes; `None` = unlimited / unknown.
    pub traffic_remains: Option<i64>,
    pub change_ip_links: Vec<String>,
    // Raw connection data (needed to generate rotating credentials).
    pub connection_host: Option<String>,
    pub connection_port: Option<u16>,
    pub connection_login: Option<String>,
    pub connection_password: Option<String>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct CyberYozhImportItem {
    pub proxy_str: String,
    pub country: Option<String>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct CyberYozhImportResult {
    pub imported: u32,
    pub skipped: u32,
    pub failed: u32,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct CyberYozhRotatingRequest {
    pub connection_host: String,
    pub connection_port: u16,
    pub connection_login: String,
    pub connection_password: String,
    /// random | short_session | long_session
    pub session_type: String,
    pub country_code: Option<String>,
    pub region: Option<String>,
    pub city: Option<String>,
    pub amount: Option<u32>,
    /// Scheme for the generated proxy strings ("socks5" | "http"); default socks5.
    pub protocol: Option<String>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct CyberYozhGeneratedProxy {
    pub proxy_str: String,
    pub display: String,
    pub country: Option<String>,
}

// ============================================================================
// HTTP CLIENT
// ============================================================================

struct CyberYozhClient {
    http: Client,
    key: String,
}

impl CyberYozhClient {
    fn new(api_key: &str) -> Result<Self, String> {
        let key = api_key.trim().to_string();
        if key.is_empty() {
            return Err("Введите API ключ CyberYozh".to_string());
        }
        let http = Client::builder()
            .connect_timeout(Duration::from_secs(10))
            .timeout(Duration::from_secs(30))
            .user_agent(concat!("AnticBrowser/", env!("CARGO_PKG_VERSION")))
            .build()
            .map_err(|e| format!("Не удалось создать HTTP клиент: {}", e))?;
        Ok(Self { http, key })
    }

    /// Sends a request. Throttling (429) is turned into an error and arms the cooldown;
    /// every other status is returned to the caller together with the body.
    async fn send(
        &self,
        method: Method,
        path: &str,
        query: &[(&str, String)],
        body: Option<&Value>,
        timeout: Duration,
    ) -> Result<(StatusCode, String), String> {
        check_cooldown()?;

        let mut rb = self
            .http
            .request(method, format!("{}{}", BASE_URL, path))
            .header("X-Api-Key", &self.key)
            .header("Accept", "application/json")
            .timeout(timeout);
        if !query.is_empty() {
            rb = rb.query(query);
        }
        if let Some(b) = body {
            rb = rb.json(b);
        }

        let resp = rb.send().await.map_err(network_error)?;
        let status = resp.status();
        let retry_after = resp
            .headers()
            .get("retry-after")
            .and_then(|v| v.to_str().ok())
            .and_then(|s| s.trim().parse::<u64>().ok());
        let text = resp.text().await.map_err(network_error)?;

        if status == StatusCode::TOO_MANY_REQUESTS
            || (!status.is_success() && text.to_lowercase().contains("throttled"))
        {
            let secs = retry_after.or_else(|| parse_wait_seconds(&text)).unwrap_or(30);
            set_cooldown(secs);
            return Err(throttle_message(secs));
        }

        Ok((status, text))
    }

    async fn get(&self, path: &str, query: &[(&str, String)]) -> Result<Value, String> {
        let (status, text) = self
            .send(Method::GET, path, query, None, Duration::from_secs(30))
            .await?;
        if !status.is_success() {
            return Err(api_error(status, &text));
        }
        serde_json::from_str(&text)
            .map_err(|_| "CyberYozh вернул неожиданный ответ. Попробуйте позже".to_string())
    }

    async fn balance(&self) -> Result<Option<String>, String> {
        let (status, text) = self
            .send(Method::GET, "/api/v2/users/balance/", &[], None, Duration::from_secs(20))
            .await?;
        if status == StatusCode::UNAUTHORIZED || status == StatusCode::FORBIDDEN {
            return Ok(None);
        }
        if !status.is_success() {
            return Err(api_error(status, &text));
        }
        parse_balance(&text)
            .map(Some)
            .ok_or_else(|| "Не удалось прочитать баланс CyberYozh".to_string())
    }
}

fn network_error(e: reqwest::Error) -> String {
    if e.is_timeout() {
        "CyberYozh не отвечает (таймаут). Попробуйте позже".to_string()
    } else if e.is_connect() {
        "Не удалось подключиться к CyberYozh. Проверьте интернет-соединение".to_string()
    } else {
        format!("Ошибка сети при обращении к CyberYozh: {}", e.without_url())
    }
}

fn check_cooldown() -> Result<(), String> {
    let mut guard = THROTTLE_UNTIL.lock().unwrap_or_else(|p| p.into_inner());
    if let Some(until) = *guard {
        let now = Instant::now();
        if now < until {
            let secs = (until - now).as_secs() + 1;
            return Err(throttle_message(secs));
        }
        *guard = None;
    }
    Ok(())
}

fn set_cooldown(secs: u64) {
    let secs = secs.clamp(1, 600);
    let mut guard = THROTTLE_UNTIL.lock().unwrap_or_else(|p| p.into_inner());
    *guard = Some(Instant::now() + Duration::from_secs(secs));
}

fn throttle_message(secs: u64) -> String {
    format!("{}. Повторите через {} сек.", THROTTLE_PREFIX, secs)
}

/// "Request was throttled. Expected available in 46 seconds." → 46
fn parse_wait_seconds(body: &str) -> Option<u64> {
    let lower = body.to_lowercase();
    let idx = lower.find("available in")?;
    let digits: String = lower[idx + "available in".len()..]
        .chars()
        .skip_while(|c| !c.is_ascii_digit())
        .take_while(|c| c.is_ascii_digit())
        .collect();
    digits.parse().ok()
}

/// Extracts a human-readable message from a DRF-style error body.
fn extract_error_message(body: &str) -> Option<String> {
    fn from_value(v: &Value) -> Option<String> {
        match v {
            Value::String(s) if !s.trim().is_empty() => Some(s.trim().to_string()),
            Value::Array(arr) => arr.iter().find_map(from_value),
            Value::Object(map) => {
                for k in ["detail", "message", "error", "non_field_errors", "errors"] {
                    if let Some(m) = map.get(k).and_then(from_value) {
                        return Some(m);
                    }
                }
                // Field errors: {"field": ["msg"]}
                map.iter().find_map(|(k, v)| from_value(v).map(|m| format!("{}: {}", k, m)))
            }
            _ => None,
        }
    }
    let v: Value = serde_json::from_str(body).ok()?;
    from_value(&v)
}

fn api_error(status: StatusCode, body: &str) -> String {
    if status == StatusCode::UNAUTHORIZED || status == StatusCode::FORBIDDEN {
        return "Неверный API ключ CyberYozh или нет доступа. Проверьте ключ".to_string();
    }
    let msg = extract_error_message(body);
    let lower = msg.clone().unwrap_or_default().to_lowercase() + &body.to_lowercase();
    if lower.contains("insufficient")
        || lower.contains("not enough")
        || lower.contains("недостаточно")
        || (lower.contains("balance") && status.is_client_error())
    {
        return "Недостаточно средств на балансе CyberYozh. Пополните баланс в личном кабинете"
            .to_string();
    }
    if status == StatusCode::NOT_FOUND {
        return "Не найдено. Возможно, товар больше не доступен".to_string();
    }
    if status.is_server_error() {
        return format!("Ошибка сервера CyberYozh ({}). Попробуйте позже", status.as_u16());
    }
    match msg {
        Some(m) => format!("CyberYozh: {}", truncate(&m, 300)),
        None => format!("CyberYozh вернул ошибку HTTP {}", status.as_u16()),
    }
}

fn truncate(s: &str, max: usize) -> String {
    if s.chars().count() <= max {
        s.to_string()
    } else {
        s.chars().take(max).collect::<String>() + "…"
    }
}

// ============================================================================
// LENIENT PARSING HELPERS
// ============================================================================

fn v_str(v: &Value, key: &str) -> Option<String> {
    match v.get(key)? {
        Value::String(s) => {
            let s = s.trim();
            if s.is_empty() || s == "---" || s == "!" {
                None
            } else {
                Some(s.to_string())
            }
        }
        Value::Number(n) => Some(n.to_string()),
        _ => None,
    }
}

fn v_f64(v: &Value, key: &str) -> Option<f64> {
    match v.get(key)? {
        Value::Number(n) => n.as_f64(),
        Value::String(s) => s.trim().parse().ok(),
        _ => None,
    }
}

fn v_i64(v: &Value, key: &str) -> Option<i64> {
    match v.get(key)? {
        Value::Number(n) => n.as_i64().or_else(|| n.as_f64().map(|f| f as i64)),
        Value::String(s) => s.trim().parse().ok(),
        _ => None,
    }
}

fn v_bool(v: &Value, key: &str) -> Option<bool> {
    match v.get(key)? {
        Value::Bool(b) => Some(*b),
        Value::String(s) => match s.trim().to_lowercase().as_str() {
            "true" | "1" | "yes" => Some(true),
            "false" | "0" | "no" => Some(false),
            _ => None,
        },
        Value::Number(n) => n.as_i64().map(|i| i != 0),
        _ => None,
    }
}

fn parse_port(v: Option<&Value>) -> Option<u16> {
    let p = match v? {
        Value::Number(n) => n.as_u64()?,
        Value::String(s) => s.trim().parse::<u64>().ok()?,
        _ => return None,
    };
    if p == 0 || p > u16::MAX as u64 {
        None
    } else {
        Some(p as u16)
    }
}

fn split_countries(s: &str) -> Vec<String> {
    s.split(',')
        .map(|c| c.trim().to_uppercase())
        .filter(|c| !c.is_empty())
        .collect()
}

fn parse_balance(text: &str) -> Option<String> {
    let t = text.trim();
    let raw = match serde_json::from_str::<Value>(t) {
        Ok(Value::Number(n)) => n.to_string(),
        Ok(Value::String(s)) => s,
        Ok(obj @ Value::Object(_)) => v_str(&obj, "balance").or_else(|| v_str(&obj, "amount"))?,
        _ => t.to_string(),
    };
    let cleaned = raw.trim().trim_matches('"').replace(['$', ' '], "");
    let value: f64 = cleaned.parse().ok()?;
    Some(format!("{:.2}", value))
}

fn results_of(v: &Value) -> Vec<Value> {
    match v {
        Value::Array(a) => a.clone(),
        _ => v.get("results").and_then(|r| r.as_array()).cloned().unwrap_or_default(),
    }
}

fn has_next(v: &Value) -> bool {
    v.get("next").map(|n| !n.is_null()).unwrap_or(false)
}

// ============================================================================
// SHOP PARSING
// ============================================================================

fn parse_shop_product(p: &Value, parent: &Value) -> Option<CyberYozhShopProduct> {
    let id = v_str(p, "id")?;
    let category = v_str(p, "proxy_category")
        .or_else(|| v_str(parent, "proxy_category"))
        .unwrap_or_default();
    let countries = v_str(p, "location_country_code")
        .or_else(|| v_str(parent, "location_country_code"))
        .map(|s| split_countries(&s))
        .unwrap_or_default();
    let traffic = v_i64(p, "traffic_limitation").filter(|t| *t > 0);
    let protocols = p
        .get("protocols")
        .and_then(|a| a.as_array())
        .map(|a| a.iter().filter_map(|x| x.as_str().map(|s| s.to_string())).collect())
        .unwrap_or_default();
    Some(CyberYozhShopProduct {
        id,
        title: v_str(p, "title").unwrap_or_default(),
        country_codes: countries,
        price_usd: v_f64(p, "price_usd").unwrap_or(0.0),
        price_per_day: v_f64(p, "price_per_day"),
        discounted_price: v_f64(p, "discounted_price"),
        days: v_i64(p, "days").filter(|d| *d > 0).map(|d| d as u32),
        category,
        in_stock: v_str(p, "stock_status").as_deref() == Some("in_stock"),
        traffic_limit_mb: traffic,
        auto_renew_possible: v_bool(p, "is_auto_renewal_possible").unwrap_or(false),
        protocols,
        max_quantity: v_i64(p, "max_quantity").filter(|q| *q > 0).map(|q| q as u32),
    })
}

fn parse_shop_group(g: &Value) -> Option<CyberYozhShopGroup> {
    let mut products: Vec<CyberYozhShopProduct> = g
        .get("proxy_products")
        .and_then(|a| a.as_array())
        .map(|a| a.iter().filter_map(|p| parse_shop_product(p, g)).collect())
        .unwrap_or_default();
    if products.is_empty() {
        return None;
    }
    products.sort_by(|a, b| {
        (a.days.unwrap_or(0), a.traffic_limit_mb.unwrap_or(i64::MAX))
            .cmp(&(b.days.unwrap_or(0), b.traffic_limit_mb.unwrap_or(i64::MAX)))
            .then(a.price_usd.partial_cmp(&b.price_usd).unwrap_or(std::cmp::Ordering::Equal))
    });

    let title = v_str(g, "title").unwrap_or_else(|| products[0].title.clone());
    let category = v_str(g, "proxy_category").unwrap_or_else(|| products[0].category.clone());
    let access_type = v_str(g, "access_type");
    let country_codes = v_str(g, "location_country_code")
        .map(|s| split_countries(&s))
        .unwrap_or_else(|| products[0].country_codes.clone());
    let key = format!(
        "{}|{}|{}|{}",
        category,
        access_type.clone().unwrap_or_default(),
        title,
        country_codes.join(",")
    );
    let in_stock = products.iter().any(|p| p.in_stock);
    Some(CyberYozhShopGroup {
        key,
        title,
        category,
        access_type,
        country_codes,
        min_price_per_day: v_f64(g, "min_price_per_day").or_else(|| {
            products
                .iter()
                .filter(|p| p.in_stock)
                .filter_map(|p| p.price_per_day.or_else(|| p.days.map(|d| p.price_usd / d as f64)))
                .fold(None, |acc: Option<f64>, x| Some(acc.map_or(x, |a| a.min(x))))
        }),
        in_stock,
        products,
    })
}

fn parse_shop_page(v: &Value, page: u32) -> CyberYozhShopPage {
    let groups = results_of(v).iter().filter_map(parse_shop_group).collect();
    CyberYozhShopPage {
        count: v_i64(v, "count").unwrap_or(0).max(0) as u32,
        page,
        has_next: has_next(v),
        groups,
    }
}

// ============================================================================
// HISTORY ("MY PROXIES") PARSING
// ============================================================================

fn build_proxy_str(scheme: &str, login: Option<&str>, password: Option<&str>, host: &str, port: u16) -> String {
    match (login, password) {
        (Some(l), Some(p)) => format!("{}://{}:{}@{}:{}", scheme, l, p, host, port),
        (Some(l), None) => format!("{}://{}@{}:{}", scheme, l, host, port),
        _ => format!("{}://{}:{}", scheme, host, port),
    }
}

/// Maps the scheme part of `url` ("socks5", "socks5_http", "http", ...) to the scheme we store.
fn scheme_from_url(url: Option<&str>) -> &'static str {
    let scheme = url
        .and_then(|u| u.split_once("://").map(|(s, _)| s.to_lowercase()))
        .unwrap_or_default();
    if scheme.starts_with("socks5") || scheme.starts_with("socks") {
        "socks5"
    } else if scheme.starts_with("http") {
        "http"
    } else if url.is_some() && scheme.is_empty() {
        "http"
    } else {
        // No url at all — CyberYozh issues socks5 by default.
        "socks5"
    }
}

fn parse_history_item(item: &Value, now: chrono::DateTime<chrono::Utc>) -> Option<CyberYozhMyProxy> {
    let id = v_str(item, "id")?;
    let url = v_str(item, "url");
    let host = v_str(item, "connection_host");
    let main_port = parse_port(item.get("connection_port"));
    let ports = item.get("connection_ports");
    let http_port = ports.and_then(|p| parse_port(p.get("http")));
    let login = v_str(item, "connection_login");
    let password = v_str(item, "connection_password");

    // Import format: http port if CyberYozh exposes one, otherwise the url scheme on connection_port.
    let (protocol, port) = match http_port {
        Some(hp) => ("http", Some(hp)),
        None => (scheme_from_url(url.as_deref()), main_port),
    };

    let access_expires_at = v_str(item, "access_expires_at");
    let expired = v_bool(item, "expired").unwrap_or_else(|| {
        access_expires_at
            .as_deref()
            .and_then(|s| chrono::DateTime::parse_from_rfc3339(s).ok())
            .map(|d| d.with_timezone(&chrono::Utc) < now)
            .unwrap_or(false)
    });
    let system_status = v_str(item, "system_status");
    let order_status = v_str(item, "order_status");
    let deleted = system_status.as_deref() == Some("deleted");
    let has_connection = host.is_some() && port.is_some();

    let status = if deleted {
        "deleted"
    } else if expired {
        "expired"
    } else if !has_connection
        || order_status.as_deref().map(|s| s != "success").unwrap_or(false)
    {
        "pending"
    } else {
        "active"
    };
    let importable = status == "active";

    let (display, proxy_str) = match (&host, port) {
        (Some(h), Some(p)) => (
            Some(format!("{}://{}:{}", protocol, h, p)),
            Some(build_proxy_str(protocol, login.as_deref(), password.as_deref(), h, p)),
        ),
        _ => (None, None),
    };

    let country = match item.get("geoip") {
        Some(g @ Value::Object(_)) => v_str(g, "countryCode2").map(|c| c.to_uppercase()),
        _ => None,
    };
    let change_ip_links = match item.get("change_ip_links") {
        Some(Value::Array(a)) => a
            .iter()
            .filter_map(|x| match x {
                Value::String(s) => Some(s.clone()),
                Value::Object(_) => v_str(x, "url").or_else(|| v_str(x, "link")),
                _ => None,
            })
            .collect(),
        Some(Value::String(s)) if s.starts_with("http") => vec![s.clone()],
        _ => vec![],
    };

    Some(CyberYozhMyProxy {
        id,
        category: v_str(item, "proxy_category"),
        access_type: v_str(item, "access_type"),
        system_status,
        order_status,
        expired,
        importable,
        status: status.to_string(),
        protocol: protocol.to_string(),
        host: host.clone(),
        port,
        display,
        proxy_str,
        country,
        public_ip: v_str(item, "public_ipaddress"),
        access_starts_at: v_str(item, "access_starts_at"),
        access_expires_at,
        traffic_remains: v_i64(item, "traffic_remains").filter(|t| *t >= 0),
        change_ip_links,
        connection_host: host,
        connection_port: main_port,
        connection_login: login,
        connection_password: password,
    })
}

fn status_rank(s: &str) -> u8 {
    match s {
        "active" => 0,
        "pending" => 1,
        "expired" => 2,
        _ => 3,
    }
}

// ============================================================================
// PROXY STRING PARSING (for import / generated credentials)
// ============================================================================

struct ParsedProxy {
    scheme: String,
    host: String,
    port: u16,
    username: Option<String>,
    password: Option<String>,
}

/// Parses `scheme://[user[:pass]@]host:port`.
fn parse_proxy_str(s: &str) -> Option<ParsedProxy> {
    let (scheme, rest) = s.trim().split_once("://")?;
    let scheme = scheme.to_lowercase();
    if scheme != "http" && scheme != "https" && scheme != "socks5" {
        return None;
    }
    let (creds, hostport) = match rest.rsplit_once('@') {
        Some((c, hp)) => (Some(c), hp),
        None => (None, rest),
    };
    let hostport = hostport.trim_end_matches('/');
    let (host, port) = hostport.rsplit_once(':')?;
    let port: u16 = port.parse().ok().filter(|p| *p > 0)?;
    if host.is_empty() {
        return None;
    }
    let (username, password) = match creds {
        Some(c) => match c.split_once(':') {
            Some((u, p)) => (Some(u.to_string()), Some(p.to_string())),
            None => (Some(c.to_string()), None),
        },
        None => (None, None),
    };
    Some(ParsedProxy { scheme, host: host.to_string(), port, username, password })
}

fn mask_proxy(p: &ParsedProxy) -> String {
    format!("{}://{}:{}", p.scheme, p.host, p.port)
}

/// Normalises one entry of the (loosely specified) rotating-credentials response.
fn credential_to_proxy_str(entry: &Value, scheme: &str) -> Option<String> {
    match entry {
        Value::String(s) => {
            let s = s.trim();
            if s.contains("://") {
                let (sch, rest) = s.split_once("://")?;
                let sch = if sch.to_lowercase().starts_with("socks") { "socks5" } else { "http" };
                let candidate = format!("{}://{}", sch, rest);
                return parse_proxy_str(&candidate).map(|_| candidate);
            }
            if s.contains('@') {
                let candidate = format!("{}://{}", scheme, s);
                return parse_proxy_str(&candidate).map(|_| candidate);
            }
            // host:port:login:password
            let parts: Vec<&str> = s.splitn(4, ':').collect();
            if parts.len() == 4 {
                let port: u16 = parts[1].parse().ok()?;
                return Some(build_proxy_str(scheme, Some(parts[2]), Some(parts[3]), parts[0], port));
            }
            None
        }
        Value::Object(_) => {
            for k in ["url", "proxy", "proxy_str", "connection_string", "credentials"] {
                if let Some(inner) = entry.get(k) {
                    if let Some(s) = credential_to_proxy_str(inner, scheme) {
                        return Some(s);
                    }
                }
            }
            let host = v_str(entry, "connection_host").or_else(|| v_str(entry, "host"))?;
            let port = parse_port(entry.get("connection_port")).or_else(|| parse_port(entry.get("port")))?;
            let login = v_str(entry, "connection_login")
                .or_else(|| v_str(entry, "login"))
                .or_else(|| v_str(entry, "username"));
            let password = v_str(entry, "connection_password").or_else(|| v_str(entry, "password"));
            Some(build_proxy_str(scheme, login.as_deref(), password.as_deref(), &host, port))
        }
        _ => None,
    }
}

// ============================================================================
// TAURI COMMANDS
// ============================================================================

/// Checks the key by requesting the balance (v2 endpoint; v1 returns 401).
#[tauri::command]
pub async fn cyberyozh_validate_key(api_key: String) -> Result<CyberYozhBalance, String> {
    let client = CyberYozhClient::new(&api_key)?;
    match client.balance().await? {
        Some(balance) => Ok(CyberYozhBalance {
            valid: true,
            message: format!("Баланс: ${}", balance),
            balance: Some(balance),
        }),
        None => Ok(CyberYozhBalance {
            valid: false,
            balance: None,
            message: "Неверный API ключ CyberYozh".to_string(),
        }),
    }
}

#[tauri::command]
pub async fn cyberyozh_get_balance(api_key: String) -> Result<String, String> {
    let client = CyberYozhClient::new(&api_key)?;
    client
        .balance()
        .await?
        .ok_or_else(|| "Неверный API ключ CyberYozh".to_string())
}

/// Loads the in-stock catalog of a category.
///
/// The server ignores the documented `country_code` filter (verified Nov 2026), so the
/// whole category is fetched here (page_size=100 → 1–2 requests per category, ~150 groups
/// max) and the UI filters by country locally. Fetching per category keeps us well away
/// from the throttle limit compared to pulling all ~600 groups.
#[tauri::command]
pub async fn cyberyozh_get_shop(
    api_key: String,
    category: String,
    access_type: Option<String>,
) -> Result<CyberYozhShopCatalog, String> {
    let Some(&(_, api_category, forced_access)) =
        CATEGORIES.iter().find(|(ui, _, _)| *ui == category.as_str())
    else {
        return Err(format!("Неизвестная категория прокси: {}", category));
    };
    let access = forced_access
        .map(str::to_string)
        .or(access_type.filter(|a| a == "private" || a == "shared"));

    let client = CyberYozhClient::new(&api_key)?;
    let mut groups: Vec<CyberYozhShopGroup> = Vec::new();
    let mut seen_groups = HashSet::new();
    let mut seen_products = HashSet::new();
    let mut total = 0;
    let mut complete = false;

    for page in 1..=SHOP_MAX_PAGES {
        let mut query: Vec<(&str, String)> = vec![
            ("page", page.to_string()),
            ("page_size", SHOP_PAGE_SIZE.to_string()),
            ("proxy_category", api_category.to_string()),
            ("stock_status", "in_stock".to_string()),
        ];
        if let Some(at) = &access {
            query.push(("access_type", at.clone()));
        }
        let v = match client.get("/api/v1/proxies/shop/", &query).await {
            Ok(v) => v,
            // Keep what we already have if a later page is throttled.
            Err(e) if page > 1 && e.starts_with(THROTTLE_PREFIX) => break,
            Err(e) => return Err(e),
        };
        let parsed = parse_shop_page(&v, page);
        total = total.max(parsed.count);
        for mut g in parsed.groups {
            g.products.retain(|p| seen_products.insert(p.id.clone()));
            if g.products.is_empty() || !seen_groups.insert(g.key.clone()) {
                continue;
            }
            // Report the UI category back so the frontend does not need the API mapping.
            g.category = category.clone();
            for p in &mut g.products {
                p.category = category.clone();
            }
            groups.push(g);
        }
        if !parsed.has_next {
            complete = true;
            break;
        }
    }

    groups.sort_by(|a, b| {
        b.in_stock
            .cmp(&a.in_stock)
            .then(
                a.min_price_per_day
                    .unwrap_or(f64::MAX)
                    .partial_cmp(&b.min_price_per_day.unwrap_or(f64::MAX))
                    .unwrap_or(std::cmp::Ordering::Equal),
            )
    });
    Ok(CyberYozhShopCatalog { category, total, complete, groups })
}

/// Buys one product. Provisioning is asynchronous: the proxy appears in history later.
#[tauri::command]
pub async fn cyberyozh_buy_proxy(
    api_key: String,
    product_id: String,
    auto_renew: bool,
    promo_code: Option<String>,
) -> Result<CyberYozhBuyResult, String> {
    let product_id = product_id.trim().to_string();
    if product_id.is_empty()
        || product_id.len() > 64
        || !product_id.chars().all(|c| c.is_ascii_hexdigit() || c == '-')
    {
        return Err("Некорректный идентификатор товара".to_string());
    }

    let mut item = json!({ "id": product_id, "auto_renew": auto_renew });
    if let Some(code) = promo_code.map(|c| c.trim().to_string()).filter(|c| !c.is_empty()) {
        item["promo_code"] = Value::String(code);
    }
    let body = Value::Array(vec![item]);

    let client = CyberYozhClient::new(&api_key)?;
    let (status, text) = client
        .send(
            Method::POST,
            "/api/v1/proxies/shop/buy_proxies/",
            &[],
            Some(&body),
            Duration::from_secs(60),
        )
        .await
        .map_err(|e| {
            if e.starts_with(THROTTLE_PREFIX) {
                e
            } else {
                // The order may have gone through — do not invite a blind retry.
                format!(
                    "{}. Покупка могла пройти — проверьте вкладку «Мои прокси», прежде чем покупать повторно",
                    e
                )
            }
        })?;

    if !status.is_success() {
        return Err(format!("Покупка не удалась: {}", api_error(status, &text)));
    }

    let v: Value = serde_json::from_str(&text).unwrap_or(Value::Null);
    let first = results_of(&v).into_iter().next();
    let (st, message) = match &first {
        Some(r) => (v_str(r, "status").unwrap_or_else(|| "in_progress".to_string()), v_str(r, "message")),
        None => ("in_progress".to_string(), None),
    };
    if st == "canceled" || st == "cancelled" {
        return Err(format!(
            "Покупка отклонена: {}",
            message.unwrap_or_else(|| "CyberYozh отменил заказ".to_string())
        ));
    }
    Ok(CyberYozhBuyResult { status: st, message })
}

/// All purchased proxies (active first). Expired/deleted ones are returned too,
/// flagged with `importable = false`, so the UI can show them.
#[tauri::command]
pub async fn cyberyozh_get_my_proxies(api_key: String) -> Result<Vec<CyberYozhMyProxy>, String> {
    let client = CyberYozhClient::new(&api_key)?;
    let now = chrono::Utc::now();
    let mut items: Vec<CyberYozhMyProxy> = Vec::new();
    let mut seen = HashSet::new();

    for page in 1..=HISTORY_MAX_PAGES {
        let query = [("page", page.to_string()), ("page_size", "100".to_string())];
        let v = match client.get("/api/v1/proxies/history/", &query).await {
            Ok(v) => v,
            // Partial data beats nothing if a later page gets throttled.
            Err(e) if page > 1 && e.starts_with(THROTTLE_PREFIX) => break,
            Err(e) => return Err(e),
        };
        for item in results_of(&v) {
            if let Some(p) = parse_history_item(&item, now) {
                if seen.insert(p.id.clone()) {
                    items.push(p);
                }
            }
        }
        if !has_next(&v) {
            break;
        }
    }

    items.sort_by(|a, b| {
        status_rank(&a.status)
            .cmp(&status_rank(&b.status))
            .then_with(|| b.access_expires_at.cmp(&a.access_expires_at))
    });
    Ok(items)
}

/// Saves proxies into local storage. Duplicates (same proxy string) are skipped.
#[tauri::command]
pub async fn cyberyozh_import_proxies(
    items: Vec<CyberYozhImportItem>,
    storage: State<'_, Arc<Storage>>,
) -> Result<CyberYozhImportResult, String> {
    let mut existing: HashSet<String> = storage.get_proxies().into_iter().map(|p| p.proxy_str).collect();
    let mut result = CyberYozhImportResult { imported: 0, skipped: 0, failed: 0 };

    for item in items {
        let Some(parsed) = parse_proxy_str(&item.proxy_str) else {
            result.failed += 1;
            continue;
        };
        let proxy_str = item.proxy_str.trim().to_string();
        if existing.contains(&proxy_str) {
            result.skipped += 1;
            continue;
        }
        let protocol = if parsed.scheme == "https" { "http".to_string() } else { parsed.scheme };
        let proxy = Proxy {
            proxy_str: proxy_str.clone(),
            protocol,
            host: parsed.host,
            port: parsed.port,
            username: parsed.username,
            password: parsed.password,
            country: item
                .country
                .map(|c| c.trim().to_uppercase())
                .filter(|c| !c.is_empty()),
            city: None,
            checked: false,
            last_check: None,
            latency: None,
        };
        match storage.save_proxy(proxy) {
            Ok(()) => {
                existing.insert(proxy_str);
                result.imported += 1;
            }
            Err(_) => result.failed += 1,
        }
    }
    Ok(result)
}

/// Generates session credentials for a purchased residential_rotating proxy.
#[tauri::command]
pub async fn cyberyozh_generate_rotating(
    api_key: String,
    request: CyberYozhRotatingRequest,
) -> Result<Vec<CyberYozhGeneratedProxy>, String> {
    if !SESSION_TYPES.contains(&request.session_type.as_str()) {
        return Err("Некорректный тип сессии".to_string());
    }
    let amount = request.amount.unwrap_or(1).clamp(1, 100);
    let country = request
        .country_code
        .as_deref()
        .map(|c| c.trim().to_uppercase())
        .filter(|c| c.len() == 2);
    let scheme = match request.protocol.as_deref() {
        Some("http") | Some("https") => "http",
        _ => "socks5",
    };

    let mut body = json!({
        "connection_host": request.connection_host,
        "connection_port": request.connection_port,
        "connection_login": request.connection_login,
        "connection_password": request.connection_password,
        "session_type": request.session_type,
        "amount": amount,
    });
    if let Some(c) = &country {
        body["country_code"] = Value::String(c.clone());
    }
    if let Some(r) = request.region.as_deref().map(str::trim).filter(|s| !s.is_empty()) {
        body["region"] = Value::String(r.to_string());
    }
    if let Some(c) = request.city.as_deref().map(str::trim).filter(|s| !s.is_empty()) {
        body["city"] = Value::String(c.to_string());
    }

    let client = CyberYozhClient::new(&api_key)?;
    let (status, text) = client
        .send(
            Method::POST,
            "/api/v1/proxies/rotating-credentials/",
            &[],
            Some(&body),
            Duration::from_secs(30),
        )
        .await?;
    if !status.is_success() {
        return Err(format!("Не удалось сгенерировать доступы: {}", api_error(status, &text)));
    }

    let v: Value = serde_json::from_str(&text)
        .map_err(|_| "CyberYozh вернул неожиданный ответ".to_string())?;
    let entries = match v.get("credentials") {
        Some(Value::Array(a)) => a.clone(),
        Some(other) => vec![other.clone()],
        None => results_of(&v),
    };

    let out: Vec<CyberYozhGeneratedProxy> = entries
        .iter()
        .filter_map(|e| credential_to_proxy_str(e, scheme))
        .filter_map(|s| {
            let parsed = parse_proxy_str(&s)?;
            Some(CyberYozhGeneratedProxy { display: mask_proxy(&parsed), proxy_str: s, country: country.clone() })
        })
        .collect();

    if out.is_empty() {
        return Err("CyberYozh не вернул доступы. Попробуйте другие параметры".to_string());
    }
    Ok(out)
}

// ============================================================================
// TESTS
// ============================================================================

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn history_http_port_preferred() {
        let item = json!({
            "id": "80ee1b14-bf43-495c-9106-1f6965248a81",
            "url": "socks5_http://45.17.110.91:5667",
            "connection_login": "user", "connection_password": "pass",
            "system_status": "active", "order_status": "success", "expired": false,
            "access_expires_at": "2099-01-01T00:00:00Z",
            "geoip": null, "proxy_category": "lte", "access_type": "shared",
            "connection_host": "45.17.110.91", "connection_port": 5667,
            "connection_ports": {"http": "8150", "socks5": "5667"}
        });
        let p = parse_history_item(&item, chrono::Utc::now()).unwrap();
        assert_eq!(p.proxy_str.as_deref(), Some("http://user:pass@45.17.110.91:8150"));
        assert!(p.importable);
        assert_eq!(p.country, None);
    }

    #[test]
    fn history_socks5_and_flags() {
        let item = json!({
            "id": "b4c992de", "url": "socks5://206.251.200.51:54495",
            "connection_login": "u", "connection_password": "p",
            "system_status": "active", "order_status": "success", "expired": true,
            "geoip": {"countryCode2": "US"},
            "connection_host": "206.251.200.51", "connection_port": "54495", "connection_ports": {}
        });
        let p = parse_history_item(&item, chrono::Utc::now()).unwrap();
        assert_eq!(p.proxy_str.as_deref(), Some("socks5://u:p@206.251.200.51:54495"));
        assert_eq!(p.country.as_deref(), Some("US"));
        assert_eq!(p.status, "expired");
        assert!(!p.importable);
    }

    #[test]
    fn history_socks5_http_without_ports_and_placeholder() {
        let item = json!({
            "id": "x", "url": "socks5_http://1.2.3.4:1000",
            "connection_login": "u", "connection_password": "p",
            "system_status": "active", "expired": false,
            "connection_host": "1.2.3.4", "connection_port": 1000, "connection_ports": {}
        });
        let p = parse_history_item(&item, chrono::Utc::now()).unwrap();
        assert_eq!(p.proxy_str.as_deref(), Some("socks5://u:p@1.2.3.4:1000"));

        let pending = json!({ "id": "y", "connection_host": "---", "connection_port": "---", "expired": false });
        let p = parse_history_item(&pending, chrono::Utc::now()).unwrap();
        assert_eq!(p.status, "pending");
        assert!(p.proxy_str.is_none());
    }

    #[test]
    fn proxy_str_parsing() {
        let p = parse_proxy_str("socks5://lo:g:in@1.2.3.4:5000").unwrap();
        assert_eq!(p.username.as_deref(), Some("lo"));
        assert_eq!(p.password.as_deref(), Some("g:in"));
        assert_eq!(p.port, 5000);
        assert!(parse_proxy_str("ftp://1.2.3.4:21").is_none());
    }

    #[test]
    fn credential_shapes() {
        assert_eq!(
            credential_to_proxy_str(&json!("h.example:1080:l:p"), "socks5").as_deref(),
            Some("socks5://l:p@h.example:1080")
        );
        assert_eq!(
            credential_to_proxy_str(&json!({"connection_host": "h", "connection_port": "9", "connection_login": "l", "connection_password": "p"}), "http").as_deref(),
            Some("http://l:p@h:9")
        );
    }

    #[test]
    fn misc_parsers() {
        assert_eq!(parse_wait_seconds(r#"{"detail":"Request was throttled. Expected available in 46 seconds."}"#), Some(46));
        assert_eq!(parse_balance("1.71").as_deref(), Some("1.71"));
        assert_eq!(parse_balance("\"$2.5\"").as_deref(), Some("2.50"));
        assert_eq!(extract_error_message(r#"[{"id":["Not found"]}]"#).as_deref(), Some("id: Not found"));
    }

    // ---- Live, read-only checks: `cargo test --lib cyberyozh -- --ignored --nocapture` ----
    // Reads the key from <repo>/api_keys.json ("cyberyozh"). Never calls buy / rotating POST.

    fn live_key() -> String {
        let path = std::path::Path::new(env!("CARGO_MANIFEST_DIR")).join("..").join("api_keys.json");
        let text = std::fs::read_to_string(path).expect("api_keys.json");
        let v: Value = serde_json::from_str(&text).expect("json");
        v.get("cyberyozh").and_then(|k| k.as_str()).expect("cyberyozh key").to_string()
    }

    #[tokio::test]
    #[ignore]
    async fn live_read_only() {
        let key = live_key();

        let bal = cyberyozh_validate_key(key.clone()).await.expect("validate");
        assert!(bal.valid);
        println!("balance: {:?}", bal.balance);

        let bad = cyberyozh_validate_key("definitely-not-a-key".into()).await.expect("validate bad");
        assert!(!bad.valid);

        for (cat, _, forced) in CATEGORIES {
            match cyberyozh_get_shop(key.clone(), cat.to_string(), None).await {
                Ok(c) => {
                    let products: usize = c.groups.iter().map(|g| g.products.len()).sum();
                    let oos = c.groups.iter().flat_map(|g| &g.products).filter(|p| !p.in_stock).count();
                    println!(
                        "{cat}: total={} complete={} groups={} products={} out_of_stock={} first={:?}",
                        c.total,
                        c.complete,
                        c.groups.len(),
                        products,
                        oos,
                        c.groups.first().map(|g| (&g.title, &g.access_type, g.country_codes.len(), g.min_price_per_day))
                    );
                    for g in &c.groups {
                        assert!(!g.products.is_empty());
                        assert_eq!(&g.category, cat);
                        if let Some(f) = forced {
                            assert_eq!(g.access_type.as_deref(), Some(*f));
                        }
                    }
                }
                Err(e) if e.starts_with(THROTTLE_PREFIX) => {
                    println!("{cat}: throttled: {e}");
                    break;
                }
                Err(e) => panic!("{cat}: {e}"),
            }
        }

        match cyberyozh_get_my_proxies(key.clone()).await {
            Ok(items) => {
                for p in &items {
                    println!(
                        "history: {} {:?} status={} importable={} display={:?} country={:?}",
                        p.id, p.category, p.status, p.importable, p.display, p.country
                    );
                }
            }
            Err(e) if e.starts_with(THROTTLE_PREFIX) => println!("history throttled: {e}"),
            Err(e) => panic!("history: {e}"),
        }
    }
}
