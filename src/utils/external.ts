// Утилиты для работы с внешними ссылками в Tauri
import { open } from '@tauri-apps/plugin-shell';

export async function openExternal(url: string): Promise<void> {
    console.log('[External] Открытие внешней ссылки:', url);
    try {
        await open(url);
        console.log('[External] Ссылка открыта успешно');
    } catch (error) {
        console.error('[External] Ошибка открытия ссылки:', error);
        // Fallback на window.open
        console.log('[External] Пробую window.open как fallback...');
        const result = window.open(url, '_blank');
        console.log('[External] window.open результат:', result);
        if (!result) {
            throw new Error('Не удалось открыть ссылку');
        }
    }
}
