mod browser;
mod commands;
mod models;
mod proxy_api;
mod proxy_checker;
mod proxy_relay;
mod storage;

use tauri::Manager;
use std::sync::Arc;

pub use commands::*;
pub use storage::Storage;
pub use commands::ProcessManager;

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
  tauri::Builder::default()
    .plugin(tauri_plugin_shell::init())
    .plugin(tauri_plugin_http::init())
    .setup(|app| {
      if cfg!(debug_assertions) {
        app.handle().plugin(
          tauri_plugin_log::Builder::default()
            .level(log::LevelFilter::Info)
            .build(),
        )?;
      }

      // Инициализируем хранилище
      let app_dir = app.path().app_data_dir().expect("Failed to get app data dir");
      let storage = Arc::new(Storage::new(app_dir).expect("Failed to initialize storage"));
      app.manage(storage);

      // Инициализируем менеджер процессов
      let process_manager = Arc::new(ProcessManager::new());
      app.manage(process_manager);

      Ok(())
    })
    .invoke_handler(tauri::generate_handler![
      // Profile commands
      commands::get_profiles,
      commands::save_profile,
      commands::delete_profile,
      commands::launch_profile,
      
      // Proxy commands
      commands::get_proxies,
      commands::add_proxy,
      commands::remove_proxy,
      commands::check_proxy,
      commands::import_proxies_from_text,
      
      // API Keys commands
      commands::save_api_key,
      commands::get_api_key,
      
      // SX.ORG commands
      commands::sx_org_validate_key,
      commands::sx_org_get_countries,
      commands::sx_org_get_states,
      commands::sx_org_get_cities,
      commands::sx_org_create_proxy,
      
      // CyberYozh commands
      commands::cyberyozh_validate_key,
      commands::cyberyozh_get_shop_proxies,
      commands::cyberyozh_buy_proxy,
      commands::cyberyozh_get_my_proxies,
      commands::cyberyozh_import_proxies,
      
      // PSB Proxy commands
      commands::psb_validate_key,
      commands::psb_get_sub_users,
      commands::psb_create_sub_user,
      commands::psb_get_basic_sub_user,
      commands::psb_get_sub_user,
      commands::psb_give_traffic,
      commands::psb_take_traffic,
      commands::psb_delete_sub_user,
      commands::psb_get_pool_data,
      commands::psb_get_countries,
      commands::psb_get_formats,
      commands::psb_get_hostnames,
      commands::psb_get_protocols,
      commands::psb_generate_proxy_list,
      commands::psb_add_whitelist_ip,
      commands::psb_get_whitelist,
      commands::psb_remove_whitelist_ip,
      commands::psb_get_my_ip,
      commands::psb_import_proxy,
    ])
    .run(tauri::generate_context!())
    .expect("error while running tauri application");
}
