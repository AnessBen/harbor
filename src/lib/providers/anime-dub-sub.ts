import { safeFetch } from "@/lib/safe-fetch";
import { isDubId, type DubScheduleStatus } from "./anime-dub-status";

const FEED_URL =
  "https://raw.githubusercontent.com/RockinChaos/AniSchedule/master/raw/dub-schedule.json";

const FEED_STALE_MS = 30 * 60 * 1000;
const RETRY_MS = 5 * 60 * 1000;
let byMal = new Map<number, DubFeedEntry[]>();
let byAnilist = new Map<number, DubFeedEntry[]>();
let inflight: Promise<DubFeedEntry[]> | null = null;
let retryAt = 0;
const subs = new Set<() => void>();

export type DubFeedEntry = {
  title?: string | null;
  romaji?: string | null;
  english?: string | null;
  episodeDate?: string | null;
  episodeNumber?: number | null;
  episodes?: number | null;
  unaired?: boolean;
  delayedUntil?: string | null;
  delayedIndefinitely?: boolean;
  media?: {
    media?: {
      id?: number | null;
      idMal?: number | null;
      type?: string | null;
      format?: string | null;
      isAdult?: boolean | null;
      title?: { romaji?: string | null; english?: string | null } | null;
      coverImage?: { extraLarge?: string | null; medium?: string | null } | null;
      bannerImage?: string | null;
    } | null;
  } | null;
};

let feedCache: { entries: DubFeedEntry[]; at: number } | null = null;

function parseFeed(value: unknown): DubFeedEntry[] {
  if (!Array.isArray(value)) throw new Error("Invalid dub schedule");
  const entries = value.filter((entry): entry is DubFeedEntry => {
    if (!entry || typeof entry !== "object") return false;
    const media = (entry as DubFeedEntry).media?.media;
    return isDubId(media?.id) || isDubId(media?.idMal);
  });
  if (value.length && !entries.length) throw new Error("Invalid dub schedule entries");
  return entries;
}

/** Fetch the AniSchedule dub feed, cached briefly. Never rejects. */
export function fetchDubSchedule(): Promise<DubFeedEntry[]> {
  const now = Date.now();
  if (feedCache && now - feedCache.at < FEED_STALE_MS) return Promise.resolve(feedCache.entries);
  if (inflight) return inflight;
  if (now < retryAt) return Promise.resolve(feedCache?.entries ?? []);
  inflight = (async () => {
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), 30_000);
    try {
      const res = await safeFetch(FEED_URL, { signal: controller.signal });
      if (!res.ok) throw new Error("Dub schedule request failed");
      const entries = parseFeed(await res.json());
      const mal = new Map<number, DubFeedEntry[]>();
      const ani = new Map<number, DubFeedEntry[]>();
      for (const entry of entries) {
        const media = entry.media?.media;
        if (isDubId(media?.idMal)) mal.set(media.idMal, [...(mal.get(media.idMal) ?? []), entry]);
        if (isDubId(media?.id)) ani.set(media.id, [...(ani.get(media.id) ?? []), entry]);
      }
      byMal = mal;
      byAnilist = ani;
      feedCache = { entries, at: Date.now() };
      retryAt = 0;
      for (const s of subs) s();
      return entries;
    } catch {
      retryAt = Date.now() + RETRY_MS;
      return feedCache?.entries ?? [];
    } finally {
      clearTimeout(timeout);
      inflight = null;
    }
  })();
  return inflight;
}

export function subscribeDubSchedule(fn: () => void): () => void {
  subs.add(fn);
  return () => {
    subs.delete(fn);
  };
}

function episodeAt(entry: DubFeedEntry): number {
  if (typeof entry.episodeDate !== "string") return NaN;
  const date = Date.parse(entry.episodeDate);
  // The feed uses year 0001 as its empty delay sentinel.
  const delay = typeof entry.delayedUntil === "string" ? Date.parse(entry.delayedUntil) : NaN;
  return Number.isFinite(delay) && delay > date ? delay : date;
}

export function dubScheduleEntryStatus(entry: DubFeedEntry, now: number): DubScheduleStatus {
  if (entry.delayedIndefinitely || !isDubId(entry.episodeNumber)) return null;
  const at = episodeAt(entry);
  if (!Number.isFinite(at) || at <= now) return null;
  if (isDubId(entry.episodes) && entry.episodeNumber > entry.episodes) return null;
  // unaired also covers first-episode batches; episodeNumber alone cannot identify a premiere.
  if (entry.unaired === true) return "upcoming";
  if (entry.unaired === false && entry.media?.media?.format !== "MOVIE") return "dubbing";
  return null;
}

export function getDubScheduleStatus(
  metaId: string,
  malId: number | null,
  now = Date.now(),
): DubScheduleStatus {
  if (!feedCache || now - feedCache.at >= FEED_STALE_MS) return null;
  const ani = /^anilist:([1-9]\d*)$/.exec(metaId);
  const entries = [
    ...(malId == null ? [] : (byMal.get(malId) ?? [])),
    ...(ani ? (byAnilist.get(Number(ani[1])) ?? []) : []),
  ];
  const statuses = entries.map((entry) => dubScheduleEntryStatus(entry, now));
  return statuses.includes("upcoming")
    ? "upcoming"
    : statuses.includes("dubbing")
      ? "dubbing"
      : null;
}

/** Next time cards need to discard a schedule indicator, even if the next fetch fails. */
export function nextDubScheduleChange(now = Date.now()): number {
  if (!feedCache || now - feedCache.at >= FEED_STALE_MS) return Infinity;
  let next = feedCache.at + FEED_STALE_MS;
  for (const entry of feedCache.entries) {
    if (dubScheduleEntryStatus(entry, now)) next = Math.min(next, episodeAt(entry));
  }
  return next;
}

export function nextDubScheduleRefresh(now = Date.now()): number {
  if (inflight) return Infinity;
  return Math.max(feedCache ? feedCache.at + FEED_STALE_MS : now, retryAt);
}
