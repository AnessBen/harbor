import { activeProfileId } from "@/lib/active-profile-id";
import { currentActivitiesAll } from "./activities/gate";
import { simklRequest } from "./client";
import { simklTargetIds } from "./ids";
import { getSession, subscribeSession } from "./session";
import type { SimklTarget } from "./types";

export type WatchlistStatus = "watching" | "plantowatch" | "hold" | "completed" | "dropped";

export const SIMKL_STATUS_LABELS: Record<WatchlistStatus, string> = {
  watching: "Watching",
  plantowatch: "Plan to Watch",
  hold: "On Hold",
  completed: "Completed",
  dropped: "Dropped",
};

export const SHOW_STATUS_ORDER: WatchlistStatus[] = [
  "watching",
  "plantowatch",
  "completed",
  "hold",
  "dropped",
];
export const MOVIE_STATUS_ORDER: WatchlistStatus[] = ["plantowatch", "completed", "dropped"];

type RawIds = {
  simkl?: number;
  imdb?: string;
  tmdb?: number | string;
  mal?: number | string;
  kitsu?: number | string;
  anilist?: number | string;
  anidb?: number | string;
};
type RawEpisode = { number?: number; watched_at?: string | null };
type RawSeason = { number?: number; episodes?: RawEpisode[] };
type RawEntry = {
  status?: string;
  movie?: { ids?: RawIds };
  show?: { ids?: RawIds };
  seasons?: RawSeason[];
};
type RawAllItems = { movies?: RawEntry[]; shows?: RawEntry[]; anime?: RawEntry[] };

type SimklData = {
  statuses: Map<string, WatchlistStatus>;
  watched: Map<string, Set<string>>;
  watchedAt: Map<string, Map<string, number>>;
};

function isStatus(s: string | undefined): s is WatchlistStatus {
  return (
    s === "watching" || s === "plantowatch" || s === "hold" || s === "completed" || s === "dropped"
  );
}

function idKeys(ids: RawIds | undefined, kind: "movie" | "show"): string[] {
  if (!ids) return [];
  const keys: string[] = [];
  if (ids.imdb) keys.push(ids.imdb);
  if (ids.tmdb != null)
    keys.push(kind === "movie" ? `tmdb:movie:${ids.tmdb}` : `tmdb:tv:${ids.tmdb}`);
  if (ids.mal != null) keys.push(`mal:${ids.mal}`);
  if (ids.kitsu != null) keys.push(`kitsu:${ids.kitsu}`);
  if (ids.anilist != null) keys.push(`anilist:${ids.anilist}`);
  if (ids.anidb != null) keys.push(`anidb:${ids.anidb}`);
  return keys;
}

function targetKeys(target: SimklTarget): string[] {
  const ids = simklTargetIds(target);
  return idKeys(ids as RawIds, target.kind === "movie" ? "movie" : "show");
}

let cache: Promise<SimklData> | null = null;
let cacheMarker: string | null = null;
let generation = 0;

subscribeSession(() => {
  generation++;
  cache = null;
  cacheMarker = null;
});

async function pull(): Promise<SimklData> {
  const owner = generation;
  const profile = activeProfileId();
  const data =
    (await simklRequest<RawAllItems | null>(
      "/sync/all-items/all/all?extended=full&episode_watched_at=yes",
    )) ?? {};
  if (owner !== generation || profile !== activeProfileId())
    throw new Error("Simkl session changed");
  const statuses = new Map<string, WatchlistStatus>();
  const watched = new Map<string, Set<string>>();
  const watchedAt = new Map<string, Map<string, number>>();
  const add = (entries: RawEntry[] | undefined, kind: "movie" | "show") => {
    for (const e of entries ?? []) {
      const node = kind === "movie" ? e.movie : e.show;
      const keys = idKeys(node?.ids, kind);
      if (keys.length === 0) continue;
      if (isStatus(e.status)) for (const k of keys) statuses.set(k, e.status);
      if (kind === "show" && e.seasons) {
        const eps = new Set<string>();
        const times = new Map<string, number>();
        for (const s of e.seasons) {
          for (const ep of s.episodes ?? []) {
            if (ep.watched_at && s.number != null && ep.number != null) {
              eps.add(`${s.number}:${ep.number}`);
              const at = Date.parse(ep.watched_at);
              if (Number.isFinite(at)) times.set(`${s.number}:${ep.number}`, at);
            }
          }
        }
        if (eps.size > 0) for (const k of keys) watched.set(k, eps);
        if (times.size > 0) for (const k of keys) watchedAt.set(k, times);
      }
    }
  };
  add(data.movies, "movie");
  add(data.shows, "show");
  add(data.anime, "show");
  rememberSimklWatched(watched);
  return { statuses, watched, watchedAt };
}

async function loadData(): Promise<SimklData> {
  const owner = generation;
  const all = await currentActivitiesAll();
  if (owner !== generation) throw new Error("Simkl session changed");
  if (!cache || (all !== null && all !== cacheMarker)) {
    const request = pull().catch((error) => {
      if (cache === request) {
        cache = null;
        cacheMarker = null;
      }
      throw error;
    });
    cache = request;
    cacheMarker = all;
  }
  return cache;
}

export async function loadSimklStatusMap(): Promise<Map<string, WatchlistStatus>> {
  return (await loadData()).statuses;
}

export async function loadSimklWatchedMap(): Promise<Map<string, Set<string>>> {
  return (await loadData()).watched;
}

export async function loadSimklProgress(): Promise<SimklData> {
  return loadData();
}

function simklWatchedKey(): string {
  return `harbor.simkl.watched.v1.${activeProfileId()}`;
}

// Synchronous starting point for the first paint. The async load still runs and replaces
// this, so a stale copy can only delay a card, never leave it permanently wrong.
export function peekSimklWatchedMap(): Map<string, Set<string>> {
  if (typeof localStorage === "undefined") return new Map();
  try {
    const saved = JSON.parse(localStorage.getItem(simklWatchedKey()) ?? "null");
    if (
      !saved ||
      !saved.account ||
      saved.account !== getSession()?.username ||
      typeof saved.at !== "number" ||
      Date.now() - saved.at > 86400000
    )
      return new Map();
    const raw: unknown = saved.watched;
    if (!raw || typeof raw !== "object") return new Map();
    const map = new Map<string, Set<string>>();
    for (const [key, episodes] of Object.entries(raw as Record<string, unknown>)) {
      if (Array.isArray(episodes)) {
        map.set(key, new Set(episodes.filter((e): e is string => typeof e === "string")));
      }
    }
    return map;
  } catch {
    return new Map();
  }
}

function rememberSimklWatched(watched: Map<string, Set<string>>): void {
  if (typeof localStorage === "undefined") return;
  try {
    const flat: Record<string, string[]> = {};
    for (const [key, episodes] of watched) flat[key] = [...episodes];
    localStorage.setItem(
      simklWatchedKey(),
      JSON.stringify({ account: getSession()?.username, at: Date.now(), watched: flat }),
    );
  } catch {
    /* ignore quota */
  }
}

export function statusForId(map: Map<string, WatchlistStatus>, id: string): WatchlistStatus | null {
  return map.get(id) ?? null;
}

export function simklWatchedForId(
  map: Map<string, Set<string>>,
  ...ids: Array<string | null | undefined>
): Set<string> {
  for (const id of ids) {
    if (!id) continue;
    const set = map.get(id);
    if (set) return set;
  }
  return new Set();
}

export async function setSimklStatus(
  target: SimklTarget,
  status: WatchlistStatus,
): Promise<WatchlistStatus> {
  const ids = simklTargetIds(target);
  const bucket = target.kind === "movie" ? "movies" : "shows";
  const r = await simklRequest<{ added?: Record<string, Array<{ to?: string }>> }>(
    "/sync/add-to-list",
    { method: "POST", body: { to: status, [bucket]: [{ to: status, ids }] } },
  );
  const echoed = r?.added?.[bucket]?.[0]?.to;
  const final = isStatus(echoed) ? echoed : status;
  const statuses = (await loadData()).statuses;
  for (const k of targetKeys(target)) statuses.set(k, final);
  return final;
}

export async function clearSimklStatus(target: SimklTarget): Promise<void> {
  const ids = simklTargetIds(target);
  const bucket = target.kind === "movie" ? "movies" : "shows";
  await simklRequest("/sync/history/remove", { method: "POST", body: { [bucket]: [{ ids }] } });
  const statuses = (await loadData()).statuses;
  for (const k of targetKeys(target)) statuses.delete(k);
}
