import { useSyncExternalStore } from "react";
import { requestMusicExplore } from "./navigation";
import {
  hydrateJsonStore,
  readJsonStore,
  readLocalJson,
  writeLocalJson,
} from "./local-store";
import { musicTrackKeys } from "./playlist-membership";
import type { MusicTrack } from "./types";

export type MusicTrackIdentity = Pick<MusicTrack, "id" | "connectorId" | "title" | "artist">;

const KEY = "harbor.music.recent-contexts.v1";
const CONTEXT_LIMIT = 200;
const LINK_LIMIT = 8000;
const LINKS_PER_CONTEXT = 120;
const ARTWORK_LIMIT = 4;

export type MusicRecentContextKind = "playlist" | "similar";

export type MusicRecentContext = {
  kind: MusicRecentContextKind;
  id: string;
  name: string;
  artwork: string[];
  at: number;
  seed?: MusicTrack;
};

type MusicRecentLink = { key: string; kind: MusicRecentContextKind; id: string };

type MusicRecentContextStore = { contexts: MusicRecentContext[]; links: MusicRecentLink[] };

const EMPTY: MusicRecentContextStore = { contexts: [], links: [] };

function contextKey(kind: MusicRecentContextKind, id: string): string {
  return `${kind}:${id}`;
}

const MIX_STORE = "context-tracks";
const HELD_LIMIT = 24;
const heldTracks = new Map<string, MusicTrack[]>();
let hydrated = false;

function persistHeld(): void {
  writeLocalJson(MIX_STORE, Object.fromEntries(heldTracks));
}

export async function hydrateMusicContextTracks(): Promise<void> {
  if (hydrated) return;
  hydrated = true;
  const saved = await readLocalJson<Record<string, MusicTrack[]>>(MIX_STORE);
  if (!saved) return;
  for (const [key, tracks] of Object.entries(saved)) {
    if (!heldTracks.has(key) && Array.isArray(tracks) && tracks.length) {
      heldTracks.set(key, tracks);
    }
  }
}

export function rememberMusicContextTracks(
  kind: MusicRecentContextKind,
  id: string,
  tracks: readonly MusicTrack[],
): void {
  if (!tracks.length) return;
  const key = contextKey(kind, id);
  heldTracks.delete(key);
  heldTracks.set(key, [...tracks]);
  while (heldTracks.size > HELD_LIMIT) heldTracks.delete(heldTracks.keys().next().value!);
  persistHeld();
}

export function heldMusicContextTracks(
  kind: MusicRecentContextKind,
  id: string,
): MusicTrack[] | null {
  return heldTracks.get(contextKey(kind, id)) ?? null;
}

function isKind(value: unknown): value is MusicRecentContextKind {
  return value === "playlist" || value === "similar";
}

function text(value: unknown): string {
  return typeof value === "string" ? value : "";
}

function parseContext(value: unknown): MusicRecentContext | null {
  if (!value || typeof value !== "object") return null;
  const entry = value as Record<string, unknown>;
  if (!isKind(entry.kind)) return null;
  const id = text(entry.id).trim();
  const name = text(entry.name).trim();
  if (!id || !name) return null;
  const artwork = Array.isArray(entry.artwork)
    ? entry.artwork.filter((url): url is string => typeof url === "string" && url.length > 0)
    : [];
  const seed =
    entry.seed && typeof entry.seed === "object" && text((entry.seed as MusicTrack).id)
      ? (entry.seed as MusicTrack)
      : undefined;
  if (entry.kind === "similar" && !seed) return null;
  return {
    kind: entry.kind,
    id,
    name,
    artwork: artwork.slice(0, ARTWORK_LIMIT),
    at: typeof entry.at === "number" ? entry.at : 0,
    seed,
  };
}

function parseLink(value: unknown): MusicRecentLink | null {
  if (!value || typeof value !== "object") return null;
  const entry = value as Record<string, unknown>;
  const key = text(entry.key).trim();
  const id = text(entry.id).trim();
  if (!key || !id || !isKind(entry.kind)) return null;
  return { key, kind: entry.kind, id };
}

const CONTEXT_STORE = "recent-contexts";

export async function hydrateMusicRecentContexts(): Promise<void> {
  await hydrateJsonStore(CONTEXT_STORE, KEY);
  store = read();
  index = buildIndex(store);
  for (const listener of listeners) listener();
}

function read(): MusicRecentContextStore {
  try {
    const parsed = readJsonStore<Record<string, unknown> | null>(CONTEXT_STORE, KEY, null);
    if (!parsed) return EMPTY;
    const contexts = Array.isArray(parsed?.contexts)
      ? parsed.contexts
          .map(parseContext)
          .filter((entry): entry is MusicRecentContext => entry !== null)
          .slice(0, CONTEXT_LIMIT)
      : [];
    const keys = new Set(contexts.map((entry) => contextKey(entry.kind, entry.id)));
    const links = Array.isArray(parsed?.links)
      ? parsed.links
          .map(parseLink)
          .filter((entry): entry is MusicRecentLink => entry !== null)
          .filter((entry) => keys.has(contextKey(entry.kind, entry.id)))
          .slice(0, LINK_LIMIT)
      : [];
    return contexts.length === 0 ? EMPTY : { contexts, links };
  } catch {
    return EMPTY;
  }
}

function buildIndex(store: MusicRecentContextStore): Map<string, MusicRecentContext> {
  const byKey = new Map(store.contexts.map((entry) => [contextKey(entry.kind, entry.id), entry]));
  const index = new Map<string, MusicRecentContext>();
  for (const link of store.links) {
    const context = byKey.get(contextKey(link.kind, link.id));
    if (context && !index.has(link.key)) index.set(link.key, context);
  }
  return index;
}

let store = read();
let index = buildIndex(store);
const listeners = new Set<() => void>();

function subscribe(listener: () => void): () => void {
  listeners.add(listener);
  return () => {
    listeners.delete(listener);
  };
}

function commit(next: MusicRecentContextStore): void {
  store = next;
  index = buildIndex(next);
  writeLocalJson(CONTEXT_STORE, next);
  for (const listener of listeners) listener();
}

export function recordMusicRecentContext(
  entry: Omit<MusicRecentContext, "at">,
  tracks: readonly MusicTrackIdentity[] = [],
): void {
  const id = entry.id.trim();
  const name = entry.name.trim();
  if (!id || !name) return;
  if (entry.kind === "similar" && !entry.seed) return;
  const key = contextKey(entry.kind, id);
  const context: MusicRecentContext = {
    ...entry,
    id,
    name,
    artwork: entry.artwork.filter((url) => url.trim().length > 0).slice(0, ARTWORK_LIMIT),
    at: Date.now(),
  };
  const contexts = [
    context,
    ...store.contexts.filter((item) => contextKey(item.kind, item.id) !== key),
  ].slice(0, CONTEXT_LIMIT);
  const keys = new Set(contexts.map((item) => contextKey(item.kind, item.id)));
  const seen = new Set<string>();
  const fresh: MusicRecentLink[] = [];
  for (const track of tracks) {
    for (const value of musicTrackKeys(track)) {
      if (seen.has(value)) continue;
      seen.add(value);
      fresh.push({ key: value, kind: entry.kind, id });
    }
    if (fresh.length >= LINKS_PER_CONTEXT) break;
  }
  const links = [...fresh, ...store.links.filter((link) => !seen.has(link.key))]
    .filter((link) => keys.has(contextKey(link.kind, link.id)))
    .slice(0, LINK_LIMIT);
  commit({ contexts, links });
}

export function refreshMusicRecentContextArtwork(updates: Map<string, string[]>): void {
  let changed = false;
  const contexts = store.contexts.map((context) => {
    const next = updates.get(context.id);
    if (!next?.length || next.join("|") === context.artwork.join("|")) return context;
    changed = true;
    return { ...context, artwork: next.slice(0, ARTWORK_LIMIT) };
  });
  if (changed) commit({ contexts, links: store.links });
}

export function musicContextArtwork(tracks: readonly MusicTrack[]): string[] {
  const seen = new Set<string>();
  const covers: string[] = [];
  for (const track of tracks) {
    const url = track.artwork?.trim();
    if (!url || seen.has(url)) continue;
    seen.add(url);
    covers.push(url);
    if (covers.length === ARTWORK_LIMIT) break;
  }
  return covers;
}

export function getMusicRecentContexts(): MusicRecentContext[] {
  return store.contexts;
}

export function useMusicRecentContexts(): MusicRecentContext[] {
  return useSyncExternalStore(subscribe, getMusicRecentContexts, getMusicRecentContexts);
}

export function getMusicTrackContext(
  track: MusicTrackIdentity | null | undefined,
): MusicRecentContext | null {
  if (!track) return null;
  for (const key of musicTrackKeys(track)) {
    const found = index.get(key);
    if (found) return found;
  }
  return null;
}

export function useMusicTrackContext(
  track: MusicTrackIdentity | null | undefined,
): MusicRecentContext | null {
  return useSyncExternalStore(
    subscribe,
    () => getMusicTrackContext(track),
    () => getMusicTrackContext(track),
  );
}

export async function reopenMusicMix(context: MusicRecentContext): Promise<void> {
  const seed = context.seed;
  if (!seed) return;
  await hydrateMusicContextTracks();
  const held = heldMusicContextTracks("similar", context.id);
  if (held?.length) {
    requestMusicExplore({ kind: "similar", track: held[0], queue: held, label: context.name });
    return;
  }
  const { musicSimilarTracks } = await import("./player");
  const mix = await musicSimilarTracks(seed);
  const queue = mix.length > 0 ? mix : [seed];
  rememberMusicContextTracks("similar", context.id, queue);
  requestMusicExplore({ kind: "similar", track: seed, queue, label: context.name });
}
