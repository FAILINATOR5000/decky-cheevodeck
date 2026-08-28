interface SteamBrowserView {
    LoadURL(url: string): void;
    SetVisible?(visible: boolean): void;
    SetBounds?(x: number, y: number, width: number, height: number): void;
    [key: string]: any;
}

interface SteamWindowInstance {
    CreateBrowserView?(name: string): SteamBrowserView;
    [key: string]: any;
}

declare const SteamClient: {
    BrowserView?: {
        Destroy?(view: SteamBrowserView): void;
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
