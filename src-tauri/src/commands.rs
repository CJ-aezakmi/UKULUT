use crate::models::*;
use crate::browser;
use crate::proxy_api::ProxyApiClient;
use crate::proxy_checker::ProxyChecker;
use crate::storage::Storage;
use std::sync::Arc;
use tauri::State;
use std::sync::Mutex;
use std::process::Child;

// Глобальное хранилище для дочерних процессов
pub struct ProcessManager {
    processes: Mutex<Vec<Child>>,
}

impl ProcessManager {
    pub fn new() -> Self {
        Self {
            processes: Mutex::new(Vec::new()),
        }
    }
    
    pub fn add_process(&self, child: Child) {
        if let Ok(mut processes) = self.processes.lock() {
            processes.push(child);
        }
    }
}

// ============================================================================
// PROFILE COMMANDS
// ============================================================================

#[tauri::command]
pub async fn get_profiles(storage: State<'_, Arc<Storage>>) -> Result<Vec<Profile>, String> {
    Ok(storage.get_profiles())
}

#[tauri::command]
pub async fn save_profile(
    profile: Profile,
    storage: State<'_, Arc<Storage>>,
) -> Result<(), String> {
    storage
        .save_profile(profile)
        .map_err(|e| format!("Failed to save profile: {}", e))
}

#[tauri::command]
pub async fn delete_profile(
    profile_name: String,
    storage: State<'_, Arc<Storage>>,
) -> Result<(), String> {
    storage
        .delete_profile(&profile_name)
        .map_err(|e| format!("Failed to delete profile: {}", e))
}

#[tauri::command]
pub async fn launch_profile(
    profile_name: String,
    storage: State<'_, Arc<Storage>>,
    process_manager: State<'_, Arc<ProcessManager>>,
) -> Result<String, String> {
    let profile = storage
        .get_profile(&profile_name)
        .ok_or_else(|| "Profile not found".to_string())?;

    // Find the antidetect-extension template directory
    use std::env;

    let current_exe = env::current_exe().map_err(|e| e.to_string())?;
    let exe_dir = current_exe.parent().ok_or("Failed to get exe directory")?;

    // In dev mode: antidetect-extension is in src-tauri/
    // In release mode: antidetect-extension should be next to .exe
    let extension_template_dir = if cfg!(debug_assertions) {
        // Dev mode: go up 3 levels from target/debug/ to src-tauri/
        exe_dir.parent()
            .and_then(|p| p.parent())
            .and_then(|p| p.parent())
            .ok_or("Failed to find project root")?
            .join("src-tauri")
            .join("antidetect-extension")
    } else {
        // Release mode: extension template next to .exe
        exe_dir.join("antidetect-extension")
    };

    if !extension_template_dir.exists() {
        return Err(format!(
            "Anti-detect extension template not found at: {:?}",
            extension_template_dir
        ));
    }

    #[cfg(debug_assertions)]
    {
        println!("[LaunchProfile] Extension template: {:?}", extension_template_dir);
    }

    // CyberYozh расширение — лежит рядом с antidetect-extension
    let cyberyozh_dir = if cfg!(debug_assertions) {
        exe_dir.parent()
            .and_then(|p| p.parent())
            .and_then(|p| p.parent())
            .map(|p| p.join("src-tauri").join("cyberyozh-extension"))
    } else {
        Some(exe_dir.join("cyberyozh-extension"))
    };

    let cyberyozh_path = cyberyozh_dir.filter(|p| p.exists());

    #[cfg(debug_assertions)]
    {
        if let Some(ref p) = cyberyozh_path {
            println!("[LaunchProfile] CyberYozh extension: {:?}", p);
        } else {
            println!("[LaunchProfile] CyberYozh extension не найден");
        }
    }

    // Launch Chrome with anti-detect profile
    match browser::launch_chrome(&profile, &extension_template_dir, cyberyozh_path) {
        Ok(child) => {
            process_manager.add_process(child);
            Ok(format!("Profile '{}' launched successfully", profile_name))
        }
        Err(e) => Err(format!("Failed to launch browser: {}", e)),
    }
}

// ============================================================================
// PROXY COMMANDS
// ============================================================================

#[tauri::command]
pub async fn get_proxies(storage: State<'_, Arc<Storage>>) -> Result<Vec<Proxy>, String> {
    Ok(storage.get_proxies())
}

#[tauri::command]
pub async fn add_proxy(proxy_str: String, storage: State<'_, Arc<Storage>>) -> Result<(), String> {
    // Парсим прокси
    let parts: Vec<&str> = proxy_str.split("://").collect();
    if parts.len() != 2 {
        return Err("Invalid proxy format".to_string());
    }

    let protocol = parts[0].to_string();
    let rest = parts[1];

    let (host, port, username, password) = if rest.contains('@') {
        let auth_parts: Vec<&str> = rest.split('@').collect();
        let credentials: Vec<&str> = auth_parts[0].split(':').collect();
        let host_port: Vec<&str> = auth_parts[1].split(':').collect();

        (
            host_port[0].to_string(),
            host_port[1].parse::<u16>().map_err(|_| "Invalid port")?,
            Some(credentials[0].to_string()),
            Some(credentials[1].to_string()),
        )
    } else {
        let host_port: Vec<&str> = rest.split(':').collect();
        (
            host_port[0].to_string(),
            host_port[1].parse::<u16>().map_err(|_| "Invalid port")?,
            None,
            None,
        )
    };

    let proxy = Proxy {
        proxy_str,
        protocol,
        host,
        port,
        username,
        password,
        country: None,
        city: None,
        checked: false,
        last_check: None,
        latency: None,
    };

    storage
        .save_proxy(proxy)
        .map_err(|e| format!("Failed to save proxy: {}", e))
}

#[tauri::command]
pub async fn remove_proxy(
    proxy_str: String,
    storage: State<'_, Arc<Storage>>,
) -> Result<(), String> {
    storage
        .remove_proxy(&proxy_str)
        .map_err(|e| format!("Failed to remove proxy: {}", e))
}

#[tauri::command]
pub async fn check_proxy(
    proxy_str: String,
    storage: State<'_, Arc<Storage>>,
) -> Result<ProxyCheckResult, String> {
    let checker = ProxyChecker::new();
    let result = checker.check_proxy(&proxy_str).await;

    // Сохраняем результат проверки
    if result.status == "working" {
        let _ = storage.update_proxy(&proxy_str, &result);
        let _ = storage.save_proxy_check(&proxy_str, result.clone());
    }

    Ok(result)
}

#[tauri::command]
pub async fn import_proxies_from_text(
    proxies_text: String,
    storage: State<'_, Arc<Storage>>,
) -> Result<Vec<String>, String> {
    let mut imported = Vec::new();

    for line in proxies_text.lines() {
        let line = line.trim();
        if !line.is_empty() && (line.starts_with("http://") || line.starts_with("socks5://")) {
            match add_proxy(line.to_string(), storage.clone()).await {
                Ok(_) => imported.push(line.to_string()),
                Err(_) => continue,
            }
        }
    }

    Ok(imported)
}

// ============================================================================
// API KEYS COMMANDS
// ============================================================================

#[tauri::command]
pub async fn save_api_key(
    service: String,
    key: String,
    storage: State<'_, Arc<Storage>>,
) -> Result<(), String> {
    storage
        .save_api_key(&service, &key)
        .map_err(|e| format!("Failed to save API key: {}", e))
}

#[tauri::command]
pub async fn get_api_key(
    service: String,
    storage: State<'_, Arc<Storage>>,
) -> Result<Option<String>, String> {
    Ok(storage.get_api_key(&service))
}

// ============================================================================
// SX.ORG API COMMANDS
// ============================================================================

#[tauri::command]
pub async fn sx_org_validate_key(api_key: String) -> Result<(bool, String), String> {
    let client = ProxyApiClient::new();
    client
        .sx_org_validate_key(&api_key)
        .await
        .map_err(|e| format!("Validation failed: {}", e))
}

#[tauri::command]
pub async fn sx_org_get_countries(api_key: String) -> Result<Vec<SXOrgCountry>, String> {
    let client = ProxyApiClient::new();
    client
        .sx_org_get_countries(&api_key)
        .await
        .map_err(|e| format!("Failed to get countries: {}", e))
}

#[tauri::command]
pub async fn sx_org_get_states(api_key: String, country_id: u32) -> Result<Vec<SXOrgState>, String> {
    let client = ProxyApiClient::new();
    client
        .sx_org_get_states(&api_key, country_id)
        .await
        .map_err(|e| format!("Failed to get states: {}", e))
}

#[tauri::command]
pub async fn sx_org_get_cities(
    api_key: String,
    state_id: u32,
    country_id: u32,
) -> Result<Vec<SXOrgCity>, String> {
    let client = ProxyApiClient::new();
    client
        .sx_org_get_cities(&api_key, state_id, country_id)
        .await
        .map_err(|e| format!("Failed to get cities: {}", e))
}

#[tauri::command]
pub async fn sx_org_create_proxy(
    api_key: String,
    country_code: String,
    state_name: Option<String>,
    city_name: Option<String>,
    connection_type: String,
    proxy_types: Vec<String>,
    proxy_name: String,
    storage: State<'_, Arc<Storage>>,
) -> Result<Vec<String>, String> {
    let client = ProxyApiClient::new();
    
    let proxy_types_refs: Vec<&str> = proxy_types.iter().map(|s| s.as_str()).collect();
    
    let proxies = client
        .sx_org_create_proxy(
            &api_key,
            &country_code,
            state_name.as_deref(),
            city_name.as_deref(),
            &connection_type,
            proxy_types_refs,
            &proxy_name,
        )
        .await
        .map_err(|e| format!("Failed to create proxy: {}", e))?;

    // Сохраняем созданные прокси
    for proxy_str in &proxies {
        let _ = add_proxy(proxy_str.clone(), storage.clone()).await;
    }

    Ok(proxies)
}

// ============================================================================
// CYBERYOZH API COMMANDS
// ============================================================================

#[tauri::command]
pub async fn cyberyozh_validate_key(api_key: String) -> Result<(bool, String), String> {
    let client = ProxyApiClient::new();
    client
        .cyberyozh_validate_key(&api_key)
        .await
        .map_err(|e| format!("Validation failed: {}", e))
}

#[tauri::command]
pub async fn cyberyozh_get_shop_proxies(
    api_key: String,
    country_code: Option<String>,
    access_type: Option<String>,
) -> Result<Vec<CyberYozhShopItem>, String> {
    let client = ProxyApiClient::new();
    client
        .cyberyozh_get_shop_proxies(
            &api_key,
            country_code.as_deref(),
            access_type.as_deref(),
        )
        .await
        .map_err(|e| format!("Failed to get shop proxies: {}", e))
}

#[tauri::command]
pub async fn cyberyozh_buy_proxy(
    api_key: String,
    proxy_id: String,
    auto_renew: bool,
) -> Result<String, String> {
    let client = ProxyApiClient::new();
    client
        .cyberyozh_buy_proxy(&api_key, &proxy_id, auto_renew)
        .await
        .map_err(|e| format!("Failed to buy proxy: {}", e))
}

#[tauri::command]
pub async fn cyberyozh_get_my_proxies(api_key: String) -> Result<Vec<CyberYozhProxyItem>, String> {
    let client = ProxyApiClient::new();
    client
        .cyberyozh_get_my_proxies(&api_key)
        .await
        .map_err(|e| format!("Failed to get my proxies: {}", e))
}

#[tauri::command]
pub async fn cyberyozh_import_proxies(
    api_key: String,
    storage: State<'_, Arc<Storage>>,
) -> Result<Vec<String>, String> {
    let client = ProxyApiClient::new();
    
    let proxies = client
        .cyberyozh_get_my_proxies(&api_key)
        .await
        .map_err(|e| format!("Failed to get proxies: {}", e))?;

    let formatted = client.cyberyozh_format_proxies(proxies).await;
    
    let mut imported = Vec::new();
    for proxy in formatted {
        let proxy_str = proxy.proxy_str.clone();
        if storage.save_proxy(proxy).is_ok() {
            imported.push(proxy_str);
        }
    }

    Ok(imported)
}

// ============================================================================
// PSB PROXY API COMMANDS
// ============================================================================

#[tauri::command]
pub async fn psb_validate_key(api_key: String) -> Result<(bool, String), String> {
    let client = ProxyApiClient::new();
    client
        .psb_validate_key(&api_key)
        .await
        .map_err(|e| format!("Validation failed: {}", e))
}

#[tauri::command]
pub async fn psb_get_sub_users(api_key: String) -> Result<serde_json::Value, String> {
    let client = ProxyApiClient::new();
    let result = client
        .psb_get_sub_users(&api_key)
        .await
        .map_err(|e| format!("Failed to get sub-users: {}", e))?;
    
    serde_json::to_value(result).map_err(|e| format!("Serialize error: {}", e))
}

#[tauri::command]
pub async fn psb_create_sub_user(api_key: String, sub_type: String) -> Result<serde_json::Value, String> {
    let client = ProxyApiClient::new();
    let result = client
        .psb_create_sub_user(&api_key, &sub_type)
        .await
        .map_err(|e| format!("Failed to create sub-user: {}", e))?;
    
    serde_json::to_value(result).map_err(|e| format!("Serialize error: {}", e))
}

#[tauri::command]
pub async fn psb_get_basic_sub_user(api_key: String, sub_type: String) -> Result<serde_json::Value, String> {
    let client = ProxyApiClient::new();
    let result = client
        .psb_get_basic_sub_user(&api_key, &sub_type)
        .await
        .map_err(|e| format!("Failed to get basic sub-user: {}", e))?;
    
    serde_json::to_value(result).map_err(|e| format!("Serialize error: {}", e))
}

#[tauri::command]
pub async fn psb_get_sub_user(api_key: String, id: u32) -> Result<serde_json::Value, String> {
    let client = ProxyApiClient::new();
    let result = client
        .psb_get_sub_user(&api_key, id)
        .await
        .map_err(|e| format!("Failed to get sub-user: {}", e))?;
    
    serde_json::to_value(result).map_err(|e| format!("Serialize error: {}", e))
}

#[tauri::command]
pub async fn psb_give_traffic(api_key: String, sub_user_id: u32, amount: f64) -> Result<serde_json::Value, String> {
    let client = ProxyApiClient::new();
    let result = client
        .psb_give_traffic(&api_key, sub_user_id, amount)
        .await
        .map_err(|e| format!("Failed to give traffic: {}", e))?;
    
    serde_json::to_value(result).map_err(|e| format!("Serialize error: {}", e))
}

#[tauri::command]
pub async fn psb_take_traffic(api_key: String, sub_user_id: u32, amount: f64) -> Result<serde_json::Value, String> {
    let client = ProxyApiClient::new();
    let result = client
        .psb_take_traffic(&api_key, sub_user_id, amount)
        .await
        .map_err(|e| format!("Failed to take traffic: {}", e))?;
    
    serde_json::to_value(result).map_err(|e| format!("Serialize error: {}", e))
}

#[tauri::command]
pub async fn psb_delete_sub_user(api_key: String, sub_user_id: u32) -> Result<String, String> {
    let client = ProxyApiClient::new();
    client
        .psb_delete_sub_user(&api_key, sub_user_id)
        .await
        .map_err(|e| format!("Failed to delete sub-user: {}", e))
}

#[tauri::command]
pub async fn psb_get_pool_data(api_key: String, proxy_type: String, pool: String) -> Result<serde_json::Value, String> {
    let client = ProxyApiClient::new();
    client
        .psb_get_pool_data(&api_key, &proxy_type, &pool)
        .await
        .map_err(|e| format!("Failed to get pool data: {}", e))
}

#[tauri::command]
pub async fn psb_get_countries(api_key: String, proxy_type: String, pool: String) -> Result<serde_json::Value, String> {
    let client = ProxyApiClient::new();
    let result = client
        .psb_get_countries(&api_key, &proxy_type, &pool)
        .await
        .map_err(|e| format!("Failed to get countries: {}", e))?;
    
    serde_json::to_value(result).map_err(|e| format!("Serialize error: {}", e))
}

#[tauri::command]
pub async fn psb_get_formats(api_key: String, proxy_type: String, pool: String) -> Result<serde_json::Value, String> {
    let client = ProxyApiClient::new();
    let result = client
        .psb_get_formats(&api_key, &proxy_type, &pool)
        .await
        .map_err(|e| format!("Failed to get formats: {}", e))?;
    
    serde_json::to_value(result).map_err(|e| format!("Serialize error: {}", e))
}

#[tauri::command]
pub async fn psb_get_hostnames(api_key: String, proxy_type: String, pool: String) -> Result<serde_json::Value, String> {
    let client = ProxyApiClient::new();
    let result = client
        .psb_get_hostnames(&api_key, &proxy_type, &pool)
        .await
        .map_err(|e| format!("Failed to get hostnames: {}", e))?;
    
    serde_json::to_value(result).map_err(|e| format!("Serialize error: {}", e))
}

#[tauri::command]
pub async fn psb_get_protocols(api_key: String, proxy_type: String, pool: String) -> Result<serde_json::Value, String> {
    let client = ProxyApiClient::new();
    let result = client
        .psb_get_protocols(&api_key, &proxy_type, &pool)
        .await
        .map_err(|e| format!("Failed to get protocols: {}", e))?;
    
    serde_json::to_value(result).map_err(|e| format!("Serialize error: {}", e))
}

#[tauri::command]
pub async fn psb_generate_proxy_list(
    api_key: String,
    proxy_type: String,
    pool: String,
    params: serde_json::Value,
) -> Result<Vec<String>, String> {
    let client = ProxyApiClient::new();
    client
        .psb_generate_proxy_list(&api_key, &proxy_type, &pool, params)
        .await
        .map_err(|e| format!("Failed to generate proxy list: {}", e))
}

#[tauri::command]
pub async fn psb_add_whitelist_ip(
    api_key: String,
    proxy_type: String,
    pool: String,
    ip: String,
    sub_user_id: Option<u32>,
) -> Result<String, String> {
    let client = ProxyApiClient::new();
    client
        .psb_add_whitelist_ip(&api_key, &proxy_type, &pool, &ip, sub_user_id)
        .await
        .map_err(|e| format!("Failed to add IP to whitelist: {}", e))
}

#[tauri::command]
pub async fn psb_get_whitelist(
    api_key: String,
    proxy_type: String,
    pool: String,
    sub_user_id: Option<u32>,
) -> Result<serde_json::Value, String> {
    let client = ProxyApiClient::new();
    client
        .psb_get_whitelist(&api_key, &proxy_type, &pool, sub_user_id)
        .await
        .map_err(|e| format!("Failed to get whitelist: {}", e))
}

#[tauri::command]
pub async fn psb_remove_whitelist_ip(
    api_key: String,
    proxy_type: String,
    pool: String,
    ip: String,
    sub_user_id: Option<u32>,
) -> Result<String, String> {
    let client = ProxyApiClient::new();
    client
        .psb_remove_whitelist_ip(&api_key, &proxy_type, &pool, &ip, sub_user_id)
        .await
        .map_err(|e| format!("Failed to remove IP from whitelist: {}", e))
}

#[tauri::command]
pub async fn psb_get_my_ip() -> Result<String, String> {
    let client = ProxyApiClient::new();
    client
        .psb_get_my_ip()
        .await
        .map_err(|e| format!("Failed to get IP: {}", e))
}

#[tauri::command]
pub async fn psb_import_proxy(
    proxy_str: String,
    protocol: Option<String>,
    country_code: Option<String>,
    storage: State<'_, Arc<Storage>>,
) -> Result<(), String> {
    // Parse the proxy string: host:port:login:password or host:port@login:password
    let parts: Vec<&str> = proxy_str.split(':').collect();
    let (host, port, username, password) = if parts.len() >= 4 {
        (parts[0].to_string(), parts[1].parse::<u16>().unwrap_or(0), Some(parts[2].to_string()), Some(parts[3].to_string()))
    } else if parts.len() >= 2 {
        (parts[0].to_string(), parts[1].parse::<u16>().unwrap_or(0), None, None)
    } else {
        (proxy_str.clone(), 0u16, None, None)
    };

    let proto = protocol.unwrap_or_else(|| "http".to_string());
    
    let formatted = if let (Some(ref u), Some(ref p)) = (&username, &password) {
        format!("{}://{}:{}@{}:{}", proto, u, p, host, port)
    } else {
        format!("{}://{}:{}", proto, host, port)
    };

    let proxy = Proxy {
        proxy_str: formatted,
        protocol: proto,
        host,
        port,
        username,
        password,
        country: country_code,
        city: None,
        checked: false,
        last_check: None,
        latency: None,
    };
    
    // Use force save to allow duplicate proxy strings (PSB rotating proxies return identical strings)
    storage
        .save_proxy_force(proxy)
        .map_err(|e| format!("Failed to save proxy: {}", e))
}
