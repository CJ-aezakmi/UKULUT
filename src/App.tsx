import { useState } from 'react';
import ProfilesPage from './pages/ProfilesPage';
import ProxiesPage from './pages/ProxiesPage';
import { NotificationProvider } from './utils/notifications';

export type Page = 'profiles' | 'proxies';

function App() {
    const [currentPage, setCurrentPage] = useState<Page>('profiles');

    const renderPage = () => {
        switch (currentPage) {
            case 'profiles':
                return <ProfilesPage />;
            case 'proxies':
                return <ProxiesPage />;
            default:
                return <ProfilesPage />;
        }
    };

    return (
        <NotificationProvider>
            <div className="flex flex-col h-screen bg-gradient-to-br from-gray-50 to-gray-200">
                {/* Header */}
                <div className="bg-gradient-to-r from-gray-800 to-gray-700 text-white px-6 py-4 shadow-lg">
                    <h1 className="text-xl font-semibold">Antic Browser</h1>
                </div>

                {/* Content */}
                <main className="flex-1 overflow-auto">
                    {renderPage()}
                </main>

                {/* Bottom Navigation */}
                <div className="bg-white border-t border-gray-200 shadow-lg">
                    <div className="flex justify-center items-center h-20 space-x-32">
                        <button
                            onClick={() => setCurrentPage('profiles')}
                            className={`flex flex-col items-center justify-center w-24 h-16 rounded-lg transition-all ${currentPage === 'profiles' ? 'bg-blue-500 text-white' : 'text-gray-600 hover:bg-gray-100'
                                }`}
                        >
                            <span className="text-2xl mb-1">⚙️</span>
                            <span className="text-sm font-medium">Конфиги</span>
                        </button>
                        <button
                            onClick={() => setCurrentPage('proxies')}
                            className={`flex flex-col items-center justify-center w-24 h-16 rounded-lg transition-all ${currentPage === 'proxies' ? 'bg-blue-500 text-white' : 'text-gray-600 hover:bg-gray-100'
                                }`}
                        >
                            <span className="text-2xl mb-1">🔑</span>
                            <span className="text-sm font-medium">Прокси</span>
                        </button>
                    </div>
                </div>
            </div>
        </NotificationProvider>
    );
}

export default App;
