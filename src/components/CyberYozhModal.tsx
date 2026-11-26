import { useState, useEffect, useMemo, useRef, useCallback, type ReactNode } from 'react';
import { useNotification } from '../utils/notifications';
import { openExternal } from '../utils/external';
import * as api from '../api';
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
const GROUPS_PAGE = 30;
/** Delays (ms) between "Мои прокси" refreshes after a purchase — provisioning is async. */
const PROVISION_POLL_DELAYS = [4000, 8000, 15000, 25000, 40000];

const CATEGORIES: { key: CyberYozhCategory; label: string; hint: string }[] = [
    { key: 'lte', label: 'Мобильные', hint: '4G/5G, IP мобильных операторов' },
    { key: 'residential_static', label: 'Резидентские статические', hint: 'Постоянный IP домашнего провайдера' },
    { key: 'residential_rotating', label: 'Резидентские ротационные', hint: 'Пакет трафика, IP меняется' },
    { key: 'datacenter_dedicated', label: 'Датацентр выделенные', hint: 'Личный IPv4 из датацентра' },
    { key: 'datacenter_shared', label: 'Датацентр общие', hint: 'IPv4 на нескольких пользователей' },
];

const SESSION_TYPES = [
    { value: 'random', label: 'Новый IP на каждый запрос' },
    { value: 'short_session', label: 'Короткая сессия' },
    { value: 'long_session', label: 'Длинная сессия' },
] as const;

const POPULAR_COUNTRIES = ['US', 'GB', 'DE', 'FR', 'NL', 'PL', 'UA', 'KZ', 'TR', 'CA', 'IT', 'ES', 'BR', 'IN', 'JP'];

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

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

function plural(n: number, one: string, few: string, many: string): string {
    const mod10 = n % 10;
    const mod100 = n % 100;
    if (mod10 === 1 && mod100 !== 11) return one;
    if (mod10 >= 2 && mod10 <= 4 && (mod100 < 12 || mod100 > 14)) return few;
    return many;
}

function daysLabel(days?: number | null): string {
    if (!days) return '';
    return `${days} ${plural(days, 'день', 'дня', 'дней')}`;
}

function trafficLabel(mb?: number | null): string {
    if (!mb) return 'Безлимит';
    if (mb >= 1024) {
        const gb = mb / 1024;
        return `${Number.isInteger(gb) ? gb : gb.toFixed(1)} ГБ`;
    }
    return `${mb} МБ`;
}

function bytesLabel(bytes: number): string {
    if (bytes >= 1024 ** 3) return `${(bytes / 1024 ** 3).toFixed(2)} ГБ`;
    if (bytes >= 1024 ** 2) return `${(bytes / 1024 ** 2).toFixed(0)} МБ`;
    return `${bytes} Б`;
}

function money(n?: number | null): string {
    return `$${(n ?? 0).toFixed(2)}`;
}

function effectivePrice(p: CyberYozhShopProduct): number {
    return p.discounted_price != null && p.discounted_price > 0 ? p.discounted_price : p.price_usd;
}

function formatDate(s?: string | null): string {
    if (!s) return '—';
    const d = new Date(s);
    if (isNaN(d.getTime())) return s;
    return d.toLocaleString('ru-RU', { day: '2-digit', month: '2-digit', year: 'numeric', hour: '2-digit', minute: '2-digit' });
}

function relativeExpiry(s?: string | null): string {
    if (!s) return '';
    const diff = new Date(s).getTime() - Date.now();
    if (isNaN(diff)) return '';
    const abs = Math.abs(diff);
    const hours = Math.round(abs / 3_600_000);
    const days = Math.round(abs / 86_400_000);
    const span = hours < 48 ? `${hours} ${plural(hours, 'час', 'часа', 'часов')}` : `${days} ${plural(days, 'день', 'дня', 'дней')}`;
    return diff >= 0 ? `через ${span}` : `${span} назад`;
}

function categoryLabel(category?: string | null, accessType?: string | null): string {
    switch (category) {
        case 'lte': return 'Мобильный';
        case 'residential_static': return 'Резидентский статический';
        case 'residential_rotating': return 'Резидентский ротационный';
        case 'datacenter_dedicated': return 'Датацентр выделенный';
        case 'datacenter_shared': return 'Датацентр общий';
        case 'datacenter': return accessType === 'shared' ? 'Датацентр общий' : 'Датацентр выделенный';
        default: return category || 'Прокси';
    }
}

function accessLabel(accessType?: string | null): string | null {
    if (accessType === 'private') return 'Выделенный';
    if (accessType === 'shared') return 'Общий';
    return null;
}

function cleanError(err: unknown): string {
    return String(err).replace(/^Error:\s*/i, '');
}

function isThrottle(err: unknown): boolean {
    return String(err).includes(api.CYBERYOZH_THROTTLE_PREFIX);
}

function productOptionLabel(p: CyberYozhShopProduct): string {
    if (p.traffic_limit_mb) return `${trafficLabel(p.traffic_limit_mb)}${p.days ? ` · ${daysLabel(p.days)}` : ''}`;
    return daysLabel(p.days) || p.title;
}

const STATUS_STYLES: Record<string, { label: string; cls: string }> = {
    active: { label: 'Активен', cls: 'bg-emerald-500/10 text-emerald-400 border-emerald-500/20' },
    pending: { label: 'Выдаётся', cls: 'bg-amber-500/10 text-amber-400 border-amber-500/20' },
    expired: { label: 'Истёк', cls: 'bg-gray-500/10 text-gray-400 border-gray-500/20' },
    deleted: { label: 'Удалён', cls: 'bg-red-500/10 text-red-400 border-red-500/20' },
};

// ---------------------------------------------------------------------------
// Small presentational pieces
// ---------------------------------------------------------------------------

function Spinner({ className = 'w-4 h-4' }: { className?: string }) {
    return (
        <svg className={`${className} animate-spin`} viewBox="0 0 24 24" fill="none">
            <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4" />
            <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4z" />
        </svg>
    );
}

function CountryBadge({ code }: { code: string }) {
    return (
        <span className="inline-flex items-center px-1.5 py-0.5 rounded bg-white/5 border border-white/10 text-[10px] font-semibold text-gray-300 tracking-wide">
            {code.toUpperCase()}
        </span>
    );
}

function StateBox({ icon, title, text, action }: { icon: 'loading' | 'empty' | 'error'; title: string; text?: string; action?: ReactNode }) {
    return (
        <div className="flex flex-col items-center justify-center text-center py-14 px-6">
            <div className={`w-12 h-12 rounded-2xl flex items-center justify-center mb-4 border ${
                icon === 'error' ? 'bg-red-500/10 border-red-500/20 text-red-400'
                    : icon === 'loading' ? 'bg-emerald-500/10 border-emerald-500/20 text-emerald-400'
                    : 'bg-white/5 border-white/10 text-gray-500'
            }`}>
                {icon === 'loading' ? <Spinner className="w-5 h-5" /> : icon === 'error' ? (
                    <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 9v2m0 4h.01m-6.938 4h13.856c1.54 0 2.502-1.667 1.732-2.5L13.732 4c-.77-.833-1.964-.833-2.732 0L4.082 16.5c-.77.833.192 2.5 1.732 2.5z" /></svg>
                ) : (
                    <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.8} d="M20 13V6a2 2 0 00-2-2H6a2 2 0 00-2 2v7m16 0v5a2 2 0 01-2 2H6a2 2 0 01-2-2v-5m16 0h-2.586a1 1 0 00-.707.293l-2.414 2.414a1 1 0 01-.707.293h-3.172a1 1 0 01-.707-.293l-2.414-2.414A1 1 0 006.586 13H4" /></svg>
                )}
            </div>
            <p className="text-sm font-medium text-gray-200">{title}</p>
            {text && <p className="text-xs text-gray-500 mt-1 max-w-sm leading-relaxed">{text}</p>}
            {action && <div className="mt-4">{action}</div>}
        </div>
    );
}

// ---------------------------------------------------------------------------
// Main component
// ---------------------------------------------------------------------------

export default function CyberYozhModal({ isOpen, onClose, onProxiesImported }: CyberYozhModalProps) {
    const { showNotification } = useNotification();

    const [view, setView] = useState<'login' | 'main'>('login');
    const [apiKey, setApiKey] = useState('');
    const [loggingIn, setLoggingIn] = useState(false);
    const [balance, setBalance] = useState<string | null>(null);
    const [balanceLoading, setBalanceLoading] = useState(false);
    const [tab, setTab] = useState<'buy' | 'my'>('buy');

    // Shop
    const [category, setCategory] = useState<CyberYozhCategory>('lte');
    const [catalogs, setCatalogs] = useState<Partial<Record<CyberYozhCategory, CyberYozhShopCatalog>>>({});
    const [shopLoading, setShopLoading] = useState(false);
    const [shopError, setShopError] = useState<string | null>(null);
    const [country, setCountry] = useState('');
    const [search, setSearch] = useState('');
    const [visibleGroups, setVisibleGroups] = useState(GROUPS_PAGE);
    const [selectedOption, setSelectedOption] = useState<Record<string, string>>({});

    // Purchase confirmation
    const [confirm, setConfirm] = useState<{ group: CyberYozhShopGroup; product: CyberYozhShopProduct } | null>(null);
    const [autoRenew, setAutoRenew] = useState(false);
    const [promoCode, setPromoCode] = useState('');
    const [buying, setBuying] = useState(false);

    // My proxies
    const [myProxies, setMyProxies] = useState<CyberYozhMyProxy[] | null>(null);
    const [myLoading, setMyLoading] = useState(false);
    const [myError, setMyError] = useState<string | null>(null);
    const [selected, setSelected] = useState<Set<string>>(new Set());
    const [showInactive, setShowInactive] = useState(false);
    const [importing, setImporting] = useState(false);
    const [localProxyStrs, setLocalProxyStrs] = useState<Set<string>>(new Set());
    const [provisioning, setProvisioning] = useState<{ attempt: number; total: number } | null>(null);
    const pollToken = useRef(0);

    // Rotating credentials generator
    const [rotBase, setRotBase] = useState<CyberYozhMyProxy | null>(null);
    const [rotCountry, setRotCountry] = useState('');
    const [rotSession, setRotSession] = useState<'random' | 'short_session' | 'long_session'>('random');
    const [rotAmount, setRotAmount] = useState(5);
    const [rotLoading, setRotLoading] = useState(false);
    const [rotResult, setRotResult] = useState<CyberYozhGeneratedProxy[]>([]);

    const balanceNum = balance != null ? parseFloat(balance) : NaN;

    // ---------------------------------------------------------------- effects

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

    const refreshLocalProxies = useCallback(async () => {
        try {
            const list = await api.getProxies();
            setLocalProxyStrs(new Set(list.map(p => p.proxy_str)));
        } catch {
            /* not critical */
        }
    }, []);

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
            setSelected(prev => new Set([...prev].filter(id => list.some(p => p.id === id && p.importable))));
            return list;
        } catch (err) {
            if (!silent) setMyError(cleanError(err));
            throw err;
        } finally {
            if (!silent) setMyLoading(false);
        }
    }, [apiKey]);

    const refreshBalance = useCallback(async () => {
        setBalanceLoading(true);
        try {
            setBalance(await api.cyberyozhGetBalance(apiKey));
        } catch (err) {
            showNotification(isThrottle(err) ? 'Подождите' : 'Ошибка', cleanError(err), isThrottle(err) ? 'warning' : 'error');
        } finally {
            setBalanceLoading(false);
        }
    }, [apiKey, showNotification]);

    // Load the selected category lazily (once per category; refresh button forces).
    useEffect(() => {
        if (view === 'main' && tab === 'buy') {
            loadCatalog(category);
        }
    }, [view, tab, category]); // eslint-disable-line react-hooks/exhaustive-deps

    useEffect(() => {
        if (view === 'main' && tab === 'my' && myProxies === null && !myLoading) {
            loadMyProxies().catch(() => undefined);
            refreshLocalProxies();
        }
    }, [view, tab]); // eslint-disable-line react-hooks/exhaustive-deps

    useEffect(() => {
        setCountry('');
        setSearch('');
        setVisibleGroups(GROUPS_PAGE);
    }, [category]);

    useEffect(() => {
        setVisibleGroups(GROUPS_PAGE);
    }, [country, search]);

    // ---------------------------------------------------------------- derived

    const catalog = catalogs[category];

    const countryOptions = useMemo(() => {
        if (!catalog) return [] as { code: string; count: number }[];
        const counts = new Map<string, number>();
        for (const g of catalog.groups) {
            // Multi-country groups (e.g. "All Countries") would flood the list.
            if (g.country_codes.length > 10) continue;
            for (const c of g.country_codes) counts.set(c, (counts.get(c) || 0) + 1);
        }
        return [...counts.entries()]
            .map(([code, count]) => ({ code, count }))
            .sort((a, b) => countryName(a.code).localeCompare(countryName(b.code), 'ru'));
    }, [catalog]);

    const filteredGroups = useMemo(() => {
        if (!catalog) return [];
        const q = search.trim().toLowerCase();
        return catalog.groups.filter(g => {
            if (country && !g.country_codes.includes(country)) return false;
            if (q && !g.title.toLowerCase().includes(q) && !g.country_codes.some(c => countryName(c).toLowerCase().includes(q))) return false;
            return true;
        });
    }, [catalog, country, search]);

    const visibleMyProxies = useMemo(
        () => (myProxies || []).filter(p => showInactive || p.status === 'active' || p.status === 'pending'),
        [myProxies, showInactive],
    );
    const inactiveCount = (myProxies || []).filter(p => p.status === 'expired' || p.status === 'deleted').length;
    const importableProxies = (myProxies || []).filter(p => p.importable && p.proxy_str);

    // ---------------------------------------------------------------- actions

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
            showNotification('CyberYozh подключён', res.message, 'success');
        } catch (err) {
            showNotification(isThrottle(err) ? 'Подождите' : 'Ошибка', cleanError(err), isThrottle(err) ? 'warning' : 'error');
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
        setSelected(new Set());
        setSelectedOption({});
        setConfirm(null);
        setRotBase(null);
        setRotResult([]);
        setProvisioning(null);
        setTab('buy');
    };

    const openConfirm = (group: CyberYozhShopGroup, product: CyberYozhShopProduct) => {
        setConfirm({ group, product });
        setAutoRenew(false);
        setPromoCode('');
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
                    setSelected(prev => new Set([...prev, ...fresh.map(p => p.id)]));
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
            setTab('my');
            // Balance changed; the shop stock may have too.
            api.cyberyozhGetBalance(apiKey).then(setBalance).catch(() => undefined);
            refreshLocalProxies();
            pollForNewProxy(knownIds, purchasedAt);
        } catch (err) {
            showNotification(isThrottle(err) ? 'Подождите' : 'Покупка не удалась', cleanError(err), isThrottle(err) ? 'warning' : 'error', 9000);
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
            showNotification(res.imported > 0 ? 'Импорт завершён' : 'Импорт', parts.join(', '), res.failed ? 'warning' : 'success');
            if (res.imported > 0) onProxiesImported();
            await refreshLocalProxies();
        } catch (err) {
            showNotification('Ошибка импорта', cleanError(err), 'error');
        } finally {
            setImporting(false);
        }
    };

    const toImportItem = (p: CyberYozhMyProxy): CyberYozhImportItem => ({ proxy_str: p.proxy_str!, country: p.country ?? null });

    const handleImportSelected = () =>
        importItems(importableProxies.filter(p => selected.has(p.id)).map(toImportItem));

    const handleImportAll = () => importItems(importableProxies.map(toImportItem));

    const toggleSelect = (id: string) => {
        setSelected(prev => {
            const next = new Set(prev);
            if (next.has(id)) next.delete(id); else next.add(id);
            return next;
        });
    };

    const allSelectableSelected = importableProxies.length > 0 && importableProxies.every(p => selected.has(p.id));
    const toggleSelectAll = () => {
        setSelected(allSelectableSelected ? new Set() : new Set(importableProxies.map(p => p.id)));
    };

    const copyProxy = (p: CyberYozhMyProxy) => {
        if (!p.proxy_str) return;
        navigator.clipboard.writeText(p.proxy_str).then(
            () => showNotification('Скопировано', 'Строка прокси скопирована в буфер обмена', 'success', 2500),
            () => showNotification('Ошибка', 'Не удалось скопировать', 'error'),
        );
    };

    const openRotating = (p: CyberYozhMyProxy) => {
        setRotBase(p);
        setRotCountry('');
        setRotSession('random');
        setRotAmount(5);
        setRotResult([]);
    };

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
            showNotification(isThrottle(err) ? 'Подождите' : 'Ошибка', cleanError(err), isThrottle(err) ? 'warning' : 'error');
        } finally {
            setRotLoading(false);
        }
    };

    if (!isOpen) return null;

    // ---------------------------------------------------------------- styles

    const inputCls = 'w-full px-3.5 py-2.5 bg-[#0f0f0f] border border-[#2a2a2a] rounded-lg text-sm text-white placeholder-gray-600 focus:outline-none focus:border-emerald-500 focus:ring-1 focus:ring-emerald-500/20 transition-all';
    const selectCls = 'px-3 py-2 bg-[#0f0f0f] border border-[#2a2a2a] rounded-lg text-sm text-white focus:outline-none focus:border-emerald-500 focus:ring-1 focus:ring-emerald-500/20 transition-all';
    const labelCls = 'block text-[11px] font-semibold text-gray-500 mb-1.5 uppercase tracking-wider';
    const accentBtn = 'py-2.5 bg-emerald-600 hover:bg-emerald-500 active:bg-emerald-700 text-white rounded-lg text-sm font-medium transition-all disabled:opacity-40 disabled:cursor-not-allowed';
    const ghostBtn = 'px-3 py-2 bg-white/5 hover:bg-white/10 border border-white/10 text-gray-300 rounded-lg text-xs font-medium transition-all disabled:opacity-40 disabled:cursor-not-allowed';

    // ---------------------------------------------------------------- render

    const renderLogin = () => (
        <div className="px-6 py-8">
            <div className="max-w-sm mx-auto space-y-5">
                <div className="text-center mb-2">
                    <div className="w-14 h-14 rounded-2xl bg-emerald-500/10 border border-emerald-500/15 flex items-center justify-center mx-auto mb-4 text-2xl">
                        🦔
                    </div>
                    <h3 className="text-lg font-semibold text-white">Подключите CyberYozh</h3>
                    <p className="text-sm text-gray-500 mt-1">Покупайте мобильные, резидентские и датацентр прокси прямо из Antic</p>
                </div>

                <button
                    onClick={() => openExternal(CYBERYOZH_URL)}
                    className="w-full py-3 rounded-lg text-sm font-semibold text-white bg-gradient-to-r from-emerald-500 to-teal-500 hover:from-emerald-400 hover:to-teal-400 shadow-lg shadow-emerald-900/30 transition-all flex items-center justify-center gap-2"
                >
                    <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M15 7a2 2 0 012 2m4 0a6 6 0 01-7.743 5.743L11 17H9v2H7v2H4a1 1 0 01-1-1v-2.586a1 1 0 01.293-.707l5.964-5.964A6 6 0 1121 9z" /></svg>
                    Получить API ключ
                    <svg className="w-3.5 h-3.5 opacity-80" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M10 6H6a2 2 0 00-2 2v10a2 2 0 002 2h10a2 2 0 002-2v-4M14 4h6m0 0v6m0-6L10 14" /></svg>
                </button>
                <ol className="text-[11px] text-gray-500 space-y-1 leading-relaxed list-decimal list-inside">
                    <li>Зарегистрируйтесь на CyberYozh и пополните баланс</li>
                    <li>Создайте API ключ в настройках профиля</li>
                    <li>Вставьте ключ ниже</li>
                </ol>

                <div className="flex items-center gap-3">
                    <div className="h-px flex-1 bg-[#252525]" />
                    <span className="text-[10px] uppercase tracking-wider text-gray-600">уже есть ключ</span>
                    <div className="h-px flex-1 bg-[#252525]" />
                </div>

                <div>
                    <label className={labelCls}>API ключ</label>
                    <input
                        type="password"
                        value={apiKey}
                        onChange={e => setApiKey(e.target.value)}
                        onKeyDown={e => e.key === 'Enter' && handleLogin()}
                        placeholder="Вставьте ключ..."
                        className={inputCls}
                        autoFocus
                    />
                </div>
                <button onClick={handleLogin} disabled={loggingIn || !apiKey.trim()} className={`w-full ${accentBtn}`}>
                    {loggingIn ? <span className="flex items-center justify-center gap-2"><Spinner />Проверка...</span> : 'Подключить'}
                </button>
            </div>
        </div>
    );

    const renderGroup = (group: CyberYozhShopGroup) => {
        const options = group.products;
        const firstInStock = options.find(p => p.in_stock);
        const selId = selectedOption[group.key] && options.some(p => p.id === selectedOption[group.key] && p.in_stock)
            ? selectedOption[group.key]
            : firstInStock?.id;
        const sel = options.find(p => p.id === selId);
        const protocols = [...new Set(options.flatMap(p => p.protocols))];
        const multiCountry = group.country_codes.length > 3;
        const price = sel ? effectivePrice(sel) : 0;
        const notEnough = sel && !isNaN(balanceNum) && balanceNum < price;

        return (
            <div key={group.key} className={`border rounded-xl p-4 transition-all ${group.in_stock ? 'border-[#252525] bg-[#1a1a1a] hover:border-[#333]' : 'border-[#202020] bg-[#151515] opacity-60'}`}>
                <div className="flex items-start justify-between gap-3">
                    <div className="min-w-0">
                        <h4 className="text-sm font-semibold text-white leading-snug break-words">{group.title}</h4>
                        <div className="flex flex-wrap items-center gap-1.5 mt-1.5">
                            {multiCountry ? (
                                <span className="text-[11px] text-gray-400">{group.country_codes.length} стран</span>
                            ) : group.country_codes.map(c => (
                                <span key={c} className="inline-flex items-center gap-1 text-[11px] text-gray-400">
                                    <CountryBadge code={c} />{countryName(c)}
                                </span>
                            ))}
                            {accessLabel(group.access_type) && (
                                <span className="text-[10px] px-1.5 py-0.5 rounded bg-sky-500/10 text-sky-300 border border-sky-500/20">{accessLabel(group.access_type)}</span>
                            )}
                            {protocols.map(pr => (
                                <span key={pr} className="text-[10px] px-1.5 py-0.5 rounded bg-white/5 text-gray-400 border border-white/10 uppercase">{pr}</span>
                            ))}
                        </div>
                    </div>
                    {group.min_price_per_day != null && (
                        <div className="text-right shrink-0">
                            <div className="text-[10px] text-gray-500 uppercase tracking-wider">от</div>
                            <div className="text-sm font-semibold text-emerald-400">{money(group.min_price_per_day)}<span className="text-[11px] text-gray-500 font-normal">/день</span></div>
                        </div>
                    )}
                </div>

                <div className="flex flex-wrap gap-1.5 mt-3">
                    {options.map(p => {
                        const active = p.id === selId;
                        return (
                            <button
                                key={p.id}
                                disabled={!p.in_stock}
                                onClick={() => setSelectedOption(prev => ({ ...prev, [group.key]: p.id }))}
                                title={p.in_stock ? p.title : 'Нет в наличии'}
                                className={`px-2.5 py-1.5 rounded-lg border text-xs transition-all text-left ${
                                    !p.in_stock
                                        ? 'border-[#222] text-gray-600 line-through cursor-not-allowed'
                                        : active
                                            ? 'border-emerald-500/60 bg-emerald-500/10 text-white'
                                            : 'border-[#2a2a2a] text-gray-300 hover:border-[#3a3a3a] hover:bg-white/5'
                                }`}
                            >
                                <span className="font-medium">{productOptionLabel(p)}</span>
                                <span className={`ml-1.5 ${active ? 'text-emerald-300' : 'text-gray-500'}`}>{money(effectivePrice(p))}</span>
                            </button>
                        );
                    })}
                </div>

                <div className="flex items-center justify-between gap-3 mt-3 pt-3 border-t border-[#222]">
                    <div className="text-[11px] text-gray-500 min-w-0">
                        {sel ? (
                            <>
                                {trafficLabel(sel.traffic_limit_mb)} трафика
                                {sel.days ? ` · ${daysLabel(sel.days)}` : ''}
                                {sel.price_per_day != null && !sel.traffic_limit_mb ? ` · ${money(sel.price_per_day)}/день` : ''}
                            </>
                        ) : 'Нет в наличии'}
                    </div>
                    <button
                        disabled={!sel || !!notEnough}
                        onClick={() => sel && openConfirm(group, sel)}
                        title={notEnough ? 'Недостаточно средств на балансе' : undefined}
                        className="shrink-0 px-4 py-2 bg-emerald-600 hover:bg-emerald-500 text-white rounded-lg text-xs font-semibold transition-all disabled:opacity-40 disabled:cursor-not-allowed"
                    >
                        {!sel ? 'Нет в наличии' : notEnough ? `Не хватает ${money(price - balanceNum)}` : `Купить за ${money(price)}`}
                    </button>
                </div>
            </div>
        );
    };

    const renderBuy = () => (
        <div className="px-6 py-4 space-y-4">
            {/* Category pills */}
            <div className="flex flex-wrap gap-1.5">
                {CATEGORIES.map(c => (
                    <button
                        key={c.key}
                        onClick={() => setCategory(c.key)}
                        title={c.hint}
                        className={`px-3 py-1.5 rounded-lg text-xs font-medium border transition-all ${
                            category === c.key
                                ? 'bg-emerald-500/15 border-emerald-500/40 text-emerald-300'
                                : 'bg-transparent border-[#2a2a2a] text-gray-400 hover:text-gray-200 hover:border-[#3a3a3a]'
                        }`}
                    >
                        {c.label}
                    </button>
                ))}
            </div>

            {/* Filters */}
            <div className="flex flex-wrap items-center gap-2">
                <select value={country} onChange={e => setCountry(e.target.value)} className={`${selectCls} min-w-[180px]`} disabled={!catalog || countryOptions.length === 0}>
                    <option value="">Все страны{catalog ? ` (${catalog.groups.length})` : ''}</option>
                    {countryOptions.map(c => (
                        <option key={c.code} value={c.code}>{countryName(c.code)} ({c.count})</option>
                    ))}
                </select>
                <input
                    value={search}
                    onChange={e => setSearch(e.target.value)}
                    placeholder="Поиск: оператор, город..."
                    className={`${selectCls} flex-1 min-w-[160px] placeholder-gray-600`}
                />
                <button onClick={() => loadCatalog(category, true)} disabled={shopLoading} className={ghostBtn} title="Обновить каталог">
                    {shopLoading ? <Spinner className="w-3.5 h-3.5" /> : (
                        <svg className="w-3.5 h-3.5" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M4 4v5h.582m15.356 2A8.001 8.001 0 004.582 9m0 0H9m11 11v-5h-.581m0 0a8.003 8.003 0 01-15.357-2m15.357 2H15" /></svg>
                    )}
                </button>
            </div>

            <p className="text-[11px] text-gray-600 -mt-1">{CATEGORIES.find(c => c.key === category)?.hint}</p>

            {catalog && !catalog.complete && (
                <div className="text-[11px] text-amber-300/80 bg-amber-500/5 border border-amber-500/20 rounded-lg px-3 py-2">
                    Загружена часть каталога ({catalog.groups.length} из {catalog.total}). Обновите позже, чтобы увидеть всё.
                </div>
            )}

            {/* Content */}
            {shopLoading && !catalog ? (
                <StateBox icon="loading" title="Загружаем каталог..." text="Получаем товары в наличии" />
            ) : shopError && !catalog ? (
                <StateBox
                    icon="error"
                    title="Не удалось загрузить каталог"
                    text={shopError}
                    action={<button onClick={() => loadCatalog(category, true)} className={ghostBtn}>Повторить</button>}
                />
            ) : catalog && filteredGroups.length === 0 ? (
                <StateBox
                    icon="empty"
                    title={catalog.groups.length === 0 ? 'Нет товаров в наличии' : 'Ничего не найдено'}
                    text={catalog.groups.length === 0 ? 'В этой категории сейчас нет прокси в наличии. Попробуйте другую категорию.' : 'Измените страну или поисковый запрос.'}
                    action={catalog.groups.length === 0 ? (
                        <button onClick={() => openExternal(CYBERYOZH_URL)} className={ghostBtn}>Открыть каталог CyberYozh</button>
                    ) : undefined}
                />
            ) : catalog ? (
                <>
                    {shopError && (
                        <div className="text-[11px] text-red-300/80 bg-red-500/5 border border-red-500/20 rounded-lg px-3 py-2">{shopError}</div>
                    )}
                    <div className="space-y-2.5">
                        {filteredGroups.slice(0, visibleGroups).map(renderGroup)}
                    </div>
                    {filteredGroups.length > visibleGroups && (
                        <button onClick={() => setVisibleGroups(v => v + GROUPS_PAGE)} className={`w-full ${ghostBtn} py-2.5`}>
                            Показать ещё ({filteredGroups.length - visibleGroups})
                        </button>
                    )}
                </>
            ) : null}
        </div>
    );

    const renderMyProxy = (p: CyberYozhMyProxy) => {
        const st = STATUS_STYLES[p.status] || STATUS_STYLES.expired;
        const imported = !!p.proxy_str && localProxyStrs.has(p.proxy_str);
        const isRotating = p.category === 'residential_rotating';
        const dim = p.status === 'expired' || p.status === 'deleted';
        return (
            <div
                key={p.id}
                className={`flex items-start gap-3 border rounded-xl px-4 py-3 transition-all ${
                    selected.has(p.id) ? 'border-emerald-500/40 bg-emerald-500/5' : 'border-[#252525] bg-[#1a1a1a]'
                } ${dim ? 'opacity-55' : ''}`}
            >
                <input
                    type="checkbox"
                    className="mt-1 w-4 h-4 accent-emerald-500 cursor-pointer disabled:cursor-not-allowed"
                    checked={selected.has(p.id)}
                    disabled={!p.importable}
                    onChange={() => toggleSelect(p.id)}
                />
                <div className="flex-1 min-w-0">
                    <div className="flex flex-wrap items-center gap-1.5">
                        <span className={`text-[10px] px-1.5 py-0.5 rounded border font-medium ${st.cls}`}>{st.label}</span>
                        <span className="text-xs font-medium text-gray-200">{categoryLabel(p.category, p.access_type)}</span>
                        {accessLabel(p.access_type) && <span className="text-[10px] text-gray-500">· {accessLabel(p.access_type)}</span>}
                        {p.country && <span className="inline-flex items-center gap-1 text-[11px] text-gray-400"><CountryBadge code={p.country} />{countryName(p.country)}</span>}
                        {imported && <span className="text-[10px] px-1.5 py-0.5 rounded bg-sky-500/10 text-sky-300 border border-sky-500/20">В Antic</span>}
                    </div>
                    <p className="text-[13px] font-mono text-gray-300 mt-1 truncate">
                        {p.display || (p.status === 'pending' ? 'Доступы ещё не выданы' : '—')}
                    </p>
                    <p className="text-[11px] text-gray-500 mt-0.5">
                        {p.access_expires_at ? <>До {formatDate(p.access_expires_at)} <span className="text-gray-600">({relativeExpiry(p.access_expires_at)})</span></> : 'Срок не указан'}
                        {p.traffic_remains != null && (p.traffic_remains < 0 ? <> · безлимит трафика</> : <> · осталось {bytesLabel(p.traffic_remains)}</>)}
                    </p>
                </div>
                <div className="flex items-center gap-1 shrink-0">
                    {isRotating && p.importable && (
                        <button onClick={() => openRotating(p)} className="px-2.5 py-1.5 text-[11px] text-emerald-300 hover:bg-emerald-500/10 rounded-md transition-all" title="Сгенерировать доступы с выбором страны и сессии">
                            Доступы
                        </button>
                    )}
                    {p.proxy_str && !dim && (
                        <button onClick={() => copyProxy(p)} className="p-1.5 text-gray-500 hover:text-white hover:bg-white/5 rounded-md transition-all" title="Копировать строку прокси">
                            <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.8} d="M8 16H6a2 2 0 01-2-2V6a2 2 0 012-2h8a2 2 0 012 2v2m-6 12h8a2 2 0 002-2v-8a2 2 0 00-2-2h-8a2 2 0 00-2 2v8a2 2 0 002 2z" /></svg>
                        </button>
                    )}
                </div>
            </div>
        );
    };

    const renderMy = () => (
        <div className="px-6 py-4 space-y-3">
            {provisioning && (
                <div className="flex items-center gap-3 text-xs text-amber-200/90 bg-amber-500/5 border border-amber-500/20 rounded-lg px-3 py-2.5">
                    <Spinner className="w-4 h-4 text-amber-400" />
                    <span>Ожидаем выдачу прокси от CyberYozh… проверка {provisioning.attempt} из {provisioning.total}</span>
                </div>
            )}

            <div className="flex flex-wrap items-center gap-2">
                <label className="flex items-center gap-2 text-xs text-gray-400 cursor-pointer select-none">
                    <input type="checkbox" className="w-4 h-4 accent-emerald-500" checked={allSelectableSelected} disabled={importableProxies.length === 0} onChange={toggleSelectAll} />
                    Выбрать все активные
                </label>
                <div className="flex-1" />
                {inactiveCount > 0 && (
                    <button onClick={() => setShowInactive(v => !v)} className="text-[11px] text-gray-500 hover:text-gray-300 transition-colors">
                        {showInactive ? 'Скрыть истёкшие' : `Показать истёкшие (${inactiveCount})`}
                    </button>
                )}
                <button onClick={() => { loadMyProxies().catch(() => undefined); refreshLocalProxies(); }} disabled={myLoading} className={`${ghostBtn} flex items-center gap-1.5`}>
                    {myLoading ? <Spinner className="w-3.5 h-3.5" /> : (
                        <svg className="w-3.5 h-3.5" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M4 4v5h.582m15.356 2A8.001 8.001 0 004.582 9m0 0H9m11 11v-5h-.581m0 0a8.003 8.003 0 01-15.357-2m15.357 2H15" /></svg>
                    )}
                    Обновить
                </button>
            </div>

            {myLoading && myProxies === null ? (
                <StateBox icon="loading" title="Загружаем ваши прокси..." />
            ) : myError && myProxies === null ? (
                <StateBox icon="error" title="Не удалось загрузить прокси" text={myError}
                    action={<button onClick={() => loadMyProxies().catch(() => undefined)} className={ghostBtn}>Повторить</button>} />
            ) : myProxies && visibleMyProxies.length === 0 ? (
                <StateBox
                    icon="empty"
                    title={myProxies.length === 0 ? 'У вас пока нет прокси' : 'Нет активных прокси'}
                    text={myProxies.length === 0 ? 'Купите прокси во вкладке «Купить» — он появится здесь.' : `Истёкших прокси: ${inactiveCount}. Продлить их можно в личном кабинете CyberYozh.`}
                    action={<button onClick={() => setTab('buy')} className={ghostBtn}>Перейти к покупке</button>}
                />
            ) : (
                <>
                    {myError && <div className="text-[11px] text-red-300/80 bg-red-500/5 border border-red-500/20 rounded-lg px-3 py-2">{myError}</div>}
                    <div className="space-y-2">{visibleMyProxies.map(renderMyProxy)}</div>
                </>
            )}
        </div>
    );

    const renderConfirm = () => {
        if (!confirm) return null;
        const { group, product } = confirm;
        const price = effectivePrice(product);
        const hasBalance = !isNaN(balanceNum);
        const after = hasBalance ? balanceNum - price : NaN;
        return (
            <div className="absolute inset-0 bg-black/70 backdrop-blur-[1px] flex items-center justify-center p-6 z-10" onClick={() => !buying && setConfirm(null)}>
                <div className="bg-[#1a1a1a] border border-[#2a2a2a] rounded-xl w-full max-w-md p-5 shadow-2xl" onClick={e => e.stopPropagation()}>
                    <h3 className="text-base font-semibold text-white">Подтверждение покупки</h3>
                    <p className="text-xs text-gray-500 mt-1">Средства будут списаны с баланса CyberYozh</p>

                    <div className="mt-4 rounded-lg border border-[#252525] bg-[#141414] divide-y divide-[#222] text-sm">
                        <div className="px-4 py-3">
                            <div className="text-white font-medium break-words">{group.title}</div>
                            <div className="text-[11px] text-gray-500 mt-0.5">{categoryLabel(product.category, group.access_type)}{accessLabel(group.access_type) ? ` · ${accessLabel(group.access_type)}` : ''}</div>
                        </div>
                        <div className="px-4 py-2.5 flex justify-between"><span className="text-gray-500">Срок</span><span className="text-gray-200">{daysLabel(product.days) || '—'}</span></div>
                        <div className="px-4 py-2.5 flex justify-between"><span className="text-gray-500">Трафик</span><span className="text-gray-200">{trafficLabel(product.traffic_limit_mb)}</span></div>
                        {product.protocols.length > 0 && (
                            <div className="px-4 py-2.5 flex justify-between"><span className="text-gray-500">Протоколы</span><span className="text-gray-200 uppercase">{product.protocols.join(', ')}</span></div>
                        )}
                        <div className="px-4 py-2.5 flex justify-between items-baseline">
                            <span className="text-gray-500">Цена</span>
                            <span className="text-lg font-semibold text-emerald-400">
                                {product.discounted_price != null && product.discounted_price > 0 && product.discounted_price < product.price_usd && (
                                    <span className="text-xs text-gray-600 line-through mr-2">{money(product.price_usd)}</span>
                                )}
                                {money(price)}
                            </span>
                        </div>
                        <div className="px-4 py-2.5 flex justify-between"><span className="text-gray-500">Баланс</span><span className="text-gray-200">{hasBalance ? money(balanceNum) : '—'}</span></div>
                        {hasBalance && (
                            <div className="px-4 py-2.5 flex justify-between"><span className="text-gray-500">После покупки</span><span className={after < 0 ? 'text-red-400' : 'text-gray-200'}>{money(after)}</span></div>
                        )}
                    </div>

                    <div className="mt-4 space-y-3">
                        <label className={`flex items-center gap-2 text-xs ${product.auto_renew_possible ? 'text-gray-300 cursor-pointer' : 'text-gray-600 cursor-not-allowed'}`}>
                            <input type="checkbox" className="w-4 h-4 accent-emerald-500" checked={autoRenew && product.auto_renew_possible} disabled={!product.auto_renew_possible} onChange={e => setAutoRenew(e.target.checked)} />
                            Автопродление{!product.auto_renew_possible && ' (недоступно для этого тарифа)'}
                        </label>
                        <input value={promoCode} onChange={e => setPromoCode(e.target.value)} placeholder="Промокод (необязательно)" className={inputCls} />
                    </div>

                    {hasBalance && after < 0 && (
                        <p className="mt-3 text-[11px] text-red-300/90">
                            Недостаточно средств.{' '}
                            <button onClick={() => openExternal(CYBERYOZH_URL)} className="underline hover:text-red-200">Пополнить баланс</button>
                        </p>
                    )}

                    <div className="flex gap-2 mt-5">
                        <button onClick={() => setConfirm(null)} disabled={buying} className="flex-1 py-2.5 bg-white/5 hover:bg-white/10 border border-white/10 text-gray-300 rounded-lg text-sm font-medium transition-all disabled:opacity-40">
                            Отмена
                        </button>
                        <button onClick={handleBuy} disabled={buying || (hasBalance && after < 0)} className={`flex-1 ${accentBtn}`}>
                            {buying ? <span className="flex items-center justify-center gap-2"><Spinner />Покупка...</span> : `Оплатить ${money(price)}`}
                        </button>
                    </div>
                </div>
            </div>
        );
    };

    const renderRotating = () => {
        if (!rotBase) return null;
        return (
            <div className="absolute inset-0 bg-black/70 backdrop-blur-[1px] flex items-center justify-center p-6 z-10" onClick={() => !rotLoading && setRotBase(null)}>
                <div className="bg-[#1a1a1a] border border-[#2a2a2a] rounded-xl w-full max-w-md p-5 shadow-2xl max-h-full overflow-y-auto" onClick={e => e.stopPropagation()}>
                    <h3 className="text-base font-semibold text-white">Доступы ротационного прокси</h3>
                    <p className="text-xs text-gray-500 mt-1">Сгенерируйте логины с нужной страной и типом сессии</p>

                    <div className="mt-4 space-y-3">
                        <div>
                            <label className={labelCls}>Страна</label>
                            <select value={rotCountry} onChange={e => setRotCountry(e.target.value)} className={`${selectCls} w-full`}>
                                <option value="">Любая</option>
                                {POPULAR_COUNTRIES.map(c => <option key={c} value={c}>{countryName(c)}</option>)}
                            </select>
                        </div>
                        <div>
                            <label className={labelCls}>Тип сессии</label>
                            <select value={rotSession} onChange={e => setRotSession(e.target.value as typeof rotSession)} className={`${selectCls} w-full`}>
                                {SESSION_TYPES.map(s => <option key={s.value} value={s.value}>{s.label}</option>)}
                            </select>
                        </div>
                        <div>
                            <label className={labelCls}>Количество</label>
                            <input type="number" min={1} max={100} value={rotAmount} onChange={e => setRotAmount(Math.max(1, Math.min(100, parseInt(e.target.value) || 1)))} className={inputCls} />
                        </div>
                    </div>

                    {rotResult.length > 0 && (
                        <div className="mt-4 rounded-lg border border-[#252525] bg-[#141414] max-h-40 overflow-y-auto divide-y divide-[#222]">
                            {rotResult.map((r, i) => (
                                <div key={i} className="px-3 py-1.5 text-[12px] font-mono text-gray-300 truncate">{r.display}</div>
                            ))}
                        </div>
                    )}

                    <div className="flex gap-2 mt-5">
                        <button onClick={() => setRotBase(null)} disabled={rotLoading} className="flex-1 py-2.5 bg-white/5 hover:bg-white/10 border border-white/10 text-gray-300 rounded-lg text-sm font-medium transition-all disabled:opacity-40">
                            Закрыть
                        </button>
                        {rotResult.length > 0 ? (
                            <button
                                onClick={() => importItems(rotResult.map(r => ({ proxy_str: r.proxy_str, country: r.country ?? null })))}
                                disabled={importing}
                                className={`flex-1 ${accentBtn}`}
                            >
                                {importing ? 'Импорт...' : `Импортировать (${rotResult.length})`}
                            </button>
                        ) : (
                            <button onClick={handleGenerateRotating} disabled={rotLoading} className={`flex-1 ${accentBtn}`}>
                                {rotLoading ? <span className="flex items-center justify-center gap-2"><Spinner />Генерация...</span> : 'Сгенерировать'}
                            </button>
                        )}
                    </div>
                </div>
            </div>
        );
    };

    const selectedImportable = importableProxies.filter(p => selected.has(p.id)).length;

    return (
        <div className="fixed inset-0 bg-black/60 backdrop-blur-[2px] flex items-center justify-center z-50 p-4" onClick={() => !buying && onClose()}>
            <div
                className="relative bg-[#161616] border border-[#252525] rounded-xl shadow-2xl shadow-black/50 w-full max-w-[820px] max-h-[88vh] flex flex-col overflow-hidden"
                onClick={e => e.stopPropagation()}
            >
                {/* Header */}
                <div className="flex items-center justify-between px-6 py-4 border-b border-[#222] bg-[#1a1a1a]">
                    <div className="flex items-center gap-3">
                        <div className="w-8 h-8 rounded-lg bg-emerald-500/10 border border-emerald-500/20 flex items-center justify-center text-base">🦔</div>
                        <div>
                            <h2 className="text-[15px] font-semibold text-white leading-tight">CyberYozh</h2>
                            <p className="text-xs text-gray-500 mt-0.5">{view === 'login' ? 'Подключение к сервису' : 'Магазин прокси'}</p>
                        </div>
                    </div>
                    <div className="flex items-center gap-1">
                        {view === 'main' && (
                            <>
                                <div className="flex items-center gap-1.5 mr-1 pl-3 pr-1.5 py-1 rounded-lg bg-[#111] border border-[#252525]">
                                    <span className="text-[11px] text-gray-500">Баланс</span>
                                    <span className="text-sm font-semibold text-emerald-400">{balance != null ? `$${balance}` : '—'}</span>
                                    <button onClick={refreshBalance} disabled={balanceLoading} className="p-1 text-gray-500 hover:text-white rounded transition-colors disabled:opacity-40" title="Обновить баланс">
                                        {balanceLoading ? <Spinner className="w-3 h-3" /> : (
                                            <svg className="w-3 h-3" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M4 4v5h.582m15.356 2A8.001 8.001 0 004.582 9m0 0H9m11 11v-5h-.581m0 0a8.003 8.003 0 01-15.357-2m15.357 2H15" /></svg>
                                        )}
                                    </button>
                                </div>
                                <button onClick={() => openExternal(CYBERYOZH_URL)} className="px-2.5 py-1.5 text-[11px] text-gray-500 hover:text-white hover:bg-white/5 rounded-md transition-all">
                                    Пополнить
                                </button>
                                <button onClick={handleLogout} className="px-2.5 py-1.5 text-[11px] text-gray-500 hover:text-red-400 hover:bg-red-500/5 rounded-md transition-all">
                                    Выйти
                                </button>
                            </>
                        )}
                        <button onClick={onClose} disabled={buying} className="ml-1 text-gray-500 hover:text-white transition-colors p-1.5 hover:bg-white/5 rounded-md disabled:opacity-40">
                            <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" /></svg>
                        </button>
                    </div>
                </div>

                {view === 'main' && (
                    <div className="px-6 pt-4">
                        <div className="flex gap-0.5 bg-[#111] p-1 rounded-lg">
                            {([
                                ['buy', 'Купить', 'M3 3h2l.4 2M7 13h10l4-8H5.4M7 13L5.4 5M7 13l-2.293 2.293c-.63.63-.184 1.707.707 1.707H17m0 0a2 2 0 100 4 2 2 0 000-4zm-8 2a2 2 0 11-4 0 2 2 0 014 0z'],
                                ['my', `Мои прокси${myProxies ? ` (${importableProxies.length})` : ''}`, 'M5 12h14M5 12a2 2 0 01-2-2V6a2 2 0 012-2h14a2 2 0 012 2v4a2 2 0 01-2 2M5 12a2 2 0 00-2 2v4a2 2 0 002 2h14a2 2 0 002-2v-4a2 2 0 00-2-2m-2-4h.01M17 16h.01'],
                            ] as const).map(([key, label, icon]) => (
                                <button
                                    key={key}
                                    onClick={() => setTab(key)}
                                    className={`flex-1 flex items-center justify-center gap-1.5 py-2 rounded-md text-[13px] font-medium transition-all ${
                                        tab === key ? 'bg-[#1e1e1e] text-white shadow-sm' : 'text-gray-500 hover:text-gray-300'
                                    }`}
                                >
                                    <svg className="w-3.5 h-3.5" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.8} d={icon} /></svg>
                                    {label}
                                </button>
                            ))}
                        </div>
                    </div>
                )}

                <div className="overflow-y-auto flex-1">
                    {view === 'login' && renderLogin()}
                    {view === 'main' && tab === 'buy' && renderBuy()}
                    {view === 'main' && tab === 'my' && renderMy()}
                </div>

                {view === 'main' && tab === 'my' && myProxies && myProxies.length > 0 && (
                    <div className="flex gap-2 px-6 py-3 border-t border-[#222] bg-[#1a1a1a]">
                        <button onClick={handleImportSelected} disabled={importing || selectedImportable === 0} className={`flex-1 ${accentBtn}`}>
                            {importing ? 'Импорт...' : `Импортировать выбранные (${selectedImportable})`}
                        </button>
                        <button onClick={handleImportAll} disabled={importing || importableProxies.length === 0} className="flex-1 py-2.5 bg-white/5 hover:bg-white/10 border border-white/10 text-gray-200 rounded-lg text-sm font-medium transition-all disabled:opacity-40 disabled:cursor-not-allowed">
                            Импортировать все активные ({importableProxies.length})
                        </button>
                    </div>
                )}

                {renderConfirm()}
                {renderRotating()}
            </div>
        </div>
    );
}
