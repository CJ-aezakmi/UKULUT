use crate::models::*;
use reqwest::Client;
use std::time::{Duration, Instant};

pub struct ProxyChecker {}

impl ProxyChecker {
    pub fn new() -> Self {
        ProxyChecker {}
    }

    // Умное определение протокола по порту
    fn detect_protocol(port: u16, explicit_protocol: Option<&str>) -> String {
        if let Some(proto) = explicit_protocol {
            return proto.to_lowercase();
        }
        
        // Автоопределение по порту
        match port {
            1080 | 1081 => "socks5".to_string(),  // Типичные SOCKS5 порты
            1085 => "socks4".to_string(),          // Типичный SOCKS4 порт
            8080 | 3128 | 8888 => "http".to_string(),  // Типичные HTTP порты
            _ => "http".to_string(),               // По умолчанию HTTP
        }
    }

    pub async fn check_proxy(&self, proxy_str: &str) -> ProxyCheckResult {
        let start = Instant::now();

        // Парсим прокси
        let proxy_parts = Self::parse_proxy(proxy_str);
        if proxy_parts.is_none() {
            return ProxyCheckResult {
                status: "error".to_string(),
                proxy_str: proxy_str.to_string(),
                country: "Unknown".to_string(),
                city: "Unknown".to_string(),
                ip: "Unknown".to_string(),
                latency: None,
                error: Some("Неверный формат прокси".to_string()),
            };
        }

        let (protocol, host, port, username, password) = proxy_parts.unwrap();

        // Создаем прокси URL
        let proxy_url = if let (Some(user), Some(pass)) = (username, password) {
            format!("{}://{}:{}@{}:{}", protocol, user, pass, host, port)
        } else {
            format!("{}://{}:{}", protocol, host, port)
        };

        // Создаем СВЕЖИЙ клиент для каждого запроса с прокси
        let proxy_result = reqwest::Proxy::all(&proxy_url);
        if let Err(e) = proxy_result {
            return ProxyCheckResult {
                status: "error".to_string(),
                proxy_str: proxy_str.to_string(),
                country: "Unknown".to_string(),
                city: "Unknown".to_string(),
                ip: "Unknown".to_string(),
                latency: None,
                error: Some(format!("Ошибка настройки прокси: {}", e)),
            };
        }

        let proxy_client = Client::builder()
            .proxy(proxy_result.unwrap())
            .timeout(Duration::from_secs(15))
            .user_agent("curl/7.68.0")
            .pool_max_idle_per_host(0) // Отключаем переиспользование соединений
            .build();

        if let Err(e) = proxy_client {
            return ProxyCheckResult {
                status: "error".to_string(),
                proxy_str: proxy_str.to_string(),
                country: "Unknown".to_string(),
                city: "Unknown".to_string(),
                ip: "Unknown".to_string(),
                latency: None,
                error: Some(format!("Ошибка создания клиента: {}", e)),
            };
        }

        let client = proxy_client.unwrap();

        println!("[Proxy Checker] Checking {} proxy: {}", protocol, proxy_str);

        // Все типы прокси (HTTP, HTTPS, SOCKS4, SOCKS5) проверяем одинаково
        // reqwest с фичей "socks" поддерживает все типы прокси
        match client.get("http://ip-api.com/json/").send().await {
            Ok(response) => {
                let latency = start.elapsed().as_secs_f64();
                
                // Если получили ответ - прокси работает
                if response.status().is_success() {
                    match response.text().await {
                        Ok(body) => {
                            // Пробуем распарсить JSON
                            if let Ok(data) = serde_json::from_str::<serde_json::Value>(&body) {
                                if data["status"].as_str() == Some("success") {
                                    let country = data["countryCode"]
                                        .as_str()
                                        .unwrap_or("Unknown")
                                        .to_string();
                                    let city = data["city"]
                                        .as_str()
                                        .unwrap_or("Unknown")
                                        .to_string();
                                    let ip = data["query"]
                                        .as_str()
                                        .unwrap_or("Unknown")
                                        .to_string();

                                    return ProxyCheckResult {
                                        status: "working".to_string(),
                                        proxy_str: proxy_str.to_string(),
                                        country,
                                        city,
                                        ip,
                                        latency: Some(latency),
                                        error: None,
                                    };
                                }
                            }
                            
                            // Если не JSON или нет гео - всё равно прокси работает
                            ProxyCheckResult {
                                status: "working".to_string(),
                                proxy_str: proxy_str.to_string(),
                                country: "Unknown".to_string(),
                                city: "Unknown".to_string(),
                                ip: "Unknown".to_string(),
                                latency: Some(latency),
                                error: None,
                            }
                        }
                        Err(_) => {
                            // Получили ответ но не смогли прочитать - всё равно работает
                            ProxyCheckResult {
                                status: "working".to_string(),
                                proxy_str: proxy_str.to_string(),
                                country: "Unknown".to_string(),
                                city: "Unknown".to_string(),
                                ip: host.clone(),
                                latency: Some(latency),
                                error: None,
                            }
                        }
                    }
                } else {
                    // Плохой статус код - не работает
                    ProxyCheckResult {
                        status: "error".to_string(),
                        proxy_str: proxy_str.to_string(),
                        country: "ERROR".to_string(),
                        city: "Bad Response".to_string(),
                        ip: "Unknown".to_string(),
                        latency: Some(latency),
                        error: Some(format!("HTTP {}", response.status())),
                    }
                }
            }
            Err(e) => {
                // Не смогли подключиться - не работает
                ProxyCheckResult {
                    status: "error".to_string(),
                    proxy_str: proxy_str.to_string(),
                    country: "ERROR".to_string(),
                    city: "Connection Failed".to_string(),
                    ip: "Unknown".to_string(),
                    latency: None,
                    error: Some(e.to_string()),
                }
            }
        }
    }

    fn parse_proxy(
        proxy_str: &str,
    ) -> Option<(String, String, u16, Option<String>, Option<String>)> {
        let proxy_str = proxy_str.trim();
        
        // Поддерживаемые форматы:
        // 1. protocol://username:password@host:port
        // 2. protocol://host:port
        // 3. host:port:username:password
        // 4. host:port
        // 5. username:password@host:port (without protocol)
        // 6. socks5://... socks4://... http://... https://...

        if proxy_str.contains("://") {
            // URL формат с явным протоколом
            let parts: Vec<&str> = proxy_str.split("://").collect();
            if parts.len() != 2 {
                return None;
            }

            let protocol = parts[0].to_lowercase();
            let rest = parts[1];

            if let Some(at_pos) = rest.find('@') {
                // С авторизацией
                let auth = &rest[..at_pos];
                let host_port = &rest[at_pos + 1..];

                let auth_parts: Vec<&str> = auth.split(':').collect();
                if auth_parts.len() != 2 {
                    return None;
                }

                let username = Some(auth_parts[0].to_string());
                let password = Some(auth_parts[1].to_string());

                let host_port_parts: Vec<&str> = host_port.split(':').collect();
                if host_port_parts.len() != 2 {
                    return None;
                }

                let host = host_port_parts[0].to_string();
                let port = host_port_parts[1].parse::<u16>().ok()?;

                Some((protocol, host, port, username, password))
            } else {
                // Без авторизации
                let host_port_parts: Vec<&str> = rest.split(':').collect();
                if host_port_parts.len() != 2 {
                    return None;
                }

                let host = host_port_parts[0].to_string();
                let port = host_port_parts[1].parse::<u16>().ok()?;

                Some((protocol, host, port, None, None))
            }
        } else if proxy_str.contains('@') {
            // Формат: username:password@host:port (без протокола)
            let parts: Vec<&str> = proxy_str.split('@').collect();
            if parts.len() != 2 {
                return None;
            }

            let auth = parts[0];
            let host_port = parts[1];

            let auth_parts: Vec<&str> = auth.split(':').collect();
            if auth_parts.len() != 2 {
                return None;
            }

            let username = Some(auth_parts[0].to_string());
            let password = Some(auth_parts[1].to_string());

            let host_port_parts: Vec<&str> = host_port.split(':').collect();
            if host_port_parts.len() != 2 {
                return None;
            }

            let host = host_port_parts[0].to_string();
            let port = host_port_parts[1].parse::<u16>().ok()?;
            
            // Автоопределение протокола
            let protocol = Self::detect_protocol(port, None);

            Some((protocol, host, port, username, password))
        } else {
            // Простые форматы: host:port или host:port:username:password
            let parts: Vec<&str> = proxy_str.split(':').collect();
            
            if parts.len() == 2 {
                // Формат: host:port
                let host = parts[0].to_string();
                let port = parts[1].parse::<u16>().ok()?;
                let protocol = Self::detect_protocol(port, None);
                Some((protocol, host, port, None, None))
            } else if parts.len() == 4 {
                // Формат: host:port:username:password
                let host = parts[0].to_string();
                let port = parts[1].parse::<u16>().ok()?;
                let username = Some(parts[2].to_string());
                let password = Some(parts[3].to_string());
                let protocol = Self::detect_protocol(port, None);
                Some((protocol, host, port, username, password))
            } else {
                None
            }
        }
    }
}
