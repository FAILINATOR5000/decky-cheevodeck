import { loadMemoryFull } from "../../api";

export async function loadFullPictureUrl(gameId: number, path: string): Promise<{ url: string; downscaled: boolean } | null> {
    const result = await loadMemoryFull(gameId, path);
    if (!result?.dataUri) {
        return null;
    }
    const comma = result.dataUri.indexOf(",");
    const type = result.dataUri.slice(5, result.dataUri.indexOf(";"));
    const binary = atob(result.dataUri.slice(comma + 1));
    const bytes = new Uint8Array(binary.length);
    for (let index = 0; index < binary.length; index += 1) {
        bytes[index] = binary.charCodeAt(index);
    }
    return { url: URL.createObjectURL(new Blob([bytes], { type })), downscaled: Boolean(result.downscaled) };
}
