import { useState, useEffect, useMemo } from 'react';
import { useNotification } from '../utils/notifications';
import * as api from '../api';
import { openExternal } from '../utils/external';
import { tauriFetch } from '../utils/http';
import type { CyberYozhShopItem, CyberYozhProxyItem } from '../types';

interface CyberYozhModalProps {
    isOpen: boolean;
    onClose: () => void;
    onProxiesImported: () => void;
}

type MainTab = 'mobile' | 'residential' | 'datacenter';
type SubTab = 'dedicated' | 'shared';

interface CardOption {
    id: string;
    days: number;
    price: number;
    trafficGb: number;          // -1 = unlimited
    stockStatus: string;
}

interface CardGroup {
    title: string;
    countryCode: string;
    resolvedMainTab: MainTab;
    badge: { text: string; color: string } | null;
    features: string[];
    options: CardOption[];
}

// ────── helpers ──────

function countryFlag(code: string): string {
    if (!code || code.length < 2) return '🌍';
    const cc = code.substring(0, 2).toUpperCase();
    return String.fromCodePoint(...cc.split('').map(c => 0x1F1E6 + c.charCodeAt(0) - 65));
}

/** Human‑readable option label like on the CyberYozh website */
function optionLabel(opt: CardOption): string {
    // Duration part
    let dur: string;
    if (opt.days <= 0) dur = '∞';
    else if (opt.days === 1) dur = '1 День';
    else if (opt.days <= 4) dur = `${opt.days} Дня`;
    else if (opt.days < 30) dur = `${opt.days} Дней`;
    else {
        const m = Math.round(opt.days / 30);
        if (m <= 1) dur = '1 Месяц';
        else if (m <= 4) dur = `${m} Месяца`;
        else dur = `${m} Месяцев`;
    }
    // Traffic part
    const traf = opt.trafficGb < 0 ? '∞ GB' : `${opt.trafficGb} GB`;
    return `${dur} / ${traf} / $${opt.price.toFixed(2)}`;
}

/** Classify an item into a MainTab based on proxy_category from API.
 *  Known API values: "lte" (mobile), "datacenter_dedicated", "residential_static", "residential_rotating", etc.
 */
function resolveMainTab(item: CyberYozhShopItem): MainTab {
    const cat = (item.proxy_category || '').toLowerCase().trim();

    // Mobile: "lte", "mobile", "mobile_dedicated", "mobile_shared", "5g", "4g"
    if (cat.includes('lte') || cat.includes('mobile') || cat.includes('5g') || cat.includes('4g')) {
        return 'mobile';
    }
    // Residential: "residential_static", "residential_rotating", "residential_dedicated", "isp"
    if (cat.includes('residential') || cat.includes('isp')) {
        return 'residential';
    }
    // Datacenter: "datacenter_dedicated", "datacenter_shared", "datacenter"
    if (cat.includes('datacenter')) {
        return 'datacenter';
    }

    // Fallback: try to detect from title keywords
    const title = (item.title || '').toLowerCase();
    if (/5g|4g|lte|mobile|t-mobile|verizon|at&t|мобил/.test(title)) return 'mobile';
    if (/residential|резидент|isp/.test(title)) return 'residential';
    if (/datacenter|датацентр|дата.центр/.test(title)) return 'datacenter';

    console.warn('[CyberYozh] Unknown proxy_category:', item.proxy_category, 'title:', item.title);
    return 'datacenter'; // safe default for truly unknown
}

/** Classify into SubTab based on proxy_category.
 *  "shared"/"rotating" → shared; everything else → dedicated.
 */
function resolveSubTab(item: CyberYozhShopItem): SubTab {
    const cat = (item.proxy_category || '').toLowerCase().trim();
    if (cat.includes('shared') || cat.includes('rotating')) return 'shared';
    // Also check title for shared/rotating hints
    const title = (item.title || '').toLowerCase();
    if (title.includes('shared') || title.includes('rotating') || title.includes('общ') || title.includes('ротац')) return 'shared';
    return 'dedicated';
}

/** Features differ by category — mirroring CyberYozh website exactly */
function buildFeatures(main: MainTab, item: CyberYozhShopItem): string[] {
    const unlimited = !item.traffic_limitation || item.traffic_limitation < 0;
    switch (main) {
        case 'mobile':
            return [
                'Dedicated Mobile Router',
                'SOCKS5 / VPN with DNS',
                'Manual IP Changing',
                'High Trust Rate',
                'Very High Speed + Low Ping',
                'UDP Support',
                unlimited ? 'Unlimited Traffic' : `${Math.round((item.traffic_limitation || 0) / 1024)} GB Traffic`,
            ];
        case 'residential':
            return [
                '24h Availability',
                'Real ISP',
                'Speed up to 150 Mbps',
                'Low Ping',
                'Supports SOCKS5 with UDP',
                unlimited ? 'Unlimited Bandwidth' : `${Math.round((item.traffic_limitation || 0) / 1024)} GB Traffic`,
                'Dedicated IP',
            ];
        case 'datacenter':
        default:
            return [
                'Exclusive IP ownership',
                'High-speed connectivity',
                '99.9% uptime',
                unlimited ? 'Unlimited bandwidth' : `${Math.round((item.traffic_limitation || 0) / 1024)} GB Traffic`,
                (item.proxy_protocol || 'HTTP').toUpperCase(),
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

// Labels for subtabs per main tab (matches CyberYozh website)
const SUB_TAB_LABELS: Record<MainTab, Record<SubTab, string>> = {
    mobile:      { dedicated: 'Выделенные',   shared: 'Общие'      },
    residential: { dedicated: 'Статические',  shared: 'Ротационные' },
    datacenter:  { dedicated: 'Выделенные',   shared: 'Общие'      },
};

export default function CyberYozhModal({ isOpen, onClose, onProxiesImported }: CyberYozhModalProps) {
    const { showNotification } = useNotification();
    const [view, setView] = useState<'login' | 'main' | 'shop' | 'import'>('login');
    const [apiKey, setApiKey] = useState('');
    const [balance, setBalance] = useState('0.00');
    const [loading, setLoading] = useState(false);

    // Shop state
    const [shopItems, setShopItems] = useState<CyberYozhShopItem[]>([]);
    const [mainTab, setMainTab] = useState<MainTab>('mobile');
    const [subTab, setSubTab] = useState<SubTab>('dedicated');
    const [selectedOptions, setSelectedOptions] = useState<Record<string, string>>({});
    const [buyingId, setBuyingId] = useState<string | null>(null);

    // Import state
    const [myProxies, setMyProxies] = useState<CyberYozhProxyItem[]>([]);
    const [selectedProxies, setSelectedProxies] = useState<Set<string>>(new Set());

    useEffect(() => {
        if (isOpen && view === 'login') {
            const saved = localStorage.getItem('cyberyozh_api_key');
            if (saved) setApiKey(saved);
        }
    }, [isOpen, view]);

    // Group products into cards — group by parent category (group_title) so products become dropdown options
    const cardGroups = useMemo(() => {
        const filtered = shopItems.filter(item => {
            const m = resolveMainTab(item);
            const s = resolveSubTab(item);
            return m === mainTab && s === subTab;
        });

        const groups: Record<string, CardGroup> = {};
        for (const item of filtered) {
            // Group by parent group title (set during Rust flatten),
            // falling back to product title if group_title not available
            const key = item.group_title || item.title || 'Unknown';
            if (!groups[key]) {
                const main = resolveMainTab(item);
                const cc = item.location_country_code
                    ? item.location_country_code.split(',')[0].trim()
                    : '';
                groups[key] = {
                    title: item.group_title || item.title,
                    countryCode: cc,
                    resolvedMainTab: main,
                    badge: resolveBadge(main),
                    features: buildFeatures(main, item),
                    options: [],
                };
            }
            const trafficGb = !item.traffic_limitation || item.traffic_limitation < 0
                ? -1
                : Math.round(item.traffic_limitation / 1024);
            groups[key].options.push({
                id: item.id,
                days: item.days || 30,
                price: item.price_usd ? parseFloat(item.price_usd) : 0,
                trafficGb,
                stockStatus: item.stock_status || 'in_stock',
            });
        }

        for (const g of Object.values(groups)) {
            g.options.sort((a, b) => a.days - b.days || a.price - b.price);
        }
        return Object.values(groups);
    }, [shopItems, mainTab, subTab]);

    // Which tabs actually have products
    const availableTabs = useMemo(() => {
        const tabs: Record<MainTab, Record<SubTab, boolean>> = {
            mobile: { dedicated: false, shared: false },
            residential: { dedicated: false, shared: false },
            datacenter: { dedicated: false, shared: false },
        };
        for (const item of shopItems) {
            const m = resolveMainTab(item);
            const s = resolveSubTab(item);
            tabs[m][s] = true;
        }
        return tabs;
    }, [shopItems]);

    // Auto-select first available main tab (with products) when shop loads
    useEffect(() => {
        if (shopItems.length === 0) return;
        const priority: MainTab[] = ['mobile', 'residential', 'datacenter'];
        for (const m of priority) {
            if (availableTabs[m].dedicated || availableTabs[m].shared) {
                setMainTab(m);
                setSubTab(availableTabs[m].dedicated ? 'dedicated' : 'shared');
                return;
            }
        }
    }, [shopItems, availableTabs]);

    const handleLogin = async () => {
        if (!apiKey.trim()) {
            showNotification('Ошибка', 'Введите API ключ', 'warning');
            return;
        }
        setLoading(true);
        try {
            const response = await tauriFetch('https://app.cyberyozh.com/api/v2/users/balance/', {
                headers: { 'X-Api-Key': apiKey, 'User-Agent': 'Antic Browser v1.0.0' },
            });
            if (!response.ok) {
                showNotification('Ошибка',
                    response.status === 401 || response.status === 403
                        ? 'Неверный API ключ'
                        : `Ошибка сервера: ${response.status}`,
                    'error'
                );
                return;
            }
            const balanceText = await response.text();
            const balanceValue = balanceText.replace('$', '').trim();
            setBalance(balanceValue);
            localStorage.setItem('cyberyozh_api_key', apiKey);
            setView('main');
            showNotification('Успех', `API ключ проверен. Баланс: $${balanceValue}`, 'success');
        } catch (error: any) {
            showNotification('Ошибка', `Не удалось подключиться: ${error.message}`, 'error');
        } finally {
            setLoading(false);
        }
    };

    const loadShopProxies = async () => {
        setLoading(true);
        try {
            const data = await api.cyberyozhGetShopProxies(apiKey, undefined, undefined);
            // Debug: dump unique proxy_category values and classification
            const cats = new Map<string, { main: MainTab; sub: SubTab; count: number }>();
            for (const item of data) {
                const key = item.proxy_category || '(empty)';
                if (!cats.has(key)) {
                    cats.set(key, { main: resolveMainTab(item), sub: resolveSubTab(item), count: 0 });
                }
                cats.get(key)!.count++;
            }
            console.log('[CyberYozh] === CATEGORY CLASSIFICATION ===');
            cats.forEach((v, k) => console.log(`  proxy_category="${k}" → ${v.main}/${v.sub} (${v.count} items)`));
            console.log(`[CyberYozh] Total: ${data.length} products`);
            setShopItems(data);
        } catch (error: any) {
            showNotification('Ошибка', `Не удалось загрузить магазин: ${error}`, 'error');
        } finally {
            setLoading(false);
        }
    };

    const loadMyProxies = async () => {
        setLoading(true);
        try {
            // Use proper Rust command that handles paginated API response and filtering
            const proxies = await api.cyberyozhGetMyProxies(apiKey);
            console.log('[CyberYozh] My proxies loaded:', proxies.length, proxies);
            setMyProxies(proxies);
        } catch (error: any) {
            console.error('[CyberYozh] Failed to load my proxies:', error);
            showNotification('Ошибка', 'Не удалось загрузить список прокси', 'error');
        } finally {
            setLoading(false);
        }
    };

    const handleBuyProxy = async (proxyId: string) => {
        setBuyingId(proxyId);
        try {
            const response = await tauriFetch('https://app.cyberyozh.com/api/v1/proxies/shop/buy_proxies/', {
                method: 'POST',
                headers: {
                    'X-Api-Key': apiKey,
                    'Content-Type': 'application/json',
                    'User-Agent': 'Antic Browser v1.0.0',
                },
                body: JSON.stringify([{ id: proxyId, auto_renew: false }]),
            });
            if (!response.ok) {
                const error = await response.json();
                throw new Error(error.message || error.detail || 'Ошибка покупки');
            }
            const result = await response.json();
            console.log('[CyberYozh] Buy result:', result);
            if (Array.isArray(result) && result[0]) {
                if (result[0].status === 'in_progress') {
                    showNotification('Успех', 'Прокси куплен! Ожидание активации...', 'success');
                    
                    // Update balance
                    const balanceResp = await tauriFetch('https://app.cyberyozh.com/api/v2/users/balance/', {
                        headers: { 'X-Api-Key': apiKey, 'User-Agent': 'Antic Browser v1.0.0' },
                    });
                    const balanceText = await balanceResp.text();
                    setBalance(balanceText.replace('$', '').trim());
                    
                    // Auto-import: wait a bit for the proxy to activate, then import all active
                    showNotification('Импорт', 'Импортирую купленные прокси в приложение...', 'info');
                    // Retry up to 3 times with delay to wait for proxy activation
                    let imported: string[] = [];
                    for (let attempt = 1; attempt <= 3; attempt++) {
                        await new Promise(r => setTimeout(r, 3000 * attempt)); // 3s, 6s, 9s
                        try {
                            imported = await api.cyberyozhImportProxies(apiKey);
                            if (imported.length > 0) break;
                        } catch (e) {
                            console.warn(`[CyberYozh] Import attempt ${attempt} failed:`, e);
                        }
                    }
                    if (imported.length > 0) {
                        showNotification('Успех', `Импортировано ${imported.length} прокси в приложение`, 'success');
                        onProxiesImported();
                    } else {
                        showNotification('Инфо', 'Прокси куплен, но ещё активируется. Используйте "Импортировать мои прокси" позже.', 'warning');
                    }
                } else {
                    throw new Error(result[0].message || 'Ошибка покупки');
                }
            }
        } catch (error: any) {
            const m: Record<string, string> = {
                'Not enough money.': 'Недостаточно средств',
                'Request was throttled.': 'Слишком много запросов',
                'Invalid API Key': 'Неверный API ключ',
                'Bad Request': 'Некорректный запрос',
            };
            showNotification('Ошибка', m[error.message] || error.message, 'error');
        } finally {
            setBuyingId(null);
        }
    };

    const handleImportSelected = async () => {
        if (selectedProxies.size === 0) {
            showNotification('Предупреждение', 'Выберите прокси для импорта', 'warning');
            return;
        }
        try {
            let imported = 0;
            for (const proxyId of selectedProxies) {
                const proxy = myProxies.find(p => p.id === proxyId);
                if (proxy) {
                    const proxyStr = `http://${proxy.connection_login}:${proxy.connection_password}@${proxy.connection_host}:${proxy.connection_port}`;
                    console.log('[CyberYozh] Importing proxy:', proxyStr);
                    try {
                        await api.addProxy(proxyStr);
                        imported++;
                    } catch (e) {
                        console.error('[CyberYozh] Failed to import proxy:', proxyStr, e);
                    }
                }
            }
            showNotification('Успех', `Импортировано ${imported} прокси`, 'success');
            setSelectedProxies(new Set());
            setView('main');
            onProxiesImported();
        } catch (error: any) {
            showNotification('Ошибка', `Ошибка импорта: ${error.message}`, 'error');
        }
    };

    const handleImportAll = async () => {
        setLoading(true);
        try {
            const imported = await api.cyberyozhImportProxies(apiKey);
            if (imported.length > 0) {
                showNotification('Успех', `Импортировано ${imported.length} прокси`, 'success');
                onProxiesImported();
            } else {
                showNotification('Инфо', 'Нет активных прокси для импорта', 'warning');
            }
            setView('main');
        } catch (error: any) {
            showNotification('Ошибка', `Ошибка импорта: ${error.message}`, 'error');
        } finally {
            setLoading(false);
        }
    };

    if (!isOpen) return null;

    return (
        <div className="fixed inset-0 bg-black/60 flex items-center justify-center z-50 p-4">
            <div className="bg-white rounded-2xl shadow-2xl w-full max-w-4xl max-h-[90vh] flex flex-col overflow-hidden">
                {/* Header */}
                <div className="bg-gradient-to-r from-zinc-900 to-zinc-800 text-white px-6 py-4 flex justify-between items-center shrink-0">
                    <div className="flex items-center gap-3">
                        <div className="w-8 h-8 bg-purple-600 rounded-lg flex items-center justify-center text-sm font-bold">CY</div>
                        <div>
                            <h2 className="text-lg font-bold">CyberYozh Proxy Shop</h2>
                            {view !== 'login' && (
                                <p className="text-xs text-zinc-400">
                                    Баланс: <span className="text-green-400 font-semibold">${balance}</span>
                                </p>
                            )}
                        </div>
                    </div>
                    <button onClick={onClose} className="text-zinc-400 hover:text-white transition rounded-lg p-1.5 hover:bg-white/10">
                        <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" />
                        </svg>
                    </button>
                </div>

                {/* Content */}
                <div className="flex-1 overflow-y-auto p-6">
                    {/* ═══════════ LOGIN ═══════════ */}
                    {view === 'login' && (
                        <div className="max-w-md mx-auto">
                            <div className="bg-purple-50 border border-purple-200 rounded-xl p-4 mb-6 text-center">
                                <p className="text-sm text-purple-800">
                                    🎁 <strong>Получите бонусы при регистрации на CyberYozh</strong>
                                </p>
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
                                    disabled={loading}
                                    className="flex-1 bg-purple-600 hover:bg-purple-700 disabled:opacity-50 text-white py-3 rounded-xl font-medium transition"
                                >
                                    {loading ? 'Проверка...' : 'Войти'}
                                </button>
                                <button
                                    onClick={() => openExternal('https://app.cyberyozh.com/ru/?utm_source=antic_browser_soft')}
                                    className="flex-1 bg-zinc-800 hover:bg-zinc-700 text-white py-3 rounded-xl font-medium transition flex items-center justify-center gap-2"
                                >
                                    <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                                        <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M10 6H6a2 2 0 00-2 2v10a2 2 0 002 2h10a2 2 0 002-2v-4M14 4h6m0 0v6m0-6L10 14" />
                                    </svg>
                                    Получить ключ
                                </button>
                            </div>
                        </div>
                    )}

                    {/* ═══════════ MAIN ═══════════ */}
                    {view === 'main' && (
                        <div className="max-w-md mx-auto">
                            <div className="bg-green-50 border border-green-200 rounded-xl p-4 mb-6 text-center">
                                <p className="text-green-800 font-bold text-lg">💰 Баланс: ${balance}</p>
                            </div>

                            <div className="space-y-3">
                                <button
                                    onClick={() => { setView('shop'); loadShopProxies(); }}
                                    className="w-full bg-purple-600 hover:bg-purple-700 text-white py-4 rounded-xl font-semibold transition flex items-center justify-center gap-2"
                                >
                                    <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                                        <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M3 3h2l.4 2M7 13h10l4-8H5.4M7 13L5.4 5M7 13l-2.293 2.293c-.63.63-.184 1.707.707 1.707H17m0 0a2 2 0 100 4 2 2 0 000-4zm-8 2a2 2 0 100 4 2 2 0 000-4z" />
                                    </svg>
                                    Магазин прокси
                                </button>
                                <button
                                    onClick={() => { setView('import'); loadMyProxies(); }}
                                    className="w-full bg-zinc-800 hover:bg-zinc-700 text-white py-4 rounded-xl font-semibold transition flex items-center justify-center gap-2"
                                >
                                    <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                                        <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M4 16v1a3 3 0 003 3h10a3 3 0 003-3v-1m-4-4l-4 4m0 0l-4-4m4 4V4" />
                                    </svg>
                                    Импортировать мои прокси
                                </button>
                            </div>

                            <div className="mt-6 text-center">
                                <p className="text-sm text-purple-600">
                                    Промокод <strong className="bg-purple-100 px-2 py-0.5 rounded">CYBERYOZH2025</strong> — скидка 10%
                                </p>
                            </div>
                        </div>
                    )}

                    {/* ═══════════ SHOP ═══════════ */}
                    {view === 'shop' && (
                        <div>
                            {/* Back */}
                            <button
                                onClick={() => setView('main')}
                                className="text-sm text-zinc-500 hover:text-zinc-800 mb-4 flex items-center gap-1 transition"
                            >
                                <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M15 19l-7-7 7-7" />
                                </svg>
                                Назад
                            </button>

                            {/* Main Tabs: Мобильные / Резидентские / Датацентр */}
                            <div className="flex gap-1 bg-zinc-100 rounded-xl p-1 mb-4">
                                {([
                                    ['mobile', 'Мобильные'],
                                    ['residential', 'Резидентские'],
                                    ['datacenter', 'Датацентр'],
                                ] as [MainTab, string][]).map(([key, label]) => (
                                    <button
                                        key={key}
                                        onClick={() => setMainTab(key)}
                                        className={`flex-1 py-2.5 text-sm font-medium rounded-lg transition ${
                                            mainTab === key
                                                ? 'bg-white text-zinc-900 shadow-sm'
                                                : 'text-zinc-500 hover:text-zinc-700'
                                        }`}
                                    >
                                        {label}
                                    </button>
                                ))}
                            </div>

                            {/* Sub Tabs: Выделенные / Общие (or Ротационные for residential) */}
                            <div className="flex gap-2 mb-6">
                                {(['dedicated', 'shared'] as SubTab[]).map((key) => {
                                    const hasItems = availableTabs[mainTab]?.[key];
                                    const label = SUB_TAB_LABELS[mainTab][key];
                                    return (
                                        <button
                                            key={key}
                                            onClick={() => setSubTab(key)}
                                            className={`px-5 py-2 text-sm font-medium rounded-lg border transition ${
                                                subTab === key
                                                    ? 'bg-zinc-900 text-white border-zinc-900'
                                                    : hasItems
                                                        ? 'bg-white text-zinc-600 border-zinc-200 hover:border-zinc-400'
                                                        : 'bg-zinc-50 text-zinc-300 border-zinc-100'
                                            }`}
                                        >
                                            {label}
                                        </button>
                                    );
                                })}
                            </div>

                            {/* Loading spinner */}
                            {loading && (
                                <div className="text-center py-16">
                                    <div className="inline-block w-8 h-8 border-4 border-zinc-200 border-t-purple-600 rounded-full animate-spin" />
                                    <p className="mt-3 text-sm text-zinc-500">Загрузка...</p>
                                </div>
                            )}

                            {/* Empty state */}
                            {!loading && cardGroups.length === 0 && (
                                <div className="text-center py-16 text-zinc-400">
                                    <svg className="w-12 h-12 mx-auto mb-3 opacity-40" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                                        <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.5} d="M20 7l-8-4-8 4m16 0l-8 4m8-4v10l-8 4m0-10L4 7m8 4v10M4 7v10l8 4" />
                                    </svg>
                                    <p className="text-lg font-medium mb-1">Нет доступных прокси</p>
                                    <p className="text-sm">В этой категории пока нет товаров</p>
                                </div>
                            )}

                            {/* Card grid */}
                            {!loading && cardGroups.length > 0 && (
                                <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
                                    {cardGroups.map((group) => {
                                        const selId = selectedOptions[group.title] || group.options[0]?.id;
                                        const selOpt = group.options.find(o => o.id === selId) || group.options[0];
                                        const outOfStock = selOpt?.stockStatus === 'out_of_stock';

                                        return (
                                            <div
                                                key={group.title}
                                                className="bg-white border border-zinc-200 rounded-xl overflow-hidden hover:border-zinc-300 hover:shadow-md transition-all flex flex-col"
                                            >
                                                {/* Card header: flag + title + badge */}
                                                <div className="px-4 pt-4 pb-3 flex items-center gap-2.5">
                                                    <span className="text-xl leading-none">{countryFlag(group.countryCode)}</span>
                                                    <span className="font-semibold text-zinc-900 text-sm flex-1 truncate">{group.title}</span>
                                                    {group.badge && (
                                                        <span
                                                            className="text-[11px] font-bold text-white px-2 py-0.5 rounded-md shrink-0"
                                                            style={{ backgroundColor: group.badge.color }}
                                                        >
                                                            {group.badge.text}
                                                        </span>
                                                    )}
                                                </div>

                                                <hr className="border-zinc-100 mx-4" />

                                                {/* Features list */}
                                                <div className="px-4 py-3 flex-1">
                                                    <ul className="space-y-1.5">
                                                        {group.features.map((f, i) => (
                                                            <li key={i} className="flex items-start gap-2 text-[13px] text-zinc-600">
                                                                <span className="text-green-500 mt-px shrink-0">✓</span>
                                                                {f}
                                                            </li>
                                                        ))}
                                                    </ul>
                                                </div>

                                                {/* Footer: dropdown + buy */}
                                                <div className="px-4 pb-4 pt-2 flex items-center gap-2">
                                                    <select
                                                        value={selId}
                                                        onChange={(e) =>
                                                            setSelectedOptions(prev => ({ ...prev, [group.title]: e.target.value }))
                                                        }
                                                        className="flex-1 min-w-0 border border-zinc-200 rounded-lg px-2.5 py-2 text-[13px] bg-zinc-50 focus:ring-2 focus:ring-purple-500 focus:outline-none"
                                                    >
                                                        {group.options.map(opt => (
                                                            <option key={opt.id} value={opt.id}>
                                                                {optionLabel(opt)}
                                                            </option>
                                                        ))}
                                                    </select>
                                                    <button
                                                        onClick={() => selOpt && handleBuyProxy(selOpt.id)}
                                                        disabled={outOfStock || buyingId === selOpt?.id}
                                                        className={`px-4 py-2 rounded-lg text-sm font-semibold transition whitespace-nowrap ${
                                                            outOfStock
                                                                ? 'bg-zinc-200 text-zinc-400 cursor-not-allowed'
                                                                : buyingId === selOpt?.id
                                                                    ? 'bg-purple-400 text-white cursor-wait'
                                                                    : 'bg-purple-600 hover:bg-purple-700 text-white'
                                                        }`}
                                                    >
                                                        {outOfStock ? 'Нет' : buyingId === selOpt?.id ? '...' : 'Купить'}
                                                    </button>
                                                </div>
                                            </div>
                                        );
                                    })}
                                </div>
                            )}
                        </div>
                    )}

                    {/* ═══════════ IMPORT ═══════════ */}
                    {view === 'import' && (
                        <div>
                            <button
                                onClick={() => setView('main')}
                                className="text-sm text-zinc-500 hover:text-zinc-800 mb-4 flex items-center gap-1 transition"
                            >
                                <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M15 19l-7-7 7-7" />
                                </svg>
                                Назад
                            </button>

                            <h3 className="text-lg font-bold mb-4">Мои прокси</h3>

                            {loading && (
                                <div className="text-center py-12">
                                    <div className="inline-block w-8 h-8 border-4 border-zinc-200 border-t-purple-600 rounded-full animate-spin" />
                                </div>
                            )}

                            {!loading && myProxies.length === 0 && (
                                <div className="text-center py-16">
                                    <p className="text-zinc-400 mb-4">Нет активных прокси</p>
                                    <button
                                        onClick={() => { setView('shop'); loadShopProxies(); }}
                                        className="bg-purple-600 hover:bg-purple-700 text-white px-6 py-2.5 rounded-xl font-medium transition"
                                    >
                                        Перейти в магазин
                                    </button>
                                </div>
                            )}

                            {!loading && myProxies.length > 0 && (
                                <>
                                    <div className="flex gap-2 mb-4">
                                        <button
                                            onClick={handleImportAll}
                                            className="bg-green-600 hover:bg-green-700 text-white px-5 py-2.5 rounded-xl font-medium transition"
                                        >
                                            Импортировать все ({myProxies.length})
                                        </button>
                                        <button
                                            onClick={handleImportSelected}
                                            disabled={selectedProxies.size === 0}
                                            className="bg-purple-600 hover:bg-purple-700 disabled:opacity-40 text-white px-5 py-2.5 rounded-xl font-medium transition"
                                        >
                                            Импортировать выбранные ({selectedProxies.size})
                                        </button>
                                    </div>

                                    <div className="space-y-2 max-h-[50vh] overflow-y-auto">
                                        {myProxies.map(proxy => (
                                            <label
                                                key={proxy.id}
                                                className="flex items-center p-3 border border-zinc-200 rounded-xl hover:bg-zinc-50 cursor-pointer transition"
                                            >
                                                <input
                                                    type="checkbox"
                                                    checked={selectedProxies.has(proxy.id)}
                                                    onChange={(e) => {
                                                        const s = new Set(selectedProxies);
                                                        e.target.checked ? s.add(proxy.id) : s.delete(proxy.id);
                                                        setSelectedProxies(s);
                                                    }}
                                                    className="mr-3 accent-purple-600"
                                                />
                                                <div className="flex-1 min-w-0">
                                                    <p className="font-medium text-sm truncate">
                                                        {countryFlag(proxy.country_code || '')} {(proxy.country_code || '??').toUpperCase()} — {proxy.public_ipaddress || proxy.connection_host}
                                                    </p>
                                                    <p className="text-xs text-zinc-500 truncate">
                                                        {proxy.connection_host}:{proxy.connection_port}
                                                        {proxy.access_expires_at && <span className="ml-2 text-zinc-400">до {new Date(proxy.access_expires_at).toLocaleDateString()}</span>}
                                                    </p>
                                                </div>
                                            </label>
                                        ))}
                                    </div>
                                </>
                            )}
                        </div>
                    )}
                </div>
            </div>
        </div>
    );
}
