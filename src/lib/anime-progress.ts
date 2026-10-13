import { resolveManualProgress, type ManualProgressMark } from "@/lib/manual-progress-state";
import type { KitsuEpisode } from "@/lib/providers/kitsu";
import { manualWatchedState, unwatchedAt, watchedAt } from "@/lib/manual-watched";
import { lastPlayedEpisode, readResumeEntry } from "@/lib/resume";
import { WATCHED_THRESHOLD, type EpisodeProgress } from "@/lib/episode-progress";
import { ANIME_ENTRY_ID, animeEpisodeCoordinates, animeSeasonKey } from "./anime-episode-identity";

export type AnimeProgressContext = {
  metaId: string;
  trackId?: string;
  imdbId?: string | null;
  traktWatched: ReadonlySet<string>;
  anilistWatched?: ReadonlyMap<string, ReadonlySet<string>>;
  malWatched?: ReadonlyMap<string, ReadonlySet<string>>;
  simklWatched?: ReadonlyMap<string, ReadonlySet<string>>;
  entryAliases?: ReadonlyMap<string, readonly string[]>;
};

export function animeProgressCoordinates(ep: KitsuEpisode, context: AnimeProgressContext) {
  const targets = animeEpisodeCoordinates(ep, context.metaId, context.trackId, context.imdbId);
  const primary = targets[0];
  if (primary && ANIME_ENTRY_ID.test(primary.id)) {
    for (const id of context.entryAliases?.get(primary.id) ?? []) {
      if (ANIME_ENTRY_ID.test(id) && !targets.some((target) => target.id === id))
        targets.push({ ...primary, id });
      else if ((id.startsWith("tt") || id.startsWith("tmdb:tv:")) && ep.imdbSeason != null && ep.imdbEpisode != null &&
        !targets.some((target) => target.id === id))
        targets.push({ id, season: ep.imdbSeason, episode: ep.imdbEpisode });
    }
  }
  return targets;
}

/** Includes historical hybrid keys only for manual watched-state cleanup. */
export function animeManualProgressCoordinates(ep: KitsuEpisode, context: AnimeProgressContext) {
  const targets = animeProgressCoordinates(ep, context);
  if (ep.id >= 0 && ep.imdbSeason != null && ep.imdbSeason !== animeSeasonKey(ep)) {
    for (const target of [...targets]) {
      if (ANIME_ENTRY_ID.test(target.id)) targets.push({ ...target, season: ep.imdbSeason });
    }
  }
  return targets;
}

export function getAnimeEpisodeProgress(ep: KitsuEpisode, context: AnimeProgressContext): EpisodeProgress {
  const targets = animeProgressCoordinates(ep, context);
  let entry: ReturnType<typeof readResumeEntry> = null;
  const marks: ManualProgressMark[] = animeManualProgressCoordinates(ep, context).map(({ id, season, episode }) => {
    const state = manualWatchedState(id, season, episode);
    return { state, at: state === true ? watchedAt(id, season, episode) : unwatchedAt(id, season, episode) };
  });
  let remoteDone = false;
  for (const target of targets) {
    const { id, season, episode } = target;
    const saved = readResumeEntry(id, season, episode);
    if (saved && (!entry || saved.t > entry.t)) entry = saved;
    const key = `${season}:${episode}`;
    remoteDone ||= context.simklWatched?.get(id)?.has(key) ?? false;
    if (ANIME_ENTRY_ID.test(id)) {
      remoteDone ||= context.anilistWatched?.get(id)?.has(key) ?? false;
      remoteDone ||= context.malWatched?.get(id)?.has(key) ?? false;
    } else if (id.startsWith("tt")) {
      remoteDone ||= context.traktWatched.has(`imdb:${id}:${key}`);
    }
  }
  const startedAt = entry?.t ?? 0;
  const manual = resolveManualProgress(marks);
  if (manual === false)
    return { ratio: 0, watched: false, startedAt };
  const durationMs = ep.length && ep.length > 0 ? ep.length * 60_000 : 0;
  const ratio = typeof entry?.pct === "number" && Number.isFinite(entry.pct)
    ? Math.min(1, Math.max(0, entry.pct))
    : durationMs > 0 ? Math.min(1, Math.max(0, (entry?.ms ?? 0) / durationMs)) : 0;
  const done = manual === true || remoteDone;
  return { ratio: done ? 1 : ratio, watched: done || ratio >= WATCHED_THRESHOLD, startedAt };
}

/** Select only a resume that maps to an episode owned by this page's loaded entries. */
export function lastAnimePlayedEpisode(episodes: KitsuEpisode[], context: AnimeProgressContext) {
  const fallback = lastPlayedEpisode(context.metaId);
  let fallbackLoaded = false;
  let best: { season: number; episode: number; t: number } | null = null;
  for (const ep of episodes) {
    if (fallback && animeProgressCoordinates(ep, context).some((target) =>
      target.id === context.metaId && target.season === fallback.season && target.episode === fallback.episode))
      fallbackLoaded = true;
    const progress = getAnimeEpisodeProgress(ep, context);
    if (!progress.startedAt || progress.ratio === 0 || (best && best.t >= progress.startedAt)) continue;
    const provider = !ANIME_ENTRY_ID.test(context.metaId);
    if (provider && (ep.imdbSeason == null || ep.imdbEpisode == null)) continue;
    best = { season: provider ? ep.imdbSeason! : animeSeasonKey(ep),
      episode: provider ? ep.imdbEpisode! : ep.number, t: progress.startedAt };
  }
  // Preserve an unloaded season, but never revive a loaded episode explicitly marked unwatched.
  return fallback && !fallbackLoaded && (!best || fallback.t > best.t) ? fallback : best;
}
