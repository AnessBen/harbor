import { imdbToKitsu, tmdbTvToKitsu } from "@/lib/providers/anime-mapping";
import {
  kitsuAnime,
  kitsuMainTvSeries,
  kitsuSearchAnime,
  type KitsuAnimeCandidate,
} from "@/lib/providers/kitsu";

export type AutoAnimeSource = {
  kind: "tv" | "movie";
  titles: Array<string | null | undefined>;
  year?: string;
  episodeCount?: number;
  tmdbTvId?: number | null;
  imdbId?: string | null;
  allowSearch?: boolean;
  excludeKitsuId?: number | null;
  signal?: AbortSignal;
};

function yearOf(value?: string): number | null {
  const match = /^(\d{4})/.exec(value ?? "");
  const year = match ? Number(match[1]) : 0;
  return year >= 1900 ? year : null;
}

// Preserve season/part labels and non-Latin titles; stripping them can merge split cours.
function normalizeTitle(value: string): string {
  return value
    .normalize("NFKC")
    .toLowerCase()
    .replace(/[^\p{L}\p{N}]+/gu, "");
}

function formatAgrees(source: AutoAnimeSource, anime: KitsuAnimeCandidate): boolean {
  const format = anime.subtype?.toLowerCase();
  if (source.kind === "movie") return format === "movie";
  if (format !== "tv" && format !== "tv_short" && format !== "ona") return false;
  // Multi-episode streaming series are legitimate TV matches; single-episode ONAs are not.
  if (format === "ona" && !(anime.episodeCount != null && anime.episodeCount > 1)) return false;
  return !(source.episodeCount != null && source.episodeCount > 1 && anime.episodeCount === 1);
}

/** Verify automatic metadata replacement; explicit anime IDs never use this resolver. */
export async function resolveAutoAnime(source: AutoAnimeSource): Promise<number | null> {
  const titles = [...new Set(source.titles.filter((title): title is string => !!title?.trim()))];
  const normalized = new Set(titles.map(normalizeTitle).filter(Boolean));
  const year = yearOf(source.year);
  if (source.signal?.aborted || !year || normalized.size === 0) return null;

  const agrees = (anime: KitsuAnimeCandidate | null, yearTolerance: number): boolean => {
    if (!anime || anime.id === source.excludeKitsuId || !formatAgrees(source, anime)) return false;
    const animeYear = yearOf(anime.year);
    return (
      animeYear != null &&
      Math.abs(animeYear - year) <= yearTolerance &&
      [anime.title, ...anime.altTitles].some((title) => normalized.has(normalizeTitle(title)))
    );
  };

  const visited = new Set<number>();
  const verify = async (id: number | null, tolerance: number): Promise<number | null> => {
    if (id == null || visited.has(id) || id === source.excludeKitsuId || source.signal?.aborted)
      return null;
    visited.add(id);
    const anime = await kitsuAnime(id).catch(() => null);
    if (source.signal?.aborted) return null;
    return agrees(anime, tolerance) ? id : null;
  };

  let hasMapping = false;
  const verifyMapping = async (id: number | null): Promise<number | null> => {
    if (id == null || source.signal?.aborted) return null;
    hasMapping = true;
    // A mapped ID can differ by a year between providers. Search candidates need an exact year.
    const verified = await verify(id, 1);
    if (verified != null || source.kind !== "tv" || source.signal?.aborted) return verified;
    const parent = await kitsuMainTvSeries(id).catch(() => null);
    return verify(parent, 1);
  };

  if (source.tmdbTvId != null && Number.isFinite(source.tmdbTvId) && source.tmdbTvId > 0) {
    const mapped = await tmdbTvToKitsu(source.tmdbTvId).catch(() => null);
    const verified = await verifyMapping(mapped);
    if (verified != null) return verified;
  }
  if (source.signal?.aborted) return null;
  if (source.imdbId?.startsWith("tt")) {
    const mapped = await imdbToKitsu(source.imdbId).catch(() => null);
    const verified = await verifyMapping(mapped);
    if (verified != null) return verified;
  }
  if (source.signal?.aborted || (!source.allowSearch && !hasMapping)) return null;

  // Query Kitsu directly: mixed-provider search can deduplicate away the correct Kitsu ID.
  const candidates = new Set<number>();
  const queries = [
    ...new Map(titles.map((title) => [normalizeTitle(title), title])).values(),
  ].slice(0, 2);
  for (const title of queries) {
    if (source.signal?.aborted) return null;
    const hits = await kitsuSearchAnime(title).catch(() => []);
    if (source.signal?.aborted) return null;
    for (const hit of hits) {
      if (agrees(hit, 0)) candidates.add(hit.id);
    }
  }
  // Multiple matching search records are ambiguous even if one detail request fails.
  if (candidates.size !== 1) return null;
  const [id] = candidates;
  return verify(id ?? null, 0);
}
