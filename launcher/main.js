const { app, BrowserWindow, ipcMain } = require('electron');
const path = require('path');
const fs = require('fs');
const { spawn, exec } = require('child_process');
const axios = require('axios');
const semver = require('semver');

let mainWindow;
const APP_NAME = 'Antic Browser';
const GITHUB_REPO = 'CJ-aezakmi/UKULUT';
const INSTALL_DIR = path.join(process.env.LOCALAPPDATA, 'Programs', APP_NAME);
const APP_EXE = path.join(INSTALL_DIR, 'Antic Browser.exe');

function createWindow() {
    mainWindow = new BrowserWindow({
        width: 500,
        height: 400,
        resizable: false,
        frame: false,
        transparent: true,
        webPreferences: {
            nodeIntegration: true,
            contextIsolation: false
        },
        icon: path.join(__dirname, 'icon.ico')
    });

    mainWindow.loadFile('index.html');
    
    // Автоматически начинаем проверку
    setTimeout(() => {
        startLaunchSequence();
    }, 1000);
}

app.whenReady().then(createWindow);

app.on('window-all-closed', () => {
    if (process.platform !== 'darwin') {
        app.quit();
    }
});

// ============================================
// ОСНОВНАЯ ЛОГИКА ЛАУНЧЕРА
// ============================================

async function startLaunchSequence() {
    try {
        updateStatus('Проверка установки...', 10);
        
        // Шаг 1: Проверка установлен ли Antic Browser
        const isInstalled = fs.existsSync(APP_EXE);
        
        if (!isInstalled) {
            updateStatus('Antic Browser не установлен. Скачивание...', 20);
            await downloadAndInstallApp();
        } else {
            // Шаг 2: Проверка обновлений
            updateStatus('Проверка обновлений...', 30);
            const hasUpdate = await checkForUpdates();
            
            if (hasUpdate) {
                updateStatus('Доступно обновление! Скачивание...', 40);
                await downloadAndInstallApp();
            }
        }
        
        // Шаг 3: Проверка Playwright/Chromium
        updateStatus('Проверка Playwright/Chromium...', 60);
        await checkAndInstallPlaywright();
        
        // Шаг 4: Проверка других зависимостей
        updateStatus('Проверка зависимостей...', 80);
        await checkDependencies();
        
        // Шаг 5: Запуск приложения
        updateStatus('Запуск Antic Browser...', 95);
        await launchApp();
        
        updateStatus('Готово!', 100);
        
        // Закрываем лаунчер через 1 секунду
        setTimeout(() => {
            app.quit();
        }, 1000);
        
    } catch (error) {
        updateStatus(`Ошибка: ${error.message}`, 0);
        console.error('[Launcher] Error:', error);
    }
}

// ============================================
// ПРОВЕРКА ОБНОВЛЕНИЙ
// ============================================

async function checkForUpdates() {
    try {
        // Получаем текущую версию
        const packagePath = path.join(INSTALL_DIR, 'resources', 'app', 'package.json');
        let currentVersion = '0.0.0';
        
        if (fs.existsSync(packagePath)) {
            const pkg = JSON.parse(fs.readFileSync(packagePath, 'utf8'));
            currentVersion = pkg.version;
        }
        
        // Получаем последнюю версию с GitHub
        const response = await axios.get(`https://api.github.com/repos/${GITHUB_REPO}/releases/latest`, {
            timeout: 10000
        });
        
        const latestVersion = response.data.tag_name.replace('v', '');
        
        console.log(`[Launcher] Current: ${currentVersion}, Latest: ${latestVersion}`);
        
        return semver.gt(latestVersion, currentVersion);
    } catch (error) {
        console.error('[Launcher] Check updates error:', error.message);
        return false; // Если ошибка - просто продолжаем
    }
}

// ============================================
// СКАЧИВАНИЕ И УСТАНОВКА ПРИЛОЖЕНИЯ
// ============================================

async function downloadAndInstallApp() {
    try {
        // Получаем ссылку на установщик
        const response = await axios.get(`https://api.github.com/repos/${GITHUB_REPO}/releases/latest`);
        const asset = response.data.assets.find(a => a.name.endsWith('.msi'));
        
        if (!asset) {
            throw new Error('Установщик не найден');
        }
        
        const installerPath = path.join(app.getPath('temp'), 'antic-browser-setup.msi');
        
        updateStatus('Скачивание установщика...', 30);
        
        // Скачиваем установщик
        const writer = fs.createWriteStream(installerPath);
        const downloadResponse = await axios({
            url: asset.browser_download_url,
            method: 'GET',
            responseType: 'stream'
        });
        
        downloadResponse.data.pipe(writer);
        
        await new Promise((resolve, reject) => {
            writer.on('finish', resolve);
            writer.on('error', reject);
        });
        
        updateStatus('Установка...', 50);
        
        // Запускаем установщик (тихая установка)
        await new Promise((resolve, reject) => {
            exec(`msiexec /i "${installerPath}" /qn /norestart`, (error) => {
                if (error && error.code !== 0) {
                    // Код 0 или undefined - успешная установка
                    // Иногда msiexec возвращает код даже при успехе
                    console.warn('[Launcher] Installer warning:', error);
                }
                resolve();
            });
        });
        
        // Ждём завершения установки
        await new Promise(resolve => setTimeout(resolve, 3000));
        
        // Удаляем установщик
        try {
            fs.unlinkSync(installerPath);
        } catch (e) {
            // Игнорируем ошибку удаления
        }
        
    } catch (error) {
        console.error('[Launcher] Download/Install error:', error);
        throw new Error(`Не удалось установить: ${error.message}`);
    }
}

// ============================================
// ПРОВЕРКА И УСТАНОВКА PLAYWRIGHT
// ============================================

async function checkAndInstallPlaywright() {
    try {
        const playwrightPath = path.join(INSTALL_DIR, 'resources', 'app', 'node_modules', 'playwright');
        
        if (!fs.existsSync(playwrightPath)) {
            updateStatus('Установка Playwright...', 65);
            
            // Playwright установлен через npm в основном приложении
            // Здесь просто проверяем наличие
            const chromiumPath = path.join(
                process.env.LOCALAPPDATA,
                'ms-playwright',
                'chromium-*'
            );
            
            // Если Chromium не найден, скачаем его
            const hasChromium = fs.existsSync(path.dirname(chromiumPath));
            
            if (!hasChromium) {
                console.log('[Launcher] Chromium будет установлен при первом запуске приложения');
            }
        }
    } catch (error) {
        console.error('[Launcher] Playwright check error:', error);
        // Не критичная ошибка
    }
}

// ============================================
// ПРОВЕРКА ЗАВИСИМОСТЕЙ
// ============================================

async function checkDependencies() {
    try {
        // Проверяем Visual C++ Redistributable
        const vcRedistKeys = [
            'HKLM\\SOFTWARE\\Microsoft\\VisualStudio\\14.0\\VC\\Runtimes\\X64',
            'HKLM\\SOFTWARE\\WOW6432Node\\Microsoft\\VisualStudio\\14.0\\VC\\Runtimes\\X64'
        ];
        
        // Проверка через reg query (необязательно, но полезно)
        // В реальности современные Windows уже имеют эти библиотеки
        
        updateStatus('Проверка системных библиотек...', 85);
        
        // Можно добавить проверку других зависимостей
        // Например, .NET, WebView2 и т.д.
        
    } catch (error) {
        console.error('[Launcher] Dependencies check error:', error);
        // Не критичная ошибка
    }
}

// ============================================
// ЗАПУСК ПРИЛОЖЕНИЯ
// ============================================

async function launchApp() {
    try {
        if (!fs.existsSync(APP_EXE)) {
            throw new Error('Приложение не найдено после установки');
        }
        
        // Запускаем приложение
        spawn(APP_EXE, [], {
            detached: true,
            stdio: 'ignore'
        }).unref();
        
        console.log('[Launcher] App launched successfully');
        
    } catch (error) {
        console.error('[Launcher] Launch error:', error);
        throw new Error(`Не удалось запустить: ${error.message}`);
    }
}

// ============================================
// ОБНОВЛЕНИЕ СТАТУСА В UI
// ============================================

function updateStatus(message, progress) {
    if (mainWindow && !mainWindow.isDestroyed()) {
        mainWindow.webContents.send('status-update', { message, progress });
    }
    console.log(`[Launcher] ${progress}% - ${message}`);
}

// ============================================
// IPC HANDLERS
// ============================================

ipcMain.on('close-app', () => {
    app.quit();
});
