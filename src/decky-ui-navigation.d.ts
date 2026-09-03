declare module "@decky/ui" {
  export const Navigation: {
    CloseSideMenus(): void;
    NavigateToExternalWeb(url: string): void;
    OpenQuickAccessMenu(quickAccessTab?: QuickAccessTab): void;
  };

  export const enum QuickAccessTab {
    Decky = 999,
  }
}
