import { safeFetch } from "@/lib/safe-fetch";
import { scheduleMusicBrainzRequest } from "./recording-profile";
import { artistIdentityKey } from "./artist-authority";

export type MusicLabelRef = {
  id: string;
  name: string;
  releases: number;
};

export type MusicLabelProfile = {
  id: string;
  name: string;
  kind: string;
  country: string;
  began: string;
  ended: string;
  note: string;
};

const MB = "https://musicbrainz.org/ws/2";
const CACHE_MS = 30 * 60_000;
const PAGE = 100;
const MAX_LABELS = 4;
const MAX_ROSTER = 8;
const PLACEHOLDER = new Set(["157afde4-4bf5-4039-8ad2-5a15acc85176"]);

const uuid = /^[a-f\d]{8}(?:-[a-f\d]{4}){3}-[a-f\d]{12}$/i;
const cache = new Map<string, { until: number; value: unknown }>();

type Obj = Record<string, unknown>;
const obj = (value: unknown): Obj =>
  value !== null && typeof value === "object" ? (value as Obj) : {};
const rows = (value: unknown): Obj[] => (Array.isArray(value) ? value.map(obj) : []);
const text = (value: unknown) => (typeof value === "string" ? value.trim().slice(0, 300) : "");

async function mb<T>(path: string, parse: (body: Obj) => T, signal?: AbortSignal): Promise<T> {
  const saved = cache.get(path);
  if (saved && saved.until > Date.now()) return saved.value as T;
  const value = await scheduleMusicBrainzRequest(async () => {
    const response = await safeFetch(`${MB}/${path}`, {
      signal,
      headers: { Accept: "application/json" },
    });
    if (!response.ok) throw new Error("Label metadata is unavailable");
    return parse(obj(await response.json()));
  }, signal);
  cache.set(path, { until: Date.now() + CACHE_MS, value });
  while (cache.size > 60) cache.delete(cache.keys().next().value!);
  return value;
}

export function artistLabels(artistId: string, signal?: AbortSignal): Promise<MusicLabelRef[]> {
  if (!uuid.test(artistId)) return Promise.resolve([]);
  return mb(
    `release?artist=${artistId}&inc=labels&limit=${PAGE}&fmt=json`,
    (body) => {
      const counts = new Map<string, MusicLabelRef>();
      for (const release of rows(body.releases)) {
        for (const info of rows(release["label-info"])) {
          const label = obj(info.label);
          const id = text(label.id);
          const name = text(label.name);
          if (!uuid.test(id) || !name || PLACEHOLDER.has(id)) continue;
          const found = counts.get(id);
          if (found) found.releases += 1;
          else counts.set(id, { id, name, releases: 1 });
        }
      }
      return [...counts.values()]
        .sort((a, b) => b.releases - a.releases)
        .slice(0, MAX_LABELS);
    },
    signal,
  );
}

export function labelProfile(labelId: string, signal?: AbortSignal): Promise<MusicLabelProfile | null> {
  if (!uuid.test(labelId)) return Promise.resolve(null);
  return mb(
    `label/${labelId}?fmt=json`,
    (body) => {
      const name = text(body.name);
      if (!name) return null;
      const span = obj(body["life-span"]);
      return {
        id: labelId,
        name,
        kind: text(body.type),
        country: text(body.country) || text(obj(body.area).name),
        began: text(span.begin),
        ended: text(span.end),
        note: text(body.disambiguation),
      };
    },
    signal,
  );
}

export function labelRoster(labelId: string, signal?: AbortSignal): Promise<string[]> {
  if (!uuid.test(labelId)) return Promise.resolve([]);
  return mb(
    `release?label=${labelId}&inc=artist-credits&limit=${PAGE}&fmt=json`,
    (body) => {
      const counts = new Map<string, { name: string; n: number }>();
      for (const release of rows(body.releases)) {
        for (const credit of rows(release["artist-credit"])) {
          const name = text(obj(credit.artist).name);
          if (!name) continue;
          const key = artistIdentityKey(name);
          const found = counts.get(key);
          if (found) found.n += 1;
          else counts.set(key, { name, n: 1 });
        }
      }
      return [...counts.values()]
        .sort((a, b) => b.n - a.n)
        .slice(0, MAX_ROSTER)
        .map((entry) => entry.name);
    },
    signal,
  );
}

