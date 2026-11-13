import { getGameIcons, logNotificationsDebug, multiplayerLoadCollage, multiplayerSaveCollage } from "../api";
import { logError } from "./errors";

const GAMES: ReadonlyArray<readonly [number, string]> = [
    [724, "/Images/149658.png"],
    [10082, "/Images/121474.png"],
    [7693, "/Images/091536.png"],
    [576, "/Images/105481.png"],
    [506, "/Images/052963.png"],
    [10438, "/Images/081550.png"],
    [34587, "/Images/118591.png"],
    [470, "/Images/043551.png"],
    [10263, "/Images/040160.png"],
    [9602, "/Images/081455.png"],
    [6151, "/Images/117530.png"],
    [12711, "/Images/072928.png"],
    [586, "/Images/126547.png"],
    [494, "/Images/114059.png"],
    [25450, "/Images/081241.png"],
    [2593, "/Images/110820.png"],
    [2277, "/Images/109029.png"],
    [6294, "/Images/052561.png"],
    [10264, "/Images/040217.png"],
    [10108, "/Images/040226.png"],
    [810, "/Images/105173.png"],
    [668, "/Images/126553.png"],
    [9852, "/Images/104785.png"],
    [4275, "/Images/063171.png"],
    [41, "/Images/055629.png"],
    [18141, "/Images/109502.png"],
    [722, "/Images/105171.png"],
    [515, "/Images/105044.png"],
    [788, "/Images/104330.png"],
    [3992, "/Images/048268.png"],
    [18526, "/Images/121840.png"],
    [11282, "/Images/166236.png"],
    [11259, "/Images/131211.png"],
    [10907, "/Images/081320.png"],
    [2624, "/Images/058042.png"],
    [30, "/Images/112099.png"],
    [10078, "/Images/040155.png"],
    [400, "/Images/099440.png"],
    [2708, "/Images/089937.png"],
    [1447, "/Images/079383.png"],
    [10073, "/Images/022585.png"],
    [7423, "/Images/068145.png"],
    [11808, "/Images/117040.png"],
    [350, "/Images/044532.png"],
    [19286, "/Images/063760.png"],
    [3323, "/Images/114416.png"],
    [195, "/Images/119305.png"],
    [55, "/Images/110823.png"],
    [2114, "/Images/076385.png"],
    [1743, "/Images/076400.png"],
    [1463, "/Images/104957.png"],
    [1460, "/Images/128256.png"],
    [1452, "/Images/072198.png"],
    [2014, "/Images/117653.png"],
    [10, "/Images/121647.png"],
    [21, "/Images/110369.png"]
];

const COLUMNS = 24;
export const COLLAGE_ROWS = 3;
const CELL_PX = 80;
const MIN_GAMES = 4;
const BUILD_DELAY_MS = 10000;
const OPEN_DELAY_MS = 3000;
const RETRY_AFTER_MS = 15 * 60 * 1000;

export type CardCollage = { key: string; image: string; tile: string[] };

let account = "";
let ready: CardCollage | null = null;
let building = false;
let warmed = false;
let startTimer: number | null = null;
let failedAt = 0;
let stopped = false;

function collageKey(): string {
    const now = new Date();
    const day = `${now.getFullYear()}-${now.getMonth() + 1}-${now.getDate()}`;
    return `${day}|${account}`;
}

export function setCardCollageAccount(ulid: string) {
    account = ulid || "";
}

export function cardCollage(): CardCollage | null {
    return ready;
}

function savedCollage(raw: { key?: unknown; image?: unknown; tile?: unknown } | null | undefined): CardCollage | null {
    if (!raw || typeof raw.key !== "string" || typeof raw.image !== "string" || !Array.isArray(raw.tile)) {
        return null;
    }
    const tile = raw.tile.filter((uri): uri is string => typeof uri === "string" && uri.startsWith("data:image/"));
    if (!raw.image.startsWith("data:image/") || tile.length !== 4) {
        return null;
    }
    return { key: raw.key, image: raw.image, tile };
}

export async function warmCardCollage(): Promise<void> {
    try {
        const result = await multiplayerLoadCollage();
        if (!ready) {
            ready = savedCollage(result?.collage);
        }
    }
    catch (e) {
        logError("notifications: couldn't read the saved Play Together collage", e);
    }
    warmed = true;
    if (stopped || ready?.key === collageKey()) {
        return;
    }
    buildAfter(BUILD_DELAY_MS);
}

function buildAfter(delay: number) {
    startTimer = window.setTimeout(() => {
        startTimer = null;
        void buildCardCollage();
    }, delay);
}

export function refreshCardCollage() {
    if (!warmed || stopped || building || startTimer !== null || ready?.key === collageKey()
        || Date.now() - failedAt < RETRY_AFTER_MS) {
        return;
    }
    buildAfter(OPEN_DELAY_MS);
}

export function stopCardCollage() {
    stopped = true;
    if (startTimer !== null) {
        window.clearTimeout(startTimer);
        startTimer = null;
    }
}

async function buildCardCollage(): Promise<void> {
    const key = collageKey();
    if (building || stopped || ready?.key === key) {
        return;
    }
    building = true;
    try {
        const result = await getGameIcons(GAMES.map(([gameId, imageIcon]) => ({ gameId, imageIcon })));
        const icons: string[] = [];
        for (const [gameId] of GAMES) {
            const uri = result?.icons?.[String(gameId)];
            if (typeof uri === "string" && uri.startsWith("data:image/")) {
                icons.push(uri);
            }
        }
        logNotificationsDebug("collage", key, `get_game_icons: ${icons.length} of ${GAMES.length} icons`);
        const collage = await composite(key, icons);
        if (stopped) {
            return;
        }
        if (!collage) {
            failedAt = Date.now();
            return;
        }
        failedAt = 0;
        ready = collage;
        await multiplayerSaveCollage(collage);
    }
    catch (e) {
        failedAt = Date.now();
        logError("notifications: couldn't build the Play Together collage", e);
    }
    finally {
        building = false;
    }
}

function seededRandom(seed: string): () => number {
    let state = 2166136261;
    for (let index = 0; index < seed.length; index += 1) {
        state = Math.imul(state ^ seed.charCodeAt(index), 16777619);
    }
    return () => {
        state = (state + 0x6d2b79f5) | 0;
        let mixed = Math.imul(state ^ (state >>> 15), 1 | state);
        mixed = (mixed + Math.imul(mixed ^ (mixed >>> 7), 61 | mixed)) ^ mixed;
        return ((mixed ^ (mixed >>> 14)) >>> 0) / 4294967296;
    };
}

async function iconBitmap(uri: string): Promise<ImageBitmap> {
    const comma = uri.indexOf(",");
    const type = uri.slice(5, uri.indexOf(";"));
    const binary = atob(uri.slice(comma + 1));
    const bytes = new Uint8Array(binary.length);
    for (let index = 0; index < binary.length; index += 1) {
        bytes[index] = binary.charCodeAt(index);
    }
    return createImageBitmap(new Blob([bytes], { type }));
}

function dataUri(blob: Blob): Promise<string> {
    return new Promise((resolve, reject) => {
        const reader = new FileReader();
        reader.onload = () => resolve(String(reader.result));
        reader.onerror = () => reject(reader.error);
        reader.readAsDataURL(blob);
    });
}

async function composite(key: string, icons: string[]): Promise<CardCollage | null> {
    const decoded = await Promise.allSettled(icons.map((uri) => iconBitmap(uri)));
    const order: Array<{ uri: string; bitmap: ImageBitmap }> = [];
    decoded.forEach((result, index) => {
        if (result.status === "fulfilled") {
            order.push({ uri: icons[index], bitmap: result.value });
        }
    });
    if (order.length < MIN_GAMES || stopped) {
        for (const icon of order) {
            icon.bitmap.close();
        }
        return null;
    }
    const random = seededRandom(key);
    for (let index = order.length - 1; index > 0; index -= 1) {
        const other = Math.floor(random() * (index + 1));
        [order[index], order[other]] = [order[other], order[index]];
    }
    const count = order.length;
    const step = Math.max(2, Math.floor(count / 3));
    const canvas = new OffscreenCanvas(COLUMNS * CELL_PX, COLLAGE_ROWS * CELL_PX);
    const context = canvas.getContext("2d");
    if (!context) {
        throw new Error("no 2d context");
    }
    context.imageSmoothingQuality = "high";
    for (let row = 0; row < COLLAGE_ROWS; row += 1) {
        for (let column = 0; column <= COLUMNS; column += 1) {
            const x = column * CELL_PX + (row % 2) * (CELL_PX / 2) - CELL_PX / 2;
            context.drawImage(order[(column + row * step) % count].bitmap, x, row * CELL_PX, CELL_PX, CELL_PX);
        }
    }
    for (const icon of order) {
        icon.bitmap.close();
    }
    const image = await dataUri(await canvas.convertToBlob({ type: "image/webp", quality: 0.85 }));
    const half = Math.floor(step / 2);
    const wanted = [half, half + step, half + step * 2, count - 1];
    for (let index = 0; index < count; index += 1) {
        wanted.push(index);
    }
    const picks: number[] = [];
    for (const index of wanted) {
        if (picks.length < 4 && !picks.includes(index % count)) {
            picks.push(index % count);
        }
    }
    return { key, image, tile: picks.map((index) => order[index].uri) };
}
