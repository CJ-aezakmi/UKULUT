export interface Profile {
    name: string;
    user_agent: string;
    screen_width: number;
    screen_height: number;
    timezone: string;
    lang: string;
    proxy?: string | null;
    cookies?: string | null;
    webgl: boolean;
    vendor: string;
    cpu: number;
    ram: number;
    is_touch: boolean;
    homepage: string;
}

export interface Proxy {
    proxy_str: string;
    protocol: string;
    host: string;
    port: number;
    username?: string | null;
    password?: string | null;
    country?: string | null;
    city?: string | null;
    checked: boolean;
    last_check?: string | null;
    latency?: number | null;
}

export interface ProxyCheckResult {
    status: string;
    proxy_str: string;
    country: string;
    city: string;
    ip: string;
    latency?: number | null;
    error?: string | null;
}

// SX.ORG API Types
export interface SXOrgCountry {
    id: number;
    name: string;
    code: string;
}

export interface SXOrgState {
    id: number;
    name: string;
    dir_country_id: number;
}

export interface SXOrgCity {
    id: number;
    name: string;
}

// CyberYozh API Types (shapes produced by src-tauri/src/cyberyozh.rs)
export type CyberYozhCategory =
    | 'lte'
    | 'residential_static'
    | 'residential_rotating'
    | 'datacenter_dedicated'
    | 'datacenter_shared';

export interface CyberYozhBalance {
    valid: boolean;
    balance?: string | null;
    message: string;
}

export interface CyberYozhShopProduct {
    id: string;
    title: string;
    country_codes: string[];
    price_usd: number;
    price_per_day?: number | null;
    discounted_price?: number | null;
    days?: number | null;
    category: string;
    in_stock: boolean;
    /** Traffic limit in MB; null = unlimited */
    traffic_limit_mb?: number | null;
    auto_renew_possible: boolean;
    protocols: string[];
    max_quantity?: number | null;
}

export interface CyberYozhShopGroup {
    key: string;
    title: string;
    category: string;
    access_type?: string | null;
    country_codes: string[];
    min_price_per_day?: number | null;
    in_stock: boolean;
    products: CyberYozhShopProduct[];
}

export interface CyberYozhShopCatalog {
    category: string;
    total: number;
    complete: boolean;
    groups: CyberYozhShopGroup[];
}

export interface CyberYozhBuyResult {
    status: string;
    message?: string | null;
}

export interface CyberYozhMyProxy {
    id: string;
    category?: string | null;
    access_type?: string | null;
    system_status?: string | null;
    order_status?: string | null;
    expired: boolean;
    importable: boolean;
    status: 'active' | 'expired' | 'deleted' | 'pending' | string;
    protocol: string;
    host?: string | null;
    port?: number | null;
    display?: string | null;
    proxy_str?: string | null;
    country?: string | null;
    public_ip?: string | null;
    access_starts_at?: string | null;
    access_expires_at?: string | null;
    traffic_remains?: number | null;
    change_ip_links: string[];
    connection_host?: string | null;
    connection_port?: number | null;
    connection_login?: string | null;
    connection_password?: string | null;
}

export interface CyberYozhImportItem {
    proxy_str: string;
    country?: string | null;
}

export interface CyberYozhImportResult {
    imported: number;
    skipped: number;
    failed: number;
}

export interface CyberYozhRotatingRequest {
    connection_host: string;
    connection_port: number;
    connection_login: string;
    connection_password: string;
    session_type: 'random' | 'short_session' | 'long_session';
    country_code?: string | null;
    region?: string | null;
    city?: string | null;
    amount?: number | null;
    protocol?: string | null;
}

export interface CyberYozhGeneratedProxy {
    proxy_str: string;
    display: string;
    country?: string | null;
}

export interface Cookie {
    name: string;
    value: string;
    domain: string;
    path: string;
}
