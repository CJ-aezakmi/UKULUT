import { invoke } from '@tauri-apps/api/core';
import type {
    Profile,
    Proxy,
    ProxyCheckResult,
    SXOrgCountry,
    SXOrgState,
    SXOrgCity,
    CyberYozhProxyItem,
    CyberYozhShopItem,
} from './types';

// ============================================================================
// PROFILE API
// ============================================================================

export async function getProfiles(): Promise<Profile[]> {
    return await invoke('get_profiles');
}

export async function saveProfile(profile: Profile): Promise<void> {
    await invoke('save_profile', { profile });
}

export async function deleteProfile(profileName: string): Promise<void> {
    await invoke('delete_profile', { profileName });
}

export async function launchProfile(profileName: string): Promise<string> {
    return await invoke('launch_profile', { profileName });
}

// ============================================================================
// PROXY API
// ============================================================================

export async function getProxies(): Promise<Proxy[]> {
    return await invoke('get_proxies');
}

export async function addProxy(proxyStr: string): Promise<void> {
    await invoke('add_proxy', { proxyStr });
}

export async function removeProxy(proxyStr: string): Promise<void> {
    await invoke('remove_proxy', { proxyStr });
}

export async function checkProxy(proxyStr: string): Promise<ProxyCheckResult> {
    return await invoke('check_proxy', { proxyStr });
}

export async function importProxiesFromText(proxiesText: string): Promise<string[]> {
    return await invoke('import_proxies_from_text', { proxiesText });
}

// ============================================================================
// API KEYS
// ============================================================================

export async function saveApiKey(service: string, key: string): Promise<void> {
    await invoke('save_api_key', { service, key });
}

export async function getApiKey(service: string): Promise<string | null> {
    return await invoke('get_api_key', { service });
}

// ============================================================================
// SX.ORG API
// ============================================================================

export async function sxOrgValidateKey(apiKey: string): Promise<[boolean, string]> {
    return await invoke('sx_org_validate_key', { apiKey });
}

export async function sxOrgGetCountries(apiKey: string): Promise<SXOrgCountry[]> {
    return await invoke('sx_org_get_countries', { apiKey });
}

export async function sxOrgGetStates(apiKey: string, countryId: number): Promise<SXOrgState[]> {
    return await invoke('sx_org_get_states', { apiKey, countryId });
}

export async function sxOrgGetCities(
    apiKey: string,
    stateId: number,
    countryId: number
): Promise<SXOrgCity[]> {
    return await invoke('sx_org_get_cities', { apiKey, stateId, countryId });
}

export async function sxOrgCreateProxy(params: {
    apiKey: string;
    countryCode: string;
    stateName?: string;
    cityName?: string;
    connectionType: string;
    proxyTypes: string[];
    proxyName: string;
}): Promise<string[]> {
    return await invoke('sx_org_create_proxy', params);
}

// ============================================================================
// CYBERYOZH API
// ============================================================================

export async function cyberyozhValidateKey(apiKey: string): Promise<[boolean, string]> {
    return await invoke('cyberyozh_validate_key', { apiKey });
}

export async function cyberyozhGetShopProxies(
    apiKey: string,
    countryCode?: string,
    accessType?: string
): Promise<CyberYozhShopItem[]> {
    return await invoke('cyberyozh_get_shop_proxies', { apiKey, countryCode, accessType });
}

export async function cyberyozhBuyProxy(
    apiKey: string,
    proxyId: string,
    autoRenew: boolean
): Promise<string> {
    return await invoke('cyberyozh_buy_proxy', { apiKey, proxyId, autoRenew });
}

export async function cyberyozhGetMyProxies(apiKey: string): Promise<CyberYozhProxyItem[]> {
    return await invoke('cyberyozh_get_my_proxies', { apiKey });
}

export async function cyberyozhImportProxies(apiKey: string): Promise<string[]> {
    return await invoke('cyberyozh_import_proxies', { apiKey });
}

// ============================================================================
// PSB PROXY API
// ============================================================================

export async function psbValidateKey(apiKey: string): Promise<[boolean, string]> {
    return await invoke('psb_validate_key', { apiKey });
}

export async function psbGetSubUsers(apiKey: string): Promise<any> {
    return await invoke('psb_get_sub_users', { apiKey });
}

export async function psbCreateSubUser(apiKey: string, subType: string): Promise<any> {
    return await invoke('psb_create_sub_user', { apiKey, subType });
}

export async function psbGetProducts(): Promise<any[]> {
    return await invoke('psb_get_products');
}

export async function psbBuyProduct(apiKey: string, productId: number, paymentType: string = 'balance'): Promise<any> {
    return await invoke('psb_buy_product', { apiKey, productId, paymentType });
}

export async function psbGetBasicSubUser(apiKey: string, subType: string): Promise<any> {
    return await invoke('psb_get_basic_sub_user', { apiKey, subType });
}

export async function psbGetSubUser(apiKey: string, id: number): Promise<any> {
    return await invoke('psb_get_sub_user', { apiKey, id });
}

export async function psbGiveTraffic(apiKey: string, subUserId: number, amount: number): Promise<any> {
    return await invoke('psb_give_traffic', { apiKey, subUserId, amount });
}

export async function psbTakeTraffic(apiKey: string, subUserId: number, amount: number): Promise<any> {
    return await invoke('psb_take_traffic', { apiKey, subUserId, amount });
}

export async function psbDeleteSubUser(apiKey: string, subUserId: number): Promise<string> {
    return await invoke('psb_delete_sub_user', { apiKey, subUserId });
}

export async function psbGetPoolData(apiKey: string, pool: string): Promise<any> {
    return await invoke('psb_get_pool_data', { apiKey, pool });
}

export async function psbGetCountries(apiKey: string, pool: string): Promise<any[]> {
    return await invoke('psb_get_countries', { apiKey, pool });
}

export async function psbGetFormats(apiKey: string, pool: string): Promise<any[]> {
    return await invoke('psb_get_formats', { apiKey, pool });
}

export async function psbGetHostnames(apiKey: string, pool: string): Promise<any[]> {
    return await invoke('psb_get_hostnames', { apiKey, pool });
}

export async function psbGetProtocols(apiKey: string, pool: string): Promise<any[]> {
    return await invoke('psb_get_protocols', { apiKey, pool });
}

export async function psbGenerateProxyList(apiKey: string, pool: string, params: any): Promise<string[]> {
    return await invoke('psb_generate_proxy_list', { apiKey, pool, params });
}

export async function psbAddWhitelistIp(
    apiKey: string,
    pool: string,
    ip: string,
    subUserId?: number,
): Promise<string> {
    return await invoke('psb_add_whitelist_ip', {
        apiKey,
        pool,
        ip,
        subUserId: subUserId ?? null,
    });
}

export async function psbGetWhitelist(apiKey: string, pool: string, subUserId?: number): Promise<any> {
    return await invoke('psb_get_whitelist', {
        apiKey,
        pool,
        subUserId: subUserId ?? null,
    });
}

export async function psbRemoveWhitelistIp(
    apiKey: string,
    pool: string,
    ip: string,
    subUserId?: number,
): Promise<string> {
    return await invoke('psb_remove_whitelist_ip', {
        apiKey,
        pool,
        ip,
        subUserId: subUserId ?? null,
    });
}

export async function psbGetMyIp(): Promise<string> {
    return await invoke('psb_get_my_ip');
}

export async function psbImportProxy(
    proxyStr: string,
    protocol?: string,
    countryCode?: string,
): Promise<void> {
    await invoke('psb_import_proxy', {
        proxyStr,
        protocol: protocol || null,
        countryCode: countryCode || null,
    });
}

// ============================================================================
// CONSTANTS
// ============================================================================

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
    'en-US',
    'en-GB',
    'fr-FR',
    'ru-RU',
    'es-ES',
    'pl-PL',
    'pt-PT',
    'nl-NL',
    'zh-CN',
    'de-DE',
    'it-IT',
    'ja-JP',
    'ko-KR',
];

export const TIMEZONES = [
    'America/New_York',
    'America/Chicago',
    'America/Los_Angeles',
    'America/Toronto',
    'Europe/London',
    'Europe/Paris',
    'Europe/Berlin',
    'Europe/Moscow',
    'Asia/Tokyo',
    'Asia/Shanghai',
    'Asia/Seoul',
    'Australia/Sydney',
];

export const USER_AGENTS = [
    'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36',
    'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/119.0.0.0 Safari/537.36',
    'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36',
    'Mozilla/5.0 (Windows NT 10.0; Win64; x64; rv:121.0) Gecko/20100101 Firefox/121.0',
    'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/17.1 Safari/605.1.15',
];

// ============================================================================
// NAMESPACE EXPORTS FOR CONVENIENCE
// ============================================================================

export const sxorg = {
    validateKey: async (apiKey: string): Promise<boolean> => {
        const [isValid] = await sxOrgValidateKey(apiKey);
        return isValid;
    },
    getCountries: sxOrgGetCountries,
    getStates: sxOrgGetStates,
    getCities: sxOrgGetCities,
    createProxy: async (
        apiKey: string,
        countryCode: string,
        stateName?: string | null,
        cityName?: string | null
    ): Promise<string> => {
        const result = await sxOrgCreateProxy({
            apiKey,
            countryCode,
            stateName: stateName || undefined,
            cityName: cityName || undefined,
            connectionType: 'ipv4',
            proxyTypes: ['http', 'socks5'],
            proxyName: `proxy_${Date.now()}`,
        });
        return result[0]; // Return first created proxy
    },
};

export const cyberyozh = {
    validateKey: async (apiKey: string): Promise<boolean> => {
        const [isValid] = await cyberyozhValidateKey(apiKey);
        return isValid;
    },
    getShopProxies: cyberyozhGetShopProxies,
    buyProxy: cyberyozhBuyProxy,
    getMyProxies: cyberyozhGetMyProxies,
    importProxies: async (apiKey: string): Promise<number> => {
        const result = await cyberyozhImportProxies(apiKey);
        return result.length;
    },
};

export const psb = {
    validateKey: async (apiKey: string): Promise<boolean> => {
        const [isValid] = await psbValidateKey(apiKey);
        return isValid;
    },
    getSubUsers: psbGetSubUsers,
    createSubUser: psbCreateSubUser,
    getProducts: psbGetProducts,
    buyProduct: psbBuyProduct,
    getBasicSubUser: psbGetBasicSubUser,
    getSubUser: psbGetSubUser,
    giveTraffic: psbGiveTraffic,
    takeTraffic: psbTakeTraffic,
    deleteSubUser: psbDeleteSubUser,
    getPoolData: psbGetPoolData,
    getCountries: psbGetCountries,
    getFormats: psbGetFormats,
    getHostnames: psbGetHostnames,
    getProtocols: psbGetProtocols,
    generateProxyList: psbGenerateProxyList,
    addWhitelistIp: psbAddWhitelistIp,
    getWhitelist: psbGetWhitelist,
    removeWhitelistIp: psbRemoveWhitelistIp,
    getMyIp: psbGetMyIp,
    importProxy: psbImportProxy,
};
