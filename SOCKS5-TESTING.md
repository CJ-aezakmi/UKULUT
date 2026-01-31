# Тестирование SOCKS5 поддержки

## Быстрый тест

1. **Добавьте SOCKS5 прокси**:
   - Перейдите в раздел "Прокси"
   - Добавьте прокси в формате: `socks5://username:password@host:1080`
   - Нажмите "Проверить" - должно показать страну и работоспособность

2. **Создайте профиль с SOCKS5**:
   - Перейдите в раздел "Профили"
   - Создайте новый профиль
   - Выберите добавленный SOCKS5 прокси
   - Сохраните профиль

3. **Запустите профиль**:
   - Нажмите "Запустить" на профиле
   - Браузер должен открыться с загруженным proxy-extension
   - Проверьте IP на whoer.net - должен показать IP прокси

## Проверка работы extension

### В терминале launcher:
```
[Launcher] Загружено SOCKS proxy extension: C:\...\proxy-extension
[Launcher] SOCKS proxy передан в extension
```

### В консоли браузера (F12):
```
[Proxy Extension] Расширение загружено
[Browser] SOCKS proxy будет настроен через extension: socks5://...
[Proxy Extension] Настройка прокси: {scheme: "socks5", host: "...", port: 1080}
[Proxy Extension] Прокси настроен: host:port
```

## Если не работает

### Проверка 1: Расширение загружено?
```powershell
Test-Path "C:\Users\Asus\Desktop\AnticBrowser-Tauri\proxy-extension\manifest.json"
```
Должно вернуть `True`

### Проверка 2: Иконки существуют?
```powershell
Test-Path "C:\Users\Asus\Desktop\AnticBrowser-Tauri\proxy-extension\icon*.png"
```

### Проверка 3: Проверка прокси работает?
- В разделе "Прокси" нажмите "Проверить" на SOCKS5 прокси
- Должно показать зеленую галочку и страну
- В терминале Rust: `[Proxy Checker] Checking socks5 proxy: ...`

### Проверка 4: Браузер запускается с расширением?
Откройте `chrome://extensions` в запущенном браузере, должно быть:
- **Antic Proxy Extension** (включено)
- Описание: "SOCKS5 proxy support for Antic Browser"

## Тестовые SOCKS5 прокси

Для тестирования без реального прокси можно использовать локальный:

### SSH Tunnel (если у вас есть SSH сервер):
```bash
ssh -D 1080 -N user@your-server.com
```
Затем используйте: `socks5://127.0.0.1:1080`

### Dante SOCKS server (для Windows):
1. Установите Dante
2. Настройте `sockd.conf`
3. Используйте: `socks5://127.0.0.1:1080`

## Сравнение с HTTP прокси

| Функция | HTTP | SOCKS5 |
|---------|------|--------|
| Проверка (reqwest) | ✅ | ✅ |
| Браузер (Playwright) | ✅ Встроенное | ✅ Через extension |
| Авторизация | ✅ | ✅ |
| UDP трафик | ❌ | ❌ (TCP only) |
| WebSocket | ⚠️ | ⚠️ |

## Отладочные команды

### Просмотр логов прокси checker:
```powershell
# В терминале где запущен npm run tauri dev
# Ищите строки:
[Proxy Checker] Checking socks5 proxy: ...
```

### Просмотр логов launcher:
```powershell
# После запуска профиля:
[Launcher] Загружено SOCKS proxy extension: ...
[Launcher] SOCKS proxy передан в extension
```

### Консоль браузера:
1. F12 в запущенном браузере
2. Console tab
3. Фильтр: "Proxy Extension"

## FAQ

**Q: Почему SOCKS5 не работал раньше?**
A: Playwright не поддерживает SOCKS с авторизацией. Нужно было создать Chrome extension.

**Q: Работает ли SOCKS5 без авторизации?**
A: Да, но большинство провайдеров требуют авторизацию. Extension поддерживает оба варианта.

**Q: Можно ли использовать несколько прокси одновременно?**
A: Нет, браузер использует один прокси за раз. Для нескольких прокси создайте несколько профилей.

**Q: Поддерживается ли SOCKS4?**
A: Да, extension поддерживает SOCKS4, SOCKS5, HTTP, HTTPS.

**Q: Безопасно ли передавать пароли в extension?**
A: Да, extension работает локально, не отправляет данные никуда. Код открыт для проверки.
