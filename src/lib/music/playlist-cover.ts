import { idbCacheDelete, idbCacheGet, idbCacheSet } from "@/lib/idb-cache";

const PREFIX = "music.playlist.cover.";
const MAX_EDGE = 640;
const MAX_INPUT_BYTES = 12 * 1024 * 1024;
const QUALITY = 0.86;
const ACCEPTED = /^image\/(png|jpeg|webp|gif|avif)$/;

const EVENT = "harbor:music-playlist-cover";
const memory = new Map<string, string>();

export function musicPlaylistCoverEvent(): string {
  return EVENT;
}

function announce(playlistId: string): void {
  window.dispatchEvent(new CustomEvent(EVENT, { detail: playlistId }));
}

export function cachedPlaylistCover(playlistId: string): string | undefined {
  return memory.get(playlistId);
}

export async function readPlaylistCover(playlistId: string): Promise<string> {
  const held = memory.get(playlistId);
  if (held !== undefined) return held;
  const entry = await idbCacheGet(`${PREFIX}${playlistId}`).catch(() => null);
  const url = typeof entry?.data === "string" ? entry.data : "";
  memory.set(playlistId, url);
  return url;
}

async function shrink(file: File): Promise<string> {
  const bitmap = await createImageBitmap(file);
  const scale = Math.min(1, MAX_EDGE / Math.max(bitmap.width, bitmap.height));
  const width = Math.max(1, Math.round(bitmap.width * scale));
  const height = Math.max(1, Math.round(bitmap.height * scale));
  const canvas = document.createElement("canvas");
  canvas.width = width;
  canvas.height = height;
  const context = canvas.getContext("2d");
  if (!context) {
    bitmap.close();
    throw new Error("music.playlist.coverFailed");
  }
  context.drawImage(bitmap, 0, 0, width, height);
  bitmap.close();
  return canvas.toDataURL("image/webp", QUALITY);
}

export async function savePlaylistCover(playlistId: string, file: File): Promise<string> {
  if (!ACCEPTED.test(file.type)) throw new Error("music.playlist.coverType");
  if (file.size > MAX_INPUT_BYTES) throw new Error("music.playlist.coverSize");
  const url = await shrink(file);
  await idbCacheSet(`${PREFIX}${playlistId}`, { at: Date.now(), data: url });
  memory.set(playlistId, url);
  announce(playlistId);
  return url;
}

export async function clearPlaylistCover(playlistId: string): Promise<void> {
  await idbCacheDelete(`${PREFIX}${playlistId}`).catch(() => {});
  memory.set(playlistId, "");
  announce(playlistId);
}
