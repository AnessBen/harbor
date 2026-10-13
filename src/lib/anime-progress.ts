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

function progressCoordinates(ep: KitsuEpisode, context: AnimeProgressContext) {
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

export function getAnimeEpisodeProgress(ep: KitsuEpisode, context: AnimeProgressContext): EpisodeProgress {
  const targets = progressCoordinates(ep, context);
  let entry: ReturnType<typeof readResumeEntry> = null;
  let manualDone = false;
  let manualUnwatched = false;
  let remoteDone = false;
  // Last write wins across the row's coordinates: a stale explicit unwatch on
  // one provider id must not hide a fresh (or timestamp-less) watch on another.
  let newestTrue = -1;
  let newestFalse = -1;
  for (const target of targets) {
    const { id, season, episode } = target;
    const saved = readResumeEntry(id, season, episode);
    if (saved && (!entry || saved.t > entry.t)) entry = saved;
    const manual = manualWatchedState(id, season, episode);
    if (manual === true) {
      manualDone = true;
      newestTrue = Math.max(newestTrue, watchedAt(id, season, episode) ?? Number.POSITIVE_INFINITY);
    } else if (manual === false) {
      manualUnwatched = true;
      const ts = unwatchedAt(id, season, episode);
      if (ts != null) newestFalse = Math.max(newestFalse, ts);
    }
    const key = `${season}:${episode}`;
    remoteDone ||= context.simklWatched?.get(id)?.has(key) ?? false;
    if (ANIME_ENTRY_ID.test(id)) {
      remoteDone ||= context.anilistWatched?.get(id)?.has(key) ?? false;
      remoteDone ||= context.malWatched?.get(id)?.has(key) ?? false;
    } else if (id.startsWith("tt")) {
      remoteDone ||= context.traktWatched.has(`imdb:${id}:${key}`);
    }
  }
  // Older autosave wrote provider season + native episode under the native entry.
  // Read those marks for compatibility, but never treat them as provider resume coordinates.
  if (ep.id >= 0 && ep.imdbSeason != null && ep.imdbSeason !== animeSeasonKey(ep)) {
    for (const target of targets) {
      if (!ANIME_ENTRY_ID.test(target.id)) continue;
      const legacy = manualWatchedState(target.id, ep.imdbSeason, target.episode);
      if (legacy === true) {
        manualDone = true;
        newestTrue = Math.max(
          newestTrue,
          watchedAt(target.id, ep.imdbSeason, target.episode) ?? Number.POSITIVE_INFINITY,
        );
      } else if (legacy === false) {
        manualUnwatched = true;
        const ts = unwatchedAt(target.id, ep.imdbSeason, target.episode);
        if (ts != null) newestFalse = Math.max(newestFalse, ts);
      }
    }
  }
  const startedAt = entry?.t ?? 0;
  if (manualUnwatched && !(manualDone && newestTrue >= newestFalse))
    return { ratio: 0, watched: false, startedAt };
  const durationMs = ep.length && ep.length > 0 ? ep.length * 60_000 : 0;
  const ratio = typeof entry?.pct === "number" && Number.isFinite(entry.pct)
    ? Math.min(1, Math.max(0, entry.pct))
    : durationMs > 0 ? Math.min(1, Math.max(0, (entry?.ms ?? 0) / durationMs)) : 0;
  const done = manualDone || remoteDone;
  return { ratio: done ? 1 : ratio, watched: done || ratio >= WATCHED_THRESHOLD, startedAt };
}

/** Select only a resume that maps to an episode owned by this page's loaded entries. */
export function lastAnimePlayedEpisode(episodes: KitsuEpisode[], context: AnimeProgressContext) {
  const fallback = lastPlayedEpisode(context.metaId);
  let fallbackLoaded = false;
  let best: { season: number; episode: number; t: number } | null = null;
  for (const ep of episodes) {
    if (fallback && progressCoordinates(ep, context).some((target) =>
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
