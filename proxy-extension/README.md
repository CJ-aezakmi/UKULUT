# Antic Proxy Extension

Chrome расширение для поддержки SOCKS4/SOCKS5 прокси с авторизацией в Antic Browser.

## Описание

Playwright (движок браузера) не поддерживает SOCKS прокси с авторизацией напрямую. 
Это расширение решает эту проблему, добавляя поддержку всех типов прокси:

- ✅ HTTP/HTTPS с авторизацией
- ✅ SOCKS4 с авторизацией  
- ✅ SOCKS5 с авторизацией

## Установка

Расширение автоматически загружается Antic Browser при запуске профиля с SOCKS прокси.

Файлы расширения находятся в папке `proxy-extension/`:
- `manifest.json` - манифест Chrome extension v3
- `background.js` - основная логика прокси
- `icon*.png` - иконки расширения

## Как это работает

1. **Определение типа прокси**: Launcher проверяет протокол прокси в конфигурации профиля
2. **Для HTTP/HTTPS**: Используется встроенная поддержка Playwright
3. **Для SOCKS**: Загружается это расширение с флагами:
   - `--disable-extensions-except=proxy-extension`
   - `--load-extension=proxy-extension`
4. **Конфигурация**: Настройки прокси передаются в расширение через localStorage
5. **Proxy API**: Расширение использует Chrome Proxy API для маршрутизации трафика
6. **Авторизация**: WebRequest API перехватывает запросы авторизации

## Поддерживаемые форматы

```
protocol://username:password@host:port
protocol://host:port
host:port:username:password
host:port
```

Где protocol: `http`, `https`, `socks4`, `socks5`

## Разработка

Для модификации расширения:

1. Отредактируйте `background.js`
2. Перезапустите Antic Browser
3. Проверьте логи в консоли браузера (F12)

## Безопасность

- Расширение работает локально, не отправляет данные никуда
- Пароли не сохраняются в открытом виде
- Используются только необходимые permissions
- Код открыт для аудита

## Технические детали

- **Manifest Version**: 3 (современный стандарт Chrome)
- **Permissions**: `proxy`, `storage`
- **Host Permissions**: `<all_urls>` (для перехвата авторизации)
- **Service Worker**: background.js (Manifest v3 требует service worker)

## Отладка

Для просмотра логов расширения:

1. Откройте браузер с профилем, который использует SOCKS
2. Нажмите F12 → Console
3. Ищите сообщения с префиксом `[Proxy Extension]`

Примеры логов:
```
[Proxy Extension] Расширение загружено
[Proxy Extension] Настройка прокси: {scheme: "socks5", host: "...", port: 1080}
[Proxy Extension] Прокси настроен: host:port
```

## Известные ограничения

- Playwright не может использовать прокси напрямую для websockets
- Некоторые сайты могут определять использование прокси
- UDP трафик не проксируется (только TCP)

## Совместимость

- ✅ Chromium-based браузеры (Playwright использует Chromium)
- ✅ Windows, macOS, Linux
- ✅ Все версии Playwright 1.40+
