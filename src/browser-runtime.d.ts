interface SteamBrowserWrapper {
    GetBrowser?(): SteamBrowserView;
    LoadURL(url: string): void;
    GoBack?(): void;
    GoForward?(): void;
    Reload?(): void;
    Destroy?(): void;
    OnFinishedRequest?(url: string, title: string): void;
    [key: string]: any;
}
