use crate::models::*;
use anyhow::Result;
use std::fs;
use std::path::PathBuf;
use std::sync::{Arc, Mutex};

pub struct Storage {
    data_dir: PathBuf,
    state: Arc<Mutex<AppState>>,
}

impl Storage {
    pub fn new(data_dir: PathBuf) -> Result<Self> {
        // Создаем необходимые директории
        fs::create_dir_all(&data_dir)?;
        fs::create_dir_all(data_dir.join("config"))?;
        fs::create_dir_all(data_dir.join("cookies"))?;

        let state = Arc::new(Mutex::new(AppState::default()));
        
        let storage = Storage { data_dir, state };

        // Загружаем данные
        storage.load_api_keys()?;
        storage.load_proxies()?;
        storage.load_profiles()?;
        storage.load_proxy_cache()?;

        Ok(storage)
    }

    // API Keys
    pub fn save_api_key(&self, service: &str, key: &str) -> Result<()> {
        let mut state = self.state.lock().unwrap();
        state.api_keys.insert(service.to_string(), key.to_string());

        let api_keys_path = self.data_dir.join("api_keys.json");
        let json = serde_json::to_string_pretty(&state.api_keys)?;
        fs::write(api_keys_path, json)?;

        Ok(())
    }

    pub fn get_api_key(&self, service: &str) -> Option<String> {
        let state = self.state.lock().unwrap();
        state.api_keys.get(service).cloned()
    }

    fn load_api_keys(&self) -> Result<()> {
        let api_keys_path = self.data_dir.join("api_keys.json");
        if api_keys_path.exists() {
            let content = fs::read_to_string(api_keys_path)?;
            let api_keys: std::collections::HashMap<String, String> = serde_json::from_str(&content)?;
            let mut state = self.state.lock().unwrap();
            state.api_keys = api_keys;
        }
        Ok(())
    }

    // Proxies
    pub fn save_proxy(&self, proxy: Proxy) -> Result<()> {
        let mut state = self.state.lock().unwrap();

        // Проверяем, существует ли уже такой прокси
        if !state.proxies.iter().any(|p| p.proxy_str == proxy.proxy_str) {
            state.proxies.push(proxy);

            let proxies_path = self.data_dir.join("proxies.json");
            let json = serde_json::to_string_pretty(&state.proxies)?;
            fs::write(proxies_path, json)?;
        }

        Ok(())
    }

    /// Save proxy without deduplication check (for bulk PSB imports where strings may repeat)
    pub fn save_proxy_force(&self, proxy: Proxy) -> Result<()> {
        let mut state = self.state.lock().unwrap();
        state.proxies.push(proxy);

        let proxies_path = self.data_dir.join("proxies.json");
        let json = serde_json::to_string_pretty(&state.proxies)?;
        fs::write(proxies_path, json)?;

        Ok(())
    }

    pub fn get_proxies(&self) -> Vec<Proxy> {
        let state = self.state.lock().unwrap();
        state.proxies.clone()
    }

    pub fn remove_proxy(&self, proxy_str: &str) -> Result<()> {
        let mut state = self.state.lock().unwrap();
        state.proxies.retain(|p| p.proxy_str != proxy_str);

        let proxies_path = self.data_dir.join("proxies.json");
        let json = serde_json::to_string_pretty(&state.proxies)?;
        fs::write(proxies_path, json)?;

        Ok(())
    }

    pub fn update_proxy(&self, proxy_str: &str, check_result: &ProxyCheckResult) -> Result<()> {
        let mut state = self.state.lock().unwrap();

        if let Some(proxy) = state.proxies.iter_mut().find(|p| p.proxy_str == proxy_str) {
            proxy.checked = check_result.status == "working";
            proxy.country = Some(check_result.country.clone());
            proxy.city = Some(check_result.city.clone());
            proxy.latency = check_result.latency;
            proxy.last_check = Some(chrono::Utc::now().to_rfc3339());

            let proxies_path = self.data_dir.join("proxies.json");
            let json = serde_json::to_string_pretty(&state.proxies)?;
            fs::write(proxies_path, json)?;
        }

        Ok(())
    }

    fn load_proxies(&self) -> Result<()> {
        let proxies_path = self.data_dir.join("proxies.json");
        if proxies_path.exists() {
            let content = fs::read_to_string(proxies_path)?;
            let proxies: Vec<Proxy> = serde_json::from_str(&content).unwrap_or_default();
            let mut state = self.state.lock().unwrap();
            state.proxies = proxies;
        }
        Ok(())
    }

    // Proxy Cache
    pub fn save_proxy_check(&self, proxy_str: &str, result: ProxyCheckResult) -> Result<()> {
        let mut state = self.state.lock().unwrap();
        state.proxy_cache.insert(proxy_str.to_string(), result);

        let cache_path = self.data_dir.join("proxy_cache.json");
        let json = serde_json::to_string_pretty(&state.proxy_cache)?;
        fs::write(cache_path, json)?;

        Ok(())
    }

    pub fn get_proxy_check(&self, proxy_str: &str) -> Option<ProxyCheckResult> {
        let state = self.state.lock().unwrap();
        state.proxy_cache.get(proxy_str).cloned()
    }

    fn load_proxy_cache(&self) -> Result<()> {
        let cache_path = self.data_dir.join("proxy_cache.json");
        if cache_path.exists() {
            let content = fs::read_to_string(cache_path)?;
            let cache: std::collections::HashMap<String, ProxyCheckResult> =
                serde_json::from_str(&content).unwrap_or_default();
            let mut state = self.state.lock().unwrap();
            state.proxy_cache = cache;
        }
        Ok(())
    }

    // Profiles
    pub fn save_profile(&self, profile: Profile) -> Result<()> {
        let profile_path = self.data_dir.join("config").join(format!("{}.json", profile.name));
        let json = serde_json::to_string_pretty(&profile)?;
        fs::write(profile_path, json)?;

        let mut state = self.state.lock().unwrap();

        // Обновляем или добавляем профиль
        if let Some(existing) = state.profiles.iter_mut().find(|p| p.name == profile.name) {
            *existing = profile;
        } else {
            state.profiles.push(profile);
        }

        Ok(())
    }

    pub fn get_profiles(&self) -> Vec<Profile> {
        let state = self.state.lock().unwrap();
        state.profiles.clone()
    }

    pub fn get_profile(&self, name: &str) -> Option<Profile> {
        let state = self.state.lock().unwrap();
        state.profiles.iter().find(|p| p.name == name).cloned()
    }

    pub fn delete_profile(&self, name: &str) -> Result<()> {
        // Удаляем файл профиля
        let profile_path = self.data_dir.join("config").join(format!("{}.json", name));
        if profile_path.exists() {
            fs::remove_file(profile_path)?;
        }

        // Удаляем из состояния
        let mut state = self.state.lock().unwrap();
        state.profiles.retain(|p| p.name != name);

        Ok(())
    }

    fn load_profiles(&self) -> Result<()> {
        let config_dir = self.data_dir.join("config");
        if !config_dir.exists() {
            return Ok(());
        }

        let mut profiles = Vec::new();

        for entry in fs::read_dir(config_dir)? {
            let entry = entry?;
            let path = entry.path();

            if path.extension().and_then(|s| s.to_str()) == Some("json") {
                if let Ok(content) = fs::read_to_string(&path) {
                    if let Ok(profile) = serde_json::from_str::<Profile>(&content) {
                        profiles.push(profile);
                    }
                }
            }
        }

        let mut state = self.state.lock().unwrap();
        state.profiles = profiles;

        Ok(())
    }

    // Cookies
    pub fn get_cookies_path(&self, profile_name: &str) -> PathBuf {
        self.data_dir.join("cookies").join(format!("{}.json", profile_name))
    }

    pub fn save_cookies(&self, profile_name: &str, cookies: &str) -> Result<()> {
        let cookies_path = self.get_cookies_path(profile_name);
        fs::write(cookies_path, cookies)?;
        Ok(())
    }

    pub fn load_cookies(&self, profile_name: &str) -> Result<String> {
        let cookies_path = self.get_cookies_path(profile_name);
        if cookies_path.exists() {
            Ok(fs::read_to_string(cookies_path)?)
        } else {
            Ok("[]".to_string())
        }
    }
}
