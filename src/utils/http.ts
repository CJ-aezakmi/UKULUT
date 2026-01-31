import { fetch } from '@tauri-apps/plugin-http';

/**
 * Tauri HTTP fetch wrapper for bypassing CORS restrictions
 */
export async function tauriFetch(url: string, options?: RequestInit): Promise<Response> {
    console.log('[HTTP] Tauri fetch:', url, options?.method || 'GET');
    try {
        const response = await fetch(url, options);
        console.log('[HTTP] Response:', response.status, response.statusText);
        return response;
    } catch (error) {
        console.error('[HTTP] Error:', error);
        throw error;
    }
}
