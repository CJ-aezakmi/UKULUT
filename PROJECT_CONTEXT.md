# Antic Browser — Project Context for AI Sessions

> Этот файл — шпаргалка для AI-агента. Читай его в начале каждой сессии, чтобы не переоткрывать всё заново.

---

## 🏗 Что это за проект

**Antic Browser** — антидетект-браузер на базе **Tauri v2** + **React/TypeScript** + **Playwright Chromium**.  
Каждый профиль запускает отдельный Chromium с изолированным `--user-data-dir` и прокси.  
Есть встроенный **CyberYozh расширение** для подмены fingerprint.

- **GitHub repo**: `CJ-aezakmi/UKULUT` (приватный)
- **Текущая версия**: `2.0.14`
- **Лаунчер**: отдельный проект, автообновляет приложение через GitHub Releases API

---

## 📁 Структура проекта

```
src/                          # Frontend (React + TypeScript + Tailwind)
  App.tsx                     # Главный компонент, роутинг между страницами
  main.tsx                    # Entry point
  index.css                   # Tailwind + кастомные стили
  types.ts                    # TypeScript типы (Profile, Proxy, etc.)
  api.ts                      # Обёртки над Tauri invoke (все API вызовы)
  pages/
    ProfilesPage.tsx          # Страница профилей (создание, запуск браузера)
    ProxiesPage.tsx           # Страница прокси (ручное добавление, проверка)
  components/
    PSBProxyModal.tsx         # Модалка PSB Proxy (~1030 строк, основной UI интеграции)
  utils/
    constants.ts              # Константы (страны, типы прокси)
    storage.ts                # Работа с localStorage

src-tauri/                    # Backend (Rust)
  src/
    main.rs                   # Entry point
    lib.rs                    # Регистрация всех Tauri commands
    commands.rs               # Tauri command handlers (~700 строк)
    proxy_api.rs              # HTTP-клиент для PSB, SX.org, CyberYozh API (~900 строк)
    models.rs                 # Rust структуры (serde)
    proxy_relay.rs            # Локальный прокси-релей для профилей
    browser.rs                # Запуск Chromium через Playwright
  cyberyozh-extension/        # CyberYozh fingerprint extension (загружается в браузер)
  antidetect-extension/       # Собственное расширение антидетекта
  tauri.conf.json             # Конфиг Tauri (версия, окна, permissions)
  Cargo.toml                  # Rust зависимости
```

---

## 🔌 Интеграции прокси-провайдеров

### PSB Proxy (основной, наиболее сложный)
- **API Base**: `https://psbproxy.io/api/`
- **Auth**: Bearer token (API ключ из личного кабинета)
- **Ключ получается по ссылке**: `http://psbproxy.io/?utm_source=partner&utm_medium=soft&utm_term=antic&utm_campaign=openincognito`

#### Endpoints:
| Действие | Метод | URL |
|----------|-------|-----|
| Каталог продуктов | GET | `/api/products` (public, без auth) |
| Купить продукт | POST | `/api/products/{id}/buy` + `{"payment_type": "balance"}` |
| Создать SubUser | POST | `/api/residential_proxy/{pool}/sub-users` |
| Список SubUsers | GET | `/api/residential_proxy/{pool}/sub-users` |
| Выдать трафик | POST | `/api/residential_proxy/{pool}/sub-users/{id}/give-traffic` |
| Забрать трафик | POST | `/api/residential_proxy/{pool}/sub-users/{id}/take-traffic` |
| Удалить SubUser | DELETE | `/api/residential_proxy/{pool}/sub-users/{id}` |
| Генерация прокси | POST | `/api/residential_proxy/{pool}/sub-users/{id}/proxy-list` |
| Whitelist IP | POST/DELETE | `/api/residential_proxy/{pool}/sub-users/{id}/whitelist` |

#### Типы пулов (все через `residential_proxy/{pool}`):
| Тип | pool параметр | Product type |
|-----|---------------|-------------|
| Residential Pool-1 | `pool-1` | `residential-proxy-pool-1` |
| Residential Pool-2 | `pool-2` | `residential-proxy-pool-2` |
| Mobile | `pool-1` | `mobile-proxy-pool-1` |
| Datacenter | `pool-1` | `datacenter-proxy-pool-1` |

#### Flow создания SubUser:
1. `GET /api/products` → показать пакеты (1/10/100/500/1000 GB с ценами)
2. Пользователь выбирает пакет
3. `POST /api/products/{id}/buy` → покупка
4. `POST /api/residential_proxy/{pool}/sub-users` → создание SubUser
5. `POST .../give-traffic` → передача трафика на SubUser

#### Обработка ошибок:
- Backend: `psb_parse_error(status, body)` в `proxy_api.rs` — парсит HTTP ошибки в русские сообщения
- Frontend: `cleanError(error)` в `PSBProxyModal.tsx` — убирает "Failed to..." префиксы от Tauri

### SX.org Proxy
- Простая интеграция, прокси по API ключу
- Файл: `proxy_api.rs` (функции `sx_*`)

### CyberYozh VPN
- Расширение для браузера
- Файл: `proxy_api.rs` (функции `cyberyozh_*`)

---

## 🔧 Версии и конфиги

Версия хранится в **3 местах** (все должны совпадать!):
1. `package.json` → `"version": "X.Y.Z"`
2. `src-tauri/tauri.conf.json` → `"version": "X.Y.Z"`
3. `src-tauri/Cargo.toml` → `version = "X.Y.Z"`

### Bump версии:
```
package.json         → "version": "2.0.XX"
tauri.conf.json      → "version": "2.0.XX"  
Cargo.toml           → version = "2.0.XX"
```

### Сборка и публикация:
```powershell
# 1. Bump version в 3 файлах
# 2. Commit + tag
git add -A
git commit -m "v2.0.XX: описание"
git tag v2.0.XX
git push origin main --tags

# 3. Build
npm run tauri build 2>&1

# 4. GitHub Release
gh.exe release create v2.0.XX "src-tauri/target/release/bundle/nsis/Antic Browser_2.0.XX_x64-setup.exe" --title "Antic Browser v2.0.XX" --notes "описание"

# 5. Windows Defender exclusions (от имени админа)
Add-MpPreference -ExclusionPath "путь_к_exe"
Add-MpPreference -ExclusionPath "$env:LOCALAPPDATA\AnticBrowser"
```

### Запуск dev:
```powershell
# Сначала ОБЯЗАТЕЛЬНО освободить порт 3000!
Get-NetTCPConnection -LocalPort 3000 -ErrorAction SilentlyContinue | ForEach-Object { Stop-Process -Id $_.OwningProcess -Force -ErrorAction SilentlyContinue }
Start-Sleep 1
npm run tauri dev
```

---

## 📝 История изменений (ключевые)

### v2.0.14 (08.02.2026)
- PSB: покупка трафика прямо из приложения (каталог продуктов)
- PSB: полный flow buy → create SubUser → give traffic
- PSB: читаемые ошибки на русском (`psb_parse_error`)
- PSB: новый дизайн кнопок пулов (градиенты, иконки, подписи)
- PSB: ссылки обновлены (Купить трафик → psbproxy.io/account, API ключ → партнёрская ссылка)

### v2.0.13 (ранее)
- PSB: исправлены пути API (были сломаны, использовались неправильные URL)
- PSB: все 4 типа SubUser работают
- Revert-ы ошибочных изменений API путей

### v2.0.12 и ранее
- CyberYozh extension интеграция
- Antidetect extension
- Базовый прокси-менеджмент
- Профили с изолированным Chromium

---

## ⚠️ Известные проблемы / подводные камни

1. **Порт 3000**: Часто остаётся занят после `npm run tauri dev`. Всегда освобождай перед запуском!
2. **Cargo.toml версия**: Раньше отставала от остальных. Проверяй все 3 файла при bump.
3. **PSB API пути**: ВСЕ типы прокси идут через `residential_proxy/{pool}` — НЕ через `mobile_proxy` или `datacenter_proxy`!
4. **gh command**: В терминале PowerShell иногда добавляется ghost-символ перед `gh`. Используй `gh.exe` явно.
5. **Windows Defender**: Может блокировать .exe. Добавляй exclusion при каждой сборке.
6. **Кодировка терминала**: Для `gh.exe` и команд с русским текстом ставь `[Console]::OutputEncoding = [System.Text.Encoding]::UTF8`

---

## 🗂 Ключевые файлы для редактирования

| Задача | Файл |
|--------|------|
| Новый API endpoint | `src-tauri/src/proxy_api.rs` + `commands.rs` + `lib.rs` + `src/api.ts` |
| UI PSB Proxy | `src/components/PSBProxyModal.tsx` |
| UI профилей | `src/pages/ProfilesPage.tsx` |
| UI прокси | `src/pages/ProxiesPage.tsx` |
| Типы данных | `src/types.ts` + `src-tauri/src/models.rs` |
| Запуск браузера | `src-tauri/src/browser.rs` |
| Прокси-релей | `src-tauri/src/proxy_relay.rs` |
| Tauri конфиг | `src-tauri/tauri.conf.json` |
| Permissions | `src-tauri/capabilities/default.json` |

---

## 💬 Пользователь

- Общается на **русском**
- Хочет **полностью рабочие** фичи, не заглушки
- Ценит **красивый UI** (градиенты, анимации, иконки)
- Проверяет всё **вручную** после каждого изменения
- Просит **запустить** (`npm run tauri dev`) для проверки
- Просит **собрать и выложить** на GitHub при готовности
