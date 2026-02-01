// Система уведомлений по образцу Python версии
import { useState, createContext, useContext, ReactNode } from 'react';

export type NotificationType = 'success' | 'error' | 'warning' | 'info';

interface Notification {
    id: string;
    title: string;
    message: string;
    type: NotificationType;
    duration: number;
}

interface NotificationContextType {
    showNotification: (title: string, message: string, type?: NotificationType, duration?: number) => void;
}

const NotificationContext = createContext<NotificationContextType | undefined>(undefined);

export function useNotification() {
    const context = useContext(NotificationContext);
    if (!context) {
        throw new Error('useNotification must be used within NotificationProvider');
    }
    return context;
}

export function NotificationProvider({ children }: { children: ReactNode }) {
    const [notifications, setNotifications] = useState<Notification[]>([]);

    const showNotification = (
        title: string,
        message: string,
        type: NotificationType = 'info',
        duration: number = 5000
    ) => {
        const id = Math.random().toString(36).substr(2, 9);
        const notification: Notification = { id, title, message, type, duration };

        setNotifications((prev) => [...prev, notification]);

        // Автоматическое скрытие
        setTimeout(() => {
            hideNotification(id);
        }, duration);
    };

    const hideNotification = (id: string) => {
        setNotifications((prev) => prev.filter((n) => n.id !== id));
    };

    const getNotificationStyles = (type: NotificationType) => {
        switch (type) {
            case 'success':
                return {
                    bgColor: 'bg-green-500',
                    icon: '✓',
                    iconBg: 'bg-green-600'
                };
            case 'error':
                return {
                    bgColor: 'bg-red-500',
                    icon: '✕',
                    iconBg: 'bg-red-600'
                };
            case 'warning':
                return {
                    bgColor: 'bg-orange-500',
                    icon: '⚠',
                    iconBg: 'bg-orange-600'
                };
            case 'info':
            default:
                return {
                    bgColor: 'bg-blue-500',
                    icon: 'ℹ',
                    iconBg: 'bg-blue-600'
                };
        }
    };

    return (
        <NotificationContext.Provider value={{ showNotification }}>
            {children}

            {/* Контейнер уведомлений в правом верхнем углу */}
            <div className="fixed top-4 right-4 z-50 flex flex-col gap-3 max-w-md">
                {notifications.map((notification) => {
                    const styles = getNotificationStyles(notification.type);
                    return (
                        <div
                            key={notification.id}
                            className={`${styles.bgColor} text-white rounded-lg shadow-2xl p-4 animate-slide-in-right flex items-start gap-3 min-w-[320px]`}
                        >
                            <div className={`${styles.iconBg} rounded-full w-8 h-8 flex items-center justify-center flex-shrink-0 text-lg font-bold`}>
                                {styles.icon}
                            </div>
                            <div className="flex-1 min-w-0">
                                <h4 className="font-bold text-sm mb-1">{notification.title}</h4>
                                <p className="text-sm opacity-90 break-words">{notification.message}</p>
                            </div>
                            <button
                                onClick={() => hideNotification(notification.id)}
                                className="text-white hover:bg-white/20 rounded p-1 transition flex-shrink-0"
                            >
                                <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" />
                                </svg>
                            </button>
                        </div>
                    );
                })}
            </div>
        </NotificationContext.Provider>
    );
}
