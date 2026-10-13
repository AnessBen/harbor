import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";
import ts from "typescript";
import { animeEpisodeCoordinates } from "../src/lib/anime-episode-identity.ts";
import { parseKitsuId } from "../src/lib/providers/kitsu.ts";
import { splitFranchiseDisplaySeason } from "../src/lib/streams/anime-identity-core.ts";
import { animeSeasonKey } from "../src/views/detail/anime-episodes/anime-season-key.ts";

function load(file: string, mocks: Record<string, unknown>) {
  const output = ts.transpileModule(readFileSync(file, "utf8"), {
    compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 },
  }).outputText;
  const api: any = {};
  new Function("require", "exports", output)((name: string) => {
    assert.ok(name in mocks, `Unexpected import ${name}`);
    return mocks[name];
  }, api);
  return api;
}

const animeDetailMocks: Record<string, unknown> = {
  "@/lib/providers/anizip": { aniZipByKitsu: async () => null },
  "@/lib/providers/anime-episode-build": {
    buildKitsuEpisodes: () => [],
    mergeAniZipEpisodes: () => {},
    mergeTvdbEpisodes: () => {},
    mergeTmdbEpisodes: () => {},
    isTextInLanguage: () => true,
  },
  "@/lib/providers/anime-kitsu-addon": { animeKitsuMeta: async () => null },
  "@/lib/providers/anime-mapping": {
    kitsuToTvdb: async () => null,
    kitsuToImdb: async () => null,
    externalToKitsu: async () => null,
    kitsuToAnilist: async () => null,
    kitsuToAnidb: async () => null,
    loadAnidbMaps: async () => null,
  },
  "@/lib/anilist/relations": { anilistFranchise: async () => [] },
  "@/lib/anilist/browse": { anilistArtById: async () => ({}), anilistRecommendations: async () => [] },
  "@/lib/providers/anime-episode-enrich": { enrichEpisodes: async () => [] },
  "@/lib/providers/fanart": { fanartMovie: async () => null, fanartTv: async () => null },
  "@/lib/providers/tvdb-proxy": { fetchTvdbArtwork: async () => null },
  "@/lib/providers/tvdb": {
    tvdbEpisodesByType: async () => [],
    tvdbEpisodesAbsolute: async () => [],
    tvdbLangFromIso1: () => "eng",
  },
  "@/lib/providers/kitsu": { parseKitsuId },
  "@/lib/providers/tmdb": {
    tmdbAnimeLogo: async () => null,
    tmdbDetails: async () => null,
    tmdbSeasonEpisodes: async () => [],
  },
};

const animeDetail = load("src/lib/providers/anime-detail.ts", animeDetailMocks);

function entry(subtype: string | undefined, episodeCount?: number) {
  return {
    meta: { id: "kitsu:1", type: "series", name: "Entry" },
    year: 2025,
    episodeCount,
    subtype,
    isCurrent: false,
    isUpcoming: false,
  };
}

test("multi-episode ONA/OVA cours are seasons, not franchise extras", () => {
  // Sakamoto Days parts are subtype ONA with 11 episodes each.
  assert.equal(animeDetail.isFranchiseExtra(entry("ONA", 11)), false);
  assert.equal(animeDetail.isFranchiseExtra(entry("ona", 11)), false);
  assert.equal(animeDetail.isFranchiseExtra(entry("OVA", 12)), false);
  assert.equal(animeDetail.isFranchiseExtra({ ...entry("ONA", 11), isCurrent: true }), false);
});

test("single-episode and unknown-count shorts stay extras", () => {
  assert.equal(animeDetail.isFranchiseExtra(entry("ONA", 1)), true);
  assert.equal(animeDetail.isFranchiseExtra(entry("ONA", undefined)), true);
  assert.equal(animeDetail.isFranchiseExtra(entry("OVA", 1)), true);
  assert.equal(animeDetail.isFranchiseExtra(entry("special", 8)), true);
  assert.equal(animeDetail.isFranchiseExtra(entry("music", 1)), true);
  assert.equal(
    animeDetail.isFranchiseExtra({ ...entry(undefined, 1), meta: { id: "x", type: "movie", name: "M" } }),
    true,
  );
  assert.equal(animeDetail.isFranchiseExtra(entry("TV", 11)), false);
});

// Sakamoto Days shapes: TMDB 207332 carries season 1 with 22 episodes while
// Kitsu splits the cours into 48915 (part 1, 11 eps) and 49332 (part 2, 11 eps).
const META_ID = "tmdb:tv:207332";
const TRACK_ID = "kitsu:48915";
const IMDB_ID = "tt17069148";

const part1Native = {
  id: 1001, number: 5, seasonNumber: 1, length: 24, airdate: "2025-02-08",
  title: "Source of Strength", streamId: undefined, sourceMetaId: undefined,
  imdbId: IMDB_ID, imdbSeason: 1, imdbEpisode: 5, absoluteNumber: 5, tvdbEpisodeId: 10799921,
};

const part2SyntheticSlot = {
  id: -10800015, number: 15, seasonNumber: 1, length: 24, airdate: "2025-08-18",
  title: "Episode 15", streamId: undefined, sourceMetaId: undefined,
  imdbId: undefined, imdbSeason: 1, imdbEpisode: 15, absoluteNumber: 15, tvdbEpisodeId: 10800015,
};

const part2Native = {
  id: 2005, number: 4, seasonNumber: 1, length: 24, airdate: "2025-08-18",
  title: "Part 2 episode 4", streamId: "kitsu:49332:4", sourceMetaId: "kitsu:49332",
  imdbId: IMDB_ID, imdbSeason: 1, imdbEpisode: 15, absoluteNumber: 15, tvdbEpisodeId: 10800015,
};

function progressFixture() {
  const manual = new Map<string, boolean>();
  const key = (id: string, s: number, e: number) => `${id}|${s}:${e}`;
  const watchedAtStamps = new Map<string, number>();
  const unwatchedAtStamps = new Map<string, number>();
  const mocks: Record<string, any> = {
    "@/lib/manual-watched": {
      manualWatchedState: (id: string, s: number, e: number) => manual.get(key(id, s, e)),
      watchedAt: (id: string, s: number, e: number) => watchedAtStamps.get(key(id, s, e)),
      unwatchedAt: (id: string, s: number, e: number) => unwatchedAtStamps.get(key(id, s, e)),
    },
    "@/lib/resume": {
      readResumeEntry: () => null,
      lastPlayedEpisode: () => null,
      subscribeResume: () => () => {},
      resumeVersion: () => 0,
    },
    "@/lib/episode-progress": { WATCHED_THRESHOLD: 0.85 },
    "./anime-episode-identity": { ANIME_ENTRY_ID: /^(kitsu|mal|anilist|anidb):\d+$/, animeEpisodeCoordinates, animeSeasonKey },
    "@/lib/providers/kitsu": { parseKitsuId },
    "@/lib/streams/anime-identity-core": { splitFranchiseDisplaySeason },
  };
  const progress = load("src/lib/anime-progress.ts", mocks);
  return { manual, key, watchedAtStamps, unwatchedAtStamps, progress };
}

test("Sakamoto Days: the watched-menu write target is readable by episode progress", () => {
  const context = (extra: Record<string, unknown> = {}) => ({
    metaId: META_ID, trackId: TRACK_ID, imdbId: IMDB_ID, traktWatched: new Set(), ...extra,
  });
  // The menu writes animeEpisodeCoordinates(ep)[0]; progress must see that mark.
  for (const ep of [part1Native, part2SyntheticSlot, part2Native]) {
    const f = progressFixture();
    const target = animeEpisodeCoordinates(ep as any, META_ID, TRACK_ID, IMDB_ID)[0];
    assert.ok(target, "episode must resolve a write target");
    assert.equal(f.progress.getAnimeEpisodeProgress(ep as any, context()).watched, false);
    f.manual.set(f.key(target!.id, target!.season, target!.episode), true);
    assert.equal(
      f.progress.getAnimeEpisodeProgress(ep as any, context()).watched,
      true,
      `mark on ${target!.id} ${target!.season}:${target!.episode} must stick`,
    );
  }
});

test("Sakamoto Days: native part-1 rows keep the anime entry as write owner", () => {
  const target = animeEpisodeCoordinates(part1Native as any, META_ID, TRACK_ID, IMDB_ID)[0];
  assert.deepEqual(target, { id: TRACK_ID, season: 1, episode: 5 });
});

test("Sakamoto Days: provider-built part-2 rows write provider coordinates the pool also reads", () => {
  const f = progressFixture();
  const context = { metaId: META_ID, trackId: TRACK_ID, imdbId: IMDB_ID, traktWatched: new Set() };
  const target = animeEpisodeCoordinates(part2SyntheticSlot as any, META_ID, TRACK_ID, IMDB_ID)[0];
  assert.deepEqual(target, { id: META_ID, season: 1, episode: 15 });
  f.manual.set(f.key(target!.id, target!.season, target!.episode), true);
  // A pooled native part-2 row maps the same provider slot, so it must agree.
  assert.equal(f.progress.getAnimeEpisodeProgress(part2Native as any, context).watched, true);
});

test("Sakamoto Days: stale alias unwatch does not veto the watched marks", () => {
  const f = progressFixture();
  const context = { metaId: META_ID, trackId: TRACK_ID, imdbId: IMDB_ID, traktWatched: new Set() };
  // The bulk unwatch from the TMDB-view era: explicit false on every alias id.
  for (const id of [META_ID, IMDB_ID, "anilist:177709", "mal:58939", "anidb:18654"]) {
    f.manual.set(f.key(id, 1, 5), false);
    f.unwatchedAtStamps.set(f.key(id, 1, 5), 1000);
  }
  // The watched marks carry no timestamp (written before watchedAt existed).
  f.manual.set(f.key(TRACK_ID, 1, 5), true);
  assert.equal(f.progress.getAnimeEpisodeProgress(part1Native as any, context).watched, true);
});

test("Sakamoto Days: a newer explicit unwatch still wins over an older watch", () => {
  const f = progressFixture();
  const context = { metaId: META_ID, trackId: TRACK_ID, imdbId: IMDB_ID, traktWatched: new Set() };
  f.manual.set(f.key(TRACK_ID, 1, 5), true);
  f.watchedAtStamps.set(f.key(TRACK_ID, 1, 5), 1000);
  f.manual.set(f.key(META_ID, 1, 5), false);
  f.unwatchedAtStamps.set(f.key(META_ID, 1, 5), 2000);
  assert.deepEqual(f.progress.getAnimeEpisodeProgress(part1Native as any, context), {
    ratio: 0, watched: false, startedAt: 0,
  });
});

test("Sakamoto Days: a newer watch wins over an older unwatch", () => {
  const f = progressFixture();
  const context = { metaId: META_ID, trackId: TRACK_ID, imdbId: IMDB_ID, traktWatched: new Set() };
  f.manual.set(f.key(META_ID, 1, 5), false);
  f.unwatchedAtStamps.set(f.key(META_ID, 1, 5), 1000);
  f.manual.set(f.key(TRACK_ID, 1, 5), true);
  f.watchedAtStamps.set(f.key(TRACK_ID, 1, 5), 2000);
  assert.equal(f.progress.getAnimeEpisodeProgress(part1Native as any, context).watched, true);
});

test("detail gates series/cinemeta episode lists while anime auto-detection is in flight", () => {
  const src = readFileSync(
    new URL("../src/views/detail.tsx", import.meta.url),
    "utf8",
  );
  assert.match(src, /tmdbEpisodeList && !isAnime && !detectingAnime && isSeries/);
  assert.match(src, /!loading &&\s+!detectingAnime &&\s+!tmdbEpisodeList &&\s+!isAnime &&/);
});

test("detail never paints a second loading panel once episodes are on screen", () => {
  const src = readFileSync(
    new URL("../src/views/detail.tsx", import.meta.url),
    "utf8",
  );
  assert.match(src, /const episodesReady =/);
  assert.match(src, /\(loading \|\| detectingAnime\) &&\s+!episodesReady &&/);
});

test("episode readiness follows the branch that will actually render", () => {
  const src = readFileSync(
    new URL("../src/views/detail.tsx", import.meta.url),
    "utf8",
  );
  // A present TMDB season list must not count while the anime list is still
  // loading, and nothing counts while auto-detection is in flight.
  assert.match(src, /!detectingAnime &&\s+\(\s*isAnime\s+\?\s+animeEpisodes\.length > 0/);
});

test("anime auto-detection always releases its flag and cannot stall forever", () => {
  const src = readFileSync(
    new URL("../src/views/detail.tsx", import.meta.url),
    "utf8",
  );
  assert.match(src, /window\.setTimeout\(\(\) => controller\.abort\(\), 15000\)/);
  assert.match(src, /if \(detectGen\.current === gen\) setDetectingAnime\(false\);/);
});
