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

// Путь к CyberYozh расширению
const CYBERYOZH_EXTENSION_PATH = path.join(__dirname, 'src-tauri', 'cyberyozh-extension');
// Путь к proxy-extension расширению (для SOCKS)
const PROXY_EXTENSION_PATH = path.join(__dirname, 'src-tauri', 'proxy-extension');

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
        homepage: 'https://2ip.ru', // DEFAULT HOMEPAGE
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

    // FORCE HOMEPAGE OVERRIDE (User Request: "Default homepage - 2ip.ru")
    // If the UI sends a different homepage, we will ignore it if it's the old default (whoer.net)
    // or we can just force it always for now to satisfy the user.
    if (config.homepage === 'https://whoer.net' || !config.homepage) {
        config.homepage = 'https://2ip.ru';
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

        const proxyConfig = {
            server: `${scheme}://${url.host}`,
            username: url.username || undefined,
            password: url.password || undefined,
        };

        return proxyConfig;
    } catch (e) {
        console.error('[Launcher] Failed to parse proxy:', e);
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

// Маппинг стран на timezone и языки (для автоматической настройки по прокси)
const COUNTRY_LOCALE_MAP = {
    'US': { timezone: 'America/New_York', lang: 'en-US', acceptLang: 'en-US,en;q=0.9' },
    'GB': { timezone: 'Europe/London', lang: 'en-GB', acceptLang: 'en-GB,en;q=0.9' },
    'DE': { timezone: 'Europe/Berlin', lang: 'de-DE', acceptLang: 'de-DE,de;q=0.9,en;q=0.8' },
    'FR': { timezone: 'Europe/Paris', lang: 'fr-FR', acceptLang: 'fr-FR,fr;q=0.9,en;q=0.8' },
    'ES': { timezone: 'Europe/Madrid', lang: 'es-ES', acceptLang: 'es-ES,es;q=0.9,en;q=0.8' },
    'IT': { timezone: 'Europe/Rome', lang: 'it-IT', acceptLang: 'it-IT,it;q=0.9,en;q=0.8' },
    'NL': { timezone: 'Europe/Amsterdam', lang: 'nl-NL', acceptLang: 'nl-NL,nl;q=0.9,en;q=0.8' },
    'PL': { timezone: 'Europe/Warsaw', lang: 'pl-PL', acceptLang: 'pl-PL,pl;q=0.9,en;q=0.8' },
    'BR': { timezone: 'America/Sao_Paulo', lang: 'pt-BR', acceptLang: 'pt-BR,pt;q=0.9,en;q=0.8' },
    'RU': { timezone: 'Europe/Moscow', lang: 'ru-RU', acceptLang: 'ru-RU,ru;q=0.9,en;q=0.8' },
    'UA': { timezone: 'Europe/Kiev', lang: 'uk-UA', acceptLang: 'uk-UA,uk;q=0.9,ru;q=0.8,en;q=0.7' },
    'JP': { timezone: 'Asia/Tokyo', lang: 'ja-JP', acceptLang: 'ja-JP,ja;q=0.9,en;q=0.8' },
    'CN': { timezone: 'Asia/Shanghai', lang: 'zh-CN', acceptLang: 'zh-CN,zh;q=0.9,en;q=0.8' },
    'KR': { timezone: 'Asia/Seoul', lang: 'ko-KR', acceptLang: 'ko-KR,ko;q=0.9,en;q=0.8' },
    'IN': { timezone: 'Asia/Kolkata', lang: 'en-IN', acceptLang: 'en-IN,en;q=0.9,hi;q=0.8' },
    'AU': { timezone: 'Australia/Sydney', lang: 'en-AU', acceptLang: 'en-AU,en;q=0.9' },
    'CA': { timezone: 'America/Toronto', lang: 'en-CA', acceptLang: 'en-CA,en;q=0.9,fr;q=0.8' },
    'SE': { timezone: 'Europe/Stockholm', lang: 'sv-SE', acceptLang: 'sv-SE,sv;q=0.9,en;q=0.8' },
    'NO': { timezone: 'Europe/Oslo', lang: 'no-NO', acceptLang: 'no-NO,no;q=0.9,en;q=0.8' },
    'DK': { timezone: 'Europe/Copenhagen', lang: 'da-DK', acceptLang: 'da-DK,da;q=0.9,en;q=0.8' },
    'FI': { timezone: 'Europe/Helsinki', lang: 'fi-FI', acceptLang: 'fi-FI,fi;q=0.9,en;q=0.8' },
    'CH': { timezone: 'Europe/Zurich', lang: 'de-CH', acceptLang: 'de-CH,de;q=0.9,fr;q=0.8,en;q=0.7' },
    'AT': { timezone: 'Europe/Vienna', lang: 'de-AT', acceptLang: 'de-AT,de;q=0.9,en;q=0.8' },
    'BE': { timezone: 'Europe/Brussels', lang: 'nl-BE', acceptLang: 'nl-BE,nl;q=0.9,fr;q=0.8,en;q=0.7' },
    'CZ': { timezone: 'Europe/Prague', lang: 'cs-CZ', acceptLang: 'cs-CZ,cs;q=0.9,en;q=0.8' },
    'PT': { timezone: 'Europe/Lisbon', lang: 'pt-PT', acceptLang: 'pt-PT,pt;q=0.9,en;q=0.8' },
    'GR': { timezone: 'Europe/Athens', lang: 'el-GR', acceptLang: 'el-GR,el;q=0.9,en;q=0.8' },
    'TR': { timezone: 'Europe/Istanbul', lang: 'tr-TR', acceptLang: 'tr-TR,tr;q=0.9,en;q=0.8' },
    'MX': { timezone: 'America/Mexico_City', lang: 'es-MX', acceptLang: 'es-MX,es;q=0.9,en;q=0.8' },
    'AR': { timezone: 'America/Argentina/Buenos_Aires', lang: 'es-AR', acceptLang: 'es-AR,es;q=0.9,en;q=0.8' },
    'CL': { timezone: 'America/Santiago', lang: 'es-CL', acceptLang: 'es-CL,es;q=0.9,en;q=0.8' },
};

// Извлечение кода страны из прокси (формат: country-XX)
function extractCountryFromProxy(proxyStr) {
    if (!proxyStr) return null;

    const match = proxyStr.match(/country-([A-Z]{2})/i);
    if (match && match[1]) {
        return match[1].toUpperCase();
    }

    return null;
}

// Получение локали по стране
function getLocaleByCountry(countryCode) {
    if (countryCode && COUNTRY_LOCALE_MAP[countryCode]) {
        return COUNTRY_LOCALE_MAP[countryCode];
    }

    // Дефолт для США
    return COUNTRY_LOCALE_MAP['US'];
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

    // Автоопределение timezone и языка по прокси (если есть country код в прокси)
    const countryCode = extractCountryFromProxy(config.proxy);
    if (countryCode) {
        const autoLocale = getLocaleByCountry(countryCode);
        console.log(`Detected proxy country: ${countryCode}`);
        console.log(`Auto-setting locale: ${autoLocale.lang}, timezone: ${autoLocale.timezone}`);

        // Переопределяем timezone и lang если они дефолтные
        if (config.timezone === 'America/New_York') {
            config.timezone = autoLocale.timezone;
        }
        if (config.lang === 'en-US') {
            config.lang = autoLocale.lang;
        }
    }

    console.log('Launching browser with config:', config);

    const launchArgs = [
        '--no-sandbox',
        '--disable-setuid-sandbox',
        '--disable-blink-features=AutomationControlled',
        '--disable-dev-shm-usage',
        '--no-first-run',
        '--disable-default-apps',
        '--enable-features=NetworkService,NetworkServiceInProcess',
        '--disable-features=IsolateOrigins,site-per-process',
        '--disable-site-isolation-trials',
        '--disable-background-timer-throttling',
        '--disable-backgrounding-occluded-windows',
        '--disable-renderer-backgrounding',
        '--disable-ipc-flooding-protection',
        '--password-store=basic',
        '--use-mock-keychain',
        '--disable-component-extensions-with-background-pages',
        '--enable-automation=false',
        '--disable-client-side-phishing-detection',
        // Изменяем поисковую систему по умолчанию на DuckDuckGo (не блокирует прокси)
        '--search-engine-choice-country=US'
    ];

    // Добавляем расширения
    const extensionsToLoad = [];

    // ВРЕМЕННО ОТКЛЮЧЕНО для отладки
    // // 1. CyberYozh расширение (всегда загружается - отображается справа от адресной строки)
    // if (fs.existsSync(CYBERYOZH_EXTENSION_PATH)) {
    //     extensionsToLoad.push(CYBERYOZH_EXTENSION_PATH);
    //     console.log('[Launcher] Загружено CyberYozh extension:', CYBERYOZH_EXTENSION_PATH);
    // } else {
    //     console.warn('[Launcher] CyberYozh extension не найдено:', CYBERYOZH_EXTENSION_PATH);
    // }

    // // 2. Proxy-extension (для SOCKS прокси с авторизацией)
    // if (fs.existsSync(PROXY_EXTENSION_PATH)) {
    //     extensionsToLoad.push(PROXY_EXTENSION_PATH);
    //     console.log('[Launcher] Загружено proxy-extension:', PROXY_EXTENSION_PATH);
    // } else {
    //     console.warn('[Launcher] proxy-extension не найдено:', PROXY_EXTENSION_PATH);
    // }

    console.log('[DEBUG] Extensions DISABLED for testing');

    // Добавляем флаги для загрузки расширений
    if (extensionsToLoad.length > 0) {
        const extensionPaths = extensionsToLoad.join(',');
        launchArgs.push(
            `--disable-extensions-except=${extensionPaths}`,
            `--load-extension=${extensionPaths}`
        );
    }

    if (!config.webgl) {
        launchArgs.push('--disable-webgl');
    }

    const launchOptions = {
        headless: false,
        args: launchArgs,
    };

    // Добавление прокси через Playwright API (поддерживает авторизацию для всех типов)
    const proxy = parseProxy(config.proxy);
    if (proxy) {
        launchOptions.proxy = proxy;
        console.log('[Launcher] Proxy configured:', proxy.server);
    } else if (config.proxy) {
        console.error('[Launcher] Failed to parse proxy');
    }

    const browser = await chromium.launch(launchOptions);

    // КРИТИЧЕСКИ ВАЖНО: Настраиваем перехват авторизации прокси на уровне browser
    if (proxy && proxy.username && proxy.password) {
        browser.on('targetcreated', async (target) => {
            try {
                const page = await target.page();
                if (page) {
                    const cdp = await page.context().newCDPSession(page);
                    await cdp.send('Fetch.enable', {
                        patterns: [{ urlPattern: '*', requestStage: 'Request' }],
                        handleAuthRequests: true
                    });

                    cdp.on('Fetch.authRequired', async ({ requestId, authChallenge }) => {
                        try {
                            await cdp.send('Fetch.continueWithAuth', {
                                requestId,
                                authChallengeResponse: {
                                    response: 'ProvideCredentials',
                                    username: proxy.username,
                                    password: proxy.password
                                }
                            });
                        } catch (err) {
                            console.error('[Launcher] Auth error:', err.message);
                            try {
                                await cdp.send('Fetch.continueRequest', { requestId });
                            } catch (e) { }
                        }
                    });

                    cdp.on('Fetch.requestPaused', async ({ requestId }) => {
                        try {
                            await cdp.send('Fetch.continueRequest', { requestId });
                        } catch (e) { }
                    });
                }
            } catch (err) {
                console.error('[Launcher] CDP setup error:', err.message);
            }
        });
    }

    // Формируем Accept-Language заголовок
    const acceptLanguage = `${config.lang},${config.lang.split('-')[0]};q=0.9,en-US;q=0.8,en;q=0.7`;

    // Исправляем User-Agent если указан Firefox (Chromium не должен притворяться Firefox)
    let userAgent = config.userAgent;
    if (userAgent.includes('Firefox') || userAgent.includes('Gecko')) {
        // Заменяем на реалистичный Chrome User-Agent
        const chromeVersion = '120.0.0.0';
        if (userAgent.includes('Windows')) {
            userAgent = `Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/${chromeVersion} Safari/537.36`;
        } else if (userAgent.includes('Macintosh')) {
            userAgent = `Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/${chromeVersion} Safari/537.36`;
        } else if (userAgent.includes('Linux')) {
            userAgent = `Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/${chromeVersion} Safari/537.36`;
        }
    }

    const contextOptions = {
        viewport: {
            width: config.screenWidth,
            height: config.screenHeight,
        },
        userAgent: userAgent,
        locale: config.lang,
        timezoneId: config.timezone,
        hasTouch: config.touch,
        extraHTTPHeaders: {
            'Accept-Language': acceptLanguage,
            'Accept': 'text/html,application/xhtml+xml,application/xml;q=0.9,image/avif,image/webp,image/apng,*/*;q=0.8',
            'Sec-Fetch-Site': 'none',
            'Sec-Fetch-Mode': 'navigate',
            'Sec-Fetch-User': '?1',
            'Sec-Fetch-Dest': 'document',
            'Upgrade-Insecure-Requests': '1'
        },
    };

    const context = await browser.newContext(contextOptions);

    // Прокси уже настроен через Playwright API (launchOptions.proxy)
    // НЕ используем расширение для прокси - это вызывает создание/закрытие страницы

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

    // Скрываем автоматизацию - ПРОДВИНУТАЯ ВЕРСИЯ (методы из AdsPower/Multilogin)
    await context.addInitScript(`
            // 1. Удаляем webdriver флаг
            Object.defineProperty(navigator, 'webdriver', {
                get: () => undefined
            });

            // 2. Маскируем chrome object
            if (!window.chrome) {
                window.chrome = {};
            }
            window.chrome.runtime = {
                connect: () => {},
                sendMessage: () => {},
                onMessage: { addListener: () => {}, removeListener: () => {} }
            };
            window.chrome.loadTimes = function() {
                return {
                    requestTime: Date.now() / 1000,
                    startLoadTime: Date.now() / 1000,
                    commitLoadTime: Date.now() / 1000,
                    finishDocumentLoadTime: Date.now() / 1000,
                    finishLoadTime: Date.now() / 1000,
                    firstPaintTime: Date.now() / 1000,
                    firstPaintAfterLoadTime: 0,
                    navigationType: "Other",
                    wasFetchedViaSpdy: false,
                    wasNpnNegotiated: true,
                    npnNegotiatedProtocol: "h2",
                    wasAlternateProtocolAvailable: false,
                    connectionInfo: "h2"
                };
            };
            window.chrome.csi = function() {
                return {
                    startE: Date.now(),
                    onloadT: Date.now(),
                    pageT: Math.random() * 1000,
                    tran: 15
                };
            };
            window.chrome.app = {
                isInstalled: false,
                InstallState: { DISABLED: 'disabled', INSTALLED: 'installed', NOT_INSTALLED: 'not_installed' },
                RunningState: { CANNOT_RUN: 'cannot_run', READY_TO_RUN: 'ready_to_run', RUNNING: 'running' }
            };

            // 3. Navigator platform маскировка
            Object.defineProperty(navigator, 'platform', {
                get: () => 'Win32'
            });

            // 4. Battery API блокировка
            if (navigator.getBattery) {
                navigator.getBattery = () => {
                    return Promise.resolve({
                        charging: true,
                        chargingTime: 0,
                        dischargingTime: Infinity,
                        level: 1,
                        addEventListener: () => {},
                        removeEventListener: () => {},
                        dispatchEvent: () => true
                    });
                };
            }

            // 5. Connection API маскировка
            if (navigator.connection) {
                Object.defineProperties(navigator.connection, {
                    downlink: { get: () => 10, configurable: true },
                    effectiveType: { get: () => '4g', configurable: true },
                    rtt: { get: () => 50, configurable: true },
                    saveData: { get: () => false, configurable: true }
                });
            }

            // 6. Screen resolution маскировка
            Object.defineProperties(window.screen, {
                availHeight: { get: () => ${config.screenHeight}, configurable: true },
                availWidth: { get: () => ${config.screenWidth}, configurable: true },
                height: { get: () => ${config.screenHeight}, configurable: true },
                width: { get: () => ${config.screenWidth}, configurable: true }
            });

            // 7. Permissions API улучшенная маскировка
            const originalQuery = window.navigator.permissions.query;
            window.navigator.permissions.query = (parameters) => {
                if (parameters.name === 'notifications') {
                    return Promise.resolve({ state: Notification.permission, onchange: null });
                }
                return originalQuery(parameters).catch(() => 
                    Promise.resolve({ state: 'prompt', onchange: null })
                );
            };

            // 8. Плагины и MIME types
            Object.defineProperty(navigator, 'plugins', {
                get: () => {
                    const plugins = [
                        { name: 'Chrome PDF Plugin', description: 'Portable Document Format', filename: 'internal-pdf-viewer', length: 1 },
                        { name: 'Chrome PDF Viewer', description: '', filename: 'mhjfbmdgcfjbbpaeojofohoefgiehjai', length: 1 },
                        { name: 'Native Client', description: '', filename: 'internal-nacl-plugin', length: 2 }
                    ];
                    return Object.setPrototypeOf(plugins, PluginArray.prototype);
                }
            });

            Object.defineProperty(navigator, 'mimeTypes', {
                get: () => {
                    const mimeTypes = [
                        { type: 'application/pdf', suffixes: 'pdf', description: 'Portable Document Format' },
                        { type: 'application/x-google-chrome-pdf', suffixes: 'pdf', description: 'Portable Document Format' },
                        { type: 'application/x-nacl', suffixes: '', description: 'Native Client Executable' },
                        { type: 'application/x-pnacl', suffixes: '', description: 'Portable Native Client Executable' }
                    ];
                    return Object.setPrototypeOf(mimeTypes, MimeTypeArray.prototype);
                }
            });

            // 9. Canvas fingerprint защита (легкая рандомизация)
            const originalToDataURL = HTMLCanvasElement.prototype.toDataURL;
            HTMLCanvasElement.prototype.toDataURL = function(type) {
                if (type === 'image/png' && this.width > 0 && this.height > 0) {
                    const context = this.getContext('2d');
                    const imageData = context.getImageData(0, 0, this.width, this.height);
                    for (let i = 0; i < imageData.data.length; i += 4) {
                        imageData.data[i] = imageData.data[i] ^ (Math.random() > 0.5 ? 1 : 0);
                    }
                    context.putImageData(imageData, 0, 0);
                }
                return originalToDataURL.apply(this, arguments);
            };

            // 10. WebGL fingerprint защита
            const getParameter = WebGLRenderingContext.prototype.getParameter;
            WebGLRenderingContext.prototype.getParameter = function(parameter) {
                if (parameter === 37445) return '${config.vendor}';
                if (parameter === 37446) return 'ANGLE (Intel, Intel(R) UHD Graphics Direct3D11 vs_5_0 ps_5_0, D3D11)';
                if (parameter === 7936) return 'WebKit';
                if (parameter === 7937) return 'WebKit WebGL';
                if (parameter === 35724) return 16384;
                if (parameter === 34076) return 16384;
                return getParameter.call(this, parameter);
            };

            // 11. Audio context fingerprint защита
            const AudioContext = window.AudioContext || window.webkitAudioContext;
            if (AudioContext) {
                const originalCreateDynamicsCompressor = AudioContext.prototype.createDynamicsCompressor;
                AudioContext.prototype.createDynamicsCompressor = function() {
                    const compressor = originalCreateDynamicsCompressor.call(this);
                    const originalGetChannelData = compressor.channelData ? compressor.channelData.constructor.prototype.getChannelData : null;
                    if (originalGetChannelData) {
                        compressor.channelData.constructor.prototype.getChannelData = function() {
                            const data = originalGetChannelData.apply(this, arguments);
                            for (let i = 0; i < data.length; i++) {
                                data[i] = data[i] + Math.random() * 0.0001 - 0.00005;
                            }
                            return data;
                        };
                    }
                    return compressor;
                };
            }

            // 12. Notification permission
            if (window.Notification) {
                Object.defineProperty(Notification, 'permission', {
                    get: () => 'default'
                });
            }

            // 13. Media devices enumeration
            if (navigator.mediaDevices && navigator.mediaDevices.enumerateDevices) {
                navigator.mediaDevices.enumerateDevices = () => {
                    return Promise.resolve([
                        { deviceId: 'default', kind: 'audioinput', label: 'Default - Microphone', groupId: 'default' },
                        { deviceId: 'default', kind: 'audiooutput', label: 'Default - Speaker', groupId: 'default' },
                        { deviceId: 'default', kind: 'videoinput', label: 'Default - Webcam', groupId: 'default' }
                    ]);
                };
            }

            // 14. Маскируем __proto__ и constructor
            delete Navigator.prototype.webdriver;
            delete Navigator.prototype.constructor.webdriver;
        `);

    // Загрузка cookies
    const cookies = loadCookies(config.profileName);
    if (cookies.length > 0) {
        await context.addCookies(cookies);
        console.log(`Loaded ${cookies.length} cookies`);
    }

    // Создание страницы
    const page = await context.newPage();

    // Используем CDP для перехвата поисковых запросов
    const cdpSession = await page.context().newCDPSession(page);

    // Перехватываем поисковые запросы Google (если прокси НЕ настроен через CDP выше)
    if (!proxy || !proxy.username) {
        await cdpSession.send('Fetch.enable', {
            patterns: [{ urlPattern: '*google.com/*', requestStage: 'Request' }]
        });
    }

    cdpSession.on('Fetch.requestPaused', async (event) => {
        const { requestId, request } = event;
        const url = request.url;

        // Если это поисковой запрос Google, перенаправляем на DuckDuckGo
        if (url.includes('google.com/search') && url.includes('?q=')) {
            try {
                const urlObj = new URL(url);
                const query = urlObj.searchParams.get('q');
                if (query) {
                    const duckUrl = `https://duckduckgo.com/?q=${encodeURIComponent(query)}`;
                    console.log(`Redirecting search "${query}" to DuckDuckGo`);

                    // Перенаправляем запрос
                    await cdpSession.send('Fetch.fulfillRequest', {
                        requestId,
                        responseCode: 302,
                        responseHeaders: [
                            { name: 'Location', value: duckUrl }
                        ]
                    });
                    return;
                }
            } catch (err) {
                console.error(' Error redirecting:', err.message);
            }
        }

        // Продолжаем обычный запрос (важно для работы с прокси)
        try {
            await cdpSession.send('Fetch.continueRequest', { requestId });
        } catch (err) {
            // Игнорируем ошибки (запрос уже мог быть обработан)
        }
    });

    // Добавляем обработчики событий для отладки
    page.on('close', () => {
        console.log('Page closed event fired!');
    });

    page.on('crash', () => {
        console.log('Page crashed!');
    });

    context.on('page', async (newPage) => {
        console.log('New page created');

        // Ждем немного чтобы URL успел загрузиться
        await new Promise(resolve => setTimeout(resolve, 100));

        const existingUrl = newPage.url();

        // Перехватываем chrome://newtab и показываем свою страницу
        if (existingUrl.startsWith('chrome://newtab') ||
            existingUrl === 'about:blank' ||
            existingUrl.startsWith('chrome-search://') ||
            existingUrl.includes('google.com/_/chrome/newtab') // New Chrome NTP
        ) {
            console.log('Redirecting new tab to custom page');
            try {
                // Ищем newtab.html рядом с launcher
                let newtabPath = path.join(__dirname, 'newtab.html');
                
                // Если не найден - пробуем в src-tauri (dev mode)
                if (!fs.existsSync(newtabPath)) {
                    newtabPath = path.join(__dirname, 'src-tauri', 'newtab.html');
                }

                if (fs.existsSync(newtabPath)) {
                    await newPage.goto(`file://${newtabPath}`, { waitUntil: 'domcontentloaded' });
                } else {
                    console.error('newtab.html not found');
                }
            } catch (err) {
                console.error(' Failed to load newtab:', err.message);
            }
            return;
        }

        // Игнорируем другие служебные chrome:// страницы
        if (newPage.url().startsWith('chrome://')) {
            console.log(' Skipping internal chrome:// page:', newPage.url());
            return;
        }

        // Используем CDP для перехвата поисковых запросов в новых вкладках
        try {
            const newCdpSession = await newPage.context().newCDPSession(newPage);

            await newCdpSession.send('Fetch.enable', {
                patterns: [{ urlPattern: '*google.com/*', requestStage: 'Request' }]
            });

            newCdpSession.on('Fetch.requestPaused', async (event) => {
                const { requestId, request } = event;
                const url = request.url;

                if (url.includes('google.com/search') && url.includes('?q=')) {
                    try {
                        const urlObj = new URL(url);
                        const query = urlObj.searchParams.get('q');
                        if (query) {
                            const duckUrl = `https://duckduckgo.com/?q=${encodeURIComponent(query)}`;
                            console.log(` [NEW TAB] Redirecting "${query}"  DuckDuckGo`);

                            await newCdpSession.send('Fetch.fulfillRequest', {
                                requestId,
                                responseCode: 302,
                                responseHeaders: [
                                    { name: 'Location', value: duckUrl }
                                ]
                            });
                            return;
                        }
                    } catch (err) {
                        console.error(' Error redirecting:', err.message);
                    }
                }

                await newCdpSession.send('Fetch.continueRequest', { requestId }).catch(() => { });
            });

            console.log(' CDP search intercept enabled for new tab');
        } catch (err) {
            console.error(' Failed to setup CDP for new page:', err.message);
        }

        // Добавляем обработчики для новых страниц
        newPage.on('close', () => {
            console.log(' New page closed:', newPage.url());
        });

        newPage.on('crash', () => {
            console.log(' New page crashed!');
        });

        // Ждем загрузки новой страницы
        newPage.on('load', () => {
            const url = newPage.url();
            if (!url.startsWith('chrome://')) {
                console.log(' New page loaded:', url);
            }
        });

        newPage.on('pageerror', (error) => {
            console.error(' Page error:', error.message);
        });
    });

    // Открытие стартовой страницы (НЕ критично - если не загрузится, браузер всё равно работает)
    console.log(' Opening homepage:', config.homepage);
    try {
        await page.goto(config.homepage, { timeout: 30000, waitUntil: 'domcontentloaded' });
        console.log(' Homepage loaded successfully');
    } catch (e) {
        console.warn(' Failed to load homepage:', e.message);
        console.log(' Opening blank page instead...');
        try {
            await page.goto('about:blank', { waitUntil: 'domcontentloaded' });
        } catch (err) {
            console.error('Failed to open about:blank:', err.message);
        }
    }

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

    // Обработчик закрытия контекста (НЕ выходим из процесса!)
    context.on('close', async () => {
        console.log('Browser context closed, saving cookies...');
        clearInterval(saveInterval);
        try {
            await saveCookies(context, config.profileName);
        } catch (e) {
            console.error('Failed to save cookies:', e);
        }
        // НЕ вызываем process.exit() - позволяем браузеру продолжать работу
    });

    // Держим процесс живым - НЕ выходим пока браузер не закроется
    // Ждем события закрытия браузера
    browser.on('disconnected', () => {
        console.log('Browser disconnected');
        clearInterval(saveInterval);
        process.exit(0);
    });

    // Бесконечный цикл для поддержания процесса
    await new Promise(() => {
        // Никогда не резолвится - процесс живет пока браузер открыт
    });
}

// Запуск
launchBrowser().catch(err => {
    console.error('Critical error:', err);
    process.exit(1);
});
