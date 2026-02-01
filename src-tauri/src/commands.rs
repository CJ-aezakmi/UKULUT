use crate::models::*;
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

    // Запуск браузера через Node.js Playwright скрипт
    use std::process::Command;
    use std::env;

    // Получаем путь к корню проекта (на уровень выше src-tauri)
    let current_exe = env::current_exe().map_err(|e| e.to_string())?;
    let exe_dir = current_exe.parent().ok_or("Failed to get exe directory")?;
    
    // В режиме разработки: playwright-launcher.js находится в корне проекта
    // В режиме релиза: playwright-launcher.js должен быть рядом с .exe
    let launcher_path = if cfg!(debug_assertions) {
        // Dev mode: идем на 3 уровня выше
        exe_dir.parent()
            .and_then(|p| p.parent())
            .and_then(|p| p.parent())
            .ok_or("Failed to find project root")?
            .join("playwright-launcher.js")
    } else {
        // Release mode: скрипт рядом с .exe
        exe_dir.join("playwright-launcher.js")
    };

    if !launcher_path.exists() {
        return Err(format!("Playwright launcher not found at: {:?}", launcher_path));
    }

    // Настройка переменных окружения
    let local_appdata = env::var("LOCALAPPDATA").unwrap_or_else(|_| String::from("C:\\Users\\Default\\AppData\\Local"));
    let runtime_dir = format!("{}\\AnticBrowser\\runtime", local_appdata);
    let node_modules = format!("{}\\node_modules", runtime_dir);
    let playwright_browsers = format!("{}\\ms-playwright", runtime_dir);
    let node_dir = format!("{}\\node", runtime_dir);
    let node_exe = format!("{}\\node.exe", node_dir);

    // Формируем аргументы для node.exe
    let mut cmd = Command::new(&node_exe);
    cmd.arg(&launcher_path);  // первый аргумент - путь к скрипту
    
    // Добавляем параметры профиля
    cmd.arg("--profile-name").arg(&profile.name);
    cmd.arg("--user-agent").arg(&profile.user_agent);
    cmd.arg("--screen-width").arg(profile.screen_width.to_string());
    cmd.arg("--screen-height").arg(profile.screen_height.to_string());
    cmd.arg("--timezone").arg(&profile.timezone);
    cmd.arg("--lang").arg(&profile.lang);
    cmd.arg("--homepage").arg(&profile.homepage);
    cmd.arg("--cpu").arg(profile.cpu.to_string());
    cmd.arg("--ram").arg(profile.ram.to_string());
    cmd.arg("--vendor").arg(&profile.vendor);
    
    if profile.webgl {
        cmd.arg("--webgl");
    }
    
    if profile.is_touch {
        cmd.arg("--touch");
    }
    
    if let Some(proxy_str) = &profile.proxy {
        cmd.arg("--proxy").arg(proxy_str);
    }
    
    cmd.env("NODE_PATH", &node_modules);
    cmd.env("PLAYWRIGHT_BROWSERS_PATH", &playwright_browsers);
    
    if let Ok(current_path) = env::var("PATH") {
        cmd.env("PATH", format!("{};{}", node_dir, current_path));
    } else {
        cmd.env("PATH", &node_dir);
    }

    // Скрываем консоль для production
    #[cfg(target_os = "windows")]
    {
        const CREATE_NO_WINDOW: u32 = 0x08000000;
        cmd.creation_flags(CREATE_NO_WINDOW);
    }
    
    // Логируем команду
    println!("🚀 Launching: {:?}", node_exe);
    println!("📄 Script: {:?}", launcher_path);
    println!("⚙️ Args: {:?}", cmd);

    // Запускаем процесс
    match cmd.spawn() {
        Ok(child) => {
            process_manager.add_process(child);
            Ok(format!("Profile '{}' launched successfully", profile_name))
        },
        Err(e) => Err(format!("Failed to launch browser: {}. Make sure Node.js and Playwright are installed.", e)),
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
