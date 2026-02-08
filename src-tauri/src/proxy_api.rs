use crate::models::*;
use anyhow::{anyhow, Result};
use reqwest::Client;
use serde_json::json;
use std::time::Duration;

const SX_ORG_BASE_URL: &str = "https://api.sx.org/";
const CYBER_YOZH_BASE_URL: &str = "https://app.cyberyozh.com/api/v1/";
const CYBER_YOZH_V2_URL: &str = "https://app.cyberyozh.com/api/v2/";
const PSB_PROXY_BASE_URL: &str = "https://psbproxy.io/api/";

/// Parse PSB API error response into user-friendly Russian message
fn psb_parse_error(status: u16, body: &str) -> String {
    // Try to extract "message" from JSON response
    let msg = serde_json::from_str::<serde_json::Value>(body)
        .ok()
        .and_then(|v| v.get("message").and_then(|m| m.as_str().map(String::from)))
        .unwrap_or_default();

    let msg_lower = msg.to_lowercase();
    let body_lower = body.to_lowercase();

    // Insufficient balance
    if msg_lower.contains("insufficient") || msg_lower.contains("enough") 
        || msg_lower.contains("balance") || body_lower.contains("insufficient")
        || body_lower.contains("not enough") {
        return "Недостаточно средств на балансе PSB. Пополните баланс в личном кабинете psbproxy.io".to_string();
    }

    // Auth errors
    if status == 401 || msg_lower.contains("unauthorized") || msg_lower.contains("unauthenticated") {
        return "Неверный или истёкший API ключ. Проверьте ключ в настройках PSB".to_string();
    }

    // Forbidden
    if status == 403 || msg_lower.contains("forbidden") {
        return "Доступ запрещён. Проверьте права API ключа".to_string();
    }

    // Not found
    if status == 404 {
        return "Продукт не найден. Возможно, тариф больше не доступен".to_string();
    }

    // Validation errors
    if status == 422 || msg_lower.contains("validation") {
        if !msg.is_empty() {
            return format!("Ошибка валидации: {}", msg);
        }
        return "Ошибка валидации запроса".to_string();
    }

    // Rate limit
    if status == 429 {
        return "Слишком много запросов. Подождите немного и попробуйте снова".to_string();
    }

    // Server error
    if status >= 500 {
        return "Ошибка сервера PSB. Попробуйте позже".to_string();
    }

    // Payment required
    if status == 402 || msg_lower.contains("payment") {
        return "Требуется оплата. Пополните баланс на psbproxy.io".to_string();
    }

    // Fallback: return original message if available
    if !msg.is_empty() {
        return msg;
    }

    format!("Ошибка HTTP {} — {}", status, &body[..body.len().min(200)])
}

pub struct ProxyApiClient {
    client: Client,
}

impl ProxyApiClient {
    pub fn new() -> Self {
        let client = Client::builder()
            .timeout(Duration::from_secs(30))
            .user_agent("Antic Browser v1.0.0")
            .build()
            .unwrap_or_default();

        ProxyApiClient { client }
    }

    // SX.ORG API Methods
    pub async fn sx_org_validate_key(&self, api_key: &str) -> Result<(bool, String)> {
        let url = format!("{}v2/plan/info", SX_ORG_BASE_URL);
        
        let response = self.client
            .get(&url)
            .query(&[("apiKey", api_key)])
            .send()
            .await?;

        let data: SXOrgResponse<serde_json::Value> = response.json().await?;
        
        if !data.success {
            return Ok((false, "Неверный API ключ или недостаточно прав".to_string()));
        }

        // Получаем баланс
        let balance_url = format!("{}v2/user/balance", SX_ORG_BASE_URL);
        let balance_response = self.client
            .get(&balance_url)
            .query(&[("apiKey", api_key)])
            .send()
            .await?;

        let balance_data: SXOrgBalanceResponse = balance_response.json().await?;
        let balance = balance_data.balance.unwrap_or_else(|| "0.00".to_string());

        Ok((true, format!("Баланс: ${}", balance)))
    }

    pub async fn sx_org_get_countries(&self, api_key: &str) -> Result<Vec<SXOrgCountry>> {
        let url = format!("{}v2/dir/countries", SX_ORG_BASE_URL);
        
        let response = self.client
            .get(&url)
            .query(&[("apiKey", api_key)])
            .send()
            .await?;

        let data: SXOrgCountriesResponse = response.json().await?;
        
        if data.success {
            Ok(data.countries)
        } else {
            Err(anyhow!("Ошибка получения стран"))
        }
    }

    pub async fn sx_org_get_states(&self, api_key: &str, country_id: u32) -> Result<Vec<SXOrgState>> {
        let url = format!("{}v2/dir/states", SX_ORG_BASE_URL);
        
        let response = self.client
            .get(&url)
            .query(&[("apiKey", api_key), ("countryId", &country_id.to_string())])
            .send()
            .await?;

        let data: SXOrgStatesResponse = response.json().await?;
        
        if data.success {
            Ok(data.states)
        } else {
            Err(anyhow!("Ошибка получения штатов"))
        }
    }

    pub async fn sx_org_get_cities(
        &self,
        api_key: &str,
        state_id: u32,
        country_id: u32,
    ) -> Result<Vec<SXOrgCity>> {
        let url = format!("{}v2/dir/cities", SX_ORG_BASE_URL);
        
        let response = self.client
            .get(&url)
            .query(&[
                ("apiKey", api_key),
                ("stateId", &state_id.to_string()),
                ("countryId", &country_id.to_string()),
            ])
            .send()
            .await?;

        let data: SXOrgCitiesResponse = response.json().await?;
        
        if data.success {
            Ok(data.cities)
        } else {
            Err(anyhow!("Ошибка получения городов"))
        }
    }

    pub async fn sx_org_create_proxy(
        &self,
        api_key: &str,
        country_code: &str,
        state_name: Option<&str>,
        city_name: Option<&str>,
        connection_type: &str, // "keep-connection" or "rotate-connection"
        proxy_types: Vec<&str>, // ["residential", "mobile", "corporate"]
        proxy_name: &str,
    ) -> Result<Vec<String>> {
        let url = format!("{}v2/proxy/create-port", SX_ORG_BASE_URL);

        let type_id = match connection_type {
            "keep-connection" => 2,
            "rotate-connection" => 3,
            _ => 2,
        };

        let proxy_type_id = if proxy_types.contains(&"residential") {
            1
        } else if proxy_types.contains(&"mobile") {
            3
        } else if proxy_types.contains(&"corporate") {
            4
        } else {
            2
        };

        let body = json!({
            "country_code": country_code,
            "state": state_name,
            "city": city_name,
            "type_id": type_id,
            "proxy_type_id": proxy_type_id,
            "server_port_type_id": 0,
            "name": proxy_name
        });

        let response = self.client
            .post(&url)
            .query(&[("apiKey", api_key)])
            .json(&body)
            .send()
            .await?;

        let data: SXOrgCreateProxyResponse = response.json().await?;
        
        if data.success {
            let proxies = data.data.unwrap_or_default();
            let proxy_strings: Vec<String> = proxies
                .iter()
                .map(|p| format!("http://{}:{}@{}:{}", p.login, p.password, p.server, p.port))
                .collect();
            Ok(proxy_strings)
        } else {
            Err(anyhow!(data.message.unwrap_or_else(|| "Неизвестная ошибка".to_string())))
        }
    }

    // CyberYozh API Methods
    pub async fn cyberyozh_validate_key(&self, api_key: &str) -> Result<(bool, String)> {
        let url = format!("{}users/balance/", CYBER_YOZH_V2_URL);
        
        let response = self.client
            .get(&url)
            .header("X-Api-Key", api_key)
            .send()
            .await?;

        if !response.status().is_success() {
            return Ok((false, "Неверный API ключ".to_string()));
        }

        let balance_text = response.text().await?;
        let balance = balance_text.trim().replace("$", "");

        Ok((true, format!("Баланс: ${}", balance)))
    }

    pub async fn cyberyozh_get_shop_proxies(
        &self,
        api_key: &str,
        _country_code: Option<&str>,
        _access_type: Option<&str>,
    ) -> Result<Vec<CyberYozhShopItem>> {
        let url = format!("{}proxies/shop/", CYBER_YOZH_BASE_URL);
        
        let request = self.client.get(&url).header("X-Api-Key", api_key);

        // Не добавляем параметры фильтрации, так как API их не поддерживает корректно
        // Фильтрация будет происходить на клиенте

        let response = request.send().await?;
        let text = response.text().await?;
        
        // Логируем ПОЛНЫЙ сырой ответ для первого продукта
        println!("[CyberYozh API] ===== RAW RESPONSE =====");
        println!("{}", &text[..text.len().min(2000)]);
        println!("[CyberYozh API] =====================");
        
        // Парсим ответ
        let data: CyberYozhShopResponse = serde_json::from_str(&text)
            .map_err(|e| anyhow!("Failed to parse shop response: {}", e))?;
        
        // Извлекаем все proxy_products из всех категорий
        let mut all_proxies = Vec::new();
        for category in data.results {
            all_proxies.extend(category.proxy_products);
        }
        
        println!("[CyberYozh API] Parsed {} proxy products", all_proxies.len());
        
        // Логируем первые 3 прокси для проверки
        for (i, proxy) in all_proxies.iter().take(3).enumerate() {
            println!("[CyberYozh API] Proxy #{}: id={}, title={}, price={:?}, currency={:?}", 
                i+1, proxy.id, proxy.title, proxy.price, proxy.currency);
        }
        
        Ok(all_proxies)
    }

    pub async fn cyberyozh_buy_proxy(
        &self,
        api_key: &str,
        proxy_id: &str,
        auto_renew: bool,
    ) -> Result<String> {
        let url = format!("{}proxies/shop/buy_proxies/", CYBER_YOZH_BASE_URL);
        
        let body = json!([{
            "id": proxy_id,
            "auto_renew": auto_renew
        }]);

        let response = self.client
            .post(&url)
            .header("X-Api-Key", api_key)
            .json(&body)
            .send()
            .await?;

        if !response.status().is_success() {
            let error_text = response.text().await.unwrap_or_else(|_| "Unknown error".to_string());
            return Err(anyhow!("Ошибка покупки: {}", error_text));
        }

        Ok("Покупка успешно инициирована".to_string())
    }

    pub async fn cyberyozh_get_my_proxies(&self, api_key: &str) -> Result<Vec<CyberYozhProxyItem>> {
        let url = format!("{}proxies/history/", CYBER_YOZH_BASE_URL);
        
        let response = self.client
            .get(&url)
            .header("X-Api-Key", api_key)
            .send()
            .await?;

        let data: CyberYozhHistoryResponse = response.json().await?;
        
        // Фильтруем только активные прокси
        let active_proxies: Vec<CyberYozhProxyItem> = data
            .results
            .into_iter()
            .filter(|p| {
                !p.expired && p.system_status.as_deref() == Some("active")
            })
            .collect();

        Ok(active_proxies)
    }

    pub async fn cyberyozh_format_proxies(&self, proxies: Vec<CyberYozhProxyItem>) -> Vec<Proxy> {
        proxies
            .into_iter()
            .map(|item| {
                let proxy_str = format!(
                    "http://{}:{}@{}:{}",
                    item.connection_login,
                    item.connection_password,
                    item.connection_host,
                    item.connection_port
                );

                Proxy {
                    proxy_str: proxy_str.clone(),
                    protocol: "http".to_string(),
                    host: item.connection_host.clone(),
                    port: item.connection_port,
                    username: Some(item.connection_login),
                    password: Some(item.connection_password),
                    country: item.country_code.clone(),
                    city: None,
                    checked: false,
                    last_check: None,
                    latency: None,
                }
            })
            .collect()
    }

    // PSB Proxy API Methods
    
    /// Validate PSB API key by checking /subUsers endpoint
    pub async fn psb_validate_key(&self, api_key: &str) -> Result<(bool, String)> {
        let url = format!("{}subUsers?page=1&pageSize=1", PSB_PROXY_BASE_URL);
        
        let response = self.client
            .get(&url)
            .header("Authorization", format!("Bearer {}", api_key))
            .send()
            .await?;

        let status = response.status();
        let body = response.text().await.unwrap_or_default();

        if status.as_u16() == 401 || body.contains("Unauthorized") {
            return Ok((false, "Неверный API ключ".to_string()));
        }

        // Try to parse subUsers response to get count
        if let Ok(data) = serde_json::from_str::<PsbSubUsersListResponse>(&body) {
            let msg = format!("API ключ подтвержден. SubUsers: {}", data.meta.total_items);
            return Ok((true, msg));
        }

        // If we got a non-401 response, key is valid
        if status.is_success() || status.as_u16() == 404 {
            return Ok((true, "API ключ подтвержден".to_string()));
        }

        Ok((false, format!("Ошибка: HTTP {}", status)))
    }

    /// Get all sub-users
    pub async fn psb_get_sub_users(&self, api_key: &str) -> Result<PsbSubUsersListResponse> {
        let url = format!("{}subUsers?page=1&pageSize=100", PSB_PROXY_BASE_URL);
        
        let response = self.client
            .get(&url)
            .header("Authorization", format!("Bearer {}", api_key))
            .send()
            .await?;

        let status = response.status();
        let body = response.text().await.unwrap_or_default();

        if !status.is_success() {
            return Err(anyhow!("{}", psb_parse_error(status.as_u16(), &body)));
        }

        let data: PsbSubUsersListResponse = serde_json::from_str(&body)
            .map_err(|e| anyhow!("Failed to parse sub-users: {} - body: {}", e, &body[..body.len().min(200)]))?;

        Ok(data)
    }

    /// Create a new sub-user
    pub async fn psb_create_sub_user(&self, api_key: &str, sub_type: &str) -> Result<PsbSubUser> {
        let url = format!("{}subUsers", PSB_PROXY_BASE_URL);
        
        let form = reqwest::multipart::Form::new()
            .text("type", sub_type.to_string());

        let response = self.client
            .post(&url)
            .header("Authorization", format!("Bearer {}", api_key))
            .multipart(form)
            .send()
            .await?;

        let status = response.status();
        let resp_body = response.text().await.unwrap_or_default();

        if !status.is_success() {
            return Err(anyhow!("{}", psb_parse_error(status.as_u16(), &resp_body)));
        }

        let sub_user: PsbSubUser = serde_json::from_str(&resp_body)
            .map_err(|e| anyhow!("Failed to parse created sub-user: {} - body: {}", e, &resp_body[..resp_body.len().min(200)]))?;

        Ok(sub_user)
    }

    /// Get basic sub-user by type
    pub async fn psb_get_basic_sub_user(&self, api_key: &str, sub_type: &str) -> Result<PsbSubUser> {
        let url = format!("{}subUsers/basic?type={}", PSB_PROXY_BASE_URL, sub_type);
        
        let response = self.client
            .get(&url)
            .header("Authorization", format!("Bearer {}", api_key))
            .send()
            .await?;

        let status = response.status();
        let body = response.text().await.unwrap_or_default();

        if !status.is_success() {
            return Err(anyhow!("{}", psb_parse_error(status.as_u16(), &body)));
        }

        let sub_user: PsbSubUser = serde_json::from_str(&body)
            .map_err(|e| anyhow!("Failed to parse sub-user: {}", e))?;

        Ok(sub_user)
    }

    /// Get sub-user by ID
    pub async fn psb_get_sub_user(&self, api_key: &str, id: u32) -> Result<PsbSubUser> {
        let url = format!("{}subUsers/{}", PSB_PROXY_BASE_URL, id);
        
        let response = self.client
            .get(&url)
            .header("Authorization", format!("Bearer {}", api_key))
            .send()
            .await?;

        let status = response.status();
        let body = response.text().await.unwrap_or_default();

        if !status.is_success() {
            return Err(anyhow!("{}", psb_parse_error(status.as_u16(), &body)));
        }

        let sub_user: PsbSubUser = serde_json::from_str(&body)
            .map_err(|e| anyhow!("Failed to parse sub-user: {}", e))?;

        Ok(sub_user)
    }

    /// Give traffic to sub-user from primary
    pub async fn psb_give_traffic(&self, api_key: &str, sub_user_id: u32, amount: f64) -> Result<PsbSubUser> {
        let url = format!("{}subUsers/{}/give-traffic", PSB_PROXY_BASE_URL, sub_user_id);
        
        let form = reqwest::multipart::Form::new()
            .text("amount", amount.to_string());

        let response = self.client
            .post(&url)
            .header("Authorization", format!("Bearer {}", api_key))
            .multipart(form)
            .send()
            .await?;

        let status = response.status();
        let resp_body = response.text().await.unwrap_or_default();

        if !status.is_success() {
            return Err(anyhow!("{}", psb_parse_error(status.as_u16(), &resp_body)));
        }

        let sub_user: PsbSubUser = serde_json::from_str(&resp_body)
            .map_err(|e| anyhow!("Failed to parse response: {}", e))?;

        Ok(sub_user)
    }

    /// Take traffic from sub-user back to primary
    pub async fn psb_take_traffic(&self, api_key: &str, sub_user_id: u32, amount: f64) -> Result<PsbSubUser> {
        let url = format!("{}subUsers/{}/take-traffic", PSB_PROXY_BASE_URL, sub_user_id);
        
        let form = reqwest::multipart::Form::new()
            .text("amount", amount.to_string());

        let response = self.client
            .post(&url)
            .header("Authorization", format!("Bearer {}", api_key))
            .multipart(form)
            .send()
            .await?;

        let status = response.status();
        let resp_body = response.text().await.unwrap_or_default();

        if !status.is_success() {
            return Err(anyhow!("{}", psb_parse_error(status.as_u16(), &resp_body)));
        }

        let sub_user: PsbSubUser = serde_json::from_str(&resp_body)
            .map_err(|e| anyhow!("Failed to parse response: {}", e))?;

        Ok(sub_user)
    }

    /// Delete sub-user
    pub async fn psb_delete_sub_user(&self, api_key: &str, sub_user_id: u32) -> Result<String> {
        let url = format!("{}subUsers/{}", PSB_PROXY_BASE_URL, sub_user_id);
        
        let response = self.client
            .delete(&url)
            .header("Authorization", format!("Bearer {}", api_key))
            .send()
            .await?;

        let status = response.status();
        let body = response.text().await.unwrap_or_default();

        if !status.is_success() {
            return Err(anyhow!("{}", psb_parse_error(status.as_u16(), &body)));
        }

        Ok("SubUser deleted".to_string())
    }

    /// Get available products (traffic packages) from PSB shop
    pub async fn psb_get_products(&self) -> Result<serde_json::Value> {
        let url = format!("{}products", PSB_PROXY_BASE_URL);
        
        let response = self.client
            .get(&url)
            .send()
            .await?;

        let status = response.status();
        let body = response.text().await.unwrap_or_default();

        if !status.is_success() {
            return Err(anyhow!("Failed to get products: HTTP {} - {}", status, body));
        }

        let data: serde_json::Value = serde_json::from_str(&body)
            .map_err(|e| anyhow!("Failed to parse products: {}", e))?;

        Ok(data)
    }

    /// Buy a product (traffic package) from PSB shop
    pub async fn psb_buy_product(&self, api_key: &str, product_id: u32, payment_type: &str) -> Result<serde_json::Value> {
        let url = format!("{}products/{}/buy", PSB_PROXY_BASE_URL, product_id);

        // Try JSON body first
        let response = self.client
            .post(&url)
            .header("Authorization", format!("Bearer {}", api_key))
            .header("Content-Type", "application/json")
            .json(&serde_json::json!({ "payment_type": payment_type }))
            .send()
            .await?;

        let status = response.status();
        let resp_body = response.text().await.unwrap_or_default();

        if status.is_success() {
            let data: serde_json::Value = serde_json::from_str(&resp_body)
                .unwrap_or(serde_json::json!({ "success": true, "message": "Traffic purchased" }));
            return Ok(data);
        }

        // If JSON didn't work (422/400), try multipart form
        if status.as_u16() == 422 || status.as_u16() == 400 {
            let form = reqwest::multipart::Form::new()
                .text("payment_type", payment_type.to_string());

            let response2 = self.client
                .post(&url)
                .header("Authorization", format!("Bearer {}", api_key))
                .multipart(form)
                .send()
                .await?;

            let status2 = response2.status();
            let resp_body2 = response2.text().await.unwrap_or_default();

            if status2.is_success() {
                let data: serde_json::Value = serde_json::from_str(&resp_body2)
                    .unwrap_or(serde_json::json!({ "success": true, "message": "Traffic purchased" }));
                return Ok(data);
            }

            return Err(anyhow!("{}", psb_parse_error(status2.as_u16(), &resp_body2)));
        }

        Err(anyhow!("{}", psb_parse_error(status.as_u16(), &resp_body)))
    }

    /// Get pool data (hostnames, countries, formats, etc.)
    pub async fn psb_get_pool_data(&self, api_key: &str, pool: &str) -> Result<serde_json::Value> {
        let url = format!("{}residential_proxy/{}", PSB_PROXY_BASE_URL, pool);
        
        let response = self.client
            .get(&url)
            .header("Authorization", format!("Bearer {}", api_key))
            .send()
            .await?;

        let status = response.status();
        let body = response.text().await.unwrap_or_default();

        if !status.is_success() {
            return Err(anyhow!("Failed to get pool data: HTTP {} - {}", status, body));
        }

        let data: serde_json::Value = serde_json::from_str(&body)
            .map_err(|e| anyhow!("Failed to parse pool data: {}", e))?;

        Ok(data)
    }

    /// Get available countries for a pool
    pub async fn psb_get_countries(&self, api_key: &str, pool: &str) -> Result<Vec<PsbCountry>> {
        let url = format!("{}residential_proxy/{}/available_countries", PSB_PROXY_BASE_URL, pool);
        
        let response = self.client
            .get(&url)
            .header("Authorization", format!("Bearer {}", api_key))
            .send()
            .await?;

        let body = response.text().await.unwrap_or_default();
        
        let countries: Vec<PsbCountry> = serde_json::from_str(&body)
            .map_err(|e| anyhow!("Failed to parse countries: {}", e))?;

        Ok(countries)
    }

    /// Get available formats
    pub async fn psb_get_formats(&self, api_key: &str, pool: &str) -> Result<Vec<PsbFormat>> {
        let url = format!("{}residential_proxy/{}/available_formats", PSB_PROXY_BASE_URL, pool);
        
        let response = self.client
            .get(&url)
            .header("Authorization", format!("Bearer {}", api_key))
            .send()
            .await?;

        let body = response.text().await.unwrap_or_default();
        
        let formats: Vec<PsbFormat> = serde_json::from_str(&body)
            .map_err(|e| anyhow!("Failed to parse formats: {}", e))?;

        Ok(formats)
    }

    /// Get available hostnames
    pub async fn psb_get_hostnames(&self, api_key: &str, pool: &str) -> Result<Vec<PsbHostname>> {
        let url = format!("{}residential_proxy/{}/available_hostnames", PSB_PROXY_BASE_URL, pool);
        
        let response = self.client
            .get(&url)
            .header("Authorization", format!("Bearer {}", api_key))
            .send()
            .await?;

        let body = response.text().await.unwrap_or_default();
        
        let hostnames: Vec<PsbHostname> = serde_json::from_str(&body)
            .map_err(|e| anyhow!("Failed to parse hostnames: {}", e))?;

        Ok(hostnames)
    }

    /// Get available protocols
    pub async fn psb_get_protocols(&self, api_key: &str, pool: &str) -> Result<Vec<PsbProtocol>> {
        let url = format!("{}residential_proxy/{}/available_protocols", PSB_PROXY_BASE_URL, pool);
        
        let response = self.client
            .get(&url)
            .header("Authorization", format!("Bearer {}", api_key))
            .send()
            .await?;

        let body = response.text().await.unwrap_or_default();
        
        let protocols: Vec<PsbProtocol> = serde_json::from_str(&body)
            .map_err(|e| anyhow!("Failed to parse protocols: {}", e))?;

        Ok(protocols)
    }

    /// Get available rotations
    pub async fn psb_get_rotations(&self, api_key: &str, pool: &str) -> Result<Vec<PsbRotation>> {
        let url = format!("{}residential_proxy/{}/available_rotations", PSB_PROXY_BASE_URL, pool);
        
        let response = self.client
            .get(&url)
            .header("Authorization", format!("Bearer {}", api_key))
            .send()
            .await?;

        let body = response.text().await.unwrap_or_default();
        
        let rotations: Vec<PsbRotation> = serde_json::from_str(&body)
            .map_err(|e| anyhow!("Failed to parse rotations: {}", e))?;

        Ok(rotations)
    }

    /// Generate proxy list
    pub async fn psb_generate_proxy_list(
        &self,
        api_key: &str,
        pool: &str,
        params: serde_json::Value,
    ) -> Result<Vec<String>> {
        let url = format!("{}residential_proxy/{}/generate-proxy-list", PSB_PROXY_BASE_URL, pool);
        
        // Build multipart form from params
        let mut form = reqwest::multipart::Form::new();
        if let Some(obj) = params.as_object() {
            for (key, value) in obj {
                let str_val = match value {
                    serde_json::Value::String(s) => s.clone(),
                    serde_json::Value::Number(n) => n.to_string(),
                    _ => value.to_string(),
                };
                if !str_val.is_empty() {
                    form = form.text(key.clone(), str_val);
                }
            }
        }

        let response = self.client
            .post(&url)
            .header("Authorization", format!("Bearer {}", api_key))
            .multipart(form)
            .send()
            .await?;

        let status = response.status();
        let body = response.text().await.unwrap_or_default();

        if !status.is_success() {
            return Err(anyhow!("Failed to generate proxy list: HTTP {} - {}", status, body));
        }

        // Response may be a JSON array or plain text lines
        let proxies: Vec<String> = serde_json::from_str(&body)
            .unwrap_or_else(|_| {
                body.lines()
                    .map(|l| l.trim().trim_matches('"').trim_matches(',').to_string())
                    .filter(|l| !l.is_empty() && !l.starts_with('[') && !l.starts_with(']'))
                    .collect()
            });

        // Filter out empty strings
        let proxies: Vec<String> = proxies.into_iter().filter(|p| !p.is_empty()).collect();

        Ok(proxies)
    }

    /// Rotate IP (reset sticky session)
    pub async fn psb_rotate_ip(
        &self,
        api_key: &str,
        pool: &str,
        port: u16,
    ) -> Result<String> {
        let url = format!("{}residential_proxy/{}/rotate-ip", PSB_PROXY_BASE_URL, pool);
        
        let form = reqwest::multipart::Form::new()
            .text("port", port.to_string());

        let response = self.client
            .post(&url)
            .header("Authorization", format!("Bearer {}", api_key))
            .multipart(form)
            .send()
            .await?;

        let status = response.status();
        let resp_body = response.text().await.unwrap_or_default();

        if !status.is_success() {
            return Err(anyhow!("Failed to rotate IP: HTTP {} - {}", status, resp_body));
        }

        Ok(resp_body)
    }

    /// Add IP to whitelist
    pub async fn psb_add_whitelist_ip(
        &self,
        api_key: &str,
        pool: &str,
        ip: &str,
        sub_user_id: Option<u32>,
    ) -> Result<String> {
        let url = format!("{}residential_proxy/{}/whitelist-entries/add", PSB_PROXY_BASE_URL, pool);
        
        let mut form = reqwest::multipart::Form::new()
            .text("ip", ip.to_string());

        if let Some(id) = sub_user_id {
            form = form.text("subUser_id", id.to_string());
        }

        let response = self.client
            .post(&url)
            .header("Authorization", format!("Bearer {}", api_key))
            .multipart(form)
            .send()
            .await?;

        let status = response.status();
        let resp_body = response.text().await.unwrap_or_default();

        if !status.is_success() {
            return Err(anyhow!("Failed to add IP to whitelist: HTTP {} - {}", status, resp_body));
        }

        Ok(resp_body)
    }

    /// Get whitelist entries
    pub async fn psb_get_whitelist(
        &self,
        api_key: &str,
        pool: &str,
        sub_user_id: Option<u32>,
    ) -> Result<serde_json::Value> {
        let mut url = format!("{}residential_proxy/{}/whitelist-entries", PSB_PROXY_BASE_URL, pool);
        
        if let Some(id) = sub_user_id {
            url.push_str(&format!("?subUser_id={}", id));
        }

        let response = self.client
            .get(&url)
            .header("Authorization", format!("Bearer {}", api_key))
            .send()
            .await?;

        let status = response.status();
        let body = response.text().await.unwrap_or_default();

        if !status.is_success() {
            return Err(anyhow!("Failed to get whitelist: HTTP {} - {}", status, body));
        }

        let data: serde_json::Value = serde_json::from_str(&body)
            .map_err(|e| anyhow!("Failed to parse whitelist: {}", e))?;

        Ok(data)
    }

    /// Remove IP from whitelist
    pub async fn psb_remove_whitelist_ip(
        &self,
        api_key: &str,
        pool: &str,
        ip: &str,
        sub_user_id: Option<u32>,
    ) -> Result<String> {
        let url = format!("{}residential_proxy/{}/whitelist-entries/remove", PSB_PROXY_BASE_URL, pool);
        
        let mut form = reqwest::multipart::Form::new()
            .text("ip", ip.to_string());

        if let Some(id) = sub_user_id {
            form = form.text("subUser_id", id.to_string());
        }

        let response = self.client
            .post(&url)
            .header("Authorization", format!("Bearer {}", api_key))
            .multipart(form)
            .send()
            .await?;

        let status = response.status();
        let resp_body = response.text().await.unwrap_or_default();

        if !status.is_success() {
            return Err(anyhow!("Failed to remove IP from whitelist: HTTP {} - {}", status, resp_body));
        }

        Ok(resp_body)
    }

    pub async fn psb_get_my_ip(&self) -> Result<String> {
        let response = self.client
            .get("https://api.ipify.org?format=json")
            .send()
            .await?;
        
        let data: serde_json::Value = response.json().await?;
        Ok(data["ip"].as_str().unwrap_or("Unknown").to_string())
    }
}
