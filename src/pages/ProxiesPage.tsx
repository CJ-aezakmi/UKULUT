import { useState, useEffect } from 'react';
import { Proxy, ProxyCheckResult } from '../types';
import * as api from '../api';
import { useNotification } from '../utils/notifications';
import SXOrgModal from '../components/SXOrgModal';
import CyberYozhModal from '../components/CyberYozhModal';
import PSBProxyModal from '../components/PSBProxyModal';

export default function ProxiesPage() {
    const { showNotification } = useNotification();
    const [proxies, setProxies] = useState<Proxy[]>([]);
    const [checking, setChecking] = useState<Record<string, boolean>>({});
    const [checkResults, setCheckResults] = useState<Record<string, ProxyCheckResult>>({});

    // Модальные окна
    const [showSXOrgModal, setShowSXOrgModal] = useState(false);
    const [showCyberYozhModal, setShowCyberYozhModal] = useState(false);
    const [showPSBProxyModal, setShowPSBProxyModal] = useState(false);

    // Форма ручного добавления
    const [quickInput, setQuickInput] = useState('');
    const [manualForm, setManualForm] = useState({
        host: '',
        port: '',
        protocol: 'http',
        username: '',
        password: '',
    });

    useEffect(() => {
        loadProxies();
    }, []);

    const loadProxies = async () => {
        try {
            const data = await api.getProxies();
            setProxies(data);

            // Загружаем сохранённые результаты проверки из Proxy данных
            const savedResults: Record<string, ProxyCheckResult> = {};
            data.forEach(proxy => {
                if (proxy.checked && proxy.country) {
                    savedResults[proxy.proxy_str] = {
                        status: 'working',
                        proxy_str: proxy.proxy_str,
                        country: proxy.country,
                        city: proxy.city || 'Unknown',
                        ip: proxy.host,
                        latency: proxy.latency || null,
                        error: null
                    };
                }
            });
            setCheckResults(savedResults);
        } catch (error) {
            showNotification('Ошибка', 'Не удалось загрузить прокси', 'error');
        }
    };

    const parseQuickInput = (input: string) => {
        const trimmed = input.trim();
        if (!trimmed) return;

        try {
            // Поддержка форматов:
            // IP:port:login:password
            // protocol://login:password@IP:port
            // protocol://IP:port
            // IP:port

            if (trimmed.includes('://')) {
                // URL формат
                const url = new URL(trimmed);
                setManualForm({
                    host: url.hostname,
                    port: url.port,
                    protocol: url.protocol.replace(':', ''),
                    username: url.username || '',
                    password: url.password || '',
                });
            } else {
                // IP:port:login:password формат
                const parts = trimmed.split(':');
                if (parts.length >= 2) {
                    setManualForm({
                        host: parts[0],
                        port: parts[1],
                        protocol: 'http',
                        username: parts[2] || '',
                        password: parts[3] || '',
                    });
                }
            }
        } catch (e) {
            // Тихо игнорируем ошибки парсинга
        }
    };

    const handleAddProxy = async () => {
        if (!manualForm.host || !manualForm.port) {
            showNotification('Ошибка', 'Введите хост и порт прокси', 'warning');
            return;
        }

        const proxyStr = manualForm.username
            ? `${manualForm.protocol}://${manualForm.username}:${manualForm.password}@${manualForm.host}:${manualForm.port}`
            : `${manualForm.protocol}://${manualForm.host}:${manualForm.port}`;

        try {
            await api.addProxy(proxyStr);
            await loadProxies();
            setManualForm({ host: '', port: '', protocol: 'http', username: '', password: '' });
            setQuickInput('');
            showNotification('Успех', 'Прокси добавлен', 'success');
        } catch (error: any) {
            showNotification('Ошибка', `Не удалось добавить прокси: ${error}`, 'error');
        }
    };

    const handleDelete = async (proxyStr: string) => {
        try {
            await api.removeProxy(proxyStr);
            await loadProxies();
            showNotification('Успех', 'Прокси удалён', 'success');
        } catch (error: any) {
            showNotification('Ошибка', `Не удалось удалить прокси: ${error}`, 'error');
        }
    };

    const handleCheckProxy = async (proxyStr: string) => {
        setChecking({ ...checking, [proxyStr]: true });
        try {
            const result = await api.checkProxy(proxyStr);
            setCheckResults({ ...checkResults, [proxyStr]: result });
            if (result.status === 'working') {
                showNotification('Прокси работает', `${result.country || '?'} | ${result.city || '?'}`, 'success', 3000);
            } else {
                showNotification('Прокси не работает', 'Не удалось подключиться', 'error', 3000);
            }
        } catch (error: any) {
            showNotification('Ошибка', `Не удалось проверить прокси: ${error}`, 'error');
        } finally {
            setChecking({ ...checking, [proxyStr]: false });
        }
    };

    return (
        <div className="p-6 bg-gradient-to-b from-blue-50 to-white min-h-screen">
            {/* Модальные окна */}
            <SXOrgModal
                isOpen={showSXOrgModal}
                onClose={() => setShowSXOrgModal(false)}
                onProxiesImported={loadProxies}
            />
            <CyberYozhModal
                isOpen={showCyberYozhModal}
                onClose={() => setShowCyberYozhModal(false)}
                onProxiesImported={loadProxies}
            />
            <PSBProxyModal
                isOpen={showPSBProxyModal}
                onClose={() => setShowPSBProxyModal(false)}
                onProxiesImported={loadProxies}
            />

            {/* Заголовок */}
            <h1 className="text-2xl font-bold text-gray-800 mb-6">Управление прокси</h1>

            {/* Форма добавления прокси */}
            <div className="bg-white rounded-xl shadow-md p-6 mb-6">
                <h2 className="text-lg font-semibold text-gray-800 mb-4">Добавить новый прокси</h2>

                {/* Быстрый ввод */}
                <div className="mb-4">
                    <input
                        type="text"
                        value={quickInput}
                        onChange={(e) => {
                            setQuickInput(e.target.value);
                            parseQuickInput(e.target.value);
                        }}
                        className="w-full border border-gray-300 rounded-lg px-4 py-3 focus:outline-none focus:ring-2 focus:ring-blue-500"
                        placeholder="IP:port:login:password или protocol://login:password@IP:port"
                    />
                    <p className="text-xs text-gray-500 mt-1">
                        Быстрый ввод прокси в любом формате
                    </p>
                </div>

                {/* Ручной ввод */}
                <div className="grid grid-cols-1 md:grid-cols-5 gap-3 mb-4">
                    <input
                        type="text"
                        value={manualForm.host}
                        onChange={(e) => setManualForm({ ...manualForm, host: e.target.value })}
                        className="border border-gray-300 rounded-lg px-3 py-2 focus:outline-none focus:ring-2 focus:ring-blue-500"
                        placeholder="IP адрес"
                    />
                    <input
                        type="text"
                        value={manualForm.port}
                        onChange={(e) => setManualForm({ ...manualForm, port: e.target.value })}
                        className="border border-gray-300 rounded-lg px-3 py-2 focus:outline-none focus:ring-2 focus:ring-blue-500"
                        placeholder="Порт"
                    />
                    <select
                        value={manualForm.protocol}
                        onChange={(e) => setManualForm({ ...manualForm, protocol: e.target.value })}
                        className="border border-gray-300 rounded-lg px-3 py-2 focus:outline-none focus:ring-2 focus:ring-blue-500"
                    >
                        <option value="http">HTTP</option>
                        <option value="socks5">SOCKS5</option>
                    </select>
                    <input
                        type="text"
                        value={manualForm.username}
                        onChange={(e) => setManualForm({ ...manualForm, username: e.target.value })}
                        className="border border-gray-300 rounded-lg px-3 py-2 focus:outline-none focus:ring-2 focus:ring-blue-500"
                        placeholder="Логин"
                    />
                    <input
                        type="password"
                        value={manualForm.password}
                        onChange={(e) => setManualForm({ ...manualForm, password: e.target.value })}
                        className="border border-gray-300 rounded-lg px-3 py-2 focus:outline-none focus:ring-2 focus:ring-blue-500"
                        placeholder="Пароль"
                    />
                </div>

                {/* Кнопки */}
                <div className="space-y-3">
                    <button
                        onClick={handleAddProxy}
                        className="w-full bg-green-600 hover:bg-green-700 text-white font-medium py-3 rounded-lg transition"
                    >
                        ➕ Добавить прокси
                    </button>

                    <div className="grid grid-cols-3 gap-3">
                        <button
                            onClick={(e) => {
                                e.preventDefault();
                                setShowSXOrgModal(true);
                            }}
                            className="bg-purple-600 hover:bg-purple-700 text-white font-medium py-3 rounded-lg transition flex items-center justify-center gap-2"
                        >
                            ⭐ SX.ORG Прокси
                        </button>
                        <button
                            onClick={(e) => {
                                e.preventDefault();
                                setShowPSBProxyModal(true);
                            }}
                            className="bg-gradient-to-r from-purple-500 to-pink-500 hover:from-purple-600 hover:to-pink-600 text-white font-medium py-3 rounded-lg transition flex items-center justify-center gap-2"
                        >
                            🔐 PSB Proxy
                        </button>
                        <button
                            onClick={(e) => {
                                e.preventDefault();
                                setShowCyberYozhModal(true);
                            }}
                            className="bg-black hover:bg-gray-900 text-white font-medium py-3 rounded-lg transition flex items-center justify-center gap-2"
                        >
                            🐾 CyberYozh Прокси
                        </button>
                    </div>
                </div>
            </div>

            {/* Список прокси */}
            <div className="bg-white rounded-xl shadow-md p-6">
                <h2 className="text-lg font-semibold text-gray-800 mb-4">
                    Список прокси ({proxies.length})
                </h2>

                {proxies.length === 0 ? (
                    <div className="text-center py-12 text-gray-500">
                        <p>Нет добавленных прокси</p>
                    </div>
                ) : (
                    <div className="space-y-3">
                        {proxies.map((proxy) => {
                            const result = checkResults[proxy.proxy_str];
                            const isChecking = checking[proxy.proxy_str];

                            let statusIcon = '⚪';
                            let statusText = 'Не проверен';
                            let statusColor = 'text-gray-500';

                            if (result) {
                                if (result.status === 'working') {
                                    statusIcon = '✅';
                                    statusText = `${result.country || '❓'} | ${result.city || '❓'}`;
                                    statusColor = 'text-green-600';
                                    if (result.latency) {
                                        statusText += ` | ${result.latency.toFixed(2)}с`;
                                    }
                                } else {
                                    statusIcon = '❌';
                                    statusText = 'Не работает';
                                    statusColor = 'text-red-600';
                                }
                            }

                            return (
                                <div
                                    key={proxy.proxy_str}
                                    className="border border-gray-200 rounded-lg p-4 hover:shadow-md transition"
                                >
                                    <div className="flex items-center justify-between">
                                        <div className="flex-1">
                                            <p className={`font-medium ${statusColor} mb-1`}>
                                                {statusIcon} {statusText} | {proxy.protocol.toUpperCase()}
                                            </p>
                                            <p className="text-sm text-gray-600 font-mono truncate">
                                                {proxy.proxy_str}
                                            </p>
                                        </div>

                                        <div className="flex gap-2 ml-4">
                                            <button
                                                onClick={() => handleCheckProxy(proxy.proxy_str)}
                                                disabled={isChecking}
                                                className="bg-blue-500 hover:bg-blue-600 text-white px-4 py-2 rounded-lg text-sm transition disabled:opacity-50"
                                            >
                                                {isChecking ? 'Проверка...' : 'Проверить'}
                                            </button>
                                            <button
                                                onClick={() => handleDelete(proxy.proxy_str)}
                                                className="bg-red-500 hover:bg-red-600 text-white px-4 py-2 rounded-lg text-sm transition"
                                            >
                                                Удалить
                                            </button>
                                        </div>
                                    </div>
                                </div>
                            );
                        })}
                    </div>
                )}
            </div>
        </div>
    );
}
