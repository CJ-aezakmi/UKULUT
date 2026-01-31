export const USER_AGENTS = [
    'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36',
    'Mozilla/5.0 (Windows NT 10.0; Win64; x64; rv:121.0) Gecko/20100101 Firefox/121.0',
    'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36',
    'Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36',
];

export const getRandomUserAgent = () => {
    return USER_AGENTS[Math.floor(Math.random() * USER_AGENTS.length)];
};

export const SCREENS = [
    '800×600',
    '960×540',
    '1024×768',
    '1152×864',
    '1280×720',
    '1280×768',
    '1280×800',
    '1280×1024',
    '1366×768',
    '1408×792',
    '1440×900',
    '1400×1050',
    '1440×1080',
    '1536×864',
    '1600×900',
    '1600×1024',
    '1600×1200',
    '1680×1050',
    '1920×1080',
    '1920×1200',
    '2048×1152',
    '2560×1080',
    '2560×1440',
    '3440×1440',
];

export const LANGUAGES = [
    { code: 'en-US', name: 'English (US)' },
    { code: 'en-GB', name: 'English (UK)' },
    { code: 'ru-RU', name: 'Русский' },
    { code: 'de-DE', name: 'Deutsch' },
    { code: 'fr-FR', name: 'Français' },
    { code: 'es-ES', name: 'Español' },
    { code: 'it-IT', name: 'Italiano' },
    { code: 'pt-PT', name: 'Português' },
    { code: 'pl-PL', name: 'Polski' },
    { code: 'nl-NL', name: 'Nederlands' },
    { code: 'zh-CN', name: '中文' },
    { code: 'ja-JP', name: '日本語' },
    { code: 'ko-KR', name: '한국어' },
];

export const TIMEZONES = [
    'America/New_York',
    'America/Chicago',
    'America/Los_Angeles',
    'America/Denver',
    'America/Toronto',
    'Europe/London',
    'Europe/Paris',
    'Europe/Berlin',
    'Europe/Moscow',
    'Europe/Rome',
    'Europe/Madrid',
    'Asia/Tokyo',
    'Asia/Shanghai',
    'Asia/Seoul',
    'Australia/Sydney',
];

export const COUNTRY_SETTINGS: Record<string, { lang: string; timezone: string }> = {
    US: { lang: 'en-US', timezone: 'America/New_York' },
    GB: { lang: 'en-GB', timezone: 'Europe/London' },
    FR: { lang: 'fr-FR', timezone: 'Europe/Paris' },
    DE: { lang: 'de-DE', timezone: 'Europe/Berlin' },
    RU: { lang: 'ru-RU', timezone: 'Europe/Moscow' },
    ES: { lang: 'es-ES', timezone: 'Europe/Madrid' },
    IT: { lang: 'it-IT', timezone: 'Europe/Rome' },
    CN: { lang: 'zh-CN', timezone: 'Asia/Shanghai' },
    JP: { lang: 'ja-JP', timezone: 'Asia/Tokyo' },
};

export function parseScreenResolution(screen: string): { width: number; height: number } {
    const [width, height] = screen.split('×').map(Number);
    return { width, height };
}

export function formatProxyString(proxy: any): string {
    const { protocol, username, password, host, port } = proxy;
    if (username && password) {
        return `${protocol}://${username}:${password}@${host}:${port}`;
    }
    return `${protocol}://${host}:${port}`;
}

export function parseProxyString(proxyStr: string): {
    protocol: string;
    host: string;
    port: number;
    username?: string;
    password?: string;
} | null {
    try {
        const parts = proxyStr.split('://');
        if (parts.length !== 2) return null;

        const protocol = parts[0];
        const rest = parts[1];

        if (rest.includes('@')) {
            const [credentials, hostPort] = rest.split('@');
            const [username, password] = credentials.split(':');
            const [host, portStr] = hostPort.split(':');
            const port = parseInt(portStr, 10);

            return { protocol, host, port, username, password };
        } else {
            const [host, portStr] = rest.split(':');
            const port = parseInt(portStr, 10);

            return { protocol, host, port };
        }
    } catch {
        return null;
    }
}
