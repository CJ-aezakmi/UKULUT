#!/usr/bin/env python3
"""
Скрипт для автоматической загрузки и распаковки расширения CyberYozh из Chrome Web Store.
"""
import os
import sys
import zipfile
import shutil
import requests
from pathlib import Path

EXTENSION_ID = "paljcopanhinogelplkpgfnljiomaapc"
# Используем crxextractor.com API для загрузки расширения
EXTENSION_URL = f"https://crxextractor.com/download.php?crx={EXTENSION_ID}"

def download_extension():
    """Скачивает CRX файл расширения из Chrome Web Store"""
    print(f"Скачиваем расширение CyberYozh (ID: {EXTENSION_ID})...")
    
    try:
        headers = {
            'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36',
            'Accept': '*/*'
        }
        response = requests.get(EXTENSION_URL, headers=headers, stream=True, timeout=30, allow_redirects=True)
        response.raise_for_status()
        
        # Проверяем что получили бинарные данные
        content_type = response.headers.get('Content-Type', '')
        print(f"Content-Type: {content_type}")
        print(f"Размер: {len(response.content)} байт")
        
        if len(response.content) == 0:
            print("❌ Пустой ответ от сервера")
            return None
        
        # Сохраняем во временный файл
        crx_path = Path("cyberyozh_extension.crx")
        with open(crx_path, 'wb') as f:
            f.write(response.content)
        
        print(f"✅ Расширение скачано: {crx_path}")
        return crx_path
    except Exception as e:
        print(f"❌ Ошибка загрузки: {e}")
        import traceback
        traceback.print_exc()
        return None

def unpack_crx(crx_path, output_dir):
    """Распаковывает CRX файл в указанную папку"""
    print(f"Распаковываем расширение в {output_dir}...")
    
    try:
        # CRX файлы — это zip архивы с дополнительным заголовком
        # Создаём папку назначения
        output_path = Path(output_dir)
        if output_path.exists():
            shutil.rmtree(output_path)
        output_path.mkdir(parents=True, exist_ok=True)
        
        # Читаем CRX и пропускаем заголовок
        with open(crx_path, 'rb') as f:
            data = f.read()
            
            # Ищем начало ZIP архива (сигнатура PK)
            zip_start = data.find(b'PK\x03\x04')
            if zip_start == -1:
                raise ValueError("Не найден ZIP архив внутри CRX")
            
            print(f"Найден ZIP на позиции {zip_start}")
            
            # Сохраняем чистый ZIP во временный файл
            zip_path = Path("temp_extension.zip")
            with open(zip_path, 'wb') as zf:
                zf.write(data[zip_start:])
        
        # Распаковываем ZIP
        with zipfile.ZipFile(zip_path, 'r') as zip_ref:
            zip_ref.extractall(output_path)
        
        # Удаляем временные файлы
        zip_path.unlink()
        crx_path.unlink()
        
        print(f"✅ Расширение распаковано в {output_path}")
        
        # Проверяем наличие manifest.json
        manifest = output_path / "manifest.json"
        if manifest.exists():
            print(f"✅ manifest.json найден")
            return True
        else:
            print(f"⚠️ manifest.json не найден в корне расширения")
            return False
            
    except Exception as e:
        print(f"❌ Ошибка распаковки: {e}")
        import traceback
        traceback.print_exc()
        return False

def main():
    """Основная функция"""
    print("=" * 60)
    print("Загрузка расширения CyberYozh для Antic Browser")
    print("=" * 60)
    
    # Определяем путь к папке назначения
    script_dir = Path(__file__).parent
    extension_dir = script_dir / "extensions" / "cyberyozh"
    
    # Скачиваем расширение
    crx_path = download_extension()
    if not crx_path:
        print("❌ Не удалось скачать расширение")
        return 1
    
    # Распаковываем расширение
    if unpack_crx(crx_path, extension_dir):
        print("\n" + "=" * 60)
        print("✅ УСПЕШНО! Расширение установлено")
        print(f"📁 Путь: {extension_dir}")
        print("=" * 60)
        print("\nТеперь расширение будет загружаться автоматически")
        print("при каждом запуске профиля в Antic Browser.")
        return 0
    else:
        print("\n❌ Не удалось распаковать расширение")
        return 1

if __name__ == "__main__":
    sys.exit(main())
