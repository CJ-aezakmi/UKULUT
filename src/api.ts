import { invoke } from '@tauri-apps/api/core';
import type {
    Profile,
    Proxy,
    ProxyCheckResult,
    SXOrgCountry,
    SXOrgState,
    SXOrgCity,
    CyberYozhBalance,
    CyberYozhShopCatalog,
    CyberYozhBuyResult,
    CyberYozhMyProxy,
    CyberYozhImportItem,
    CyberYozhImportResult,
    CyberYozhRotatingRequest,
    CyberYozhGeneratedProxy,
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
// CYBERYOZH API (all HTTP happens in Rust: src-tauri/src/cyberyozh.rs)
// ============================================================================

/** Prefix of the error returned when CyberYozh throttles requests. */
export const CYBERYOZH_THROTTLE_PREFIX = 'Слишком много запросов к CyberYozh';

export async function cyberyozhValidateKey(apiKey: string): Promise<CyberYozhBalance> {
    return await invoke('cyberyozh_validate_key', { apiKey });
}

export async function cyberyozhGetBalance(apiKey: string): Promise<string> {
    return await invoke('cyberyozh_get_balance', { apiKey });
}

export async function cyberyozhGetShop(
    apiKey: string,
    category: string,
    accessType?: string
): Promise<CyberYozhShopCatalog> {
    return await invoke('cyberyozh_get_shop', { apiKey, category, accessType });
}

export async function cyberyozhBuyProxy(
    apiKey: string,
    productId: string,
    autoRenew: boolean,
    promoCode?: string
): Promise<CyberYozhBuyResult> {
    return await invoke('cyberyozh_buy_proxy', { apiKey, productId, autoRenew, promoCode });
}

export async function cyberyozhGetMyProxies(apiKey: string): Promise<CyberYozhMyProxy[]> {
    return await invoke('cyberyozh_get_my_proxies', { apiKey });
}

export async function cyberyozhImportProxies(items: CyberYozhImportItem[]): Promise<CyberYozhImportResult> {
    return await invoke('cyberyozh_import_proxies', { items });
}

export async function cyberyozhGenerateRotating(
    apiKey: string,
    request: CyberYozhRotatingRequest
): Promise<CyberYozhGeneratedProxy[]> {
    return await invoke('cyberyozh_generate_rotating', { apiKey, request });
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

export async function psbBuyProduct(apiKey: string, productId: number, paymentType: string = 'balance', amount: number = 1): Promise<any> {
    return await invoke('psb_buy_product', { apiKey, productId, paymentType, amount });
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
