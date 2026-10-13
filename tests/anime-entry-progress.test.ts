import * as manualProgress from "../src/lib/manual-progress-state.ts";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";
import ts from "typescript";
import { hookHarness } from "./helpers/hook-harness.ts";
import { animeSeasonKey } from "../src/views/detail/anime-episodes/anime-season-key.ts";
import * as identity from "../src/lib/anime-episode-identity.ts";
import { playbackParams, playbackPersistenceHarness } from "./helpers/playback-persistence-harness.ts";
import { animePlayEpisode } from "../src/views/detail/anime-play-episode.ts";
import { parseKitsuId } from "../src/lib/providers/kitsu.ts";
import { splitFranchiseDisplaySeason } from "../src/lib/streams/anime-identity-core.ts";

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

function fixture() {
  const resume = new Map<string, { ms: number; t: number }>();
  const manual = new Map<string, boolean>();
  const key = (id: string, season: number, episode: number) => `${id}|${season}:${episode}`;
  const watchedAtStamps = new Map<string, number>();
  const unwatchedAtStamps = new Map<string, number>();
  const mocks: Record<string, any> = {
    "@/lib/manual-progress-state": manualProgress,
    "@/lib/manual-watched": {
      manualWatchedState: (id: string, s: number, e: number) => manual.get(key(id, s, e)),
      watchedAt: (id: string, s: number, e: number) => watchedAtStamps.get(key(id, s, e)),
      unwatchedAt: (id: string, s: number, e: number) => unwatchedAtStamps.get(key(id, s, e)),
    },
    "@/lib/resume": { readResumeEntry: (id: string, s: number, e: number) => resume.get(key(id, s, e)) ?? null,
      lastPlayedEpisode: (id: string) => {
        let best: any = null;
        for (const [coordinate, entry] of resume) {
          const match = coordinate.match(/^(.*)\|(\d+):(\d+)$/);
          if (match?.[1] === id && (!best || entry.t > best.t))
            best = { ...entry, season: Number(match[2]), episode: Number(match[3]) };
        }
        return best;
      },
      subscribeResume: () => () => {}, resumeVersion: () => 0 },
    "@/lib/spoilers": { spoilerMaskFor: () => ({}) },
    "../helpers": { airedOnly: (episodes: unknown[]) => episodes },
    "./anime-season-key": { animeSeasonKey },
    "./anime-episode-identity": identity,
    "@/lib/anime-episode-identity": identity,
    "@/lib/providers/kitsu": { parseKitsuId },
    "@/lib/streams/anime-identity-core": { splitFranchiseDisplaySeason },
  };
  mocks["@/lib/episode-progress"] = load("src/lib/episode-progress.ts", mocks);
  mocks["@/lib/anime-progress"] = load("src/lib/anime-progress.ts", mocks);
  const ep = { id: 123, number: 1, seasonNumber: 1, length: 24, airdate: null,
    title: "Re:Zero cour episode", streamId: "kitsu:44047:1", sourceMetaId: "kitsu:44047",
    imdbId: "tt5607616", imdbSeason: 2, imdbEpisode: 14 };
  const progress = (metaId: string, extra: Record<string, unknown> = {}) => {
    const h = hookHarness("src/views/detail/anime-episodes/use-anime-progress-map.ts", "useAnimeProgressMap", mocks);
    return h.render({ episodes: [ep], displayEpisodes: [ep], mwVersion: 0, resumeVersion: 0, settings: {},
      progressContext: { metaId, trackId: ep.sourceMetaId, traktWatched: new Set(), ...extra } }).progressFor(ep);
  };
  return { ep, resume, manual, key, progress, mocks, watchedAtStamps, unwatchedAtStamps };
}

test("CW native entry and search/catalog provider entry show the same mapped resume", () => {
  const f = fixture();
  f.resume.set(f.key("tt5607616", 2, 14), { ms: 12 * 60 * 1000, t: 100 });
  const cw = f.progress(f.ep.sourceMetaId);
  const search = f.progress("tt5607616");
  const catalog = f.progress("tmdb:tv:65942");
  assert.equal(cw.ratio, 0.5);
  assert.deepEqual(search, cw);
  assert.deepEqual(catalog, cw);
});

test("Simkl native cour marks reach anime rows from every entry path", () => {
  const f = fixture();
  const simklWatched = new Map([[f.ep.sourceMetaId, new Set(["1:1"])]]);
  for (const id of [f.ep.sourceMetaId, "tt5607616", "tmdb:tv:65942"]) {
    assert.equal(f.progress(id, { simklWatched }).watched, true);
  }
});

test("mapped provider marks and explicit manual unwatched agree across entry paths", () => {
  const f = fixture();
  const simklWatched = new Map([["tt5607616", new Set(["2:14"])]]);
  assert.equal(f.progress(f.ep.sourceMetaId, { simklWatched }).watched, true);
  f.manual.set(f.key(f.ep.sourceMetaId, 1, 1), false);
  f.resume.set(f.key("tt5607616", 2, 14), { ms: 720000, t: 100 });
  for (const id of [f.ep.sourceMetaId, "tt5607616", "tmdb:tv:65942"])
    assert.deepEqual(f.progress(id, { simklWatched }), { ratio: 0, watched: false, startedAt: 100 });
  assert.equal(f.mocks["@/lib/anime-progress"].lastAnimePlayedEpisode([f.ep], {
    metaId: "tt5607616", trackId: f.ep.sourceMetaId, traktWatched: new Set(),
  }), null);
});

test("legacy MAL and TMDB resume aliases use their own verified coordinates", () => {
  const f = fixture();
  const entryAliases = new Map([[f.ep.sourceMetaId, ["mal:42203", "tmdb:tv:65942"]]]);
  f.resume.set(f.key("mal:42203", 1, 1), { ms: 720000, t: 100 });
  f.resume.set(f.key("tmdb:tv:65942", 2, 14), { ms: 360000, t: 200 });
  assert.equal(f.progress(f.ep.sourceMetaId, { entryAliases }).ratio, 0.25, "newest position wins, including rewinds");
  f.manual.set(f.key("mal:42203", 2, 1), true);
  assert.equal(f.progress(f.ep.sourceMetaId, { entryAliases }).watched, true, "legacy autosave marks remain readable");
});

test("another cour's E1 and an unrelated provider S1E1 cannot mark this cour", () => {
  const f = fixture();
  f.resume.set(f.key("tt5607616", 1, 1), { ms: 1400000, t: 100 });
  const anilistWatched = new Map([["kitsu:999", new Set(["1:1"])]]);
  assert.equal(f.progress("tt5607616", { anilistWatched }).ratio, 0);
});

test("long-running absolute episodes, specials and synthetic provider rows keep their ownership", () => {
  const f = fixture();
  const onePiece = { ...f.ep, sourceMetaId: "kitsu:12", streamId: "kitsu:12:1089", number: 1089,
    imdbId: "tt0388629", imdbSeason: 21, imdbEpisode: 45 };
  assert.deepEqual(identity.animeEpisodeCoordinates(onePiece as any, "tt0388629")[0],
    { id: "kitsu:12", season: 1, episode: 1089 });
  const special = { ...f.ep, imdbSeason: 0, seasonNumber: 0 };
  assert.equal(identity.animeEpisodeCoordinates(special as any, f.ep.sourceMetaId)[0].season, 0);
  const unmapped = { ...f.ep, id: -55, sourceMetaId: undefined, streamId: undefined };
  assert.deepEqual(identity.animeEpisodeCoordinates(unmapped as any, f.ep.sourceMetaId, f.ep.sourceMetaId),
    [{ id: "tt5607616", season: 2, episode: 14 }]);
});

test("colliding episode IDs from different cours retain separate progress and next-up", () => {
  const f = fixture();
  const sibling = { ...f.ep, sourceMetaId: "kitsu:999", streamId: "kitsu:999:1", imdbEpisode: 15 };
  const h = hookHarness("src/views/detail/anime-episodes/use-anime-progress-map.ts", "useAnimeProgressMap", f.mocks);
  const context = { metaId: "tt5607616", trackId: f.ep.sourceMetaId, traktWatched: new Set(),
    anilistWatched: new Map([[f.ep.sourceMetaId, new Set(["1:1"])]]),
    malWatched: new Map([[sibling.sourceMetaId, new Set<string>()]]) };
  const args = { episodes: [f.ep, sibling], displayEpisodes: [f.ep, sibling],
    progressContext: context, mwVersion: 0, resumeVersion: 0, settings: {} };
  const first = h.render(args);
  assert.equal(first.progressFor(f.ep).watched, true);
  assert.equal(first.progressFor(sibling).watched, false);
  assert.equal(first.allWatched, false);
  f.resume.set(f.key(sibling.sourceMetaId, 1, 1), { ms: 720000, t: 100 });
  assert.equal(h.render({ ...args, resumeVersion: 1 }).progressFor(sibling).ratio, 0.5);
});

test("actual playback saves and completes native and provider coordinates without hybrid keys", () => {
  for (const finished of [false, true]) {
    const f = fixture();
    const h = playbackPersistenceHarness();
    const p = playbackParams();
    p.src.meta.id = "tt5607616";
    p.src.episode = { season: 1, episode: 1, sourceMetaId: f.ep.sourceMetaId,
      kitsuStreamId: f.ep.streamId, imdbId: f.ep.imdbId, imdbSeason: 2, imdbEpisode: 14 };
    h.render(p);
    h.render({ ...p, snap: { ...p.snap, status: "playing", positionSec: 720, durationSec: 1440 } });
    h.clock(finished ? 1400 : 720); h.tick();
    if (finished) {
      assert.ok(h.watched.some(([id, s, e]) => id === f.ep.sourceMetaId && s === 1 && e === 1));
      assert.ok(h.watched.some(([id, s, e]) => id === "tt5607616" && s === 2 && e === 14));
    } else {
      for (const [id, ms, s, e] of h.writes) f.resume.set(f.key(id, s, e), { ms, t: 100 });
      assert.equal(f.progress(f.ep.sourceMetaId).ratio, 0.5);
      assert.equal(f.progress("tt5607616").ratio, 0.5);
      assert.equal(h.writes.some(([id, , s, e]) => id === "tt5607616" && s === 1 && e === 1), false);
      assert.equal(h.localCw.at(-1).season, 2);
      assert.equal(h.localCw.at(-1).episode, 14);
    }
  }
});

test("hero resume, preferred season and rows select the same episode across entry paths", () => {
  const f = fixture();
  f.resume.set(f.key("tt5607616", 2, 14), { ms: 720000, t: 100 });
  const earlier = { ...f.ep, id: 111, streamId: "kitsu:111:1", sourceMetaId: "kitsu:111", imdbSeason: 1, imdbEpisode: 1 };
  const anilistWatched = new Map([[earlier.sourceMetaId, new Set(["1:1"])]]);
  for (const metaId of [f.ep.sourceMetaId, "tt5607616", "tmdb:tv:65942"]) {
    const progressContext = { metaId, trackId: f.ep.sourceMetaId, traktWatched: new Set(), anilistWatched };
    const preferred = hookHarness("src/views/detail/anime-episodes/use-anime-preferred-season.ts", "useAnimePreferredSeason", f.mocks);
    assert.equal(preferred.render({ episodes: [earlier, f.ep], progressContext, mwVersion: 0, resumeVersion: 0 }), "2");
    const resume = f.mocks["@/lib/anime-progress"].lastAnimePlayedEpisode([f.ep], progressContext);
    assert.equal(animePlayEpisode([f.ep as any], resume, identity.ANIME_ENTRY_ID.test(metaId), f.ep.sourceMetaId)?.kitsuStreamId, f.ep.streamId);
  }
});

test("manual bulk marking writes each cour and mapped provider row to its own coordinates", () => {
  const f = fixture();
  const writes: any[][] = [], simkl: any[][] = [];
  const mocks = {
    "@/lib/manual-progress-state": manualProgress,
    "@/lib/manual-watched": { recordManualWatchedMeta() {}, setManualWatchedMany: (...args: any[]) => writes.push(args) },
    "@/lib/anilist/sync": { syncAnimeProgress() {} },
    "@/lib/mal/sync": { syncMalProgress() {} },
    "@/lib/settings": { useSettings: () => ({ settings: {} }) },
    "@/lib/simkl/provider": { useSimkl: () => ({ isConnected: true }) },
    "@/lib/simkl/ids": { stremioIdToSimklTarget: (id: string) => ({ ok: true,
      target: { kind: "episode", show: { ids: { id } } } }) },
    "@/lib/simkl/history": { markEpisodesWatched: (...args: any[]) => simkl.push(args), unmarkEpisodesWatched() {} },
    "@/lib/anime-episode-identity": identity,
    "../helpers": { airedOnly: (eps: unknown[]) => eps },
  };
  const h = hookHarness("src/views/detail/anime-episodes/use-anime-watched-routing.ts", "useAnimeWatchedRouting", mocks);
  const sibling = { ...f.ep, sourceMetaId: "kitsu:999", streamId: "kitsu:999:1" };
  const provider = { ...f.ep, id: -100, sourceMetaId: undefined, streamId: undefined, number: 15, imdbEpisode: 15 };
  h.render({ id: f.ep.sourceMetaId, name: "Re:Zero", type: "series" }, [], f.ep.sourceMetaId, f.ep.imdbId)
    .markMany([f.ep, sibling, provider], true);
  assert.deepEqual(writes, [
    [f.ep.sourceMetaId, [{ season: 1, episode: 1 }], true],
    ["kitsu:999", [{ season: 1, episode: 1 }], true],
    ["tt5607616", [{ season: 2, episode: 15 }], true],
  ]);
  assert.deepEqual(simkl.map(([ids, season, episodes]) => [ids.id, season, episodes]),
    [[f.ep.sourceMetaId, 1, [1]], ["kitsu:999", 1, [1]], ["tt5607616", 2, [15]]]);
});

test("closing playback retains the mapped position and actual player percentage", async () => {
  const f = fixture();
  const writes: any[][] = [];
  const noop = () => {};
  const h = hookHarness("src/views/player/hooks/use-player-exit.ts", "usePlayerExit", {
    "@/lib/picker-cache": {}, "@/lib/playback-history": {},
    "@/lib/player/playback-clock": { getPlaybackPosition: () => 720 },
    "@/lib/resume": { saveResumeMs: (...args: any[]) => writes.push(args) },
    "@/lib/anime-episode-identity": identity,
    "@/lib/profiles": { useProfiles: () => ({ activeProfile: { id: "one" } }) },
    "@/lib/fullscreen-state": { exitWindowFullscreenOnPlayerClose: noop },
    "../player-utils": { MAX_AUTORETRY_ATTEMPTS: 2 },
  });
  const args = { src: { meta: { id: "tt5607616" }, episode: { season: 1, episode: 1,
    sourceMetaId: f.ep.sourceMetaId, kitsuStreamId: f.ep.streamId,
    imdbId: f.ep.imdbId, imdbSeason: 2, imdbEpisode: 14 } },
    season: 1, episode: 1, durationSec: 1440, captureExitSnapshot: noop, exitPip: noop,
    castActiveRef: { current: false }, inRoom: false, exitPlayback: noop };
  await h.render(args).closePlayer();
  assert.deepEqual(writes.map(([id, ms, s, e, , pct, , owner]) => [id, ms, s, e, pct, owner]),
    [[f.ep.sourceMetaId, 720000, 1, 1, 0.5, "one"], ["tt5607616", 720000, 2, 14, 0.5, "one"]]);
});


test("fresh unwatch defeats legacy watches, remote marks and completed resumes across entry paths", () => {
  const f = fixture();
  f.manual.set(f.key("tt5607616", 2, 14), true);
  f.manual.set(f.key("mal:39587", 1, 1), true);
  f.manual.set(f.key(f.ep.sourceMetaId, 2, 1), true);
  f.manual.set(f.key(f.ep.sourceMetaId, 1, 1), false);
  f.unwatchedAtStamps.set(f.key(f.ep.sourceMetaId, 1, 1), Date.now());
  f.resume.set(f.key("tt5607616", 2, 14), { ms: 24 * 60000, t: 100 });
  const extra = { entryAliases: new Map([[f.ep.sourceMetaId, ["mal:39587"]]]),
    simklWatched: new Map([["tt5607616", new Set(["2:14"])]]) };
  for (const id of [f.ep.sourceMetaId, "tt5607616", "tmdb:tv:65942"])
    assert.deepEqual(f.progress(id, extra), { ratio: 0, watched: false, startedAt: 100 });
});

test("regular progress resolves both primary and IMDb aliases and canonical coordinates by date", () => {
  const f = fixture();
  const get = () => f.mocks["@/lib/episode-progress"].getEpisodeProgress(
    "tmdb:tv:65942", 1, 1, 24, "tt5607616", new Set(["imdb:tt5607616:2:14"]),
    undefined, undefined, undefined, undefined, 2, 14,
  );
  f.manual.set(f.key("tmdb:tv:65942", 1, 1), true);
  f.manual.set(f.key("tt5607616", 2, 14), false);
  f.unwatchedAtStamps.set(f.key("tt5607616", 2, 14), 2000);
  assert.equal(get().watched, false);
  f.watchedAtStamps.set(f.key("tmdb:tv:65942", 1, 1), 3000);
  assert.equal(get().watched, true);
  f.unwatchedAtStamps.set(f.key("tt5607616", 2, 14), 3000);
  assert.equal(get().watched, false);
});

test("legacy manual conflicts have a deterministic unwatch preference", () => {
  assert.equal(manualProgress.resolveManualProgress([{ state: true }, { state: false }]), false);
  assert.equal(manualProgress.resolveManualProgress([{ state: false }, { state: true }]), false);
  assert.equal(manualProgress.resolveManualProgress([{ state: true }]), true);
  assert.equal(manualProgress.resolveManualProgress([{ state: undefined }]), undefined);
});


test("manual cleanup coordinates include entry aliases and historical keys without sharing their resumes", () => {
  const f = fixture();
  const context = { metaId: "tmdb:tv:65942", trackId: f.ep.sourceMetaId, traktWatched: new Set(),
    entryAliases: new Map([[f.ep.sourceMetaId, ["mal:39587"]]]) };
  const api = f.mocks["@/lib/anime-progress"];
  const coordinates = api.animeManualProgressCoordinates(f.ep, context);
  assert.ok(coordinates.some((c: any) => c.id === "mal:39587" && c.season === 1 && c.episode === 1));
  assert.ok(coordinates.some((c: any) => c.id === f.ep.sourceMetaId && c.season === 2 && c.episode === 1));
  assert.ok(coordinates.some((c: any) => c.id === "tmdb:tv:65942" && c.season === 2 && c.episode === 14));
  assert.equal(api.animeProgressCoordinates(f.ep, context).some((c: any) =>
    c.id === f.ep.sourceMetaId && c.season === 2 && c.episode === 1), false);
});
