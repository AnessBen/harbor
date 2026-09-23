import type { Meta } from "@/lib/cinemeta";
import type { KitsuEpisode } from "@/lib/providers/kitsu";

export function animeSeasonKey(ep: KitsuEpisode): number {
  if (ep.imdbSeason === 0) return 0;
  return ep.id < 0 ? (ep.imdbSeason ?? ep.seasonNumber ?? 1) : (ep.seasonNumber ?? 1);
}

export type AnimeDetailTarget = {
  seriesId: string;
  season: number;
  episode: number;
  seriesMeta: Meta;
};

function isResolvableSeriesId(id: string): boolean {
  return id.startsWith("tt") || id.startsWith("tmdb:tv:");
}

// Resolve the episode-detail target for an anime episode without mutating
// display/play/watched identifiers (ep.number, animeSeasonKey).
// Canonical imdbSeason/imdbEpisode are only used when a resolvable
// TMDB/Cinemeta id (tt:/tmdb:tv:) is available; pure kitsu: entries keep
// Kitsu numbering because meta.videos are Kitsu-numbered.
export function resolveAnimeDetailTarget(
  ep: KitsuEpisode,
  parentMeta: Meta,
  epMeta: Meta,
): AnimeDetailTarget {
  const canonicalSeason = ep.imdbSeason ?? animeSeasonKey(ep);
  const canonicalEpisode = ep.imdbEpisode ?? ep.number;
  const canonicalId =
    (ep.imdbId?.startsWith("tt") ? ep.imdbId : null) ??
    (isResolvableSeriesId(parentMeta.id) ? parentMeta.id : null) ??
    (isResolvableSeriesId(epMeta.id) ? epMeta.id : null);
  if (canonicalId) {
    return {
      seriesId: canonicalId,
      season: canonicalSeason,
      episode: canonicalEpisode,
      seriesMeta: epMeta,
    };
  }
  return {
    seriesId: epMeta.id,
    season: animeSeasonKey(ep),
    episode: ep.number,
    seriesMeta: epMeta,
  };
}
