import { useState, useEffect } from 'react';
import { Profile, Proxy } from '../types';
import * as api from '../api';
import { SCREENS, LANGUAGES, TIMEZONES, CPU_OPTIONS, RAM_OPTIONS, AUTO, parseScreenResolution } from '../utils/constants';
import { useNotification } from '../utils/notifications';

export default function ProfilesPage() {
    const { showNotification } = useNotification();
    const [profiles, setProfiles] = useState<Profile[]>([]);
    const [proxies, setProxies] = useState<Proxy[]>([]);
    const [showModal, setShowModal] = useState(false);
    const [editingProfile, setEditingProfile] = useState<Profile | null>(null);
    const [launching, setLaunching] = useState<Set<string>>(new Set());

    const emptyProfile: Profile = {
        name: '',
        user_agent: AUTO,
        screen_width: 1920,
        screen_height: 1080,
        timezone: AUTO,
        lang: AUTO,
        proxy: null,
        cookies: null,
        webgl: true,
        vendor: 'Google Inc.',
        cpu: 8,
        ram: 8,
        is_touch: false,
        homepage: 'https://2ip.ru',
    };

    const [formData, setFormData] = useState<Profile>(emptyProfile);

    useEffect(() => {
        loadData();
    }, []);

    const loadData = async () => {
        try {
            const [profilesData, proxiesData] = await Promise.all([
                api.getProfiles(),
                api.getProxies(),
            ]);
            setProfiles(profilesData);
            setProxies(proxiesData);
        } catch (error) {
            console.error('Error loading data:', error);
        }
    };

    const handleOpenModal = (profile?: Profile) => {
        if (profile) {
            setEditingProfile(profile);
            setFormData(profile);
        } else {
            setEditingProfile(null);
            setFormData(emptyProfile);
        }
        setShowModal(true);
    };

    const handleCloseModal = () => {
        setShowModal(false);
        setEditingProfile(null);
        setFormData(emptyProfile);
    };

    const handleSaveProfile = async () => {
        if (!formData.name.trim()) {
            showNotification('Ошибка', 'Введите название профиля', 'warning');
            return;
        }

        try {
            await api.saveProfile(formData);
            await loadData();
            handleCloseModal();
            showNotification('Успех', `Профиль "${formData.name}" сохранён`, 'success');
        } catch (error: any) {
            showNotification('Ошибка', `Не удалось сохранить профиль: ${error}`, 'error');
        }
    };

    const handleDeleteProfile = async (profileName: string) => {
        try {
            await api.deleteProfile(profileName);
            await loadData();
            showNotification('Успех', `Профиль "${profileName}" удалён`, 'success');
        } catch (error: any) {
            showNotification('Ошибка', `Не удалось удалить профиль: ${error}`, 'error');
        }
    };

    const handleLaunchProfile = async (profileName: string) => {
        if (launching.has(profileName)) return;

        setLaunching(new Set(launching).add(profileName));

        try {
            const message = await api.launchProfile(profileName);
            showNotification('Успех', message || `Профиль "${profileName}" запущен`, 'success', 4000);
        } catch (error: any) {
            showNotification('Ошибка запуска', String(error), 'error', 7000);
        } finally {
            const newLaunching = new Set(launching);
            newLaunching.delete(profileName);
            setLaunching(newLaunching);
        }
    };

    const handleScreenChange = (screen: string) => {
        const { width, height } = parseScreenResolution(screen);
        setFormData({ ...formData, screen_width: width, screen_height: height });
    };

    const getProxyInfo = (proxyStr: string | null | undefined) => {
        if (!proxyStr) return null;

        const proxy = proxies.find(p => p.proxy_str === proxyStr);
        if (!proxy) return { country: 'Unknown', host: 'Unknown' };

        return {
            country: proxy.country || 'Unknown',
            city: proxy.city || '',
            host: `${proxy.host}:${proxy.port}`
        };
    };

    return (
        <div className="p-6">
            <div className="flex justify-between items-center mb-6">
                <h1 className="text-2xl font-bold">Профили</h1>
                <button
                    onClick={() => handleOpenModal()}
                    className="bg-blue-500 hover:bg-blue-600 text-white px-6 py-2 rounded-lg transition"
                >
                    + Создать профиль
                </button>
            </div>

            {profiles.length === 0 ? (
                <div className="text-center py-20 text-gray-500">
                    <p className="text-xl mb-4">Нет профилей</p>
                    <p>Создайте первый профиль для начала работы</p>
                </div>
            ) : (
                <div className="grid grid-cols-2 md:grid-cols-3 lg:grid-cols-5 xl:grid-cols-6 gap-3">
                    {profiles.map((profile) => {
                        const proxyInfo = getProxyInfo(profile.proxy);
                        return (
                            <div
                                key={profile.name}
                                className="bg-white rounded-lg shadow hover:shadow-lg transition-all duration-200 border border-gray-200 hover:border-blue-400 overflow-hidden"
                            >
                                {/* Header */}
                                <div className="bg-gradient-to-r from-blue-500 to-indigo-600 p-2 flex justify-between items-center">
                                    <h3 className="text-white font-semibold text-sm truncate">{profile.name}</h3>
                                    <button
                                        onClick={() => handleDeleteProfile(profile.name)}
                                        className="text-white/80 hover:text-white hover:bg-white/20 rounded-full w-6 h-6 flex items-center justify-center transition"
                                        title="Удалить"
                                    >
                                        <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                                            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" />
                                        </svg>
                                    </button>
                                </div>

                                {/* Body */}
                                <div className="p-3 space-y-2">
                                    {/* Screen Resolution */}
                                    <div className="flex items-center gap-2 text-xs text-gray-700">
                                        <svg className="w-4 h-4 text-gray-500" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                                            <rect x="2" y="3" width="20" height="14" rx="2" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" />
                                            <line x1="8" y1="21" x2="16" y2="21" strokeWidth="2" strokeLinecap="round" />
                                            <line x1="12" y1="17" x2="12" y2="21" strokeWidth="2" strokeLinecap="round" />
                                        </svg>
                                        <span className="font-medium">{profile.screen_width}×{profile.screen_height}</span>
                                    </div>

                                    {/* Language & Timezone */}
                                    <div className="flex items-center gap-2 text-xs text-gray-700">
                                        <svg className="w-4 h-4 text-gray-500" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                                            <circle cx="12" cy="12" r="10" strokeWidth="2" />
                                            <path d="M2 12h20M12 2a15.3 15.3 0 0 1 4 10 15.3 15.3 0 0 1-4 10 15.3 15.3 0 0 1-4-10 15.3 15.3 0 0 1 4-10z" strokeWidth="2" />
                                        </svg>
                                        <span>{profile.lang === AUTO ? 'Язык: авто' : profile.lang}</span>
                                        <span className="text-gray-400">•</span>
                                        <span className="text-gray-600 truncate">{profile.timezone === AUTO ? 'Время: авто' : profile.timezone.split('/').pop()}</span>
                                    </div>

                                    {/* Proxy Info */}
                                    {proxyInfo ? (
                                        <div className="flex items-center gap-1.5 text-xs rounded px-1.5 py-1">
                                            <span className="bg-gradient-to-r from-green-500 to-emerald-600 text-white text-[10px] px-1.5 py-0.5 rounded font-bold">
                                                {proxyInfo.country}
                                            </span>
                                            {proxyInfo.city && <span className="text-[10px] text-gray-600 truncate">{proxyInfo.city}</span>}
                                        </div>
                                    ) : (
                                        <div className="flex items-center gap-1.5 text-xs bg-gray-100 text-gray-500 rounded px-1.5 py-0.5">
                                            <svg className="w-3 h-3" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                                                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M18.364 5.636a9 9 0 010 12.728m0 0l-2.829-2.829m2.829 2.829L21 21M15.536 8.464a5 5 0 010 7.072m0 0l-2.829-2.829m-4.243 2.829a4.978 4.978 0 01-1.414-2.83m-1.414 5.658a9 9 0 01-2.167-9.238m7.824 2.167a1 1 0 111.414 1.414m-1.414-1.414L3 3" />
                                            </svg>
                                            <span className="text-[10px]">Нет прокси</span>
                                        </div>
                                    )}
                                </div>

                                {/* Actions */}
                                <div className="p-1.5 border-t border-gray-100 flex gap-1.5">
                                    <button
                                        onClick={() => handleLaunchProfile(profile.name)}
                                        disabled={launching.has(profile.name)}
                                        className="flex-1 bg-gradient-to-r from-blue-500 to-indigo-600 hover:from-blue-600 hover:to-indigo-700 text-white text-[10px] font-semibold py-1.5 rounded transition disabled:opacity-50 disabled:cursor-not-allowed flex items-center justify-center"
                                        title={launching.has(profile.name) ? "Запуск..." : "Запустить профиль"}
                                    >
                                        {launching.has(profile.name) ? (
                                            <div className="w-3 h-3 border-2 border-white border-t-transparent rounded-full animate-spin"></div>
                                        ) : (
                                            <svg className="w-3 h-3" fill="currentColor" viewBox="0 0 24 24">
                                                <path d="M8 5v14l11-7z" />
                                            </svg>
                                        )}
                                    </button>
                                    <button
                                        onClick={() => handleOpenModal(profile)}
                                        className="px-2 bg-gray-100 hover:bg-gray-200 text-gray-700 rounded transition"
                                        title="Редактировать"
                                    >
                                        <svg className="w-3 h-3" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                                            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M11 5H6a2 2 0 00-2 2v11a2 2 0 002 2h11a2 2 0 002-2v-5m-1.414-9.414a2 2 0 112.828 2.828L11.828 15H9v-2.828l8.586-8.586z" />
                                        </svg>
                                    </button>
                                </div>
                            </div>
                        );
                    })}
                </div>
            )}

            {/* Modal */}
            {showModal && (
                <div className="fixed inset-0 bg-black bg-opacity-50 flex items-center justify-center z-50 p-4">
                    <div className="bg-white rounded-lg shadow-xl max-w-2xl w-full max-h-[90vh] overflow-y-auto">
                        <div className="p-6">
                            <div className="flex justify-between items-center mb-6">
                                <h2 className="text-xl font-bold">
                                    {editingProfile ? 'Редактировать профиль' : 'Новый профиль'}
                                </h2>
                                <button onClick={handleCloseModal} className="text-gray-500 hover:text-gray-700 text-2xl">
                                    ×
                                </button>
                            </div>

                            <div className="space-y-4">
                                <div>
                                    <label className="block text-sm font-medium mb-1">Название профиля *</label>
                                    <input
                                        type="text"
                                        value={formData.name}
                                        onChange={(e) => setFormData({ ...formData, name: e.target.value })}
                                        className="w-full border rounded px-3 py-2"
                                        placeholder="Profile 1"
                                    />
                                </div>

                                <div className="flex items-start gap-2 rounded border border-blue-100 bg-blue-50 px-3 py-2 text-xs text-blue-900">
                                    <span className="text-base leading-none">🛡️</span>
                                    <span>
                                        User-Agent и Client Hints берутся из встроенного Chromium и всегда совпадают с его версией —
                                        подмена версии выдаёт антидетект. Часовой пояс и язык в режиме «Авто» подбираются по IP прокси при каждом запуске.
                                    </span>
                                </div>

                                <div>
                                    <label className="block text-sm font-medium mb-1">Разрешение экрана</label>
                                    <select
                                        value={`${formData.screen_width}×${formData.screen_height}`}
                                        onChange={(e) => handleScreenChange(e.target.value)}
                                        className="w-full border rounded px-3 py-2"
                                    >
                                        {SCREENS.map((screen) => (
                                            <option key={screen} value={screen}>{screen}</option>
                                        ))}
                                    </select>
                                </div>

                                <div className="grid grid-cols-2 gap-4">
                                    <div>
                                        <label className="block text-sm font-medium mb-1">Язык</label>
                                        <select
                                            value={formData.lang}
                                            onChange={(e) => setFormData({ ...formData, lang: e.target.value })}
                                            className="w-full border rounded px-3 py-2"
                                        >
                                            <option value={AUTO}>Авто (по стране прокси)</option>
                                            {!LANGUAGES.some((l) => l.code === formData.lang) && formData.lang !== AUTO && (
                                                <option value={formData.lang}>{formData.lang}</option>
                                            )}
                                            {LANGUAGES.map((lang) => (
                                                <option key={lang.code} value={lang.code}>{lang.name}</option>
                                            ))}
                                        </select>
                                    </div>

                                    <div>
                                        <label className="block text-sm font-medium mb-1">Часовой пояс</label>
                                        <select
                                            value={formData.timezone}
                                            onChange={(e) => setFormData({ ...formData, timezone: e.target.value })}
                                            className="w-full border rounded px-3 py-2"
                                        >
                                            <option value={AUTO}>Авто (по IP прокси)</option>
                                            {!TIMEZONES.includes(formData.timezone) && formData.timezone !== AUTO && (
                                                <option value={formData.timezone}>{formData.timezone}</option>
                                            )}
                                            {TIMEZONES.map((tz) => (
                                                <option key={tz} value={tz}>{tz}</option>
                                            ))}
                                        </select>
                                    </div>
                                </div>

                                <div>
                                    <label className="block text-sm font-medium mb-1">Прокси</label>
                                    <select
                                        value={formData.proxy || ''}
                                        onChange={(e) => setFormData({ ...formData, proxy: e.target.value || null })}
                                        className="w-full border rounded px-3 py-2"
                                    >
                                        <option value="">Без прокси</option>
                                        {proxies.map((proxy) => (
                                            <option key={proxy.proxy_str} value={proxy.proxy_str}>
                                                {proxy.country || 'Unknown'} - {proxy.host}:{proxy.port}
                                            </option>
                                        ))}
                                    </select>
                                </div>

                                <div>
                                    <label className="block text-sm font-medium mb-1">Стартовая страница</label>
                                    <input
                                        type="text"
                                        value={formData.homepage}
                                        onChange={(e) => setFormData({ ...formData, homepage: e.target.value })}
                                        className="w-full border rounded px-3 py-2"
                                        placeholder="https://2ip.ru"
                                    />
                                </div>

                                <div className="grid grid-cols-2 gap-4">
                                    <div>
                                        <label className="block text-sm font-medium mb-1">CPU ядер</label>
                                        <select
                                            value={formData.cpu}
                                            onChange={(e) => setFormData({ ...formData, cpu: parseInt(e.target.value) })}
                                            className="w-full border rounded px-3 py-2"
                                        >
                                            {[...new Set([...CPU_OPTIONS, formData.cpu])].sort((a, b) => a - b).map((n) => (
                                                <option key={n} value={n}>{n}</option>
                                            ))}
                                        </select>
                                    </div>

                                    <div>
                                        <label className="block text-sm font-medium mb-1">RAM (ГБ)</label>
                                        <select
                                            value={formData.ram}
                                            onChange={(e) => setFormData({ ...formData, ram: parseInt(e.target.value) })}
                                            className="w-full border rounded px-3 py-2"
                                        >
                                            {[...new Set([...RAM_OPTIONS, formData.ram])].sort((a, b) => a - b).map((n) => (
                                                <option key={n} value={n}>{n}</option>
                                            ))}
                                        </select>
                                    </div>
                                </div>

                                <div className="flex gap-6">
                                    <label className="flex items-center gap-2">
                                        <input
                                            type="checkbox"
                                            checked={formData.webgl}
                                            onChange={(e) => setFormData({ ...formData, webgl: e.target.checked })}
                                            className="w-4 h-4"
                                        />
                                        <span>WebGL</span>
                                    </label>

                                    <label className="flex items-center gap-2">
                                        <input
                                            type="checkbox"
                                            checked={formData.is_touch}
                                            onChange={(e) => setFormData({ ...formData, is_touch: e.target.checked })}
                                            className="w-4 h-4"
                                        />
                                        <span>Touch Screen</span>
                                    </label>
                                </div>
                            </div>

                            <div className="flex gap-3 mt-6">
                                <button
                                    onClick={handleSaveProfile}
                                    className="flex-1 bg-blue-500 hover:bg-blue-600 text-white py-2 rounded transition"
                                >
                                    Сохранить
                                </button>
                                <button
                                    onClick={handleCloseModal}
                                    className="px-6 bg-gray-200 hover:bg-gray-300 py-2 rounded transition"
                                >
                                    Отмена
                                </button>
                            </div>
                        </div>
                    </div>
                </div>
            )}
        </div>
    );
}
