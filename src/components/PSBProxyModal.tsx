import { useState, useEffect, useCallback } from 'react';
import { useNotification } from '../utils/notifications';
import * as api from '../api';
import { openExternal } from '../utils/external';

interface PSBProxyModalProps {
    isOpen: boolean;
    onClose: () => void;
    onProxiesImported: () => void;
}

interface SubUser {
    id: number;
    data: {
        subuser_id?: number;
        username?: string;
        password?: string;
        traffic_available?: any;
        traffic_used?: any;
        hash?: string;
    };
    type: string;
    user: number;
    createdAt?: string;
    updatedAt?: string;
}

interface Country {
    country_code: string;
    country_name: string;
}

interface Format {
    name: string;
    value: string;
}

interface Hostname {
    type: string;
    name: string;
    value: string;
}

interface Protocol {
    name: string;
    value: string;
}

export default function PSBProxyModal({ isOpen, onClose, onProxiesImported }: PSBProxyModalProps) {
    const { showNotification } = useNotification();
    const [view, setView] = useState<'login' | 'main'>('login');
    const [loading, setLoading] = useState(false);
    const [apiKey, setApiKey] = useState('');
    const [tab, setTab] = useState<'proxy' | 'whitelist' | 'subusers'>('proxy');

    // SubUsers
    const [subUsers, setSubUsers] = useState<SubUser[]>([]);
    const [selectedSubUser, setSelectedSubUser] = useState<SubUser | null>(null);
    const [creatingSubUser, setCreatingSubUser] = useState(false);

    // Pool data
    const [pool] = useState('pool-1');
    const [countries, setCountries] = useState<Country[]>([]);
    const [formats, setFormats] = useState<Format[]>([]);
    const [hostnames, setHostnames] = useState<Hostname[]>([]);
    const [protocols, setProtocols] = useState<Protocol[]>([]);

    // Proxy generator
    const [selectedCountry, setSelectedCountry] = useState('');
    const [selectedFormat, setSelectedFormat] = useState('hostname:port:login:password');
    const [selectedHostname, setSelectedHostname] = useState('gw.psbproxy.io');
    const [selectedProtocol, setSelectedProtocol] = useState('http');
    const [proxyCount, setProxyCount] = useState(10);
    const [generatedProxies, setGeneratedProxies] = useState<string[]>([]);
    const [countrySearch, setCountrySearch] = useState('');

    // Whitelist
    const [myIp, setMyIp] = useState('');
    const [whitelist, setWhitelist] = useState<any[]>([]);
    const [whitelistLoading, setWhitelistLoading] = useState(false);

    // Load saved key
    useEffect(() => {
        if (isOpen && view === 'login') {
            const saved = localStorage.getItem('psb_api_key');
            if (saved) setApiKey(saved);
        }
    }, [isOpen, view]);

    // Load data on main view
    useEffect(() => {
        if (view === 'main') {
            loadSubUsers();
            loadPoolOptions();
            loadMyIp();
        }
    }, [view]);

    const loadSubUsers = useCallback(async () => {
        try {
            const result = await api.psbGetSubUsers(apiKey);
            const users = result.data || [];
            setSubUsers(users);
            if (users.length > 0 && !selectedSubUser) {
                setSelectedSubUser(users[0]);
            }
        } catch (error: any) {
            console.error('[PSB] Failed to load sub-users:', error);
        }
    }, [apiKey, selectedSubUser]);

    const loadPoolOptions = useCallback(async () => {
        try {
            const [countriesData, formatsData, hostnamesData, protocolsData] = await Promise.all([
                api.psbGetCountries(apiKey, pool),
                api.psbGetFormats(apiKey, pool),
                api.psbGetHostnames(apiKey, pool),
                api.psbGetProtocols(apiKey, pool),
            ]);
            setCountries(countriesData);
            setFormats(formatsData);
            setHostnames(hostnamesData);
            setProtocols(protocolsData);
        } catch (error: any) {
            console.error('[PSB] Failed to load pool options:', error);
        }
    }, [apiKey, pool]);

    const loadMyIp = async () => {
        try {
            const ip = await api.psbGetMyIp();
            setMyIp(ip);
        } catch (error: any) {
            console.error('[PSB] Failed to get IP:', error);
        }
    };

    const loadWhitelist = useCallback(async () => {
        if (!selectedSubUser) return;
        setWhitelistLoading(true);
        try {
            const data = await api.psbGetWhitelist(apiKey, pool, selectedSubUser.id);
            setWhitelist(Array.isArray(data) ? data : []);
        } catch (error: any) {
            console.error('[PSB] Failed to load whitelist:', error);
            setWhitelist([]);
        } finally {
            setWhitelistLoading(false);
        }
    }, [apiKey, pool, selectedSubUser]);

    useEffect(() => {
        if (tab === 'whitelist' && selectedSubUser) {
            loadWhitelist();
        }
    }, [tab, selectedSubUser, loadWhitelist]);

    const handleLogin = async () => {
        if (!apiKey.trim()) {
            showNotification('Ошибка', 'Введите API ключ', 'warning');
            return;
        }
        setLoading(true);
        try {
            const [isValid, message] = await api.psbValidateKey(apiKey);
            if (!isValid) {
                showNotification('Ошибка', message || 'Неверный API ключ', 'error');
                return;
            }
            localStorage.setItem('psb_api_key', apiKey);
            setView('main');
            showNotification('Успех', message, 'success');
        } catch (error: any) {
            showNotification('Ошибка', `Не удалось подключиться: ${error}`, 'error');
        } finally {
            setLoading(false);
        }
    };

    const handleCreateSubUser = async (type: string) => {
        setCreatingSubUser(true);
        try {
            const result = await api.psbCreateSubUser(apiKey, type);
            showNotification('Успех', `SubUser создан (ID: ${result.id})`, 'success');
            await loadSubUsers();
            setSelectedSubUser(result);
        } catch (error: any) {
            showNotification('Ошибка', `Не удалось создать SubUser: ${error}`, 'error');
        } finally {
            setCreatingSubUser(false);
        }
    };

    const handleDeleteSubUser = async (id: number) => {
        if (!confirm('Удалить SubUser? Оставшийся трафик вернется на основной аккаунт.')) return;
        try {
            await api.psbDeleteSubUser(apiKey, id);
            showNotification('Успех', 'SubUser удален', 'success');
            if (selectedSubUser?.id === id) setSelectedSubUser(null);
            await loadSubUsers();
        } catch (error: any) {
            showNotification('Ошибка', error.toString(), 'error');
        }
    };

    const handleGenerateProxies = async () => {
        if (!selectedSubUser) {
            showNotification('Ошибка', 'Сначала выберите или создайте SubUser', 'warning');
            return;
        }
        setLoading(true);
        try {
            const params: any = {
                subUser_id: selectedSubUser.id,
                type: selectedSubUser.type,
                format: selectedFormat,
                hostname: selectedHostname,
                protocol: selectedProtocol,
                rotation: 'rotating',
                proxy_count: proxyCount,
            };
            if (selectedCountry) {
                params.location = selectedCountry;
            }
            const proxies = await api.psbGenerateProxyList(apiKey, pool, params);
            setGeneratedProxies(proxies);
            showNotification('Успех', `Сгенерировано ${proxies.length} прокси`, 'success');
        } catch (error: any) {
            showNotification('Ошибка', `Генерация не удалась: ${error}`, 'error');
        } finally {
            setLoading(false);
        }
    };

    const handleImportProxies = async () => {
        if (generatedProxies.length === 0) return;
        setLoading(true);
        try {
            let imported = 0;
            for (let i = 0; i < generatedProxies.length; i++) {
                try {
                    await api.psbImportProxy(generatedProxies[i], selectedProtocol, selectedCountry || undefined);
                    imported++;
                } catch (e) {
                    console.error('[PSB] Failed to import proxy:', generatedProxies[i], e);
                }
            }
            showNotification('Успех', `Импортировано ${imported} из ${generatedProxies.length} прокси`, 'success');
            onProxiesImported();
        } catch (error: any) {
            showNotification('Ошибка', error.toString(), 'error');
        } finally {
            setLoading(false);
        }
    };

    const handleAddToWhitelist = async () => {
        if (!myIp || !selectedSubUser) return;
        setLoading(true);
        try {
            await api.psbAddWhitelistIp(apiKey, pool, myIp, selectedSubUser.id);
            showNotification('Успех', 'IP добавлен в whitelist', 'success');
            await loadWhitelist();
        } catch (error: any) {
            showNotification('Ошибка', error.toString(), 'error');
        } finally {
            setLoading(false);
        }
    };

    const handleRemoveFromWhitelist = async (ip: string) => {
        if (!selectedSubUser) return;
        try {
            await api.psbRemoveWhitelistIp(apiKey, pool, ip, selectedSubUser.id);
            showNotification('Успех', 'IP удален из whitelist', 'success');
            await loadWhitelist();
        } catch (error: any) {
            showNotification('Ошибка', error.toString(), 'error');
        }
    };

    const handleCopyProxies = () => {
        if (generatedProxies.length > 0) {
            navigator.clipboard.writeText(generatedProxies.join('\n'));
            showNotification('Скопировано', `${generatedProxies.length} прокси скопировано`, 'success');
        }
    };

    const handleLogout = () => {
        setView('login');
        setApiKey('');
        setSubUsers([]);
        setSelectedSubUser(null);
        setGeneratedProxies([]);
        setWhitelist([]);
        localStorage.removeItem('psb_api_key');
    };

    const getTrafficValue = (val: any): string => {
        if (val === null || val === undefined) return '0.00';
        if (typeof val === 'number') return val.toFixed(2);
        if (typeof val === 'string') return parseFloat(val).toFixed(2);
        return '0.00';
    };

    const filteredCountries = countries.filter(c =>
        !countrySearch ||
        c.country_name.toLowerCase().includes(countrySearch.toLowerCase()) ||
        c.country_code.toLowerCase().includes(countrySearch.toLowerCase())
    );

    if (!isOpen) return null;

    const inputCls = "w-full px-3.5 py-2.5 bg-[#0f0f0f] border border-[#2a2a2a] rounded-lg text-sm text-white placeholder-gray-600 focus:outline-none focus:border-[#4a6cf7] focus:ring-1 focus:ring-[#4a6cf7]/20 transition-all";
    const selectCls = "w-full px-3.5 py-2.5 bg-[#0f0f0f] border border-[#2a2a2a] rounded-lg text-sm text-white focus:outline-none focus:border-[#4a6cf7] focus:ring-1 focus:ring-[#4a6cf7]/20 transition-all";
    const labelCls = "block text-[11px] font-semibold text-gray-500 mb-1.5 uppercase tracking-wider";
    const accentBtn = "py-2.5 bg-[#4a6cf7] hover:bg-[#3d5de0] active:bg-[#3452cc] text-white rounded-lg text-sm font-medium transition-all disabled:opacity-40 disabled:cursor-not-allowed";

    return (
        <div className="fixed inset-0 bg-black/60 backdrop-blur-[2px] flex items-center justify-center z-50 p-4" onClick={onClose}>
            <div
                className="bg-[#161616] border border-[#252525] rounded-xl shadow-2xl shadow-black/50 w-full max-w-[760px] max-h-[88vh] flex flex-col overflow-hidden"
                onClick={e => e.stopPropagation()}
            >
                {/* Header */}
                <div className="flex items-center justify-between px-6 py-4 border-b border-[#222] bg-[#1a1a1a]">
                    <div className="flex items-center gap-3">
                        <div className="w-8 h-8 rounded-lg bg-[#4a6cf7]/10 border border-[#4a6cf7]/20 flex items-center justify-center">
                            <svg className="w-4 h-4 text-[#4a6cf7]" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.8} d="M12 15v2m-6 4h12a2 2 0 002-2v-6a2 2 0 00-2-2H6a2 2 0 00-2 2v6a2 2 0 002 2zm10-10V7a4 4 0 00-8 0v4h8z" />
                            </svg>
                        </div>
                        <div>
                            <h2 className="text-[15px] font-semibold text-white leading-tight">PSB Proxy</h2>
                            {view === 'main' && selectedSubUser ? (
                                <p className="text-xs text-gray-500 mt-0.5">
                                    SubUser #{selectedSubUser.id} &middot; {getTrafficValue(selectedSubUser.data.traffic_available)} GB
                                </p>
                            ) : view === 'login' ? (
                                <p className="text-xs text-gray-500 mt-0.5">Подключение к сервису</p>
                            ) : null}
                        </div>
                    </div>
                    <div className="flex items-center gap-1">
                        {view === 'main' && (
                            <>
                                <button
                                    onClick={() => openExternal('https://psbproxy.io/account/shop/residential-proxy/pool-1')}
                                    className="px-2.5 py-1.5 text-[11px] text-gray-500 hover:text-white hover:bg-white/5 rounded-md transition-all"
                                >
                                    Купить трафик
                                </button>
                                <button
                                    onClick={handleLogout}
                                    className="px-2.5 py-1.5 text-[11px] text-gray-500 hover:text-red-400 hover:bg-red-500/5 rounded-md transition-all"
                                >
                                    Выйти
                                </button>
                            </>
                        )}
                        <button onClick={onClose} className="ml-1 text-gray-500 hover:text-white transition-colors p-1.5 hover:bg-white/5 rounded-md">
                            <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" />
                            </svg>
                        </button>
                    </div>
                </div>

                <div className="overflow-y-auto flex-1">
                    {/* ========== LOGIN VIEW ========== */}
                    {view === 'login' && (
                        <div className="px-6 py-8">
                            <div className="max-w-sm mx-auto space-y-5">
                                <div className="text-center mb-6">
                                    <div className="w-14 h-14 rounded-2xl bg-[#4a6cf7]/10 border border-[#4a6cf7]/15 flex items-center justify-center mx-auto mb-4">
                                        <svg className="w-7 h-7 text-[#4a6cf7]" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                                            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.5} d="M15 7a2 2 0 012 2m4 0a6 6 0 01-7.743 5.743L11 17H9v2H7v2H4a1 1 0 01-1-1v-2.586a1 1 0 01.293-.707l5.964-5.964A6 6 0 1121 9z" />
                                        </svg>
                                    </div>
                                    <h3 className="text-lg font-semibold text-white">Введите API ключ</h3>
                                    <p className="text-sm text-gray-500 mt-1">Партнерский ключ из личного кабинета</p>
                                </div>
                                <div>
                                    <input
                                        type="password"
                                        value={apiKey}
                                        onChange={(e) => setApiKey(e.target.value)}
                                        onKeyDown={(e) => e.key === 'Enter' && handleLogin()}
                                        placeholder="Вставьте ключ..."
                                        className={inputCls}
                                    />
                                </div>
                                <button
                                    onClick={handleLogin}
                                    disabled={loading || !apiKey.trim()}
                                    className={`w-full ${accentBtn}`}
                                >
                                    {loading ? (
                                        <span className="flex items-center justify-center gap-2">
                                            <svg className="w-4 h-4 animate-spin" viewBox="0 0 24 24" fill="none"><circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4"/><path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4z"/></svg>
                                            Проверка...
                                        </span>
                                    ) : 'Подключить'}
                                </button>
                                <p className="text-[11px] text-gray-600 text-center leading-relaxed">
                                    Ключ можно получить в{' '}
                                    <button onClick={() => openExternal('https://psbproxy.io/account/partnership')} className="text-[#4a6cf7] hover:text-[#6b8aff] transition-colors">
                                        разделе Партнерство
                                    </button>
                                </p>
                            </div>
                        </div>
                    )}

                    {/* ========== MAIN VIEW ========== */}
                    {view === 'main' && (
                        <div>
                            {/* No SubUser Warning */}
                            {subUsers.length === 0 && (
                                <div className="mx-6 mt-5 border border-amber-500/20 bg-amber-500/5 rounded-lg p-4 flex items-start gap-3">
                                    <div className="w-8 h-8 rounded-lg bg-amber-500/10 flex items-center justify-center shrink-0 mt-0.5">
                                        <svg className="w-4 h-4 text-amber-400" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                                            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 9v2m0 4h.01m-6.938 4h13.856c1.54 0 2.502-1.667 1.732-2.5L13.732 4c-.77-.833-1.964-.833-2.732 0L4.082 16.5c-.77.833.192 2.5 1.732 2.5z" />
                                        </svg>
                                    </div>
                                    <div>
                                        <p className="text-sm text-amber-200/80 mb-2.5">
                                            Для генерации прокси нужен SubUser. Создайте его или купите трафик.
                                        </p>
                                        <div className="flex gap-2">
                                            <button
                                                onClick={() => handleCreateSubUser('residential-proxy-pool-1')}
                                                disabled={creatingSubUser}
                                                className="px-3 py-1.5 bg-amber-500/15 hover:bg-amber-500/25 text-amber-300 rounded-md text-xs font-medium transition-colors disabled:opacity-50 border border-amber-500/20"
                                            >
                                                {creatingSubUser ? 'Создание...' : 'Создать SubUser'}
                                            </button>
                                            <button
                                                onClick={() => openExternal('https://psbproxy.io/account/shop/residential-proxy/pool-1')}
                                                className="px-3 py-1.5 text-amber-400/70 hover:text-amber-300 rounded-md text-xs transition-colors"
                                            >
                                                Купить трафик
                                            </button>
                                        </div>
                                    </div>
                                </div>
                            )}

                            {/* Tabs */}
                            <div className="px-6 pt-4 pb-0">
                                <div className="flex gap-0.5 bg-[#111] p-1 rounded-lg">
                                    {([
                                        ['proxy', 'Генератор', 'M13 10V3L4 14h7v7l9-11h-7z'],
                                        ['whitelist', 'Whitelist', 'M9 12l2 2 4-4m5.618-4.016A11.955 11.955 0 0112 2.944a11.955 11.955 0 01-8.618 3.04A12.02 12.02 0 003 9c0 5.591 3.824 10.29 9 11.622 5.176-1.332 9-6.03 9-11.622 0-1.042-.133-2.052-.382-3.016z'],
                                        ['subusers', 'SubUsers', 'M12 4.354a4 4 0 110 5.292M15 21H3v-1a6 6 0 0112 0v1zm0 0h6v-1a6 6 0 00-9-5.197m13.5-9a2.5 2.5 0 11-5 0 2.5 2.5 0 015 0zM12.5 6.5a2.5 2.5 0 11-5 0 2.5 2.5 0 015 0z'],
                                    ] as const).map(([key, label, icon]) => (
                                        <button
                                            key={key}
                                            onClick={() => setTab(key)}
                                            className={`flex-1 flex items-center justify-center gap-1.5 py-2 rounded-md text-[13px] font-medium transition-all ${
                                                tab === key
                                                    ? 'bg-[#1e1e1e] text-white shadow-sm'
                                                    : 'text-gray-500 hover:text-gray-300'
                                            }`}
                                        >
                                            <svg className="w-3.5 h-3.5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                                                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.8} d={icon} />
                                            </svg>
                                            {label}
                                        </button>
                                    ))}
                                </div>
                            </div>

                            <div className="px-6 py-4">
                                {/* ===== PROXY TAB ===== */}
                                {tab === 'proxy' && (
                                    <div className="space-y-4">
                                        {/* SubUser selector */}
                                        {subUsers.length > 0 && (
                                            <div>
                                                <label className={labelCls}>SubUser</label>
                                                <select
                                                    value={selectedSubUser?.id || ''}
                                                    onChange={(e) => {
                                                        const su = subUsers.find(s => s.id === Number(e.target.value));
                                                        setSelectedSubUser(su || null);
                                                    }}
                                                    className={selectCls}
                                                >
                                                    {subUsers.map(su => (
                                                        <option key={su.id} value={su.id}>
                                                            #{su.id} — {su.data.username || su.data.hash || 'N/A'} | {getTrafficValue(su.data.traffic_available)} GB | {su.type}
                                                        </option>
                                                    ))}
                                                </select>
                                            </div>
                                        )}

                                        {/* Country */}
                                        <div>
                                            <label className={labelCls}>Страна</label>
                                            <div className="relative">
                                                <input
                                                    type="text"
                                                    value={countrySearch}
                                                    onChange={(e) => { setCountrySearch(e.target.value); if (!e.target.value) setSelectedCountry(''); }}
                                                    placeholder="Любая — начните вводить для поиска"
                                                    className={inputCls}
                                                />
                                                {selectedCountry && (
                                                    <span className="absolute right-3 top-1/2 -translate-y-1/2 flex items-center gap-1.5 px-2 py-0.5 bg-[#4a6cf7]/10 text-[#6b8aff] border border-[#4a6cf7]/20 rounded-md text-xs font-mono">
                                                        {selectedCountry.toUpperCase()}
                                                        <button onClick={() => { setSelectedCountry(''); setCountrySearch(''); }} className="text-[#4a6cf7]/50 hover:text-white">×</button>
                                                    </span>
                                                )}
                                            </div>
                                            {countrySearch && !selectedCountry && (
                                                <div className="mt-1 max-h-40 overflow-y-auto bg-[#111] border border-[#2a2a2a] rounded-lg shadow-lg shadow-black/30">
                                                    {filteredCountries.slice(0, 20).map(c => (
                                                        <button
                                                            key={c.country_code}
                                                            onClick={() => { setSelectedCountry(c.country_code); setCountrySearch(c.country_name); }}
                                                            className="w-full text-left px-3.5 py-2 text-sm text-gray-400 hover:bg-[#4a6cf7]/10 hover:text-white transition-colors flex items-center gap-2"
                                                        >
                                                            <span className="text-gray-600 font-mono text-[11px] w-6">{c.country_code.toUpperCase()}</span>
                                                            {c.country_name}
                                                        </button>
                                                    ))}
                                                    {filteredCountries.length === 0 && (
                                                        <div className="px-3.5 py-3 text-xs text-gray-600">Не найдено</div>
                                                    )}
                                                </div>
                                            )}
                                        </div>

                                        {/* Options grid */}
                                        <div className="grid grid-cols-2 gap-3">
                                            <div>
                                                <label className={labelCls}>Протокол</label>
                                                <select value={selectedProtocol} onChange={(e) => setSelectedProtocol(e.target.value)} className={selectCls}>
                                                    {protocols.length > 0 ? protocols.map(p => (
                                                        <option key={p.value} value={p.value}>{p.name}</option>
                                                    )) : (
                                                        <>
                                                            <option value="http">HTTP</option>
                                                            <option value="https">HTTPS</option>
                                                            <option value="socks5">SOCKS5</option>
                                                        </>
                                                    )}
                                                </select>
                                            </div>
                                            <div>
                                                <label className={labelCls}>Формат</label>
                                                <select value={selectedFormat} onChange={(e) => setSelectedFormat(e.target.value)} className={selectCls}>
                                                    {formats.length > 0 ? formats.map(f => (
                                                        <option key={f.value} value={f.value}>{f.name}</option>
                                                    )) : (
                                                        <option value="hostname:port:login:password">host:port:login:pass</option>
                                                    )}
                                                </select>
                                            </div>
                                            <div>
                                                <label className={labelCls}>Сервер</label>
                                                <select value={selectedHostname} onChange={(e) => setSelectedHostname(e.target.value)} className={selectCls}>
                                                    {hostnames.length > 0 ? hostnames.map(h => (
                                                        <option key={h.value} value={h.value}>{h.name} ({h.value})</option>
                                                    )) : (
                                                        <option value="gw.psbproxy.io">gw.psbproxy.io</option>
                                                    )}
                                                </select>
                                            </div>
                                            <div>
                                                <label className={labelCls}>Количество</label>
                                                <input
                                                    type="number"
                                                    value={proxyCount}
                                                    onChange={(e) => setProxyCount(Math.max(1, Math.min(1000, parseInt(e.target.value) || 1)))}
                                                    min={1}
                                                    max={1000}
                                                    className={inputCls}
                                                />
                                            </div>
                                        </div>

                                        <button
                                            onClick={handleGenerateProxies}
                                            disabled={loading || !selectedSubUser}
                                            className={`w-full ${accentBtn}`}
                                        >
                                            {loading ? (
                                                <span className="flex items-center justify-center gap-2">
                                                    <svg className="w-4 h-4 animate-spin" viewBox="0 0 24 24" fill="none"><circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4"/><path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4z"/></svg>
                                                    Генерация...
                                                </span>
                                            ) : (
                                                <span className="flex items-center justify-center gap-2">
                                                    <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M13 10V3L4 14h7v7l9-11h-7z" /></svg>
                                                    Сгенерировать {proxyCount} прокси
                                                </span>
                                            )}
                                        </button>

                                        {/* Generated proxies */}
                                        {generatedProxies.length > 0 && (
                                            <div className="mt-2 bg-[#111] border border-[#252525] rounded-lg overflow-hidden">
                                                <div className="flex items-center justify-between px-4 py-2.5 border-b border-[#222] bg-[#141414]">
                                                    <span className="text-xs font-medium text-gray-400">
                                                        Результат: {generatedProxies.length} прокси
                                                    </span>
                                                    <button onClick={handleCopyProxies} className="text-xs text-[#4a6cf7] hover:text-[#6b8aff] transition-colors font-medium flex items-center gap-1">
                                                        <svg className="w-3 h-3" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M8 16H6a2 2 0 01-2-2V6a2 2 0 012-2h8a2 2 0 012 2v2m-6 12h8a2 2 0 002-2v-8a2 2 0 00-2-2h-8a2 2 0 00-2 2v8a2 2 0 002 2z" /></svg>
                                                        Копировать
                                                    </button>
                                                </div>
                                                <div className="max-h-44 overflow-y-auto p-3 font-mono text-[11px] leading-[1.7] text-gray-500 select-all scrollbar-thin">
                                                    {generatedProxies.map((p, i) => (
                                                        <div key={i} className="hover:text-gray-300 transition-colors">{p}</div>
                                                    ))}
                                                </div>
                                                <div className="px-4 py-3 border-t border-[#222] bg-[#141414]">
                                                    <button
                                                        onClick={handleImportProxies}
                                                        disabled={loading}
                                                        className="w-full py-2.5 bg-emerald-600 hover:bg-emerald-700 active:bg-emerald-800 text-white rounded-lg text-sm font-medium transition-all disabled:opacity-40 flex items-center justify-center gap-2"
                                                    >
                                                        {loading ? (
                                                            <>
                                                                <svg className="w-4 h-4 animate-spin" viewBox="0 0 24 24" fill="none"><circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4"/><path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4z"/></svg>
                                                                Импорт...
                                                            </>
                                                        ) : (
                                                            <>
                                                                <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M4 16v1a3 3 0 003 3h10a3 3 0 003-3v-1m-4-4l-4 4m0 0l-4-4m4 4V4" /></svg>
                                                                Импортировать {generatedProxies.length} прокси
                                                            </>
                                                        )}
                                                    </button>
                                                </div>
                                            </div>
                                        )}
                                    </div>
                                )}

                                {/* ===== WHITELIST TAB ===== */}
                                {tab === 'whitelist' && (
                                    <div className="space-y-4">
                                        {!selectedSubUser ? (
                                            <div className="py-12 text-center">
                                                <div className="w-12 h-12 rounded-xl bg-[#1e1e1e] flex items-center justify-center mx-auto mb-3">
                                                    <svg className="w-5 h-5 text-gray-600" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                                                        <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.5} d="M9 12l2 2 4-4m5.618-4.016A11.955 11.955 0 0112 2.944a11.955 11.955 0 01-8.618 3.04A12.02 12.02 0 003 9c0 5.591 3.824 10.29 9 11.622 5.176-1.332 9-6.03 9-11.622 0-1.042-.133-2.052-.382-3.016z" />
                                                    </svg>
                                                </div>
                                                <p className="text-sm text-gray-500">Сначала выберите SubUser</p>
                                                <p className="text-xs text-gray-600 mt-1">Перейдите на вкладку SubUsers</p>
                                            </div>
                                        ) : (
                                            <>
                                                <div className="flex gap-2">
                                                    <div className="flex-1 relative">
                                                        <input
                                                            type="text"
                                                            value={myIp}
                                                            readOnly
                                                            className="w-full px-3.5 py-2.5 bg-[#0f0f0f] border border-[#2a2a2a] rounded-lg text-sm text-white font-mono pr-20"
                                                            placeholder="Определение IP..."
                                                        />
                                                        <button
                                                            onClick={loadMyIp}
                                                            className="absolute right-2 top-1/2 -translate-y-1/2 px-2 py-1 text-[11px] text-gray-500 hover:text-white bg-[#1e1e1e] hover:bg-[#252525] rounded transition-all"
                                                        >
                                                            Обновить
                                                        </button>
                                                    </div>
                                                    <button
                                                        onClick={handleAddToWhitelist}
                                                        disabled={!myIp || loading}
                                                        className="px-5 py-2.5 bg-[#4a6cf7] hover:bg-[#3d5de0] disabled:bg-[#222] disabled:text-gray-600 text-white rounded-lg text-sm font-medium transition-all shrink-0"
                                                    >
                                                        Добавить
                                                    </button>
                                                </div>

                                                {whitelistLoading ? (
                                                    <div className="text-center py-8 text-gray-500 text-sm">Загрузка...</div>
                                                ) : whitelist.length > 0 ? (
                                                    <div>
                                                        <div className="text-[11px] font-semibold text-gray-500 uppercase tracking-wider mb-2">IP в whitelist ({whitelist.length})</div>
                                                        <div className="space-y-1.5">
                                                            {whitelist.map((entry: any, i: number) => {
                                                                const ip = typeof entry === 'string' ? entry : entry.ip || JSON.stringify(entry);
                                                                return (
                                                                    <div key={i} className="flex items-center justify-between px-3.5 py-2.5 bg-[#111] border border-[#222] rounded-lg group hover:border-[#2a2a2a] transition-colors">
                                                                        <div className="flex items-center gap-2.5">
                                                                            <div className="w-2 h-2 rounded-full bg-emerald-500/60"></div>
                                                                            <span className="text-sm text-gray-300 font-mono">{ip}</span>
                                                                        </div>
                                                                        <button
                                                                            onClick={() => handleRemoveFromWhitelist(ip)}
                                                                            className="text-xs text-gray-600 hover:text-red-400 opacity-0 group-hover:opacity-100 transition-all font-medium"
                                                                        >
                                                                            Удалить
                                                                        </button>
                                                                    </div>
                                                                );
                                                            })}
                                                        </div>
                                                    </div>
                                                ) : (
                                                    <div className="py-12 text-center">
                                                        <div className="w-12 h-12 rounded-xl bg-[#1e1e1e] flex items-center justify-center mx-auto mb-3">
                                                            <svg className="w-5 h-5 text-gray-600" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                                                                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.5} d="M9 12l2 2 4-4m5.618-4.016A11.955 11.955 0 0112 2.944a11.955 11.955 0 01-8.618 3.04A12.02 12.02 0 003 9c0 5.591 3.824 10.29 9 11.622 5.176-1.332 9-6.03 9-11.622 0-1.042-.133-2.052-.382-3.016z" />
                                                            </svg>
                                                        </div>
                                                        <p className="text-sm text-gray-500">Whitelist пуст</p>
                                                        <p className="text-xs text-gray-600 mt-1">Добавьте IP для авторизации без логина</p>
                                                    </div>
                                                )}
                                            </>
                                        )}
                                    </div>
                                )}

                                {/* ===== SUBUSERS TAB ===== */}
                                {tab === 'subusers' && (
                                    <div className="space-y-4">
                                        <div className="flex gap-2">
                                            <button
                                                onClick={() => handleCreateSubUser('residential-proxy-pool-1')}
                                                disabled={creatingSubUser}
                                                className="px-4 py-2 bg-[#4a6cf7] hover:bg-[#3d5de0] text-white rounded-lg text-xs font-medium transition-all disabled:opacity-50 flex items-center gap-1.5"
                                            >
                                                <svg className="w-3.5 h-3.5" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 6v6m0 0v6m0-6h6m-6 0H6" /></svg>
                                                {creatingSubUser ? 'Создание...' : 'Pool-1'}
                                            </button>
                                            <button
                                                onClick={() => handleCreateSubUser('residential-proxy-pool-2')}
                                                disabled={creatingSubUser}
                                                className="px-4 py-2 bg-[#1e1e1e] hover:bg-[#252525] text-gray-300 rounded-lg text-xs font-medium transition-all border border-[#2a2a2a] disabled:opacity-50 flex items-center gap-1.5"
                                            >
                                                <svg className="w-3.5 h-3.5" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 6v6m0 0v6m0-6h6m-6 0H6" /></svg>
                                                {creatingSubUser ? 'Создание...' : 'Pool-2'}
                                            </button>
                                            <button
                                                onClick={loadSubUsers}
                                                className="px-3 py-2 bg-[#1e1e1e] hover:bg-[#252525] text-gray-400 rounded-lg text-xs transition-all border border-[#2a2a2a] ml-auto"
                                                title="Обновить"
                                            >
                                                <svg className="w-3.5 h-3.5" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M4 4v5h.582m15.356 2A8.001 8.001 0 004.582 9m0 0H9m11 11v-5h-.581m0 0a8.003 8.003 0 01-15.357-2m15.357 2H15" /></svg>
                                            </button>
                                        </div>

                                        {subUsers.length === 0 ? (
                                            <div className="py-12 text-center">
                                                <div className="w-12 h-12 rounded-xl bg-[#1e1e1e] flex items-center justify-center mx-auto mb-3">
                                                    <svg className="w-5 h-5 text-gray-600" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                                                        <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.5} d="M17 20h5v-2a3 3 0 00-5.356-1.857M17 20H7m10 0v-2c0-.656-.126-1.283-.356-1.857M7 20H2v-2a3 3 0 015.356-1.857M7 20v-2c0-.656.126-1.283.356-1.857m0 0a5.002 5.002 0 019.288 0M15 7a3 3 0 11-6 0 3 3 0 016 0zm6 3a2 2 0 11-4 0 2 2 0 014 0zM7 10a2 2 0 11-4 0 2 2 0 014 0z" />
                                                    </svg>
                                                </div>
                                                <p className="text-sm text-gray-500">Нет SubUser'ов</p>
                                                <p className="text-xs text-gray-600 mt-1">Создайте SubUser для начала работы</p>
                                            </div>
                                        ) : (
                                            <div className="space-y-2">
                                                {subUsers.map(su => {
                                                    const isSelected = selectedSubUser?.id === su.id;
                                                    return (
                                                        <div
                                                            key={su.id}
                                                            className={`flex items-center justify-between px-4 py-3 rounded-lg border transition-all cursor-pointer ${
                                                                isSelected
                                                                    ? 'bg-[#4a6cf7]/5 border-[#4a6cf7]/25'
                                                                    : 'bg-[#111] border-[#222] hover:border-[#333]'
                                                            }`}
                                                            onClick={() => setSelectedSubUser(su)}
                                                        >
                                                            <div className="flex items-center gap-3 min-w-0">
                                                                <div className={`w-8 h-8 rounded-lg flex items-center justify-center text-xs font-bold shrink-0 ${
                                                                    isSelected ? 'bg-[#4a6cf7]/15 text-[#4a6cf7]' : 'bg-[#1e1e1e] text-gray-500'
                                                                }`}>
                                                                    {su.id}
                                                                </div>
                                                                <div className="min-w-0">
                                                                    <div className="flex items-center gap-2">
                                                                        <span className="text-sm text-white font-medium">
                                                                            {su.data.username || `SubUser #${su.id}`}
                                                                        </span>
                                                                        <span className={`text-[10px] px-1.5 py-0.5 rounded font-medium ${
                                                                            su.type.includes('pool-1') ? 'bg-[#4a6cf7]/10 text-[#6b8aff]' : 'bg-teal-500/10 text-teal-400'
                                                                        }`}>
                                                                            {su.type.includes('pool-1') ? 'POOL-1' : su.type.includes('pool-2') ? 'POOL-2' : su.type.split('-').pop()?.toUpperCase()}
                                                                        </span>
                                                                        {isSelected && (
                                                                            <svg className="w-3.5 h-3.5 text-[#4a6cf7]" fill="currentColor" viewBox="0 0 20 20"><path fillRule="evenodd" d="M16.707 5.293a1 1 0 010 1.414l-8 8a1 1 0 01-1.414 0l-4-4a1 1 0 011.414-1.414L8 12.586l7.293-7.293a1 1 0 011.414 0z" clipRule="evenodd" /></svg>
                                                                        )}
                                                                    </div>
                                                                    <div className="flex items-center gap-3 mt-0.5 text-xs text-gray-500">
                                                                        <span>
                                                                            <span className="text-emerald-400 font-medium">{getTrafficValue(su.data.traffic_available)}</span> GB доступно
                                                                        </span>
                                                                        <span className="text-gray-600">
                                                                            {getTrafficValue(su.data.traffic_used)} GB исп.
                                                                        </span>
                                                                    </div>
                                                                </div>
                                                            </div>
                                                            <button
                                                                onClick={(e) => { e.stopPropagation(); handleDeleteSubUser(su.id); }}
                                                                className="p-2 text-gray-700 hover:text-red-400 hover:bg-red-500/5 rounded-lg transition-all shrink-0"
                                                                title="Удалить"
                                                            >
                                                                <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                                                                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.8} d="M19 7l-.867 12.142A2 2 0 0116.138 21H7.862a2 2 0 01-1.995-1.858L5 7m5 4v6m4-6v6m1-10V4a1 1 0 00-1-1h-4a1 1 0 00-1 1v3M4 7h16" />
                                                                </svg>
                                                            </button>
                                                        </div>
                                                    );
                                                })}
                                            </div>
                                        )}

                                        <div className="flex items-start gap-2 bg-[#111] border border-[#222] rounded-lg px-3.5 py-3">
                                            <svg className="w-4 h-4 text-gray-600 shrink-0 mt-0.5" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.5} d="M13 16h-1v-4h-1m1-4h.01M21 12a9 9 0 11-18 0 9 9 0 0118 0z" /></svg>
                                            <p className="text-xs text-gray-500 leading-relaxed">
                                                <span className="text-gray-400">SubUser</span> — подключение к пулу с отдельным балансом.{' '}
                                                <span className="text-gray-400">Pool-1</span> — ротация через шлюз, по GB.{' '}
                                                <span className="text-gray-400">Pool-2</span> — статичные сессии.
                                            </p>
                                        </div>
                                    </div>
                                )}
                            </div>
                        </div>
                    )}
                </div>
            </div>
        </div>
    );
}
