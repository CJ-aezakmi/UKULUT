# 🚀 Скрипт для Быстрого Релиза
# Использование: .\release.ps1 -Version "2.0.1" -Message "Описание изменений"

param(
    [Parameter(Mandatory=$true)]
    [string]$Version,
    
    [Parameter(Mandatory=$true)]
    [string]$Message
)

Write-Host "`n╔════════════════════════════════════════════════════════════╗" -ForegroundColor Cyan
Write-Host "║              🚀 РЕЛИЗ ВЕРСИИ $Version                       " -ForegroundColor Cyan
Write-Host "╚════════════════════════════════════════════════════════════╝`n" -ForegroundColor Cyan

# Шаг 1: Обновление версий в файлах
Write-Host "📝 Шаг 1: Обновление версий..." -ForegroundColor Yellow

# package.json
Write-Host "   → package.json" -ForegroundColor White
$packageJson = Get-Content "package.json" -Raw | ConvertFrom-Json
$packageJson.version = $Version
$packageJson | ConvertTo-Json -Depth 100 | Set-Content "package.json"

# Cargo.toml
Write-Host "   → src-tauri/Cargo.toml" -ForegroundColor White
$cargoContent = Get-Content "src-tauri/Cargo.toml" -Raw
$cargoContent = $cargoContent -replace 'version = "[\d\.]+"', "version = `"$Version`""
$cargoContent | Set-Content "src-tauri/Cargo.toml"

# tauri.conf.json
Write-Host "   → src-tauri/tauri.conf.json" -ForegroundColor White
$tauriConfig = Get-Content "src-tauri/tauri.conf.json" -Raw | ConvertFrom-Json
$tauriConfig.version = $Version
$tauriConfig | ConvertTo-Json -Depth 100 | Set-Content "src-tauri/tauri.conf.json"

Write-Host "✅ Версии обновлены!`n" -ForegroundColor Green

# Шаг 2: Git commit
Write-Host "📦 Шаг 2: Коммит изменений..." -ForegroundColor Yellow
git add .
git commit -m "Релиз v$Version - $Message"
Write-Host "✅ Закоммичено!`n" -ForegroundColor Green

# Шаг 3: Push на GitHub
Write-Host "🚀 Шаг 3: Отправка на GitHub..." -ForegroundColor Yellow
git push origin main
Write-Host "✅ Код отправлен!`n" -ForegroundColor Green

# Шаг 4: Создание тега
Write-Host "🏷️ Шаг 4: Создание тега v$Version..." -ForegroundColor Yellow
git tag "v$Version"
git push origin "v$Version"
Write-Host "✅ Тег создан!`n" -ForegroundColor Green

# Финал
Write-Host "╔════════════════════════════════════════════════════════════╗" -ForegroundColor Green
Write-Host "║                  🎉 РЕЛИЗ ЗАПУЩЕН! 🎉                      ║" -ForegroundColor Green
Write-Host "╚════════════════════════════════════════════════════════════╝`n" -ForegroundColor Green

Write-Host "📊 Смотри прогресс сборки:" -ForegroundColor Cyan
Write-Host "   https://github.com/CJ-aezakmi/UKULUT/actions`n" -ForegroundColor Yellow

Write-Host "⏳ Сборка займёт ~8-10 минут" -ForegroundColor Magenta
Write-Host "📦 Релиз появится здесь:" -ForegroundColor Cyan
Write-Host "   https://github.com/CJ-aezakmi/UKULUT/releases/tag/v$Version`n" -ForegroundColor Yellow

Write-Host "💡 Пользователи с предыдущими версиями получат уведомление об обновлении автоматически!" -ForegroundColor Green

# Открыть Actions в браузере
$open = Read-Host "`nОткрыть GitHub Actions в браузере? (y/n)"
if ($open -eq "y" -or $open -eq "Y") {
    Start-Process "https://github.com/CJ-aezakmi/UKULUT/actions"
}
