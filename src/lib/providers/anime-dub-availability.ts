import { safeFetch } from "@/lib/safe-fetch";
import {
  parseDubAvailability,
  parseDubMappings,
  resolveDubMalId,
  validateDubMappings,
  type AnimeDubStatus,
  type DubAvailabilityData,
  type DubTitle,
} from "./anime-dub-status";
import {
  fetchDubSchedule,
  getDubScheduleStatus,
  nextDubScheduleChange,
  nextDubScheduleRefresh,
  subscribeDubSchedule,
} from "./anime-dub-sub";

const BASE_URL = "https://raw.githubusercontent.com/Joelis57/MyDubList/main/dubs";
const DAY_MS = 24 * 60 * 60 * 1000;
const RETRY_MS = 5 * 60 * 1000;
type Cached<T> = { data: T; at: number };
type Resource<T> = {
  key: string;
  url: string;
  ttl: number;
  decode: (res: Response) => Promise<T>;
  validate: (data: unknown) => T;
  cache: Cached<T> | null;
  retryAt: number;
  inflight: Promise<void> | null;
};

function resource<T>(
  key: string,
  url: string,
  ttl: number,
  validate: (data: unknown) => T,
  decode: (res: Response) => Promise<T>,
): Resource<T> {
  return {
    key: `harbor.anime-dub.${key}.v1`,
    url: `${BASE_URL}/${url}`,
    ttl,
    validate,
    decode,
    cache: null,
    retryAt: 0,
    inflight: null,
  };
}

const availability = resource(
  "english",
  "confidence/low/dubbed_english.json",
  DAY_MS,
  parseDubAvailability,
  async (res) => parseDubAvailability(await res.json()),
);
const anilist = resource(
  "anilist",
  "mappings/mappings_anilist.jsonl",
  7 * DAY_MS,
  validateDubMappings,
  async (res) => parseDubMappings(await res.text(), "anilist"),
);
const kitsu = resource(
  "kitsu",
  "mappings/mappings_kitsu.jsonl",
  7 * DAY_MS,
  validateDubMappings,
  async (res) => parseDubMappings(await res.text(), "kitsu"),
);

let dubbed = new Set<number>();
let partial = new Set<number>();
let hydrated = false;
let version = 0;
let timer: ReturnType<typeof setTimeout> | null = null;
let unsubscribeSchedule: (() => void) | null = null;
const subs = new Set<() => void>();

function rebuildAvailability(data: DubAvailabilityData | undefined): void {
  dubbed = new Set(data?.dubbed);
  partial = new Set(data?.partial);
}

function notify(): void {
  version++;
  for (const fn of subs) fn();
  scheduleRefresh();
}

function hydrate<T>(entry: Resource<T>): void {
  try {
    const raw = localStorage.getItem(entry.key);
    if (!raw) return;
    const parsed = JSON.parse(raw) as Cached<unknown>;
    if (!parsed || !Number.isFinite(parsed.at) || parsed.at <= 0 || parsed.at > Date.now()) return;
    entry.cache = { data: entry.validate(parsed.data), at: parsed.at };
  } catch {
    /* Storage is optional; a network refresh can recover invalid caches. */
  }
}

function load<T>(entry: Resource<T>, onLoaded?: () => void): Promise<void> {
  const now = Date.now();
  if (entry.inflight) return entry.inflight;
  if ((entry.cache && now - entry.cache.at < entry.ttl) || now < entry.retryAt)
    return Promise.resolve();
  entry.inflight = (async () => {
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), 30_000);
    try {
      const res = await safeFetch(entry.url, { signal: controller.signal });
      if (!res.ok) throw new Error("Dub availability request failed");
      const data = await entry.decode(res);
      entry.cache = { data, at: Date.now() };
      entry.retryAt = 0;
      try {
        localStorage.setItem(entry.key, JSON.stringify(entry.cache));
      } catch {
        /* Keep the in-memory data. */
      }
      onLoaded?.();
      notify();
    } catch {
      entry.retryAt = Date.now() + RETRY_MS;
    } finally {
      clearTimeout(timeout);
      entry.inflight = null;
    }
  })();
  return entry.inflight;
}

export async function ensureAnimeDubData(): Promise<void> {
  if (!hydrated) {
    hydrated = true;
    hydrate(availability);
    hydrate(anilist);
    hydrate(kitsu);
    rebuildAvailability(availability.cache?.data);
    notify();
  }
  await Promise.all([
    load(availability, () => rebuildAvailability(availability.cache?.data)),
    load(anilist),
    load(kitsu),
    fetchDubSchedule(),
  ]);
  scheduleRefresh();
}

function nextResourceRefresh<T>(entry: Resource<T>, now: number): number {
  if (entry.inflight) return Infinity;
  return Math.max(entry.cache ? entry.cache.at + entry.ttl : now, entry.retryAt);
}

// One timer serves every mounted card. It also expires dates without requiring navigation.
function scheduleRefresh(): void {
  if (timer != null) clearTimeout(timer);
  timer = null;
  if (!subs.size || typeof window === "undefined") return;
  const now = Date.now();
  const expiresAt = nextDubScheduleChange(now);
  const next = Math.min(
    nextResourceRefresh(availability, now),
    nextResourceRefresh(anilist, now),
    nextResourceRefresh(kitsu, now),
    expiresAt,
    nextDubScheduleRefresh(now),
  );
  if (!Number.isFinite(next)) return;
  timer = setTimeout(
    () => {
      timer = null;
      if (Date.now() >= expiresAt) notify();
      void ensureAnimeDubData();
    },
    Math.max(1000, next - now),
  );
}

export function subscribeAnimeDub(fn: () => void): () => void {
  subs.add(fn);
  if (!unsubscribeSchedule) unsubscribeSchedule = subscribeDubSchedule(notify);
  scheduleRefresh();
  return () => {
    subs.delete(fn);
    if (!subs.size) {
      if (timer != null) clearTimeout(timer);
      timer = null;
      unsubscribeSchedule?.();
      unsubscribeSchedule = null;
    }
  };
}

export function animeDubVersion(): number {
  return version;
}

export function getAnimeDubStatus(title: DubTitle): AnimeDubStatus {
  const mal = resolveDubMalId(title, anilist.cache?.data, kitsu.cache?.data);
  return {
    availability:
      mal == null ? null : partial.has(mal) ? "partial" : dubbed.has(mal) ? "dub" : null,
    schedule: getDubScheduleStatus(title.id, mal),
  };
}
