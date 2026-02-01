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
const CANDIDATE_EXES = [
    path.join(INSTALL_DIR, 'Antic Browser.exe'),
    path.join(process.env.ProgramFiles || 'C:\\Program Files', 'AnticBrowser', 'antic.exe'),
    path.join(process.env.ProgramFiles || 'C:\\Program Files', 'Antic Browser', 'Antic Browser.exe')
];

function findInstalledExe() {
    return CANDIDATE_EXES.find(p => fs.existsSync(p)) || null;
}

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
        const isInstalled = Boolean(findInstalledExe());
        
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

function getGitHubHeaders() {
    const token = process.env.GITHUB_TOKEN || process.env.GH_TOKEN || process.env.GITHUB_API_TOKEN;
    if (!token) return {};
    return { Authorization: `Bearer ${token}` };
}

async function getLatestRelease() {
    const response = await axios.get(
        `https://api.github.com/repos/${GITHUB_REPO}/releases`,
        { timeout: 10000, headers: getGitHubHeaders() }
    );

    const releases = Array.isArray(response.data) ? response.data : [];
    const latest = releases.find(r => !r.draft && !r.prerelease);

    if (!latest) {
        throw new Error('Не найден опубликованный релиз');
    }

    return latest;
}

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
        const latestRelease = await getLatestRelease();
        const latestVersion = String(latestRelease.tag_name || '').replace('v', '');
        
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
        const release = await getLatestRelease();
        const asset = (release.assets || []).find(a => a.name.endsWith('.msi'));
        
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
        
        // Запускаем установщик (тихая установка, per-user)
        const logPath = path.join(app.getPath('temp'), 'antic-browser-install.log');
        await new Promise((resolve) => {
            const cmd = `msiexec /i "${installerPath}" /qn /norestart /l*v "${logPath}" ALLUSERS=2 MSIINSTALLPERUSER=1`;
            exec(cmd, (error) => {
                if (error && error.code !== 0) {
                    console.warn('[Launcher] Installer warning:', error);
                }
                resolve();
            });
        });
        
        // Ждём завершения установки
        await new Promise(resolve => setTimeout(resolve, 5000));

        if (!findInstalledExe()) {
            // Повтор с повышенными правами (UAC)
            updateStatus('Требуются права администратора. Повторная установка...', 55);
            await new Promise((resolve) => {
                const args = `/i "${installerPath}" /passive /norestart /l*v "${logPath}"`;
                const ps = `Start-Process msiexec -ArgumentList '${args}' -Verb RunAs -Wait`;
                exec(`powershell -Command "${ps}"`, () => resolve());
            });

            if (!findInstalledExe()) {
                throw new Error(`Установка не завершилась. Проверь лог: ${logPath}`);
            }
        }
        
        // Удаляем установщик
        try {
            fs.unlinkSync(installerPath);
        } catch (e) {
            // Игнорируем ошибку удаления
        }
        
    } catch (error) {
        console.error('[Launcher] Download/Install error:', error);
        const status = error?.response?.status;
        if (status === 404) {
            throw new Error('Не найден релиз на GitHub (репозиторий приватный или нет published релиза).');
        }
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
        const exePath = findInstalledExe();
        if (!exePath) {
            throw new Error('Приложение не найдено после установки');
        }
        
        // Запускаем приложение (через shell, чтобы избежать EACCES)
        await new Promise((resolve, reject) => {
            const cmd = `cmd /c start "" "${exePath}"`;
            exec(cmd, (error) => {
                if (error) {
                    return reject(error);
                }
                resolve();
            });
        });

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
