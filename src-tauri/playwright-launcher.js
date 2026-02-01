// playwright-launcher.js
// Запуск браузера с настройками профиля по образцу Python версии

import { chromium } from 'playwright';
import fs from 'fs';
import path from 'path';
import os from 'os';
import { fileURLToPath } from 'url';
import { dirname } from 'path';

// Получаем __dirname для ES модулей
const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);

// Парсинг аргументов командной строки
function parseArgs() {
    const args = process.argv.slice(2);
    const config = {
        profileName: '',
        userAgent: '',
        screenWidth: 1920,
        screenHeight: 1080,
        timezone: 'America/New_York',
        lang: 'en-US',
        homepage: 'https://whoer.net',
        cpu: 8,
        ram: 8,
        vendor: 'Google Inc.',
        webgl: true,
        touch: false,
        proxy: null,
    };

    for (let i = 0; i < args.length; i++) {
        switch (args[i]) {
            case '--profile-name':
                config.profileName = args[++i];
                break;
            case '--user-agent':
                config.userAgent = args[++i];
                break;
            case '--screen-width':
                config.screenWidth = parseInt(args[++i]);
                break;
            case '--screen-height':
                config.screenHeight = parseInt(args[++i]);
                break;
            case '--timezone':
                config.timezone = args[++i];
                break;
            case '--lang':
                config.lang = args[++i];
                break;
            case '--homepage':
                config.homepage = args[++i];
                break;
            case '--cpu':
                config.cpu = parseInt(args[++i]);
                break;
            case '--ram':
                config.ram = parseInt(args[++i]);
                break;
            case '--vendor':
                config.vendor = args[++i];
                break;
            case '--webgl':
                config.webgl = true;
                break;
            case '--touch':
                config.touch = true;
                break;
            case '--proxy':
                config.proxy = args[++i];
                break;
        }
    }

    return config;
}

// Парсинг прокси строки
function parseProxyString(proxyStr) {
    if (!proxyStr) return null;

    try {
        const url = new URL(proxyStr);
        
        return {
            scheme: url.protocol.replace(':', ''),  // http, https, socks4, socks5
            host: url.hostname,
            port: parseInt(url.port) || (url.protocol === 'https:' ? 443 : 80),
            username: url.username || null,
            password: url.password || null
        };
    } catch (e) {
        // Формат: host:port:username:password
        const parts = proxyStr.split(':');
        if (parts.length >= 2) {
            return {
                scheme: 'http',
                host: parts[0],
                port: parseInt(parts[1]),
                username: parts[2] || null,
                password: parts[3] || null
            };
        }
        return null;
    }
}

// Парсинг прокси строки для Playwright
function parseProxy(proxyStr) {
    if (!proxyStr) return null;

    try {
        const url = new URL(proxyStr);
        const scheme = url.protocol.replace(':', '');
        
        // ВАЖНО: Chromium не поддерживает авторизацию для SOCKS через Playwright API
        // Если это SOCKS с авторизацией - конвертируем в HTTP туннель
        if ((scheme === 'socks4' || scheme === 'socks5') && (url.username || url.password)) {
            console.log('[Launcher] SOCKS with auth detected, converting to HTTP tunnel');
            return {
                server: `http://${url.host}`,
                username: url.username || undefined,
                password: url.password || undefined,
            };
        }
        
        // Для остальных используем как есть
        return {
            server: `${scheme}://${url.host}`,
            username: url.username || undefined,
            password: url.password || undefined,
        };
    } catch (e) {
        console.error('Failed to parse proxy:', e);
        return null;
    }
}

// Получение пути к cookies файлу
function getCookiesPath(profileName) {
    let appDataDir;
    if (process.platform === 'win32') {
        appDataDir = process.env.APPDATA || path.join(os.homedir(), 'AppData', 'Roaming');
    } else if (process.platform === 'darwin') {
        appDataDir = path.join(os.homedir(), 'Library', 'Application Support');
    } else {
        appDataDir = path.join(os.homedir(), '.config');
    }
    
    const cookiesDir = path.join(appDataDir, 'com.anticbrowser.dev', 'cookies');
    
    if (!fs.existsSync(cookiesDir)) {
        fs.mkdirSync(cookiesDir, { recursive: true });
    }
    
    return path.join(cookiesDir, `${profileName}.json`);
}

// Загрузка cookies из файла
function loadCookies(profileName) {
    try {
        const cookiesPath = getCookiesPath(profileName);
        if (fs.existsSync(cookiesPath)) {
            const data = fs.readFileSync(cookiesPath, 'utf8');
            return JSON.parse(data);
        }
    } catch (e) {
        console.error('Failed to load cookies:', e);
    }
    return [];
}

// Сохранение cookies в файл
async function saveCookies(context, profileName) {
    try {
        const cookies = await context.cookies();
        // Удаляем sameSite для совместимости
        cookies.forEach(cookie => {
            delete cookie.sameSite;
        });
        const cookiesPath = getCookiesPath(profileName);
        fs.writeFileSync(cookiesPath, JSON.stringify(cookies, null, 2));
        console.log(`Cookies saved for profile: ${profileName}`);
    } catch (e) {
        console.error('Failed to save cookies:', e);
    }
}

// Главная функция
async function launchBrowser() {
    const config = parseArgs();

    console.log('Launching browser with config:', config);

    const launchArgs = [
        '--no-sandbox',
        '--disable-setuid-sandbox',
        '--disable-web-security',
        '--ignore-certificate-errors',
        '--disable-infobars',
        '--disable-blink-features=AutomationControlled',
        '--disable-dev-shm-usage',
        '--no-first-run',
        '--disable-default-apps',
        '--enable-features=NetworkService,NetworkServiceInProcess'
    ];

    if (!config.webgl) {
        launchArgs.push('--disable-webgl');
    }

    // Добавление прокси
    const proxy = parseProxy(config.proxy);
    const launchOptions = {
        headless: false,
        args: launchArgs,
    };

    // Playwright Proxy API поддерживает все типы включая SOCKS с авторизацией
    if (proxy) {
        launchOptions.proxy = proxy;
        console.log('[Launcher] Proxy настроен через Playwright API:', proxy.server);
    }

    try {
        const browser = await chromium.launch(launchOptions);

        // Формируем Accept-Language заголовок
        const acceptLanguage = `${config.lang},${config.lang.split('-')[0]};q=0.9,en-US;q=0.8,en;q=0.7`;

        const contextOptions = {
            viewport: {
                width: config.screenWidth,
                height: config.screenHeight,
            },
            userAgent: config.userAgent,
            locale: config.lang,
            timezoneId: config.timezone,
            hasTouch: config.touch,
            extraHTTPHeaders: {
                'Accept-Language': acceptLanguage
            },
        };

        const context = await browser.newContext(contextOptions);

        // Маскировка navigator.vendor
        await context.addInitScript(`
            Object.defineProperty(navigator, 'vendor', {
                get: function() {
                    return '${config.vendor}';
                }
            });
        `);

        // Маскировка hardwareConcurrency
        await context.addInitScript(`
            Object.defineProperty(navigator, 'hardwareConcurrency', {
                get: function() {
                    return ${config.cpu};
                }
            });
        `);

        // Маскировка deviceMemory
        await context.addInitScript(`
            Object.defineProperty(navigator, 'deviceMemory', {
                get: function() {
                    return ${config.ram};
                }
            });
        `);

        // Маскировка языков
        await context.addInitScript(`
            Object.defineProperty(navigator, 'language', {
                get: function() {
                    return '${config.lang}';
                }
            });
            Object.defineProperty(navigator, 'languages', {
                get: function() {
                    return ['${config.lang}', '${config.lang.split('-')[0]}', 'en-US', 'en'];
                }
            });
        `);

        // Блокировка WebRTC утечек IP
        await context.addInitScript(`
            // Отключаем enumerateDevices для WebRTC
            if (navigator.mediaDevices && navigator.mediaDevices.enumerateDevices) {
                navigator.mediaDevices.enumerateDevices = function() {
                    return Promise.resolve([]);
                };
            }
            
            // Переопределяем RTCPeerConnection для маскировки IP
            const original_RTCPeerConnection = window.RTCPeerConnection || window.webkitRTCPeerConnection || window.mozRTCPeerConnection;
            if (original_RTCPeerConnection) {
                window.RTCPeerConnection = function(...args) {
                    const pc = new original_RTCPeerConnection(...args);
                    const original_createOffer = pc.createOffer;
                    pc.createOffer = function() {
                        return Promise.reject(new Error('WebRTC is disabled'));
                    };
                    return pc;
                };
            }
        `);

        // Скрываем автоматизацию
        await context.addInitScript(`
            // Удаляем webdriver флаг
            Object.defineProperty(navigator, 'webdriver', {
                get: function() {
                    return undefined;
                }
            });

            // Переопределяем permissions
            const originalQuery = window.navigator.permissions.query;
            window.navigator.permissions.query = (parameters) => (
                parameters.name === 'notifications' ?
                    Promise.resolve({ state: Notification.permission }) :
                    originalQuery(parameters)
            );

            // Переопределяем плагины
            Object.defineProperty(navigator, 'plugins', {
                get: function() {
                    return [
                        {
                            0: { type: "application/x-google-chrome-pdf", suffixes: "pdf", description: "Portable Document Format" },
                            description: "Portable Document Format",
                            filename: "internal-pdf-viewer",
                            length: 1,
                            name: "Chrome PDF Plugin"
                        },
                        {
                            0: { type: "application/pdf", suffixes: "pdf", description: "" },
                            description: "",
                            filename: "mhjfbmdgcfjbbpaeojofohoefgiehjai",
                            length: 1,
                            name: "Chrome PDF Viewer"
                        }
                    ];
                }
            });
        `);

        // Загрузка cookies
        const cookies = loadCookies(config.profileName);
        if (cookies.length > 0) {
            await context.addCookies(cookies);
            console.log(`Loaded ${cookies.length} cookies`);
        }

        // Создание страницы
        const page = await context.newPage();

        // Открытие стартовой страницы
        await page.goto(config.homepage);

        console.log(`Browser launched for profile: ${config.profileName}`);
        console.log('Browser will remain open. Close it manually when done.');

        // Периодическое сохранение cookies (каждые 30 секунд)
        const saveInterval = setInterval(async () => {
            try {
                await saveCookies(context, config.profileName);
            } catch (e) {
                console.error('Error saving cookies:', e);
            }
        }, 30000);

        // Обработчик закрытия контекста
        context.on('close', async () => {
            console.log('Browser context closed, saving cookies...');
            clearInterval(saveInterval);
            try {
                await saveCookies(context, config.profileName);
            } catch (e) {
                console.error('Error saving cookies on close:', e);
            }
        });

        // Ожидаем закрытия браузера
        await page.waitForEvent('close').catch(() => {});
        await context.close();
        await browser.close();
        process.exit(0);

    } catch (error) {
        console.error('Failed to launch browser:', error);
        process.exit(1);
    }
}

// Запуск
launchBrowser();
