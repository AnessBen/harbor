import { useSyncExternalStore } from "react";
import type { MusicArtistRef } from "./types";

const KEY = "harbor.music.liked-artists.v1";

export type LikedArtist = {
  key: string;
  id: string;
  connectorId: string;
  name: string;
  artwork?: string;
};

type ArtistIdentity = Pick<MusicArtistRef, "musicBrainzId" | "id" | "connectorId">;

const listeners = new Set<() => void>();

export function musicArtistKey(artist: ArtistIdentity): string {
  return artist.musicBrainzId
    ? `mb:${artist.musicBrainzId}`
    : `${artist.connectorId}:${artist.id}`;
}

function load(): LikedArtist[] {
  try {
    const raw = localStorage.getItem(KEY);
    const parsed = raw ? JSON.parse(raw) : null;
    if (!Array.isArray(parsed)) return [];
    return parsed.filter(
      (entry): entry is LikedArtist =>
        !!entry && typeof entry.key === "string" && typeof entry.name === "string",
    );
  } catch {
    return [];
  }
}

let liked: LikedArtist[] = load();

function commit(next: LikedArtist[]): void {
  liked = next;
  try {
    localStorage.setItem(KEY, JSON.stringify(next));
  } catch {}
  for (const listener of listeners) listener();
}

export function subscribeLikedArtists(listener: () => void): () => void {
  listeners.add(listener);
  return () => {
    listeners.delete(listener);
  };
}

export function getLikedArtists(): LikedArtist[] {
  return liked;
}

export function isArtistLiked(artist: ArtistIdentity): boolean {
  const key = musicArtistKey(artist);
  return liked.some((entry) => entry.key === key);
}

export function toggleLikedArtist(artist: MusicArtistRef): void {
  const key = musicArtistKey(artist);
  if (liked.some((entry) => entry.key === key)) {
    commit(liked.filter((entry) => entry.key !== key));
    return;
  }
  commit([
    {
      key,
      id: artist.id,
      connectorId: artist.connectorId,
      name: artist.name,
      artwork: artist.artwork,
    },
    ...liked,
  ]);
}

export function useLikedArtist(artist: ArtistIdentity | null | undefined): boolean {
  return useSyncExternalStore(
    subscribeLikedArtists,
    () => (artist ? isArtistLiked(artist) : false),
    () => false,
  );
}

export function useLikedArtists(): LikedArtist[] {
  return useSyncExternalStore(subscribeLikedArtists, getLikedArtists, () => liked);
}
