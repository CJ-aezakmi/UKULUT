import { useState, useEffect, useMemo, useRef, useCallback } from 'react';
import { useNotification } from '../utils/notifications';
import { openExternal } from '../utils/external';
import * as api from '../api';
import CyberYozhLogo from './CyberYozhLogo';
import Flag from './Flag';
import type {
    CyberYozhCategory,
    CyberYozhShopCatalog,
    CyberYozhShopGroup,
    CyberYozhShopProduct,
    CyberYozhMyProxy,
    CyberYozhGeneratedProxy,
    CyberYozhImportItem,
} from '../types';

interface CyberYozhModalProps {
    isOpen: boolean;
    onClose: () => void;
    onProxiesImported: () => void;
}

const CYBERYOZH_URL = 'https://app.cyberyozh.com/catalog/?utm_source=antic';
const STORAGE_KEY = 'cyberyozh_api_key';
const CARDS_PAGE = 30;
/** Delays (ms) between "Мои прокси" refreshes after a purchase — provisioning is async. */
const PROVISION_POLL_DELAYS = [4000, 8000, 15000, 25000, 40000];

type MainTab = 'mobile' | 'residential' | 'datacenter';
type SubTab = 'dedicated' | 'shared';

/** Which backend category (and access-type filter) each tab pair maps to. */
const TAB_SOURCES: Record<MainTab, Record<SubTab, { category: CyberYozhCategory; access?: 'private' | 'shared' }>> = {
    mobile: { dedicated: { category: 'lte', access: 'private' }, shared: { category: 'lte', access: 'shared' } },
    residential: { dedicated: { category: 'residential_static' }, shared: { category: 'residential_rotating' } },
    datacenter: { dedicated: { category: 'datacenter_dedicated' }, shared: { category: 'datacenter_shared' } },
};

// Labels for subtabs per main tab (matches CyberYozh website)
const SUB_TAB_LABELS: Record<MainTab, Record<SubTab, string>> = {
    mobile: { dedicated: 'Выделенные', shared: 'Общие' },
    residential: { dedicated: 'Статические', shared: 'Ротационные' },
    datacenter: { dedicated: 'Выделенные', shared: 'Общие' },
};

const SESSION_TYPES = [
    { value: 'random', label: 'Новый IP на каждый запрос' },
    { value: 'short_session', label: 'Короткая сессия' },
    { value: 'long_session', label: 'Длинная сессия' },
] as const;

const POPULAR_COUNTRIES = ['US', 'GB', 'DE', 'FR', 'NL', 'PL', 'UA', 'KZ', 'TR', 'CA', 'IT', 'ES', 'BR', 'IN', 'JP'];

// ────── helpers ──────

let regionNames: { of: (code: string) => string | undefined } | null = null;
try {
    regionNames = new (Intl as any).DisplayNames(['ru'], { type: 'region' });
} catch {
    regionNames = null;
}

function countryName(code: string): string {
    try {
        return regionNames?.of(code.toUpperCase()) || code.toUpperCase();
    } catch {
        return code.toUpperCase();
    }
}

function effectivePrice(p: CyberYozhShopProduct): number {
    return p.discounted_price != null && p.discounted_price > 0 ? p.discounted_price : p.price_usd;
}

/** Human-readable option label like on the CyberYozh website: "1 Месяц / ∞ GB / $49.00" */
function optionLabel(p: CyberYozhShopProduct): string {
    const days = p.days || 0;
    let dur: string;
    if (days <= 0) dur = '∞';
    else if (days === 1) dur = '1 День';
    else if (days <= 4) dur = `${days} Дня`;
    else if (days < 30) dur = `${days} Дней`;
    else {
        const m = Math.round(days / 30);
        if (m <= 1) dur = '1 Месяц';
        else if (m <= 4) dur = `${m} Месяца`;
        else dur = `${m} Месяцев`;
    }
    const traf = !p.traffic_limit_mb || p.traffic_limit_mb < 0 ? '∞ GB' : `${Math.round(p.traffic_limit_mb / 1024)} GB`;
    return `${dur} / ${traf} / $${effectivePrice(p).toFixed(2)}${p.in_stock ? '' : ' — нет в наличии'}`;
}

/** Features differ by category — mirroring CyberYozh website */
function buildFeatures(main: MainTab, sub: SubTab, p?: CyberYozhShopProduct): string[] {
    const limit = p?.traffic_limit_mb && p.traffic_limit_mb > 0 ? `${Math.round(p.traffic_limit_mb / 1024)} GB Traffic` : null;
    const protocols = (p?.protocols || []).map(x => x.toUpperCase()).join(' / ') || 'HTTP / SOCKS5';
    switch (main) {
        case 'mobile':
            return [
                sub === 'dedicated' ? 'Dedicated Mobile Router' : 'Shared Mobile Router',
                'SOCKS5 / VPN with DNS',
                'Manual IP Changing',
                'High Trust Rate',
                'Very High Speed + Low Ping',
                'UDP Support',
                limit || 'Unlimited Traffic',
            ];
        case 'residential':
            return sub === 'dedicated'
                ? ['24h Availability', 'Real ISP', 'Speed up to 150 Mbps', 'Low Ping', 'Supports SOCKS5 with UDP', limit || 'Unlimited Bandwidth', 'Dedicated IP']
                : ['Rotating residential IPs', '160+ countries', 'City / region targeting', 'Sticky & rotating sessions', protocols, limit || 'Traffic package'];
        case 'datacenter':
        default:
            return [
                sub === 'dedicated' ? 'Exclusive IP ownership' : 'Shared IP',
                'High-speed connectivity',
                '99.9% uptime',
                limit || 'Unlimited bandwidth',
                protocols,
            ];
    }
}

/** Badge based on category — matches CyberYozh website colors */
function resolveBadge(main: MainTab): { text: string; color: string } | null {
    switch (main) {
        case 'mobile': return { text: 'Premium', color: '#0059DF' };
        case 'residential': return { text: 'Sale', color: '#FF3A34' };
        default: return null;
    }
}

/** Single country of a group, or null for multi-country groups ("All Countries"). */
function groupCountry(g: CyberYozhShopGroup): string | null {
    return g.country_codes.length === 1 ? g.country_codes[0].toUpperCase() : null;
}

function categoryLabel(category?: string | null, accessType?: string | null): string {
    switch (category) {
        case 'lte': return 'Мобильный';
        case 'residential_static': return 'Резидентский';
        case 'residential_rotating': return 'Ротационный';
        case 'datacenter_dedicated': return 'Датацентр';
        case 'datacenter_shared': return 'Датацентр общий';
        case 'datacenter': return accessType === 'shared' ? 'Датацентр общий' : 'Датацентр';
        default: return category || 'Прокси';
    }
}

function cleanError(err: unknown): string {
    return String(err).replace(/^Error:\s*/i, '');
}

function isThrottle(err: unknown): boolean {
    return String(err).includes(api.CYBERYOZH_THROTTLE_PREFIX);
}

const STATUS_STYLES: Record<string, { label: string; cls: string }> = {
    active: { label: 'Активен', cls: 'bg-green-100 text-green-700' },
    pending: { label: 'Выдаётся', cls: 'bg-amber-100 text-amber-700' },
    expired: { label: 'Истёк', cls: 'bg-zinc-100 text-zinc-500' },
    deleted: { label: 'Удалён', cls: 'bg-red-100 text-red-600' },
};

function Spinner() {
    return <div className="inline-block w-8 h-8 border-4 border-zinc-200 border-t-purple-600 rounded-full animate-spin" />;
}

function BackButton({ onClick }: { onClick: () => void }) {
    return (
        <button onClick={onClick} className="text-sm text-zinc-500 hover:text-zinc-800 mb-4 flex items-center gap-1 transition">
            <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M15 19l-7-7 7-7" />
            </svg>
            Назад
        </button>
    );
}

export default function CyberYozhModal({ isOpen, onClose, onProxiesImported }: CyberYozhModalProps) {
    const { showNotification } = useNotification();
    const [view, setView] = useState<'login' | 'main' | 'shop' | 'import'>('login');
    const [apiKey, setApiKey] = useState('');
    const [balance, setBalance] = useState<string | null>(null);
    const [loggingIn, setLoggingIn] = useState(false);

    // Shop
    const [mainTab, setMainTab] = useState<MainTab>('mobile');
    const [subTab, setSubTab] = useState<SubTab>('dedicated');
    const [catalogs, setCatalogs] = useState<Partial<Record<CyberYozhCategory, CyberYozhShopCatalog>>>({});
    const [shopLoading, setShopLoading] = useState(false);
    const [shopError, setShopError] = useState<string | null>(null);
    const [country, setCountry] = useState('');
    const [visibleCards, setVisibleCards] = useState(CARDS_PAGE);
    const [selectedOptions, setSelectedOptions] = useState<Record<string, string>>({});

    // Purchase confirmation
    const [confirm, setConfirm] = useState<{ group: CyberYozhShopGroup; product: CyberYozhShopProduct } | null>(null);
    const [autoRenew, setAutoRenew] = useState(false);
    const [promoCode, setPromoCode] = useState('');
    const [buying, setBuying] = useState(false);

    // My proxies
    const [myProxies, setMyProxies] = useState<CyberYozhMyProxy[] | null>(null);
    const [myLoading, setMyLoading] = useState(false);
    const [myError, setMyError] = useState<string | null>(null);
    const [selectedProxies, setSelectedProxies] = useState<Set<string>>(new Set());
    const [showInactive, setShowInactive] = useState(false);
    const [importing, setImporting] = useState(false);
    const [provisioning, setProvisioning] = useState<{ attempt: number; total: number } | null>(null);
    const pollToken = useRef(0);

    // Rotating credentials generator
    const [rotBase, setRotBase] = useState<CyberYozhMyProxy | null>(null);
    const [rotCountry, setRotCountry] = useState('');
    const [rotSession, setRotSession] = useState<'random' | 'short_session' | 'long_session'>('random');
    const [rotAmount, setRotAmount] = useState(5);
    const [rotLoading, setRotLoading] = useState(false);
    const [rotResult, setRotResult] = useState<CyberYozhGeneratedProxy[]>([]);

    const source = TAB_SOURCES[mainTab][subTab];
    const balanceNum = balance != null ? parseFloat(balance) : NaN;

    useEffect(() => {
        if (isOpen && view === 'login' && !apiKey) {
            const saved = localStorage.getItem(STORAGE_KEY);
            if (saved) setApiKey(saved);
        }
    }, [isOpen, view]); // eslint-disable-line react-hooks/exhaustive-deps

    // Stop post-purchase polling when the modal closes.
    useEffect(() => {
        if (!isOpen) {
            pollToken.current++;
            setProvisioning(null);
        }
    }, [isOpen]);

    const loadCatalog = useCallback(async (cat: CyberYozhCategory, force = false) => {
        if (!force && catalogs[cat]) return;
        setShopLoading(true);
        setShopError(null);
        try {
            const catalog = await api.cyberyozhGetShop(apiKey, cat);
            setCatalogs(prev => ({ ...prev, [cat]: catalog }));
        } catch (err) {
            setShopError(cleanError(err));
        } finally {
            setShopLoading(false);
        }
    }, [apiKey, catalogs]);

    const loadMyProxies = useCallback(async (silent = false): Promise<CyberYozhMyProxy[] | null> => {
        if (!silent) setMyLoading(true);
        setMyError(null);
        try {
            const list = await api.cyberyozhGetMyProxies(apiKey);
            setMyProxies(list);
            setSelectedProxies(prev => new Set([...prev].filter(id => list.some(p => p.id === id && p.importable))));
            return list;
        } catch (err) {
            if (!silent) setMyError(cleanError(err));
            throw err;
        } finally {
            if (!silent) setMyLoading(false);
        }
    }, [apiKey]);

    useEffect(() => {
        if (view === 'shop') loadCatalog(source.category);
    }, [view, source.category]); // eslint-disable-line react-hooks/exhaustive-deps

    useEffect(() => {
        setCountry('');
        setVisibleCards(CARDS_PAGE);
    }, [mainTab, subTab]);

    useEffect(() => setVisibleCards(CARDS_PAGE), [country]);

    // ────── derived ──────

    const catalog = catalogs[source.category];

    const tabGroups = useMemo(() => {
        if (!catalog) return [] as CyberYozhShopGroup[];
        return catalog.groups.filter(g => !source.access || !g.access_type || g.access_type === source.access);
    }, [catalog, source.access]);

    const countryOptions = useMemo(() => {
        const counts = new Map<string, number>();
        for (const g of tabGroups) {
            if (g.country_codes.length > 3) continue; // "All countries" groups
            for (const c of g.country_codes) counts.set(c, (counts.get(c) || 0) + 1);
        }
        return [...counts.entries()]
            .map(([code, count]) => ({ code, count }))
            .sort((a, b) => countryName(a.code).localeCompare(countryName(b.code), 'ru'));
    }, [tabGroups]);

    const cardGroups = useMemo(
        () => (country ? tabGroups.filter(g => g.country_codes.includes(country)) : tabGroups),
        [tabGroups, country],
    );

    const visibleMyProxies = useMemo(
        () => (myProxies || []).filter(p => showInactive || p.status === 'active' || p.status === 'pending'),
        [myProxies, showInactive],
    );
    const inactiveCount = (myProxies || []).filter(p => p.status === 'expired' || p.status === 'deleted').length;
    const importableProxies = (myProxies || []).filter(p => p.importable && p.proxy_str);

    // ────── actions ──────

    const notifyError = (err: unknown, title = 'Ошибка') =>
        showNotification(isThrottle(err) ? 'Подождите' : title, cleanError(err), isThrottle(err) ? 'warning' : 'error', 7000);

    const handleLogin = async () => {
        const key = apiKey.trim();
        if (!key) {
            showNotification('Ошибка', 'Введите API ключ', 'warning');
            return;
        }
        setLoggingIn(true);
        try {
            const res = await api.cyberyozhValidateKey(key);
            if (!res.valid) {
                showNotification('Ошибка', res.message || 'Неверный API ключ', 'error');
                return;
            }
            localStorage.setItem(STORAGE_KEY, key);
            setApiKey(key);
            setBalance(res.balance ?? null);
            setView('main');
            showNotification('Успех', `API ключ проверен. ${res.message}`, 'success');
        } catch (err) {
            notifyError(err);
        } finally {
            setLoggingIn(false);
        }
    };

    const handleLogout = () => {
        pollToken.current++;
        localStorage.removeItem(STORAGE_KEY);
        setView('login');
        setApiKey('');
        setBalance(null);
        setCatalogs({});
        setMyProxies(null);
        setSelectedProxies(new Set());
        setSelectedOptions({});
        setConfirm(null);
        setRotBase(null);
        setProvisioning(null);
    };

    const openImport = () => {
        setView('import');
        if (myProxies === null) loadMyProxies().catch(() => undefined);
    };

    /** After a purchase: refresh "Мои прокси" a few times until the new proxy is issued. */
    const pollForNewProxy = async (knownIds: Set<string> | null, purchasedAt: number) => {
        const token = ++pollToken.current;
        for (let i = 0; i < PROVISION_POLL_DELAYS.length; i++) {
            setProvisioning({ attempt: i + 1, total: PROVISION_POLL_DELAYS.length });
            await new Promise(r => setTimeout(r, PROVISION_POLL_DELAYS[i]));
            if (token !== pollToken.current) return;
            try {
                const list = await loadMyProxies(true);
                if (token !== pollToken.current) return;
                const fresh = (list || []).filter(p => {
                    if (!p.importable) return false;
                    if (knownIds) return !knownIds.has(p.id);
                    const started = p.access_starts_at ? new Date(p.access_starts_at).getTime() : 0;
                    return started >= purchasedAt - 10 * 60_000;
                });
                if (fresh.length > 0) {
                    setSelectedProxies(prev => new Set([...prev, ...fresh.map(p => p.id)]));
                    setProvisioning(null);
                    showNotification('Прокси выдан', `Готово к импорту: ${fresh.length}. Нажмите «Импортировать выбранные».`, 'success', 7000);
                    return;
                }
            } catch (err) {
                if (isThrottle(err)) {
                    setProvisioning(null);
                    showNotification('Подождите', `${cleanError(err)} Затем нажмите «Обновить».`, 'warning', 7000);
                    return;
                }
            }
        }
        if (token === pollToken.current) {
            setProvisioning(null);
            showNotification('Прокси ещё выдаётся', 'CyberYozh пока не выдал прокси. Нажмите «Обновить» через минуту.', 'info', 7000);
        }
    };

    const handleBuy = async () => {
        if (!confirm) return;
        const { product } = confirm;
        setBuying(true);
        const knownIds = myProxies ? new Set(myProxies.map(p => p.id)) : null;
        const purchasedAt = Date.now();
        try {
            const res = await api.cyberyozhBuyProxy(apiKey, product.id, autoRenew && product.auto_renew_possible, promoCode.trim() || undefined);
            setConfirm(null);
            showNotification('Заказ оформлен', res.message || 'Прокси выдаётся, это может занять до минуты.', 'success', 6000);
            api.cyberyozhGetBalance(apiKey).then(setBalance).catch(() => undefined);
            setView('import');
            pollForNewProxy(knownIds, purchasedAt);
        } catch (err) {
            notifyError(err, 'Покупка не удалась');
        } finally {
            setBuying(false);
        }
    };

    const importItems = async (items: CyberYozhImportItem[]) => {
        if (items.length === 0) {
            showNotification('Нечего импортировать', 'Нет активных прокси с выданными доступами', 'warning');
            return;
        }
        setImporting(true);
        try {
            const res = await api.cyberyozhImportProxies(items);
            const parts = [`Добавлено: ${res.imported}`];
            if (res.skipped) parts.push(`уже были: ${res.skipped}`);
            if (res.failed) parts.push(`ошибок: ${res.failed}`);
            showNotification(res.imported > 0 ? 'Успех' : 'Импорт', parts.join(', '), res.failed ? 'warning' : 'success');
            if (res.imported > 0) onProxiesImported();
        } catch (err) {
            showNotification('Ошибка импорта', cleanError(err), 'error');
        } finally {
            setImporting(false);
        }
    };

    const toImportItem = (p: CyberYozhMyProxy): CyberYozhImportItem => ({ proxy_str: p.proxy_str!, country: p.country ?? null });

    const handleGenerateRotating = async () => {
        if (!rotBase) return;
        const { connection_host, connection_port, connection_login, connection_password } = rotBase;
        if (!connection_host || !connection_port || !connection_login || !connection_password) {
            showNotification('Ошибка', 'У этого прокси ещё нет доступов для генерации', 'warning');
            return;
        }
        setRotLoading(true);
        try {
            const res = await api.cyberyozhGenerateRotating(apiKey, {
                connection_host,
                connection_port,
                connection_login,
                connection_password,
                session_type: rotSession,
                country_code: rotCountry || null,
                amount: rotAmount,
                protocol: rotBase.protocol,
            });
            setRotResult(res);
            showNotification('Готово', `Сгенерировано доступов: ${res.length}`, 'success');
        } catch (err) {
            notifyError(err);
        } finally {
            setRotLoading(false);
        }
    };

    if (!isOpen) return null;

    return (
        <div className="fixed inset-0 bg-black/60 flex items-center justify-center z-50 p-4">
            <div className="bg-white rounded-2xl shadow-2xl w-full max-w-4xl max-h-[90vh] flex flex-col overflow-hidden relative">
                {/* Header */}
                <div className="bg-gradient-to-r from-zinc-900 to-zinc-800 text-white px-6 py-4 flex justify-between items-center shrink-0">
                    <div className="flex items-center gap-4">
                        <CyberYozhLogo className="h-8 w-auto" textColor="white" />
                        <div className="border-l border-white/15 pl-4">
                            <h2 className="text-lg font-bold leading-tight">Proxy Shop</h2>
                            {view !== 'login' && (
                                <p className="text-xs text-zinc-400">
                                    Баланс: <span className="text-green-400 font-semibold">${balance ?? '—'}</span>
                                </p>
                            )}
                        </div>
                    </div>
                    <div className="flex items-center gap-1">
                        {view !== 'login' && (
                            <button onClick={handleLogout} className="text-xs text-zinc-400 hover:text-white transition rounded-lg px-2.5 py-1.5 hover:bg-white/10">
                                Выйти
                            </button>
                        )}
                        <button onClick={onClose} className="text-zinc-400 hover:text-white transition rounded-lg p-1.5 hover:bg-white/10">
                            <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" />
                            </svg>
                        </button>
                    </div>
                </div>

                {/* Content */}
                <div className="flex-1 overflow-y-auto p-6">
                    {/* ═══════════ LOGIN ═══════════ */}
                    {view === 'login' && (
                        <div className="max-w-md mx-auto">
                            <div className="flex justify-center mb-4">
                                <CyberYozhLogo className="h-10 w-auto" textColor="#18181b" />
                            </div>
                            <h3 className="text-xl font-bold text-center mb-6">Авторизация</h3>
                            <input
                                type="text"
                                value={apiKey}
                                onChange={(e) => setApiKey(e.target.value)}
                                onKeyDown={(e) => e.key === 'Enter' && handleLogin()}
                                className="w-full border border-gray-300 rounded-xl px-4 py-3 mb-4 focus:ring-2 focus:ring-purple-500 focus:outline-none text-sm"
                                placeholder="Введите API ключ CyberYozh"
                            />
                            <div className="flex gap-3">
                                <button
                                    onClick={handleLogin}
                                    disabled={loggingIn}
                                    className="flex-1 bg-purple-600 hover:bg-purple-700 disabled:opacity-50 text-white py-3 rounded-xl font-medium transition"
                                >
                                    {loggingIn ? 'Проверка...' : 'Войти'}
                                </button>
                                <button
                                    onClick={() => openExternal(CYBERYOZH_URL)}
                                    className="flex-1 bg-zinc-800 hover:bg-zinc-700 text-white py-3 rounded-xl font-medium transition flex items-center justify-center gap-2"
                                >
                                    <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                                        <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M10 6H6a2 2 0 00-2 2v10a2 2 0 002 2h10a2 2 0 002-2v-4M14 4h6m0 0v6m0-6L10 14" />
                                    </svg>
                                    Получить API ключ
                                </button>
                            </div>
                        </div>
                    )}

                    {/* ═══════════ MAIN ═══════════ */}
                    {view === 'main' && (
                        <div className="max-w-md mx-auto">
                            <div className="bg-green-50 border border-green-200 rounded-xl p-4 mb-6 text-center">
                                <p className="text-green-800 font-bold text-lg">💰 Баланс: ${balance ?? '—'}</p>
                            </div>

                            <div className="space-y-3">
                                <button
                                    onClick={() => setView('shop')}
                                    className="w-full bg-purple-600 hover:bg-purple-700 text-white py-4 rounded-xl font-semibold transition flex items-center justify-center gap-2"
                                >
                                    <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                                        <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M3 3h2l.4 2M7 13h10l4-8H5.4M7 13L5.4 5M7 13l-2.293 2.293c-.63.63-.184 1.707.707 1.707H17m0 0a2 2 0 100 4 2 2 0 000-4zm-8 2a2 2 0 100 4 2 2 0 000-4z" />
                                    </svg>
                                    Магазин прокси
                                </button>
                                <button
                                    onClick={openImport}
                                    className="w-full bg-zinc-800 hover:bg-zinc-700 text-white py-4 rounded-xl font-semibold transition flex items-center justify-center gap-2"
                                >
                                    <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                                        <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M4 16v1a3 3 0 003 3h10a3 3 0 003-3v-1m-4-4l-4 4m0 0l-4-4m4 4V4" />
                                    </svg>
                                    Импортировать мои прокси
                                </button>
                            </div>

                            <div className="mt-6 text-center space-y-2">
                                <p className="text-sm text-purple-600">
                                    Промокод <strong className="bg-purple-100 px-2 py-0.5 rounded">CYBERYOZH2025</strong> — скидка 10%
                                </p>
                                <button onClick={() => openExternal(CYBERYOZH_URL)} className="text-xs text-zinc-400 hover:text-zinc-600 underline transition">
                                    Пополнить баланс на сайте
                                </button>
                            </div>
                        </div>
                    )}

                    {/* ═══════════ SHOP ═══════════ */}
                    {view === 'shop' && (
                        <div>
                            <BackButton onClick={() => setView('main')} />

                            {/* Main Tabs: Мобильные / Резидентские / Датацентр */}
                            <div className="flex gap-1 bg-zinc-100 rounded-xl p-1 mb-4">
                                {([
                                    ['mobile', 'Мобильные'],
                                    ['residential', 'Резидентские'],
                                    ['datacenter', 'Датацентр'],
                                ] as [MainTab, string][]).map(([key, label]) => (
                                    <button
                                        key={key}
                                        onClick={() => { setMainTab(key); setSubTab('dedicated'); }}
                                        className={`flex-1 py-2.5 text-sm font-medium rounded-lg transition ${
                                            mainTab === key ? 'bg-white text-zinc-900 shadow-sm' : 'text-zinc-500 hover:text-zinc-700'
                                        }`}
                                    >
                                        {label}
                                    </button>
                                ))}
                            </div>

                            {/* Sub Tabs + country filter */}
                            <div className="flex flex-wrap items-center gap-2 mb-6">
                                {(['dedicated', 'shared'] as SubTab[]).map((key) => (
                                    <button
                                        key={key}
                                        onClick={() => setSubTab(key)}
                                        className={`px-5 py-2 text-sm font-medium rounded-lg border transition ${
                                            subTab === key
                                                ? 'bg-zinc-900 text-white border-zinc-900'
                                                : 'bg-white text-zinc-600 border-zinc-200 hover:border-zinc-400'
                                        }`}
                                    >
                                        {SUB_TAB_LABELS[mainTab][key]}
                                    </button>
                                ))}
                                <div className="flex-1" />
                                {countryOptions.length > 1 && (
                                    <select
                                        value={country}
                                        onChange={(e) => setCountry(e.target.value)}
                                        className="border border-zinc-200 rounded-lg px-3 py-2 text-sm bg-white focus:ring-2 focus:ring-purple-500 focus:outline-none"
                                    >
                                        <option value="">Все страны ({countryOptions.length})</option>
                                        {countryOptions.map(c => (
                                            <option key={c.code} value={c.code}>{countryName(c.code)} ({c.count})</option>
                                        ))}
                                    </select>
                                )}
                                <button
                                    onClick={() => loadCatalog(source.category, true)}
                                    disabled={shopLoading}
                                    title="Обновить"
                                    className="p-2 rounded-lg border border-zinc-200 text-zinc-500 hover:text-zinc-800 hover:border-zinc-400 disabled:opacity-40 transition"
                                >
                                    <svg className={`w-4 h-4 ${shopLoading ? 'animate-spin' : ''}`} fill="none" stroke="currentColor" viewBox="0 0 24 24">
                                        <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M4 4v5h.582m15.356 2A8.001 8.001 0 004.582 9m0 0H9m11 11v-5h-.581m0 0a8.003 8.003 0 01-15.357-2m15.357 2H15" />
                                    </svg>
                                </button>
                            </div>

                            {shopLoading && !catalog && (
                                <div className="text-center py-16">
                                    <Spinner />
                                    <p className="mt-3 text-sm text-zinc-500">Загрузка...</p>
                                </div>
                            )}

                            {shopError && !shopLoading && (
                                <div className="text-center py-12">
                                    <p className="text-red-600 font-medium mb-1">Не удалось загрузить каталог</p>
                                    <p className="text-sm text-zinc-500 mb-4">{shopError}</p>
                                    <button
                                        onClick={() => loadCatalog(source.category, true)}
                                        className="bg-purple-600 hover:bg-purple-700 text-white px-6 py-2.5 rounded-xl font-medium transition"
                                    >
                                        Повторить
                                    </button>
                                </div>
                            )}

                            {catalog && !shopError && cardGroups.length === 0 && (
                                <div className="text-center py-16 text-zinc-400">
                                    <svg className="w-12 h-12 mx-auto mb-3 opacity-40" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                                        <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.5} d="M20 7l-8-4-8 4m16 0l-8 4m8-4v10l-8 4m0-10L4 7m8 4v10M4 7v10l8 4" />
                                    </svg>
                                    <p className="text-lg font-medium mb-1">Нет доступных прокси</p>
                                    <p className="text-sm">В этой категории пока нет товаров</p>
                                </div>
                            )}

                            {/* Card grid */}
                            {catalog && !shopError && cardGroups.length > 0 && (
                                <>
                                    <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
                                        {cardGroups.slice(0, visibleCards).map((group) => {
                                            const products = group.products;
                                            const selId = selectedOptions[group.key] || products.find(p => p.in_stock)?.id || products[0]?.id;
                                            const selOpt = products.find(p => p.id === selId) || products[0];
                                            const outOfStock = !selOpt || !selOpt.in_stock;
                                            const badge = resolveBadge(mainTab);
                                            return (
                                                <div
                                                    key={group.key}
                                                    className="bg-white border border-zinc-200 rounded-xl overflow-hidden hover:border-zinc-300 hover:shadow-md transition-all flex flex-col"
                                                >
                                                    <div className="px-4 pt-4 pb-3 flex items-center gap-2.5">
                                                        <Flag code={groupCountry(group)} />
                                                        <span className="font-semibold text-zinc-900 text-sm flex-1 truncate" title={group.title}>{group.title}</span>
                                                        {badge && (
                                                            <span className="text-[11px] font-bold text-white px-2 py-0.5 rounded-md shrink-0" style={{ backgroundColor: badge.color }}>
                                                                {badge.text}
                                                            </span>
                                                        )}
                                                    </div>

                                                    <hr className="border-zinc-100 mx-4" />

                                                    <div className="px-4 py-3 flex-1">
                                                        <ul className="space-y-1.5">
                                                            {buildFeatures(mainTab, subTab, selOpt).map((f, i) => (
                                                                <li key={i} className="flex items-start gap-2 text-[13px] text-zinc-600">
                                                                    <span className="text-green-500 mt-px shrink-0">✓</span>
                                                                    {f}
                                                                </li>
                                                            ))}
                                                        </ul>
                                                    </div>

                                                    <div className="px-4 pb-4 pt-2 flex items-center gap-2">
                                                        <select
                                                            value={selId}
                                                            onChange={(e) => setSelectedOptions(prev => ({ ...prev, [group.key]: e.target.value }))}
                                                            className="flex-1 min-w-0 border border-zinc-200 rounded-lg px-2.5 py-2 text-[13px] bg-zinc-50 focus:ring-2 focus:ring-purple-500 focus:outline-none"
                                                        >
                                                            {products.map(p => (
                                                                <option key={p.id} value={p.id} disabled={!p.in_stock}>
                                                                    {optionLabel(p)}
                                                                </option>
                                                            ))}
                                                        </select>
                                                        <button
                                                            onClick={() => selOpt && (setConfirm({ group, product: selOpt }), setAutoRenew(false), setPromoCode(''))}
                                                            disabled={outOfStock}
                                                            className={`px-4 py-2 rounded-lg text-sm font-semibold transition whitespace-nowrap ${
                                                                outOfStock ? 'bg-zinc-200 text-zinc-400 cursor-not-allowed' : 'bg-purple-600 hover:bg-purple-700 text-white'
                                                            }`}
                                                        >
                                                            {outOfStock ? 'Нет' : 'Купить'}
                                                        </button>
                                                    </div>
                                                </div>
                                            );
                                        })}
                                    </div>
                                    {cardGroups.length > visibleCards && (
                                        <div className="text-center mt-6">
                                            <button
                                                onClick={() => setVisibleCards(v => v + CARDS_PAGE)}
                                                className="px-6 py-2.5 rounded-xl border border-zinc-200 text-sm font-medium text-zinc-600 hover:border-zinc-400 hover:text-zinc-900 transition"
                                            >
                                                Показать ещё ({cardGroups.length - visibleCards})
                                            </button>
                                        </div>
                                    )}
                                </>
                            )}
                        </div>
                    )}

                    {/* ═══════════ IMPORT ═══════════ */}
                    {view === 'import' && (
                        <div>
                            <BackButton onClick={() => setView('main')} />

                            <div className="flex items-center justify-between mb-4">
                                <h3 className="text-lg font-bold">Мои прокси</h3>
                                <div className="flex items-center gap-3">
                                    {inactiveCount > 0 && (
                                        <label className="flex items-center gap-1.5 text-xs text-zinc-500 cursor-pointer">
                                            <input type="checkbox" checked={showInactive} onChange={(e) => setShowInactive(e.target.checked)} className="accent-purple-600" />
                                            Показать истёкшие ({inactiveCount})
                                        </label>
                                    )}
                                    <button
                                        onClick={() => loadMyProxies().catch(() => undefined)}
                                        disabled={myLoading}
                                        className="text-sm text-zinc-500 hover:text-zinc-800 disabled:opacity-40 flex items-center gap-1 transition"
                                    >
                                        <svg className={`w-4 h-4 ${myLoading ? 'animate-spin' : ''}`} fill="none" stroke="currentColor" viewBox="0 0 24 24">
                                            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M4 4v5h.582m15.356 2A8.001 8.001 0 004.582 9m0 0H9m11 11v-5h-.581m0 0a8.003 8.003 0 01-15.357-2m15.357 2H15" />
                                        </svg>
                                        Обновить
                                    </button>
                                </div>
                            </div>

                            {provisioning && (
                                <div className="bg-purple-50 border border-purple-200 rounded-xl p-3 mb-4 text-sm text-purple-800 flex items-center gap-3">
                                    <div className="w-4 h-4 border-2 border-purple-300 border-t-purple-700 rounded-full animate-spin shrink-0" />
                                    Прокси выдаётся… проверка {provisioning.attempt} из {provisioning.total}
                                </div>
                            )}

                            {myLoading && myProxies === null && (
                                <div className="text-center py-12"><Spinner /></div>
                            )}

                            {myError && !myLoading && (
                                <div className="text-center py-12">
                                    <p className="text-red-600 font-medium mb-1">Не удалось загрузить прокси</p>
                                    <p className="text-sm text-zinc-500">{myError}</p>
                                </div>
                            )}

                            {myProxies !== null && !myError && visibleMyProxies.length === 0 && (
                                <div className="text-center py-16">
                                    <p className="text-zinc-400 mb-4">Нет активных прокси</p>
                                    <button
                                        onClick={() => setView('shop')}
                                        className="bg-purple-600 hover:bg-purple-700 text-white px-6 py-2.5 rounded-xl font-medium transition"
                                    >
                                        Перейти в магазин
                                    </button>
                                </div>
                            )}

                            {myProxies !== null && !myError && visibleMyProxies.length > 0 && (
                                <>
                                    <div className="flex gap-2 mb-4">
                                        <button
                                            onClick={() => importItems(importableProxies.map(toImportItem))}
                                            disabled={importing || importableProxies.length === 0}
                                            className="bg-green-600 hover:bg-green-700 disabled:opacity-40 text-white px-5 py-2.5 rounded-xl font-medium transition"
                                        >
                                            Импортировать все ({importableProxies.length})
                                        </button>
                                        <button
                                            onClick={() => importItems(importableProxies.filter(p => selectedProxies.has(p.id)).map(toImportItem))}
                                            disabled={importing || selectedProxies.size === 0}
                                            className="bg-purple-600 hover:bg-purple-700 disabled:opacity-40 text-white px-5 py-2.5 rounded-xl font-medium transition"
                                        >
                                            Импортировать выбранные ({selectedProxies.size})
                                        </button>
                                    </div>

                                    <div className="space-y-2 max-h-[50vh] overflow-y-auto">
                                        {visibleMyProxies.map(proxy => {
                                            const st = STATUS_STYLES[proxy.status] || { label: proxy.status, cls: 'bg-zinc-100 text-zinc-500' };
                                            const isRotating = proxy.category === 'residential_rotating';
                                            return (
                                                <label
                                                    key={proxy.id}
                                                    className={`flex items-center p-3 border border-zinc-200 rounded-xl transition ${
                                                        proxy.importable ? 'hover:bg-zinc-50 cursor-pointer' : 'opacity-60'
                                                    }`}
                                                >
                                                    <input
                                                        type="checkbox"
                                                        disabled={!proxy.importable}
                                                        checked={selectedProxies.has(proxy.id)}
                                                        onChange={(e) => {
                                                            const s = new Set(selectedProxies);
                                                            e.target.checked ? s.add(proxy.id) : s.delete(proxy.id);
                                                            setSelectedProxies(s);
                                                        }}
                                                        className="mr-3 accent-purple-600"
                                                    />
                                                    <div className="flex-1 min-w-0">
                                                        <p className="font-medium text-sm truncate flex items-center gap-2">
                                                            <Flag code={proxy.country} className="w-5 h-[15px]" />
                                                            <span>{proxy.country ? countryName(proxy.country) : 'Страна неизвестна'} — {proxy.public_ip || proxy.host || '—'}</span>
                                                            <span className={`text-[10px] font-semibold px-1.5 py-0.5 rounded ${st.cls}`}>{st.label}</span>
                                                            <span className="text-[11px] text-zinc-400 font-normal">{categoryLabel(proxy.category, proxy.access_type)}</span>
                                                        </p>
                                                        <p className="text-xs text-zinc-500 truncate">
                                                            {proxy.protocol.toUpperCase()} {proxy.display || `${proxy.host}:${proxy.port}`}
                                                            {proxy.access_expires_at && (
                                                                <span className="ml-2 text-zinc-400">до {new Date(proxy.access_expires_at).toLocaleDateString('ru-RU')}</span>
                                                            )}
                                                        </p>
                                                    </div>
                                                    {isRotating && proxy.status === 'active' && (
                                                        <button
                                                            onClick={(e) => { e.preventDefault(); setRotBase(proxy); setRotResult([]); setRotCountry(''); }}
                                                            className="ml-2 text-xs font-medium text-purple-600 hover:text-purple-800 px-2.5 py-1.5 rounded-lg hover:bg-purple-50 transition"
                                                        >
                                                            Доступы
                                                        </button>
                                                    )}
                                                </label>
                                            );
                                        })}
                                    </div>
                                </>
                            )}
                        </div>
                    )}
                </div>

                {/* ═══════════ BUY CONFIRMATION ═══════════ */}
                {confirm && (() => {
                    const price = effectivePrice(confirm.product);
                    const enough = isNaN(balanceNum) || balanceNum >= price;
                    return (
                        <div className="absolute inset-0 bg-black/40 flex items-center justify-center p-6 z-10">
                            <div className="bg-white rounded-2xl shadow-2xl w-full max-w-sm p-6">
                                <h3 className="text-lg font-bold mb-1">Подтверждение покупки</h3>
                                <p className="text-sm text-zinc-500 mb-4 truncate" title={confirm.group.title}>{confirm.group.title}</p>
                                <div className="bg-zinc-50 rounded-xl p-4 space-y-2 text-sm mb-4">
                                    <div className="flex justify-between"><span className="text-zinc-500">Тариф</span><span className="font-medium">{optionLabel(confirm.product).split(' / $')[0]}</span></div>
                                    <div className="flex justify-between"><span className="text-zinc-500">Цена</span><span className="font-bold">${price.toFixed(2)}</span></div>
                                    <div className="flex justify-between"><span className="text-zinc-500">Баланс</span><span className="font-medium">${balance ?? '—'}</span></div>
                                    {!isNaN(balanceNum) && (
                                        <div className="flex justify-between border-t border-zinc-200 pt-2">
                                            <span className="text-zinc-500">После покупки</span>
                                            <span className={`font-semibold ${enough ? 'text-green-600' : 'text-red-600'}`}>${(balanceNum - price).toFixed(2)}</span>
                                        </div>
                                    )}
                                </div>
                                <input
                                    value={promoCode}
                                    onChange={(e) => setPromoCode(e.target.value)}
                                    placeholder="Промокод (необязательно)"
                                    className="w-full border border-zinc-200 rounded-xl px-4 py-2.5 mb-3 text-sm focus:ring-2 focus:ring-purple-500 focus:outline-none"
                                />
                                {confirm.product.auto_renew_possible && (
                                    <label className="flex items-center gap-2 text-sm text-zinc-600 mb-4 cursor-pointer">
                                        <input type="checkbox" checked={autoRenew} onChange={(e) => setAutoRenew(e.target.checked)} className="accent-purple-600" />
                                        Автопродление
                                    </label>
                                )}
                                {!enough && (
                                    <p className="text-sm text-red-600 mb-3">
                                        Недостаточно средств.{' '}
                                        <button onClick={() => openExternal(CYBERYOZH_URL)} className="underline font-medium">Пополнить баланс</button>
                                    </p>
                                )}
                                <div className="flex gap-3">
                                    <button
                                        onClick={handleBuy}
                                        disabled={buying || !enough}
                                        className="flex-1 bg-purple-600 hover:bg-purple-700 disabled:opacity-50 text-white py-3 rounded-xl font-medium transition"
                                    >
                                        {buying ? 'Покупка...' : `Купить за $${price.toFixed(2)}`}
                                    </button>
                                    <button
                                        onClick={() => setConfirm(null)}
                                        disabled={buying}
                                        className="px-5 bg-zinc-100 hover:bg-zinc-200 text-zinc-700 py-3 rounded-xl font-medium transition"
                                    >
                                        Отмена
                                    </button>
                                </div>
                            </div>
                        </div>
                    );
                })()}

                {/* ═══════════ ROTATING CREDENTIALS ═══════════ */}
                {rotBase && (
                    <div className="absolute inset-0 bg-black/40 flex items-center justify-center p-6 z-10">
                        <div className="bg-white rounded-2xl shadow-2xl w-full max-w-md p-6 max-h-full overflow-y-auto">
                            <div className="flex items-center justify-between mb-4">
                                <h3 className="text-lg font-bold">Доступы ротационного прокси</h3>
                                <button onClick={() => setRotBase(null)} className="text-zinc-400 hover:text-zinc-700 p-1 rounded-lg hover:bg-zinc-100 transition">
                                    <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" /></svg>
                                </button>
                            </div>
                            <div className="grid grid-cols-2 gap-3 mb-3">
                                <select value={rotCountry} onChange={(e) => setRotCountry(e.target.value)} className="border border-zinc-200 rounded-xl px-3 py-2.5 text-sm bg-white focus:ring-2 focus:ring-purple-500 focus:outline-none">
                                    <option value="">Любая страна</option>
                                    {POPULAR_COUNTRIES.map(c => <option key={c} value={c}>{countryName(c)}</option>)}
                                </select>
                                <input
                                    type="number" min={1} max={100} value={rotAmount}
                                    onChange={(e) => setRotAmount(Math.max(1, Math.min(100, parseInt(e.target.value) || 1)))}
                                    className="border border-zinc-200 rounded-xl px-3 py-2.5 text-sm focus:ring-2 focus:ring-purple-500 focus:outline-none"
                                    title="Количество"
                                />
                            </div>
                            <select value={rotSession} onChange={(e) => setRotSession(e.target.value as typeof rotSession)} className="w-full border border-zinc-200 rounded-xl px-3 py-2.5 text-sm bg-white mb-4 focus:ring-2 focus:ring-purple-500 focus:outline-none">
                                {SESSION_TYPES.map(s => <option key={s.value} value={s.value}>{s.label}</option>)}
                            </select>
                            <button
                                onClick={handleGenerateRotating}
                                disabled={rotLoading}
                                className="w-full bg-purple-600 hover:bg-purple-700 disabled:opacity-50 text-white py-3 rounded-xl font-medium transition mb-4"
                            >
                                {rotLoading ? 'Генерация...' : 'Сгенерировать'}
                            </button>
                            {rotResult.length > 0 && (
                                <>
                                    <div className="space-y-1.5 max-h-48 overflow-y-auto mb-3">
                                        {rotResult.map((r, i) => (
                                            <div key={i} className="text-xs font-mono bg-zinc-50 border border-zinc-200 rounded-lg px-3 py-2 truncate">{r.display}</div>
                                        ))}
                                    </div>
                                    <button
                                        onClick={() => importItems(rotResult.map(r => ({ proxy_str: r.proxy_str, country: r.country ?? null })))}
                                        disabled={importing}
                                        className="w-full bg-green-600 hover:bg-green-700 disabled:opacity-40 text-white py-2.5 rounded-xl font-medium transition"
                                    >
                                        Импортировать ({rotResult.length})
                                    </button>
                                </>
                            )}
                        </div>
                    </div>
                )}
            </div>
        </div>
    );
}
