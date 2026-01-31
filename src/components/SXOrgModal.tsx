import { useState, useEffect } from 'react';
import { useNotification } from '../utils/notifications';
import * as api from '../api';
import { openExternal } from '../utils/external';

interface SXOrgModalProps {
    isOpen: boolean;
    onClose: () => void;
    onProxiesImported: () => void;
}

interface Country {
    id: number;
    name: string;
    code: string;
}

interface State {
    id: number;
    name: string;
}

interface City {
    id: number;
    name: string;
}

interface ProxyPort {
    id: number;
    name: string;
    server: string;
    port: number;
    login: string;
    password: string;
    country_code: string;
}

export default function SXOrgModal({ isOpen, onClose, onProxiesImported }: SXOrgModalProps) {
    const { showNotification } = useNotification();
    const [view, setView] = useState<'login' | 'main' | 'create' | 'import'>('login');
    const [apiKey, setApiKey] = useState('');
    const [balance, setBalance] = useState('0.00');
    const [countries, setCountries] = useState<Country[]>([]);
    const [states, setStates] = useState<State[]>([]);
    const [cities, setCities] = useState<City[]>([]);
    const [ports, setPorts] = useState<ProxyPort[]>([]);
    const [selectedPorts, setSelectedPorts] = useState<Set<number>>(new Set());

    // Форма создания
    const [selectedCountry, setSelectedCountry] = useState<Country | null>(null);
    const [selectedState, setSelectedState] = useState<State | null>(null);
    const [selectedCity, setSelectedCity] = useState<City | null>(null);
    const [connectionType, setConnectionType] = useState<'keep-connection' | 'rotate-connection'>('keep-connection');
    const [proxyTypes, setProxyTypes] = useState<string[]>(['residential']);

    useEffect(() => {
        if (isOpen && view === 'login') {
            // Попытка загрузить сохраненный API ключ
            const saved = localStorage.getItem('sxorg_api_key');
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

        console.log('[SX.ORG] Проверка API ключа...', apiKey.substring(0, 10) + '...');
        try {
            const response = await fetch(`https://api.sx.org/v2/plan/info?apiKey=${apiKey}`, {
                headers: { 'User-Agent': 'Antic Browser v1.0.0' }
            });
            console.log('[SX.ORG] Ответ сервера:', response.status, response.statusText);
            const data = await response.json();
            console.log('[SX.ORG] Данные плана:', data);

            if (!data.success) {
                showNotification('Ошибка', 'Неверный API ключ', 'error');
                return;
            }

            // Получаем баланс
            const balanceResp = await fetch(`https://api.sx.org/v2/user/balance?apiKey=${apiKey}`, {
                headers: { 'User-Agent': 'Antic Browser v1.0.0' }
            });
            const balanceData = await balanceResp.json();
            setBalance(balanceData.balance || '0.00');

            // Получаем страны
            const countriesResp = await fetch(`https://api.sx.org/v2/dir/countries?apiKey=${apiKey}`, {
                headers: { 'User-Agent': 'Antic Browser v1.0.0' }
            });
            const countriesData = await countriesResp.json();
            if (countriesData.success) {
                setCountries(countriesData.countries);
            }

            localStorage.setItem('sxorg_api_key', apiKey);
            setView('main');
            showNotification('Успех', 'API ключ проверен', 'success');
        } catch (error: any) {
            showNotification('Ошибка', `Не удалось подключиться: ${error.message}`, 'error');
        }
    };

    const loadStates = async (countryId: number) => {
        try {
            const resp = await fetch(`https://api.sx.org/v2/dir/states?apiKey=${apiKey}&countryId=${countryId}`, {
                headers: { 'User-Agent': 'Antic Browser v1.0.0' }
            });
            const data = await resp.json();
            if (data.success) {
                setStates(data.states);
            }
        } catch (error) {
            console.error('Failed to load states:', error);
        }
    };

    const loadCities = async (stateId: number, countryId: number) => {
        try {
            const resp = await fetch(`https://api.sx.org/v2/dir/cities?apiKey=${apiKey}&stateId=${stateId}&countryId=${countryId}`, {
                headers: { 'User-Agent': 'Antic Browser v1.0.0' }
            });
            const data = await resp.json();
            if (data.success) {
                setCities(data.cities);
            }
        } catch (error) {
            console.error('Failed to load cities:', error);
        }
    };

    const handleCountryChange = (countryId: number) => {
        const country = countries.find(c => c.id === countryId);
        setSelectedCountry(country || null);
        setSelectedState(null);
        setSelectedCity(null);
        setStates([]);
        setCities([]);
        if (country) {
            loadStates(countryId);
        }
    };

    const handleStateChange = (stateId: number) => {
        const state = states.find(s => s.id === stateId);
        setSelectedState(state || null);
        setSelectedCity(null);
        setCities([]);
        if (state && selectedCountry) {
            loadCities(stateId, selectedCountry.id);
        }
    };

    const handleCreateProxy = async () => {
        if (!selectedCountry) {
            showNotification('Ошибка', 'Выберите страну', 'warning');
            return;
        }

        try {
            const typeMap = { 'keep-connection': 2, 'rotate-connection': 3 };
            const proxyTypeId = proxyTypes.includes('residential') ? 1 : proxyTypes.includes('mobile') ? 3 : 4;

            const requestData = {
                country_code: selectedCountry.code,
                state: selectedState?.name || '',
                city: selectedCity?.name || '',
                type_id: typeMap[connectionType],
                proxy_type_id: proxyTypeId,
                server_port_type_id: 0,
                name: `Antic_${Date.now()}`
            };

            const resp = await fetch(`https://api.sx.org/v2/proxy/create-port?apiKey=${apiKey}`, {
                method: 'POST',
                headers: {
                    'Content-Type': 'application/json',
                    'User-Agent': 'Antic Browser v1.0.0'
                },
                body: JSON.stringify(requestData)
            });

            const result = await resp.json();

            if (result.success) {
                const proxyData = Array.isArray(result.data) ? result.data : [result.data];
                let addedCount = 0;
                for (const p of proxyData) {
                    const proxyStr = `http://${p.login}:${p.password}@${p.server}:${p.port}`;
                    try {
                        await api.addProxy(proxyStr);
                        addedCount++;
                    } catch (err) {
                        console.error('Ошибка добавления прокси:', err);
                    }
                }
                showNotification('Успех', `Создано и добавлено ${addedCount} прокси`, 'success');
                setView('main');
                onProxiesImported();
            } else {
                showNotification('Ошибка', result.message || 'Не удалось создать прокси', 'error');
            }
        } catch (error: any) {
            showNotification('Ошибка', `Не удалось создать прокси: ${error.message}`, 'error');
        }
    };

    const loadPorts = async () => {
        try {
            const resp = await fetch(`https://api.sx.org/v2/proxy/ports?apiKey=${apiKey}`, {
                headers: { 'User-Agent': 'Antic Browser v1.0.0' }
            });
            const data = await resp.json();
            if (data.success && data.message?.proxies) {
                setPorts(data.message.proxies);
            }
        } catch (error) {
            showNotification('Ошибка', 'Не удалось загрузить список прокси', 'error');
        }
    };

    const handleImportSelected = async () => {
        if (selectedPorts.size === 0) {
            showNotification('Предупреждение', 'Выберите прокси для импорта', 'warning');
            return;
        }

        try {
            let imported = 0;
            for (const portId of selectedPorts) {
                const port = ports.find(p => p.id === portId);
                if (port) {
                    const proxyStr = `http://${port.login}:${port.password}@${port.server}:${port.port}`;
                    try {
                        await api.addProxy(proxyStr);
                        imported++;
                    } catch (err) {
                        console.error('Ошибка добавления прокси:', err);
                    }
                }
            }
            showNotification('Успех', `Импортировано ${imported} прокси`, 'success');
            setSelectedPorts(new Set());
            setView('main');
            onProxiesImported();
        } catch (error: any) {
            showNotification('Ошибка', `Ошибка импорта: ${error.message}`, 'error');
        }
    };

    if (!isOpen) return null;

    return (
        <div className="fixed inset-0 bg-black bg-opacity-50 flex items-center justify-center z-50">
            <div className="bg-white rounded-xl shadow-2xl w-full max-w-2xl max-h-[90vh] overflow-y-auto">
                {/* Header */}
                <div className="bg-purple-600 text-white px-6 py-4 flex justify-between items-center rounded-t-xl">
                    <h2 className="text-xl font-bold">Proxy SX.ORG</h2>
                    <button onClick={onClose} className="text-white hover:bg-purple-700 rounded p-1">
                        <svg className="w-6 h-6" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" />
                        </svg>
                    </button>
                </div>

                {/* Content */}
                <div className="p-6">
                    {view === 'login' && (
                        <div>
                            <div className="bg-yellow-50 border border-yellow-200 rounded-lg p-4 mb-4">
                                <p className="text-sm text-yellow-800">
                                    🎁 <strong>Промокод ANTIC3 = 3GB бесплатно</strong>
                                </p>
                            </div>

                            <h3 className="text-lg font-semibold mb-4">Авторизация</h3>
                            <input
                                type="text"
                                value={apiKey}
                                onChange={(e) => setApiKey(e.target.value)}
                                className="w-full border border-gray-300 rounded-lg px-4 py-3 mb-4 focus:ring-2 focus:ring-purple-500 focus:outline-none"
                                placeholder="API Ключ SX.ORG"
                            />
                            <div className="flex gap-3">
                                <button
                                    onClick={handleLogin}
                                    className="flex-1 bg-blue-600 hover:bg-blue-700 text-white py-3 rounded-lg font-medium"
                                >
                                    Войти
                                </button>
                                <button
                                    onClick={async () => {
                                        console.log('[SX.ORG] Открываю ссылку для получения API ключа...');
                                        try {
                                            await openExternal('https://my.sx.org/auth/login/?utm-source=antic');
                                        } catch (err) {
                                            console.error('[SX.ORG] Не удалось открыть ссылку:', err);
                                            showNotification('Ошибка', 'Не удалось открыть ссылку', 'error');
                                        }
                                    }}
                                    className="flex-1 bg-purple-600 hover:bg-purple-700 text-white py-3 rounded-lg font-medium"
                                >
                                    Получить API ключ
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
                                    onClick={() => setView('create')}
                                    className="w-full bg-green-600 hover:bg-green-700 text-white py-3 rounded-lg font-medium"
                                >
                                    Создать прокси
                                </button>
                                <button
                                    onClick={() => {
                                        setView('import');
                                        loadPorts();
                                    }}
                                    className="w-full bg-blue-600 hover:bg-blue-700 text-white py-3 rounded-lg font-medium"
                                >
                                    Импортировать прокси
                                </button>
                            </div>
                        </div>
                    )}

                    {view === 'create' && (
                        <div>
                            <button onClick={() => setView('main')} className="text-blue-600 hover:underline mb-4 flex items-center gap-1">
                                ← Назад
                            </button>

                            <h3 className="text-lg font-semibold mb-4">Создание нового прокси</h3>

                            <div className="space-y-4">
                                {/* Страна */}
                                <div>
                                    <label className="block text-sm font-medium text-gray-700 mb-2">Страна *</label>
                                    <select
                                        value={selectedCountry?.id || ''}
                                        onChange={(e) => handleCountryChange(Number(e.target.value))}
                                        className="w-full border border-gray-300 rounded-lg px-4 py-2"
                                    >
                                        <option value="">Выберите страну</option>
                                        {countries.map(country => (
                                            <option key={country.id} value={country.id}>{country.name}</option>
                                        ))}
                                    </select>
                                </div>

                                {/* Штат/Область */}
                                <div>
                                    <label className="block text-sm font-medium text-gray-700 mb-2">Штат/Область</label>
                                    <select
                                        value={selectedState?.id || ''}
                                        onChange={(e) => handleStateChange(Number(e.target.value))}
                                        className="w-full border border-gray-300 rounded-lg px-4 py-2"
                                        disabled={states.length === 0}
                                    >
                                        <option value="">Не выбрано</option>
                                        {states.map(state => (
                                            <option key={state.id} value={state.id}>{state.name}</option>
                                        ))}
                                    </select>
                                </div>

                                {/* Город */}
                                <div>
                                    <label className="block text-sm font-medium text-gray-700 mb-2">Город</label>
                                    <select
                                        value={selectedCity?.id || ''}
                                        onChange={(e) => {
                                            const city = cities.find(c => c.id === Number(e.target.value));
                                            setSelectedCity(city || null);
                                        }}
                                        className="w-full border border-gray-300 rounded-lg px-4 py-2"
                                        disabled={cities.length === 0}
                                    >
                                        <option value="">Не выбрано</option>
                                        {cities.map(city => (
                                            <option key={city.id} value={city.id}>{city.name}</option>
                                        ))}
                                    </select>
                                </div>

                                {/* Тип соединения */}
                                <div>
                                    <label className="block text-sm font-medium text-gray-700 mb-2">Тип соединения:</label>
                                    <div className="space-y-2">
                                        <label className="flex items-center">
                                            <input
                                                type="radio"
                                                checked={connectionType === 'keep-connection'}
                                                onChange={() => setConnectionType('keep-connection')}
                                                className="mr-2"
                                            />
                                            Без ротации
                                        </label>
                                        <label className="flex items-center">
                                            <input
                                                type="radio"
                                                checked={connectionType === 'rotate-connection'}
                                                onChange={() => setConnectionType('rotate-connection')}
                                                className="mr-2"
                                            />
                                            С ротацией
                                        </label>
                                    </div>
                                </div>

                                {/* Типы прокси */}
                                <div>
                                    <label className="block text-sm font-medium text-gray-700 mb-2">Типы прокси:</label>
                                    <div className="flex gap-4">
                                        <label className="flex items-center">
                                            <input
                                                type="checkbox"
                                                checked={proxyTypes.includes('residential')}
                                                onChange={(e) => {
                                                    if (e.target.checked) {
                                                        setProxyTypes(['residential']);
                                                    }
                                                }}
                                                className="mr-2"
                                            />
                                            Residential
                                        </label>
                                        <label className="flex items-center">
                                            <input
                                                type="checkbox"
                                                checked={proxyTypes.includes('mobile')}
                                                onChange={(e) => {
                                                    if (e.target.checked) {
                                                        setProxyTypes(['mobile']);
                                                    }
                                                }}
                                                className="mr-2"
                                            />
                                            Mobile
                                        </label>
                                        <label className="flex items-center">
                                            <input
                                                type="checkbox"
                                                checked={proxyTypes.includes('corporate')}
                                                onChange={(e) => {
                                                    if (e.target.checked) {
                                                        setProxyTypes(['corporate']);
                                                    }
                                                }}
                                                className="mr-2"
                                            />
                                            Corporate
                                        </label>
                                    </div>
                                </div>

                                <button
                                    onClick={handleCreateProxy}
                                    className="w-full bg-green-600 hover:bg-green-700 text-white py-3 rounded-lg font-medium"
                                >
                                    Создать прокси
                                </button>
                            </div>
                        </div>
                    )}

                    {view === 'import' && (
                        <div>
                            <button onClick={() => setView('main')} className="text-blue-600 hover:underline mb-4 flex items-center gap-1">
                                ← Назад
                            </button>

                            <h3 className="text-lg font-semibold mb-4">Импорт существующих прокси</h3>

                            <div className="flex gap-3 mb-4">
                                <button
                                    onClick={loadPorts}
                                    className="bg-blue-600 hover:bg-blue-700 text-white px-4 py-2 rounded-lg"
                                >
                                    Обновить список
                                </button>
                                <button
                                    onClick={handleImportSelected}
                                    className="bg-green-600 hover:bg-green-700 text-white px-4 py-2 rounded-lg"
                                >
                                    Импортировать выбранные
                                </button>
                            </div>

                            <div className="space-y-2 max-h-96 overflow-y-auto">
                                {ports.length === 0 ? (
                                    <p className="text-gray-500 text-center py-8">Нет доступных прокси</p>
                                ) : (
                                    ports.map(port => (
                                        <label key={port.id} className="flex items-center p-3 border border-gray-200 rounded-lg hover:bg-gray-50 cursor-pointer">
                                            <input
                                                type="checkbox"
                                                checked={selectedPorts.has(port.id)}
                                                onChange={(e) => {
                                                    const newSet = new Set(selectedPorts);
                                                    if (e.target.checked) {
                                                        newSet.add(port.id);
                                                    } else {
                                                        newSet.delete(port.id);
                                                    }
                                                    setSelectedPorts(newSet);
                                                }}
                                                className="mr-3"
                                            />
                                            <div className="flex-1">
                                                <p className="font-medium">{port.name || `Proxy ${port.id}`}</p>
                                                <p className="text-sm text-gray-600">
                                                    {port.country_code} - {port.server}:{port.port}
                                                </p>
                                            </div>
                                        </label>
                                    ))
                                )}
                            </div>
                        </div>
                    )}
                </div>
            </div>
        </div>
    );
}
