import { useState, useEffect } from 'react';
import { useNotification } from '../utils/notifications';
import * as api from '../api';
import { openExternal } from '../utils/external';
import { tauriFetch } from '../utils/http';

interface CyberYozhModalProps {
    isOpen: boolean;
    onClose: () => void;
    onProxiesImported: () => void;
}

interface ShopProxy {
    id: string;
    name: string;
    country_code: string;
    access_type: string;
    category: string;
    price: number;
    currency: string;
    stock_status: string;
    traffic_gb: number;  // Трафик в GB
    duration_days: number;  // Срок в днях
}

interface HistoryProxy {
    id: string;
    url: string;
    connection_login: string;
    connection_password: string;
    connection_host: string;
    connection_port: number;
    public_ipaddress: string;
    system_status: string;
    expired: boolean;
    geoip?: {
        countryCode2?: string;
        district?: string;
    };
}

export default function CyberYozhModal({ isOpen, onClose, onProxiesImported }: CyberYozhModalProps) {
    const { showNotification } = useNotification();
    const [view, setView] = useState<'login' | 'main' | 'shop' | 'import'>('login');
    const [apiKey, setApiKey] = useState('');
    const [balance, setBalance] = useState('0.00');
    const [shopProxies, setShopProxies] = useState<ShopProxy[]>([]);
    const [myProxies, setMyProxies] = useState<HistoryProxy[]>([]);
    const [selectedProxies, setSelectedProxies] = useState<Set<string>>(new Set());

    // Фильтры для магазина
    const [countryFilter, setCountryFilter] = useState('');
    const [categoryFilter, setCategoryFilter] = useState('');

    useEffect(() => {
        if (isOpen && view === 'login') {
            const saved = localStorage.getItem('cyberyozh_api_key');
            if (saved) {
                setApiKey(saved);
            }
        }
    }, [isOpen, view]);

    const handleLogin = async () => {
        if (!apiKey.trim()) {
            showNotification('Ошибка', 'Введите API ключ', 'warning');
            return;
        }

        console.log('[CyberYozh] Проверка API ключа...', apiKey.substring(0, 10) + '...');
        try {
            // Баланс доступен только на v2
            console.log('[CyberYozh] Отправка запроса на баланс...');
            const response = await tauriFetch('https://app.cyberyozh.com/api/v2/users/balance/', {
                headers: {
                    'X-Api-Key': apiKey,
                    'User-Agent': 'Antic Browser v1.0.0'
                }
            });
            console.log('[CyberYozh] Ответ сервера:', response.status, response.statusText);

            if (!response.ok) {
                if (response.status === 401 || response.status === 403) {
                    showNotification('Ошибка', 'Неверный API ключ', 'error');
                } else {
                    showNotification('Ошибка', `Ошибка сервера: ${response.status}`, 'error');
                }
                return;
            }

            const balanceText = await response.text();
            const balanceValue = balanceText.replace('$', '').trim();
            setBalance(balanceValue);

            localStorage.setItem('cyberyozh_api_key', apiKey);
            setView('main');
            showNotification('Успех', `API ключ проверен. Баланс: $${balanceValue}`, 'success');
        } catch (error: any) {
            console.error('[CyberYozh] Ошибка API:', error);
            console.error('[CyberYozh] Тип ошибки:', error.constructor.name);
            console.error('[CyberYozh] Стек:', error.stack);
            showNotification('Ошибка', `Не удалось подключиться: ${error.message}`, 'error');
        }
    };

    const loadShopProxies = async () => {
        try {
            console.log('[CyberYozh] Загрузка магазина прокси...');
            
            const data = await api.cyberyozhGetShopProxies(
                apiKey,
                undefined,
                undefined
            );
            
            console.log('[CyberYozh] RAW DATA from Rust:', JSON.stringify(data.slice(0, 2), null, 2));
            console.log('[CyberYozh] Получено прокси:', data.length);
            console.log('[CyberYozh] Первый прокси:', data[0]);
            
            // Преобразуем CyberYozhShopItem в ShopProxy
            let allProxies: ShopProxy[] = data.map(item => {
                // Извлекаем первый код страны из location_country_code
                const countryCode = item.location_country_code ? 
                    item.location_country_code.split(',')[0].trim() : 'Global';
                
                // Парсим цену из строки в число
                const price = item.price_usd ? parseFloat(item.price_usd) : 0;
                
                // Конвертируем трафик из MB в GB
                const trafficGb = item.traffic_limitation ? Math.round(item.traffic_limitation / 1024) : 0;
                const durationDays = item.days || 30;
                
                console.log('[CyberYozh] Маппинг прокси:', {
                    title: item.title,
                    price_raw: item.price_usd,
                    price_parsed: price,
                    traffic_mb: item.traffic_limitation,
                    traffic_gb: trafficGb,
                    days: durationDays
                });
                
                return {
                    id: item.id,
                    name: item.title || 'Proxy',
                    country_code: countryCode,
                    access_type: item.proxy_category || item.proxy_protocol || 'http',
                    category: '',
                    price: isNaN(price) ? 0 : price,
                    currency: 'USD',
                    stock_status: item.stock_status || 'in_stock',
                    traffic_gb: trafficGb,
                    duration_days: durationDays
                };
            });
            
            console.log('[CyberYozh] После маппинга, первый прокси:', allProxies[0]);
            
            // Применяем фильтры на клиенте
            if (countryFilter) {
                allProxies = allProxies.filter(p => {
                    // Поиск в location_country_code (список через запятую)
                    const itemData = data.find(item => item.id === p.id);
                    if (!itemData || !itemData.location_country_code) return false;
                    
                    const countries = itemData.location_country_code.split(',').map(c => c.trim().toUpperCase());
                    return countries.includes(countryFilter.toUpperCase());
                });
            }
            if (categoryFilter) {
                allProxies = allProxies.filter(p => {
                    const category = categoryFilter.toLowerCase();
                    const accessType = p.access_type.toLowerCase();
                    
                    // Поиск по access_type (например "residential_rotating")
                    if (category === 'residential' && accessType.includes('residential')) return true;
                    if (category === 'mobile' && accessType.includes('mobile')) return true;
                    if (category === 'datacenter' && accessType.includes('datacenter')) return true;
                    
                    return false;
                });
            }
            
            console.log('[CyberYozh] После фильтрации:', allProxies.length);
            setShopProxies(allProxies);
        } catch (error: any) {
            console.error('[CyberYozh] Ошибка загрузки магазина:', error);
            showNotification('Ошибка', `Не удалось загрузить магазин прокси: ${error}`, 'error');
        }
    };

    const loadMyProxies = async () => {
        try {
            const response = await tauriFetch('https://app.cyberyozh.com/api/v1/proxies/history/', {
                headers: {
                    'X-Api-Key': apiKey,
                    'User-Agent': 'Antic Browser v1.0.0'
                }
            });

            const data = await response.json();
            const proxiesList = Array.isArray(data) ? data : [];
            
            // Фильтруем только активные и не истекшие
            const activeProxies = proxiesList.filter((p: HistoryProxy) => 
                p.system_status === 'active' && !p.expired
            );
            
            setMyProxies(activeProxies);
        } catch (error) {
            showNotification('Ошибка', 'Не удалось загрузить список прокси', 'error');
        }
    };

    const handleBuyProxy = async (proxyId: string) => {
        try {
            const response = await tauriFetch('https://app.cyberyozh.com/api/v1/proxies/shop/buy_proxies/', {
                method: 'POST',
                headers: {
                    'X-Api-Key': apiKey,
                    'Content-Type': 'application/json',
                    'User-Agent': 'Antic Browser v1.0.0'
                },
                body: JSON.stringify([{ id: proxyId, auto_renew: false }])
            });

            if (!response.ok) {
                const error = await response.json();
                throw new Error(error.message || error.detail || 'Ошибка покупки');
            }

            const result = await response.json();
            
            if (Array.isArray(result) && result[0]) {
                const status = result[0].status;
                const message = result[0].message;

                if (status === 'in_progress') {
                    showNotification('Успех', 'Прокси успешно куплен!', 'success');
                    // Обновляем баланс
                    const balanceResp = await tauriFetch('https://app.cyberyozh.com/api/v2/users/balance/', {
                        headers: { 'X-Api-Key': apiKey, 'User-Agent': 'Antic Browser v1.0.0' }
                    });
                    const balanceText = await balanceResp.text();
                    setBalance(balanceText.replace('$', '').trim());
                } else {
                    throw new Error(message || 'Ошибка покупки');
                }
            }
        } catch (error: any) {
            const friendlyMessage = translateErrorMessage(error.message);
            showNotification('Ошибка', friendlyMessage, 'error');
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
                    try {
                        await api.addProxy(proxyStr);
                        imported++;
                    } catch (err) {
                        console.error('Ошибка добавления прокси:', err);
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

    const translateErrorMessage = (msg: string): string => {
        const mapping: Record<string, string> = {
            'Not enough money.': 'Недостаточно средств',
            'Request was throttled.': 'Слишком много запросов',
            'Invalid API Key': 'Неверный API ключ',
            'Bad Request': 'Некорректный запрос',
            'Unauthorized': 'Неавторизовано',
            'Forbidden': 'Доступ запрещён'
        };
        return mapping[msg] || msg;
    };

    if (!isOpen) return null;

    return (
        <div className="fixed inset-0 bg-black bg-opacity-50 flex items-center justify-center z-50">
            <div className="bg-white rounded-xl shadow-2xl w-full max-w-3xl max-h-[90vh] overflow-y-auto">
                {/* Header */}
                <div className="bg-black text-white px-6 py-4 flex justify-between items-center rounded-t-xl">
                    <h2 className="text-xl font-bold">Proxy CyberYozh</h2>
                    <button onClick={onClose} className="text-white hover:bg-gray-800 rounded p-1">
                        <svg className="w-6 h-6" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" />
                        </svg>
                    </button>
                </div>

                {/* Content */}
                <div className="p-6">
                    {view === 'login' && (
                        <div>
                            <div className="bg-pink-50 border border-pink-200 rounded-lg p-4 mb-4">
                                <p className="text-sm text-pink-800">
                                    🎁 <strong>Получите бонусы при регистрации</strong>
                                </p>
                            </div>

                            <h3 className="text-lg font-semibold mb-4">Авторизация</h3>
                            <input
                                type="text"
                                value={apiKey}
                                onChange={(e) => setApiKey(e.target.value)}
                                className="w-full border border-gray-300 rounded-lg px-4 py-3 mb-4 focus:ring-2 focus:ring-purple-500 focus:outline-none"
                                placeholder="API Ключ CyberYozh"
                            />
                            <div className="flex gap-3">
                                <button
                                    onClick={handleLogin}
                                    className="flex-1 bg-purple-600 hover:bg-purple-700 text-white py-3 rounded-lg font-medium"
                                >
                                    Проверить API ключ
                                </button>
                                <button
                                    onClick={async () => {
                                        console.log('[CyberYozh] Открываю ссылку для получения API ключа (логин экран)...');
                                        try {
                                            await openExternal('https://app.cyberyozh.com/ru/?utm_source=antic_browser_soft');
                                        } catch (err) {
                                            console.error('[CyberYozh] Не удалось открыть ссылку:', err);
                                            showNotification('Ошибка', 'Не удалось открыть ссылку', 'error');
                                        }
                                    }}
                                    className="flex-1 bg-blue-600 hover:bg-blue-700 text-white py-3 rounded-lg font-medium flex items-center justify-center gap-1"
                                >
                                    <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                                        <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M10 6H6a2 2 0 00-2 2v10a2 2 0 002 2h10a2 2 0 002-2v-4M14 4h6m0 0v6m0-6L10 14" />
                                    </svg>
                                    Получить ключ
                                </button>
                            </div>
                        </div>
                    )}

                    {view === 'main' && (
                        <div>
                            <div className="bg-green-50 border border-green-200 rounded-lg p-4 mb-6">
                                <p className="text-green-800 font-semibold">
                                    💰 Баланс: ${balance}
                                </p>
                            </div>

                            <div className="space-y-3">
                                <button
                                    onClick={() => {
                                        setView('shop');
                                        loadShopProxies();
                                    }}
                                    className="w-full bg-green-600 hover:bg-green-700 text-white py-3 rounded-lg font-medium"
                                >
                                    Создать прокси
                                </button>
                                <button
                                    onClick={() => {
                                        setView('import');
                                        loadMyProxies();
                                    }}
                                    className="w-full bg-blue-600 hover:bg-blue-700 text-white py-3 rounded-lg font-medium"
                                >
                                    Импортировать прокси
                                </button>
                            </div>

                            <div className="mt-4 text-center">
                                <p className="text-sm text-green-600">
                                    Промокод <strong>CYBERYOZH2025</strong> — скидка 10% при пополнении
                                </p>
                            </div>
                        </div>
                    )}

                    {view === 'shop' && (
                        <div>
                            <button onClick={() => setView('main')} className="text-blue-600 hover:underline mb-4 flex items-center gap-1">
                                ← Назад
                            </button>

                            <h3 className="text-lg font-semibold mb-4">Магазин прокси CyberYozh</h3>

                            {/* Фильтры */}
                            <div className="grid grid-cols-1 md:grid-cols-3 gap-3 mb-4">
                                <select
                                    value={countryFilter}
                                    onChange={(e) => setCountryFilter(e.target.value)}
                                    className="border border-gray-300 rounded-lg px-4 py-2"
                                >
                                    <option value="">Страна (ISO код)</option>
                                    <option value="us">United States (US)</option>
                                    <option value="ru">Russia (RU)</option>
                                    <option value="de">Germany (DE)</option>
                                    <option value="gb">United Kingdom (GB)</option>
                                    <option value="fr">France (FR)</option>
                                </select>

                                <select
                                    value={categoryFilter}
                                    onChange={(e) => setCategoryFilter(e.target.value)}
                                    className="border border-gray-300 rounded-lg px-4 py-2"
                                >
                                    <option value="">Категория</option>
                                    <option value="residential">Residential</option>
                                    <option value="mobile">Mobile</option>
                                    <option value="datacenter">Datacenter</option>
                                </select>

                                <button
                                    onClick={loadShopProxies}
                                    className="bg-blue-600 hover:bg-blue-700 text-white px-4 py-2 rounded-lg"
                                >
                                    Искать в магазине
                                </button>
                            </div>

                            {/* Список доступных прокси */}
                            <div className="space-y-3 max-h-96 overflow-y-auto">
                                <h4 className="font-semibold">Доступные прокси</h4>
                                {shopProxies.length === 0 ? (
                                    <p className="text-gray-500 text-center py-8">
                                        Нет доступных прокси. Попробуйте изменить фильтры.
                                    </p>
                                ) : (
                                    shopProxies.map(proxy => (
                                        <div key={proxy.id} className="border border-gray-200 rounded-lg p-4 hover:border-blue-300 transition">
                                            <div className="flex items-start justify-between">
                                                <div className="flex-1">
                                                    <div className="flex items-center gap-2 mb-2">
                                                        <span className="bg-gradient-to-r from-blue-500 to-indigo-600 text-white text-xs px-2 py-1 rounded font-bold">
                                                            {proxy.country_code === 'Global' ? '🌍 Global' : proxy.country_code}
                                                        </span>
                                                        <span className="bg-gradient-to-r from-teal-500 to-emerald-600 text-white text-xs px-2 py-1 rounded">
                                                            {proxy.access_type.replace('_', ' ')}
                                                        </span>
                                                    </div>
                                                    <p className="font-medium text-sm mb-2">{proxy.name}</p>
                                                    
                                                    <div className="flex gap-4 text-xs text-gray-600 mb-2">
                                                        <div className="flex items-center gap-1">
                                                            <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                                                                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 8v4l3 3m6-3a9 9 0 11-18 0 9 9 0 0118 0z" />
                                                            </svg>
                                                            <span>{proxy.duration_days} дней ({Math.round(proxy.duration_days / 30)} мес.)</span>
                                                        </div>
                                                        <div className="flex items-center gap-1">
                                                            <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                                                                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M7 16a4 4 0 01-.88-7.903A5 5 0 1115.9 6L16 6a5 5 0 011 9.9M15 13l-3-3m0 0l-3 3m3-3v12" />
                                                            </svg>
                                                            <span>{proxy.traffic_gb} GB</span>
                                                        </div>
                                                    </div>
                                                    
                                                    <div className="text-lg font-bold text-blue-600">
                                                        ${proxy.price.toFixed(2)} {proxy.currency}
                                                    </div>
                                                </div>
                                                
                                                <button
                                                    onClick={() => handleBuyProxy(proxy.id)}
                                                    disabled={proxy.stock_status === 'out_of_stock'}
                                                    className={`px-4 py-2 rounded-lg font-medium transition ${
                                                        proxy.stock_status === 'out_of_stock' 
                                                            ? 'bg-gray-400 cursor-not-allowed text-white' 
                                                            : 'bg-green-600 hover:bg-green-700 text-white'
                                                    }`}
                                                >
                                                    {proxy.stock_status === 'out_of_stock' ? 'Нет в наличии' : 'Купить'}
                                                </button>
                                            </div>
                                        </div>
                                    ))
                                )}
                            </div>
                        </div>
                    )}

                    {view === 'import' && (
                        <div>
                            <button onClick={() => setView('main')} className="text-blue-600 hover:underline mb-4 flex items-center gap-1">
                                ← Назад
                            </button>

                            <h3 className="text-lg font-semibold mb-4">Импорт прокси CyberYozh</h3>

                            <p className="text-sm text-gray-600 mb-4">
                                Выберите прокси для импорта в Antic Browser:
                            </p>

                            {myProxies.length === 0 ? (
                                <div className="text-center py-8">
                                    <p className="text-gray-500 mb-4">Нет доступных прокси. Купите прокси в магазине.</p>
                                    <button
                                        onClick={() => {
                                            setView('shop');
                                            loadShopProxies();
                                        }}
                                        className="bg-green-600 hover:bg-green-700 text-white px-6 py-2 rounded-lg"
                                    >
                                        Перейти в магазин
                                    </button>
                                </div>
                            ) : (
                                <>
                                    <button
                                        onClick={handleImportSelected}
                                        className="bg-green-600 hover:bg-green-700 text-white px-4 py-2 rounded-lg mb-4"
                                        disabled={selectedProxies.size === 0}
                                    >
                                        Импортировать выбранные ({selectedProxies.size})
                                    </button>

                                    <div className="space-y-2 max-h-96 overflow-y-auto">
                                        {myProxies.map(proxy => (
                                            <label key={proxy.id} className="flex items-center p-3 border border-gray-200 rounded-lg hover:bg-gray-50 cursor-pointer">
                                                <input
                                                    type="checkbox"
                                                    checked={selectedProxies.has(proxy.id)}
                                                    onChange={(e) => {
                                                        const newSet = new Set(selectedProxies);
                                                        if (e.target.checked) {
                                                            newSet.add(proxy.id);
                                                        } else {
                                                            newSet.delete(proxy.id);
                                                        }
                                                        setSelectedProxies(newSet);
                                                    }}
                                                    className="mr-3"
                                                />
                                                <div className="flex-1">
                                                    <p className="font-medium">
                                                        {proxy.geoip?.countryCode2 || 'Unknown'} - {proxy.public_ipaddress}
                                                    </p>
                                                    <p className="text-sm text-gray-600">
                                                        {proxy.connection_host}:{proxy.connection_port}
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
