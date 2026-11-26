# Antic Browser — Project Context

> Шпаргалка для разработчика / AI-агента. Актуально на ноябрь 2026 (после v2.0.20).

## Что это

Антидетект-браузер: **Tauri v2 (Rust) + React 18/TypeScript/Tailwind**. Каждый профиль —
отдельный Chromium (Playwright build) со своим `--user-data-dir`, прокси и отпечатком.

- Repo: `CJ-aezakmi/UKULUT` (**публичный** — никаких ключей в коммитах).
- Автообновление делает Electron-лаунчер (`launcher/`), он же ставит Node + Playwright Chromium
  в `%LOCALAPPDATA%\AnticBrowser\runtime`. Tauri updater не используется.

## Как работает антидетект (src-tauri/src)

| Файл | Роль |
|------|------|
| `browser.rs` | поиск Chromium, флаги запуска, `Preferences` профиля, выбор таймзоны/языка (`resolve_locale`), geo-lookup прокси |
| `cdp.rs` | CDP-контроллер: `Target.setAutoAttach(waitForDebuggerOnStart)` → в каждую страницу/фрейм/воркер до первого скрипта ставит таймзону, ядра CPU и `stealth.js` |
| `stealth.js` | WebGL vendor/renderer, шум canvas/audio (детерминированный seed профиля), screen, deviceMemory, touch; все патчи выглядят как `[native code]` |
| `proxy_relay.rs` | локальный HTTP-прокси на 127.0.0.1 → апстрим **HTTP или SOCKS5** с логином/паролем |

Принципы:
- **UA и Client Hints не подменяются** — всегда реальная версия движка (подмена версии палится
  через `Sec-CH-UA`/`userAgentData`/воркеры).
- Таймзона/язык `auto` (по умолчанию) — по IP выхода прокси (ip-api.com через сам прокси).
  Старые профили с `America/New_York` + `en-US` и прокси трактуются как `auto`.
- Язык: `--lang` + `intl.accept_languages` в Preferences (нативно, в т.ч. в воркерах).
- WebRTC: `disable_non_proxied_udp` (флаг + pref) — реальный IP не утекает.
- `Runtime.enable` никогда не вызывается (детектируемо). `--disable-blink-features=AutomationControlled`
  держит `navigator.webdriver=false` при подключённом CDP; `--disable-infobars` скрывает плашку
  Chrome for Testing; `--no-sandbox` нужен из‑за ACL папки ms-playwright.

Проверка: стенд в истории сессии — страница сообщает значения из `<head>`, iframe, srcdoc, worker и
HTTP-заголовки; e2e-тест `cargo test --lib launch_e2e -- --ignored` (переменные в комментарии теста).

## Интеграции прокси

| Провайдер | Код | Примечания |
|-----------|-----|-----------|
| SX.org | `SXOrgModal.tsx` (HTTP из фронта через plugin-http), `proxy_api.rs` | `message` в ответах бывает объектом, `balance` — числом |
| PSB Proxy | `PSBProxyModal.tsx`, `proxy_api.rs` (`psb_*`) | все пулы через `residential_proxy/{pool}` |
| CyberYozh | `CyberYozhModal.tsx`, `cyberyozh.rs` | см. ниже |
| MobileProxy.Space | кнопка-ссылка на `ProxiesPage.tsx` | партнёрская ссылка |

CyberYozh (`https://app.cyberyozh.com`, заголовок `X-Api-Key`):
- баланс только `GET /api/v2/users/balance/` (v1 → 401), тело — число текстом;
- магазин `GET /api/v1/proxies/shop/`: фильтр `country_code` сервер игнорирует; датацентр —
  `proxy_category=datacenter` + `access_type=private|shared`;
- покупка `POST /api/v1/proxies/shop/buy_proxies/` (массив `{id, auto_renew}`), без авто‑повторов;
- история `GET /api/v1/proxies/history/`; прокси чаще всего socks5 / `socks5_http` (`connection_ports`);
- жёсткий rate limit («Request was throttled») — клиент сам выдерживает паузу;
- ссылка «Получить API ключ»: `https://app.cyberyozh.com/catalog/?utm_source=antic`.

## Версия и релиз

Версия в 4 местах: `package.json`, `src-tauri/Cargo.toml`, `src-tauri/tauri.conf.json`,
`src-tauri/Cargo.lock` (пакет `app`).

GitHub Actions заблокирован по биллингу (с 08.2026) → релиз локально:
```powershell
npm run tauri build
# артефакты: src-tauri/target/release/bundle/{nsis,msi}
gh release create vX.Y.Z --draft <nsis.exe> <msi...>
# догрузить ассет лаунчера Antic.Browser_2.0.1_x64-setup.exe из прошлого релиза
gh release edit vX.Y.Z --draft=false --latest
```
Лаунчер ищет ассет `*_x64-setup.exe`, содержащий `_<версия>_`.

## Подводные камни

1. Порт 3000 бывает занят после `npm run tauri dev`.
2. `release.ps1` не запускать: `git add .`, переформатирует JSON, висит на `Read-Host`.
3. Лаунчер 2.0.1 читает версию из несуществующего `resources/app/package.json` → переустанавливает
   приложение при каждом запуске (не исправлено, лаунчер не пересобирается).
4. Windows Defender может ругаться на свежий exe.
