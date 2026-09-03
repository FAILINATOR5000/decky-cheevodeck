declare module "@decky/api" {
    export function callable<TArgs extends any[], TReturn>(name: string): (...args: TArgs) => Promise<TReturn>;
    const definePlugin: any;
    export { definePlugin };

    export function addEventListener<T extends (...args: any[]) => void>(
        event: string,
        callback: T
    ): T;

    export function removeEventListener(
        event: string,
        callback: (...args: any[]) => void
    ): void;

    export const toaster: {
        toast: (toast: {
            title?: string;
            body?: string;
            duration?: number;
        }) => void;
    };

    export function executeInTab(
        tab: string,
        runAsync: boolean,
        code: string
    ): Promise<{ success: boolean; result: any }>;

    export function fetchNoCors(input: string, init?: any): Promise<Response>;

    export const enum FileSelectionType {
        FILE = 0,
        FOLDER = 1,
    }

    export type FilePickerRes = {
        path: string;
        realpath: string;
    };

    export function openFilePicker(
        select: FileSelectionType,
        startPath: string,
        includeFiles?: boolean,
        includeFolders?: boolean,
        filter?: RegExp | ((file: any) => boolean),
        extensions?: string[],
        showHiddenFiles?: boolean,
        allowAllFiles?: boolean,
        max?: number
    ): Promise<FilePickerRes>;

    export type RoutePatch = (route: any) => any;

    export const routerHook: {
        addPatch(path: string, patch: RoutePatch): RoutePatch;
        removePatch(path: string, patch: RoutePatch): void;
        addGlobalComponent(name: string, component: () => any): void;
        removeGlobalComponent(name: string): void;
    };
}
declare module "@decky/ui" {
    type NoDomFocusEvents = {
        onGamepadFocus?: () => void;
        onGamepadBlur?: () => void;
        onFocus?: never;
        onBlur?: never;
        [prop: string]: any;
    };

    export const findModuleExport: (filter: (e: any) => boolean, minExports?: number) => any;
    export const ButtonItem: (props: NoDomFocusEvents) => any;
    export const ConfirmModal: any;
    export const DialogButton: (props: NoDomFocusEvents) => any;
    export const Focusable: (props: NoDomFocusEvents) => any;
    export const ModalRoot: any;
    export const PanelSection: any;
    export const PanelSectionRow: any;
    export const ScrollPanelGroup: any;

    export const SliderField: (props: {
        label?: string;
        description?: import("react").ReactNode;
        value: number;
        min?: number;
        max?: number;
        step?: number;
        notchCount?: number;
        notchLabels?: { notchIndex: number; label: string }[];
        notchTicksVisible?: boolean;
        layout?: "inline" | "below";
        showValue?: boolean;
        valueSuffix?: string;
        bottomSeparator?: "standard" | "thick" | "none";
        disabled?: boolean;
        onChange?: (value: number) => void;
    }) => JSX.Element;

    export const ToggleField: (props: {
        label?: import("react").ReactNode;
        description?: import("react").ReactNode;
        checked: boolean;
        disabled?: boolean;
        bottomSeparator?: "standard" | "thick" | "none";
        highlightOnFocus?: boolean;
        controlled?: boolean;
        onChange?: (checked: boolean) => void;
    }) => JSX.Element;

    export const Field: (props: {
        label?: import("react").ReactNode;
        description?: import("react").ReactNode;
        children?: import("react").ReactNode;
        childrenLayout?: "below" | "inline";
        childrenContainerWidth?: "min" | "max" | "fixed";
        padding?: "none" | "standard" | "compact";
        bottomSeparator?: "standard" | "thick" | "none";
        highlightOnFocus?: boolean;
        focusable?: boolean;
        disabled?: boolean;
        onActivate?: (e: any) => void;
        onGamepadFocus?: () => void;
        onGamepadBlur?: () => void;
    }) => JSX.Element;

    export const TextField: any;
    export const quickAccessMenuClasses: any;
    export const showModal: any;

    export const afterPatch: (
        object: any,
        property: string,
        handler: (args: any[], ret: any) => any
    ) => { unpatch: () => void };

    export const createReactTreePatcher: (
        steps: ((node: any) => any)[],
        handler: (args: any[], ret?: any) => any
    ) => (args: any[], ret?: any) => any;

    export const findInReactTree: (node: any, filter: (element: any) => boolean) => any;

    export const appDetailsClasses: { InnerContainer: string };

}
declare module "react-icons/fa" {
    export const FaTrophy: any;
    export const FaThumbtack: any;
    export const FaHistory: any;
    export const FaSyncAlt: any;
    export const FaUnlock: any;
    export const FaRegCalendar: any;
    export const FaClipboardCheck: any;
    export const FaClock: any;
    export const FaCompressArrowsAlt: any;
    export const FaExpandAlt: any;
    export const FaFileAlt: any;
    export const FaGamepad: any;
    export const FaNetworkWired: any;
}
