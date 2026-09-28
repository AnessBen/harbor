import { useMemo, useSyncExternalStore } from "react";
import { musicArtistKey } from "./liked-artists";
import type { MusicArtistRef, MusicTrack } from "./types";

const KEY = "harbor.music.artist-blocks.v1";

export type MusicArtistBlockMode = "play" | "show";

export type MusicArtistBlock = {
  key: string;
  name: string;
  match: string;
  play: boolean;
  show: boolean;
};

type Identity = Pick<MusicArtistRef, "musicBrainzId" | "id" | "connectorId" | "name">;

const listeners = new Set<() => void>();

export function artistMatchKey(name: string): string {
  return name
    .toLowerCase()
    .normalize("NFKD")
    .replace(/[^\p{L}\p{N}]+/gu, "")
    .trim();
}

function load(): MusicArtistBlock[] {
  try {
    const raw = localStorage.getItem(KEY);
    const parsed = raw ? JSON.parse(raw) : null;
    if (!Array.isArray(parsed)) return [];
    return parsed.filter(
      (entry): entry is MusicArtistBlock =>
        !!entry && typeof entry.key === "string" && typeof entry.match === "string",
    );
  } catch {
    return [];
  }
}

let blocks: MusicArtistBlock[] = load();

function commit(next: MusicArtistBlock[]): void {
  blocks = next.filter((entry) => entry.play || entry.show);
  try {
    localStorage.setItem(KEY, JSON.stringify(blocks));
  } catch {}
  for (const listener of listeners) listener();
}

export function subscribeArtistBlocks(listener: () => void): () => void {
  listeners.add(listener);
  return () => {
    listeners.delete(listener);
  };
}

export function getArtistBlocks(): MusicArtistBlock[] {
  return blocks;
}

export function isArtistBlocked(artist: Identity, mode: MusicArtistBlockMode): boolean {
  const key = musicArtistKey(artist);
  const match = artistMatchKey(artist.name);
  return blocks.some((entry) => (entry.key === key || entry.match === match) && entry[mode]);
}

export function toggleArtistBlock(artist: Identity, mode: MusicArtistBlockMode): void {
  const key = musicArtistKey(artist);
  const match = artistMatchKey(artist.name);
  const found = blocks.find((entry) => entry.key === key || entry.match === match);
  if (found) {
    commit(blocks.map((entry) => (entry === found ? { ...entry, [mode]: !entry[mode] } : entry)));
    return;
  }
  commit([
    { key, name: artist.name, match, play: mode === "play", show: mode === "show" },
    ...blocks,
  ]);
}

function hiddenNames(mode: MusicArtistBlockMode): Set<string> {
  const names = new Set<string>();
  for (const entry of blocks) if (entry[mode]) names.add(entry.match);
  return names;
}

export function filterBlockedTracks<T extends Pick<MusicTrack, "artist">>(
  tracks: readonly T[],
  mode: MusicArtistBlockMode,
): T[] {
  const names = hiddenNames(mode);
  if (names.size === 0) return tracks as T[];
  return tracks.filter((track) => !names.has(artistMatchKey(track.artist ?? "")));
}

export function useArtistBlock(
  artist: Identity | null | undefined,
  mode: MusicArtistBlockMode,
): boolean {
  return useSyncExternalStore(
    subscribeArtistBlocks,
    () => (artist ? isArtistBlocked(artist, mode) : false),
    () => false,
  );
}

export function useBlockedArtistFilter<T extends Pick<MusicTrack, "artist">>(
  tracks: readonly T[],
  mode: MusicArtistBlockMode,
): T[] {
  const version = useSyncExternalStore(
    subscribeArtistBlocks,
    () => blocks,
    () => blocks,
  );
  return useMemo(() => filterBlockedTracks(tracks, mode), [tracks, mode, version]);
}
