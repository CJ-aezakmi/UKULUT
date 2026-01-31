use crate::models::*;
use anyhow::{anyhow, Result};
use reqwest::Client;
use serde_json::json;
use std::time::Duration;

const SX_ORG_BASE_URL: &str = "https://api.sx.org/";
const CYBER_YOZH_BASE_URL: &str = "https://app.cyberyozh.com/api/v1/";
const CYBER_YOZH_V2_URL: &str = "https://app.cyberyozh.com/api/v2/";

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
}
