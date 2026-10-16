import { NUMERAL_SPOT, rankNumeral } from "../milestones/RankEmblem";
import type { RankTier } from "../../types";

const HEIGHT = 160;
const RADIUS = HEIGHT / 2;
const AVATAR = 128;
const BADGE = 136;
const GAP = 22;
const NAME_FONT = "800 64px 'Motiva Sans', Arial, Helvetica, sans-serif";
const NAME_END_PAD = 52;
const BACKGROUND = "rgba(0, 0, 0, 0.55)";
const LETTER_FILL = "#3d4450";
const VIEWBOX = 48;

export type SharePillParts = {
    name: string | null;
    avatarDataUri: string | null;
    badge: { svg: string; tier: RankTier; step: number } | null;
};

function loadImage(doc: Document, src: string): Promise<HTMLImageElement> {
    const image = doc.createElement("img");
    image.src = src;
    return image.decode().then(() => image);
}

function drawAvatar(g: CanvasRenderingContext2D, image: HTMLImageElement | null, name: string, centerX: number) {
    g.save();
    g.beginPath();
    g.arc(centerX, RADIUS, AVATAR / 2, 0, Math.PI * 2);
    g.clip();
    if (image) {
        g.drawImage(image, centerX - AVATAR / 2, RADIUS - AVATAR / 2, AVATAR, AVATAR);
    }
    else {
        g.fillStyle = LETTER_FILL;
        g.fillRect(centerX - AVATAR / 2, RADIUS - AVATAR / 2, AVATAR, AVATAR);
        g.fillStyle = "#ffffff";
        g.font = NAME_FONT;
        g.textAlign = "center";
        g.textBaseline = "middle";
        g.fillText((name.trim().slice(0, 1) || "?").toUpperCase(), centerX, RADIUS + 2);
    }
    g.restore();
}

function drawBadge(g: CanvasRenderingContext2D, image: HTMLImageElement, tier: RankTier, step: number, centerX: number) {
    const left = centerX - BADGE / 2;
    const top = RADIUS - BADGE / 2;
    g.drawImage(image, left, top, BADGE, BADGE);
    const scale = BADGE / VIEWBOX;
    const spot = NUMERAL_SPOT[tier];
    g.fillStyle = spot.fill;
    g.font = `800 ${spot.size * scale}px 'Motiva Sans', Arial, Helvetica, sans-serif`;
    g.textAlign = "center";
    g.textBaseline = "middle";
    g.fillText(rankNumeral(step), left + 24 * scale, top + spot.y * scale);
}

export async function drawSharePill(doc: Document, parts: SharePillParts): Promise<string> {
    const { name, avatarDataUri, badge } = parts;
    const avatar = name !== null && avatarDataUri
        ? await loadImage(doc, avatarDataUri).catch(() => null)
        : null;
    const emblem = badge
        ? await loadImage(doc, "data:image/svg+xml;charset=utf-8," + encodeURIComponent(badge.svg))
        : null;

    const canvas = doc.createElement("canvas");
    const g = canvas.getContext("2d");
    if (!g) {
        throw new Error("no 2d context");
    }
    g.font = NAME_FONT;
    const nameWidth = name !== null ? Math.ceil(g.measureText(name).width) : 0;

    let width = HEIGHT;
    if (name !== null) {
        width = RADIUS + AVATAR / 2 + GAP + nameWidth + (badge ? GAP + BADGE / 2 + RADIUS : NAME_END_PAD);
    }
    canvas.width = width;
    canvas.height = HEIGHT;

    g.fillStyle = BACKGROUND;
    g.beginPath();
    g.roundRect(0, 0, width, HEIGHT, RADIUS);
    g.fill();

    if (name !== null) {
        drawAvatar(g, avatar, name, RADIUS);
        g.fillStyle = "#ffffff";
        g.font = NAME_FONT;
        g.textAlign = "left";
        g.textBaseline = "middle";
        g.fillText(name, RADIUS + AVATAR / 2 + GAP, RADIUS + 2);
    }
    if (badge && emblem) {
        drawBadge(g, emblem, badge.tier, badge.step, width - RADIUS);
    }

    return canvas.toDataURL("image/png").split(",", 2)[1];
}
