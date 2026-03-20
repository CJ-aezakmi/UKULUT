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

export interface Cookie {
    name: string;
    value: string;
    domain: string;
    path: string;
}
