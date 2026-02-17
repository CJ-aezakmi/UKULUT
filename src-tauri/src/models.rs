use serde::{Deserialize, Serialize};
use std::collections::HashMap;

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct Profile {
    pub name: String,
    pub user_agent: String,
    pub screen_width: u32,
    pub screen_height: u32,
    pub timezone: String,
    pub lang: String,
    pub proxy: Option<String>,
    pub cookies: Option<String>,
    pub webgl: bool,
    pub vendor: String,
    pub cpu: u32,
    pub ram: u32,
    pub is_touch: bool,
    pub homepage: String,
}

impl Default for Profile {
    fn default() -> Self {
        Profile {
            name: String::from("Profile 1"),
            user_agent: String::from("Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36"),
            screen_width: 1920,
            screen_height: 1080,
            timezone: String::from("America/New_York"),
            lang: String::from("en-US"),
            proxy: None,
            cookies: None,
            webgl: true,
            vendor: String::from("Google Inc."),
            cpu: 8,
            ram: 8,
            is_touch: false,
            homepage: String::from("https://whoer.net"),
        }
    }
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct Proxy {
    pub proxy_str: String,
    pub protocol: String,
    pub host: String,
    pub port: u16,
    pub username: Option<String>,
    pub password: Option<String>,
    pub country: Option<String>,
    pub city: Option<String>,
    pub checked: bool,
    pub last_check: Option<String>,
    pub latency: Option<f64>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct ProxyCheckResult {
    pub status: String,
    pub proxy_str: String,
    pub country: String,
    pub city: String,
    pub ip: String,
    pub latency: Option<f64>,
    pub error: Option<String>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct ApiKey {
    pub service: String,
    pub key: String,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct SXOrgCountry {
    pub id: u32,
    pub name: String,
    pub code: String,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct SXOrgState {
    pub id: u32,
    pub name: String,
    pub dir_country_id: u32,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct SXOrgCity {
    pub id: u32,
    pub name: String,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct SXOrgResponse<T> {
    pub success: bool,
    pub message: Option<String>,
    pub data: Option<T>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct SXOrgBalanceResponse {
    pub success: bool,
    pub balance: Option<String>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct SXOrgCountriesResponse {
    pub success: bool,
    pub countries: Vec<SXOrgCountry>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct SXOrgStatesResponse {
    pub success: bool,
    pub states: Vec<SXOrgState>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct SXOrgCitiesResponse {
    pub success: bool,
    pub cities: Vec<SXOrgCity>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct SXOrgProxyData {
    pub login: String,
    pub password: String,
    pub server: String,
    pub port: u16,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct SXOrgCreateProxyResponse {
    pub success: bool,
    pub message: Option<String>,
    pub data: Option<Vec<SXOrgProxyData>>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct CyberYozhProxyItem {
    pub id: String,
    pub connection_host: String,
    pub connection_port: u16,
    pub connection_login: String,
    pub connection_password: String,
    pub country_code: Option<String>,
    pub access_type: Option<String>,
    pub category: Option<String>,
    pub expired: bool,
    pub system_status: Option<String>,
    pub public_ipaddress: Option<String>,
    pub access_expires_at: Option<String>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct CyberYozhShopItem {
    pub id: String,
    pub title: String,
    pub location_country_code: Option<String>,
    pub proxy_protocol: Option<String>,
    #[serde(rename = "price_usd")]
    pub price: Option<String>,  // Приходит как строка "875.00"
    pub currency: Option<String>,
    pub stock_status: Option<String>,  // "in_stock" или "out_of_stock"
    pub days: Option<u32>,
    pub traffic_limitation: Option<i32>,  // Может быть -1 для безлимита
    pub proxy_category: Option<String>,
    /// Title of the parent category group — set during flatten, not from individual product JSON
    #[serde(default)]
    pub group_title: Option<String>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct CyberYozhShopCategory {
    pub proxy_products: Vec<CyberYozhShopItem>,
    /// Parent category title (e.g. "5G Arizona Phoenix T-Mobile Unlimited")
    pub title: Option<String>,
    /// Parent proxy_category (e.g. "lte", "datacenter_dedicated", "residential_static")
    pub proxy_category: Option<String>,
    /// Parent location_country_code (e.g. "us")
    pub location_country_code: Option<String>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct CyberYozhHistoryResponse {
    pub results: Vec<CyberYozhProxyItem>,
    pub next: Option<String>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct CyberYozhShopResponse {
    pub count: u32,
    pub next: Option<String>,
    pub results: Vec<CyberYozhShopCategory>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct GeoInfo {
    pub country_code: String,
    pub city: Option<String>,
    pub timezone: Option<String>,
    pub latitude: Option<f64>,
    pub longitude: Option<f64>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct AppState {
    pub api_keys: HashMap<String, String>,
    pub proxies: Vec<Proxy>,
    pub profiles: Vec<Profile>,
    pub proxy_cache: HashMap<String, ProxyCheckResult>,
}

impl Default for AppState {
    fn default() -> Self {
        AppState {
            api_keys: HashMap::new(),
            proxies: Vec::new(),
            profiles: Vec::new(),
            proxy_cache: HashMap::new(),
        }
    }
}

// ============================================================================
// PSB PROXY MODELS
// ============================================================================

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct PsbSubUser {
    pub id: u32,
    pub data: PsbSubUserData,
    #[serde(rename = "type")]
    pub sub_type: String,
    pub user: u32,
    #[serde(rename = "createdAt")]
    pub created_at: Option<String>,
    #[serde(rename = "updatedAt")]
    pub updated_at: Option<String>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct PsbSubUserData {
    pub subuser_id: Option<u32>,
    pub username: Option<String>,
    pub password: Option<String>,
    pub traffic_available: Option<serde_json::Value>, // Can be string "1.00" or number
    pub traffic_used: Option<serde_json::Value>,
    pub hash: Option<String>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct PsbSubUsersListResponse {
    pub data: Vec<PsbSubUser>,
    pub meta: PsbPaginationMeta,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct PsbPaginationMeta {
    #[serde(rename = "currentPage")]
    pub current_page: u32,
    #[serde(rename = "pageSize")]
    pub page_size: u32,
    #[serde(rename = "totalPages")]
    pub total_pages: u32,
    #[serde(rename = "totalItems")]
    pub total_items: u32,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct PsbCountry {
    pub country_code: String,
    pub country_name: String,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct PsbFormat {
    pub name: String,
    pub value: String,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct PsbHostname {
    #[serde(rename = "type")]
    pub host_type: String,
    pub name: String,
    pub value: String,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct PsbProtocol {
    pub name: String,
    pub value: String,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct PsbRotation {
    pub name: String,
    pub value: String,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct PsbPoolData {
    pub available_hostnames: Option<Vec<PsbHostname>>,
    pub available_countries: Option<serde_json::Value>,
    pub available_protocols: Option<Vec<PsbProtocol>>,
    pub available_rotations: Option<Vec<PsbRotation>>,
    pub available_formats: Option<Vec<PsbFormat>>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct PsbTrafficStats {
    pub traffic_available: Option<serde_json::Value>,
    pub traffic_used: Option<serde_json::Value>,
}
