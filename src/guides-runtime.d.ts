interface SteamBrowserView {
    LoadURL(url: string): void;
    SetVisible?(visible: boolean): void;
    SetBounds?(x: number, y: number, width: number, height: number): void;
    [key: string]: any;
}

interface SteamWindowInstance {
    CreateBrowserView?(name: string, options?: any): SteamBrowserView;
    [key: string]: any;
}

interface SteamAppDetails {
    strLaunchOptions?: string;
    [key: string]: any;
}

interface SteamAppLifetimeEvent {
    unAppID: number;
    bRunning: boolean;
    [key: string]: any;
}

declare const SteamClient: {
    BrowserView?: {
        Destroy?(view: SteamBrowserView): void;
        [key: string]: any;
    };
    Apps: {
        RegisterForAppDetails(appId: number, callback: (details: SteamAppDetails | null) => void): { unregister(): void };
        SetShortcutLaunchOptions(appId: number, options: string): void;
        RunGame(gameId: string, launchOptions: string, unknown: number, launchSource: number): void;
        [key: string]: any;
    };
    GameSessions: {
        RegisterForAppLifetimeNotifications(callback: (event: SteamAppLifetimeEvent) => void): { unregister(): void };
        [key: string]: any;
    };
    [key: string]: any;
};

declare const SteamUIStore: {
    WindowStore?: {
        GamepadUIMainWindowInstance?: SteamWindowInstance;
        [key: string]: any;
    };
    m_WindowStore?: {
        m_mapDesiredWindowInstances?: Map<any, SteamWindowInstance>;
        [key: string]: any;
    };
    [key: string]: any;
};
