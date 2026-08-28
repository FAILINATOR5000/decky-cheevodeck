import { createContext, useContext, type ReactNode } from "react";

type NotificationsChrome = {
    hasUnread: boolean;
    doNotDisturb: boolean;
    openNotifications: () => void;
};

const NotificationsContext = createContext<NotificationsChrome | null>(null);

export function NotificationsProvider(props: { value: NotificationsChrome; children: ReactNode }) {
    return (
        <NotificationsContext.Provider value={props.value}>
            {props.children}
        </NotificationsContext.Provider>
    );
}

export function useNotificationsChrome(): NotificationsChrome {
    return useContext(NotificationsContext) ?? {
        hasUnread: false,
        doNotDisturb: false,
        openNotifications: () => { }
    };
}
