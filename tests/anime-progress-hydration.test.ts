import * as manualProgress from "../src/lib/manual-progress-state.ts";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";
import ts from "typescript";
import type { KitsuEpisode } from "../src/lib/providers/kitsu.ts";
import { resolveAnimeSlotMatch } from "../src/views/detail/anime-episodes/anime-slot-match.ts";
import * as identity from "../src/lib/anime-episode-identity.ts";
import { animePlayEpisode } from "../src/views/detail/anime-play-episode.ts";
import { hookHarness, flushPromises } from "./helpers/hook-harness.ts";

function load(file: string, mocks: Record<string, unknown>) {
  const output = ts.transpileModule(readFileSync(file, "utf8"), {
    compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 },
  }).outputText;
  const api: any = {};
  new Function("require", "exports", output)((id: string) => {
    assert.ok(id in mocks, `Unexpected import ${id}`);
    return mocks[id];
  }, api);
  return api;
}

const episodeBuild = load("src/lib/providers/anime-episode-build.ts", { "@/lib/providers/anizip": {} });

async function fixture(overrides: Partial<KitsuEpisode> = {}, options: {
  name?: string;
  airDate?: string;
  season?: number;
  absolute?: number | null;
  duplicate?: boolean;
} = {}) {
  const episode: KitsuEpisode = { id: 222, number: 2, seasonNumber: 1,
    title: "Reunion with the Witch", synopsis: "", thumbnail: null, length: 25,
    streamId: "kitsu:11209:2", airdate: null, ...overrides };
  const sibling: KitsuEpisode = { ...episode, id: 333, number: 1, title: "Another cour",
    sourceMetaId: "kitsu:999", streamId: "kitsu:999:1", imdbSeason: 2, imdbEpisode: 1 };
  const episodes = [episode];
  const slot = { id: 555, seasonNumber: options.season ?? 1, episodeNumber: 2,
    name: options.name ?? "Reunion with the Witch", airDate: options.airDate, runtime: 25 };
  const slots = options.duplicate ? [slot, { ...slot, id: 556 }] : [slot];
  const absolute = options.absolute === undefined ? 2 : options.absolute;
  const order = { seasons: [{ seasonNumber: slot.seasonNumber, name: `Season ${slot.seasonNumber}` }],
    bySeason: new Map([[slot.seasonNumber, slots]]),
    absByEpId: new Map(absolute == null ? [] : slots.map((s) => [s.id, absolute])), imageByAbs: new Map() };
  const panel = hookHarness("src/views/detail/anime-episodes/use-anime-tvdb-panel.ts", "useAnimeTvdbPanel", {
    "@/lib/i18n": { useT: () => (s: string) => s },
    "@/lib/providers/anime-mapping": { kitsuToTvdb: async () => 1 },
    "@/lib/providers/anime-detail": { isFranchiseExtra: () => false },
    "@/lib/providers/anime-episode-build": episodeBuild,
    "@/lib/providers/tvdb": { tvdbLangFromIso1: () => "eng", tvdbSeasonTypes: async () => [],
      tvdbOrderTypeHasEpisodes: async () => true, defaultOrderLabel: () => "Aired", tvdbSeriesByRemote: async () => 1 },
    "@/lib/providers/tmdb/tmdb-client": { tmdbLanguageIso: () => "en" },
    "@/lib/localized-text": { pickLocalizedText: (items: { text: string }[]) => items.find((i) => i.text)?.text },
    "@/lib/providers/harbor-imdb": { harborImdbEpisodesCached: () => undefined },
    "@/lib/providers/tvdb-order": { fetchTvdbOrderBySeriesId: async () => order,
      waitForTvdbSeasonNames: async () => order, seasonDateRange: () => ({}) },
    "@/lib/streams/anime-identity": { foreignAnimeProviderSeasons: async () => new Set() },
    "./anime-slot-match": { resolveAnimeSlotMatch },
  });
  const render = (pool?: KitsuEpisode[]) => panel.render(11209, "tt5607616", episodes, "aired", "", true, pool);
  for (let i = 0; i < 4; i++) { render(); await flushPromises(); }
  const initial: KitsuEpisode[] = render().panel.visibleEpisodes;
  const hydrated: KitsuEpisode[] = render([...episodes, sibling]).panel.visibleEpisodes;
  const resume = new Map([["kitsu:11209|1:2", { ms: 750000, t: 100, pct: 0.5 }]]);
  const manual = new Map<string, boolean>();
  const key = (id: string, s: number, e: number) => `${id}|${s}:${e}`;
  const progressMocks = {
    "@/lib/manual-progress-state": manualProgress,
    "@/lib/manual-watched": {
      manualWatchedState: (id: string, s: number, e: number) => manual.get(key(id, s, e)),
      watchedAt: (id: string, s: number, e: number) => undefined,
      unwatchedAt: (id: string, s: number, e: number) => undefined,
    },
    "@/lib/resume": { lastPlayedEpisode: () => null, readResumeEntry: (id: string, s: number, e: number) => resume.get(`${id}|${s}:${e}`) ?? null },
    "@/lib/episode-progress": { WATCHED_THRESHOLD: 0.85 },
    "./anime-episode-identity": identity,
  };
  const api = load("src/lib/anime-progress.ts", progressMocks);
  const progress = (ep: KitsuEpisode, metaId = "kitsu:11209", extra = {}) => api.getAnimeEpisodeProgress(ep, {
    metaId, trackId: "kitsu:11209", imdbId: "tt5607616", traktWatched: new Set(), ...extra,
  });
  return { episode, initial, hydrated, progress, resume, manual };
}

test("CW and search retain native partial progress when the franchise list arrives", async () => {
  const f = await fixture();
  for (const id of ["kitsu:11209", "tt5607616", "tmdb:tv:65942"]) {
    assert.equal(f.progress(f.initial[0], id).ratio, 0.5);
    assert.equal(f.progress(f.hydrated[0], id).ratio, 0.5);
  }
  assert.equal(f.hydrated[0].streamId, "kitsu:11209:2");
  assert.deepEqual(identity.animeEpisodeCoordinates(f.hydrated[0], "tt5607616", "kitsu:11209"), [
    { id: "kitsu:11209", season: 1, episode: 2 }, { id: "tt5607616", season: 1, episode: 2 },
  ]);
  const playback = animePlayEpisode(f.hydrated, { season: 1, episode: 2 }, true, "kitsu:11209");
  assert.deepEqual(identity.animePlaybackCoordinates("kitsu:11209", playback ?? undefined, 1, 2), [
    { id: "kitsu:11209", season: 1, episode: 2 }, { id: "tt5607616", season: 1, episode: 2 },
  ]);
  assert.equal(f.episode.imdbSeason, undefined, "recovery must not mutate the original list");
});

test("tracker and manual watched marks survive the same replacement", async () => {
  const f = await fixture();
  for (const tracker of ["anilistWatched", "malWatched", "simklWatched"]) {
    const context = { [tracker]: new Map([["kitsu:11209", new Set(["1:2"])]]) };
    assert.equal(f.progress(f.initial[0], "tt5607616", context).watched, true);
    assert.equal(f.progress(f.hydrated[0], "tt5607616", context).watched, true);
  }
  f.manual.set("kitsu:11209|1:2", true);
  assert.equal(f.progress(f.hydrated[0]).watched, true);
  f.manual.set("kitsu:11209|1:2", false);
  assert.equal(f.progress(f.hydrated[0]).ratio, 0);
});

test("verified recovery works without TVDB absolute numbering", async () => {
  const f = await fixture({}, { absolute: null });
  assert.equal(f.progress(f.hydrated[0]).ratio, 0.5);
});

test("matching air dates recover translated titles", async () => {
  const f = await fixture({ airdate: "2016-04-11" }, { name: "A translated title", airDate: "2016-04-10" });
  assert.equal(f.progress(f.hydrated[0]).ratio, 0.5);
});

test("number alone cannot attach native progress to an unverified row", async () => {
  const f = await fixture({ airdate: "2016-04-11" }, { name: "Different episode", airDate: "2016-05-10" });
  assert.equal(f.hydrated[0].id, -555);
  assert.equal(f.progress(f.hydrated[0]).ratio, 0);
});

test("generic episode titles cannot serve as identity verification", async () => {
  for (const title of ["Episode 2", "Bölüm 2", "2"]) {
    const f = await fixture({ title }, { name: title });
    assert.equal(f.hydrated[0].id, -555);
    assert.equal(f.progress(f.hydrated[0]).ratio, 0);
  }
});

test("another season cannot inherit the current entry's episode progress", async () => {
  const f = await fixture({}, { season: 2 });
  assert.equal(f.hydrated[0].id, -555);
  assert.equal(f.progress(f.hydrated[0]).ratio, 0);
});

test("recovery never overrides conflicting explicit provider mappings", async () => {
  for (const mapping of [{ imdbSeason: 2, imdbEpisode: 14 }, { tvdbEpisodeId: 999 }, { absoluteNumber: 99 }]) {
    const f = await fixture(mapping);
    assert.equal(f.hydrated[0].id, -555);
    assert.equal(f.progress(f.hydrated[0]).ratio, 0);
  }
});

test("duplicate TVDB slots cannot claim one recovered native episode twice", async () => {
  const f = await fixture({}, { duplicate: true });
  assert.equal(f.hydrated.length, 2);
  assert.equal(f.progress(f.hydrated[0]).ratio, 0.5);
  assert.equal(f.hydrated[1].id, -556);
  assert.equal(f.progress(f.hydrated[1]).ratio, 0);
});
