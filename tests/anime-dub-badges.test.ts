import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";
import ts from "typescript";
import * as React from "react";
import * as jsxRuntime from "react/jsx-runtime";
import { renderToStaticMarkup } from "react-dom/server";
import {
  animeDubLabel,
  isDubId,
  parseDubAvailability,
  parseDubMappings,
  resolveDubMalId,
} from "../src/lib/providers/anime-dub-status.ts";
import type { DubFeedEntry } from "../src/lib/providers/anime-dub-sub.ts";

const START = Date.parse("2026-10-14T12:00:00Z");
const MINUTE = 60_000;
const DAY = 24 * 60 * MINUTE;
const KEY = (name: string) => `harbor.anime-dub.${name}.v1`;

function load<T>(
  path: string,
  mocks: Record<string, unknown>,
  globals: Record<string, unknown> = {},
): T {
  const compiled = ts.transpileModule(readFileSync(new URL(path, import.meta.url), "utf8"), {
    fileName: path,
    compilerOptions: {
      target: ts.ScriptTarget.ES2022,
      module: ts.ModuleKind.CommonJS,
      jsx: ts.JsxEmit.ReactJSX,
    },
  }).outputText;
  const api = {};
  new Function("require", "exports", ...Object.keys(globals), compiled)(
    (id: string) => {
      assert.ok(id in mocks, id);
      return mocks[id];
    },
    api,
    ...Object.values(globals),
  );
  return api as T;
}

function episode(overrides: Partial<DubFeedEntry> = {}): DubFeedEntry {
  return {
    title: "Example",
    episodeNumber: 3,
    episodes: 12,
    unaired: false,
    episodeDate: new Date(START + 20 * MINUTE).toISOString(),
    media: { media: { id: 31, idMal: 1, format: "TV" } },
    ...overrides,
  };
}

function fixture(initial: Record<string, string> = {}) {
  let now = START;
  let nextTimer = 0;
  const timers = new Map<number, { at: number; fn: () => void }>();
  const storage = new Map(Object.entries(initial));
  const calls: string[] = [];
  const state = {
    offline: false,
    storageUnavailable: false,
    gate: null as Promise<void> | null,
    data: { dubbed: [1, 2], partial: [2] } as unknown,
    anilist: '{"mal_id":1,"anilist_id":31}\n{"mal_id":2,"anilist_id":32}\n',
    kitsu: '{"mal_id":1,"kitsu_id":101}\n{"mal_id":2,"kitsu_id":102}\n',
    feed: [] as unknown,
  };
  const fetch = async (url: string) => {
    const name = url.endsWith("dub-schedule.json")
      ? "schedule"
      : url.endsWith("mappings_anilist.jsonl")
        ? "anilist"
        : url.endsWith("mappings_kitsu.jsonl")
          ? "kitsu"
          : "english";
    calls.push(name);
    if (state.gate) await state.gate;
    if (state.offline) throw new Error("Offline");
    return new Response(
      name === "anilist"
        ? state.anilist
        : name === "kitsu"
          ? state.kitsu
          : JSON.stringify(name === "schedule" ? state.feed : state.data),
    );
  };
  const globals = {
    Date: class extends Date {
      static now() {
        return now;
      }
    },
    window: {},
    localStorage: {
      getItem: (key: string) => {
        if (state.storageUnavailable) throw new Error("Storage disabled");
        return storage.get(key) ?? null;
      },
      setItem: (key: string, value: string) => {
        if (state.storageUnavailable) throw new Error("Storage disabled");
        storage.set(key, value);
      },
    },
    setTimeout: (fn: () => void, delay: number) => {
      const id = ++nextTimer;
      timers.set(id, { fn, at: now + delay });
      return id;
    },
    clearTimeout: (id: number) => {
      timers.delete(id);
    },
  };
  const status = load<typeof import("../src/lib/providers/anime-dub-status")>(
    "../src/lib/providers/anime-dub-status.ts",
    {},
    globals,
  );
  const schedule = load<typeof import("../src/lib/providers/anime-dub-sub")>(
    "../src/lib/providers/anime-dub-sub.ts",
    { "@/lib/safe-fetch": { safeFetch: fetch }, "./anime-dub-status": status },
    globals,
  );
  const api = load<typeof import("../src/lib/providers/anime-dub-availability")>(
    "../src/lib/providers/anime-dub-availability.ts",
    {
      "@/lib/safe-fetch": { safeFetch: fetch },
      "./anime-dub-status": status,
      "./anime-dub-sub": schedule,
    },
    globals,
  );
  const flush = async () => {
    for (let i = 0; i < 30; i++) await Promise.resolve();
  };
  const advance = async (milliseconds: number) => {
    const target = now + milliseconds;
    for (;;) {
      const due = [...timers.entries()].sort((a, b) => a[1].at - b[1].at)[0];
      if (!due || due[1].at > target) break;
      now = due[1].at;
      timers.delete(due[0]);
      due[1].fn();
      await flush();
    }
    now = target;
    await flush();
  };
  return { api, schedule, state, storage, calls, timers, advance, globals };
}

test("completed anime absent from AniSchedule still has dub availability; partial wins", async () => {
  const h = fixture();
  await h.api.ensureAnimeDubData();
  assert.deepEqual(h.api.getAnimeDubStatus({ id: "mal:1" }), {
    availability: "dub",
    schedule: null,
  });
  assert.deepEqual(h.api.getAnimeDubStatus({ id: "mal:2" }), {
    availability: "partial",
    schedule: null,
  });
  assert.deepEqual(h.api.getAnimeDubStatus({ id: "mal:999" }), {
    availability: null,
    schedule: null,
  });
});

test("MAL, AniList, Kitsu, and explicit metadata MAL IDs agree without per-title requests", async () => {
  const h = fixture();
  await h.api.ensureAnimeDubData();
  for (const id of ["mal:2", "anilist:32", "kitsu:102"]) {
    assert.equal(h.api.getAnimeDubStatus({ id }).availability, "partial");
  }
  assert.equal(h.api.getAnimeDubStatus({ id: "anidb:600", malId: 2 }).availability, "partial");
  for (const id of [
    "mal:2:1",
    "mal:0",
    "mal:-2",
    "mal:2.0",
    "anilist:999",
    "kitsu:999",
    "simkl:2",
  ]) {
    assert.equal(h.api.getAnimeDubStatus({ id }).availability, null);
  }
  assert.equal(resolveDubMalId({ id: "mal:1", malId: 2 }), 1);
  assert.equal(h.calls.length, 4);
});

test("payload validation rejects corrupt data and omits ambiguous mapping IDs", () => {
  for (const payload of [
    null,
    [],
    {},
    { dubbed: [1], partial: null },
    { dubbed: ["1"], partial: [] },
    { dubbed: [-1], partial: [] },
    { dubbed: [], partial: [] },
  ]) {
    assert.throws(() => parseDubAvailability(payload));
  }
  assert.deepEqual(parseDubAvailability({ dubbed: [1, 1], partial: [2, 2], extra: "ignored" }), {
    dubbed: [1],
    partial: [2],
  });
  for (const value of ["{}", "null", "not json", '{"mal_id":1,"kitsu_id":"101"}', ""]) {
    assert.throws(() => parseDubMappings(value, "kitsu"));
  }
  assert.deepEqual(
    parseDubMappings(
      '{"mal_id":1,"anilist_id":31}\r\n{"mal_id":2,"anilist_id":31}\n{"mal_id":3,"anilist_id":32}',
      "anilist",
    ),
    { "32": 3 },
  );
});

test("calendar and concurrent card loads share one request for each source", async () => {
  const h = fixture();
  let release = () => {};
  h.state.gate = new Promise<void>((resolve) => {
    release = resolve;
  });
  const calendar = h.schedule.fetchDubSchedule();
  const first = h.api.ensureAnimeDubData();
  const second = h.api.ensureAnimeDubData();
  assert.equal(h.calls.length, 4);
  release();
  await Promise.all([calendar, first, second]);
  await h.api.ensureAnimeDubData();
  assert.equal(h.calls.length, 4);
});

test("cached availability and mappings work offline, including expired data", async () => {
  const h = fixture({
    [KEY("english")]: JSON.stringify({ at: START - 8 * DAY, data: { dubbed: [7], partial: [8] } }),
    [KEY("anilist")]: JSON.stringify({ at: START - 8 * DAY, data: { "38": 8 } }),
    [KEY("kitsu")]: JSON.stringify({ at: START - 8 * DAY, data: { "108": 8 } }),
  });
  h.state.offline = true;
  const load = h.api.ensureAnimeDubData();
  assert.equal(h.api.getAnimeDubStatus({ id: "mal:7" }).availability, "dub");
  await load;
  assert.equal(h.api.getAnimeDubStatus({ id: "anilist:38" }).availability, "partial");
  assert.equal(h.api.getAnimeDubStatus({ id: "kitsu:108" }).availability, "partial");
  assert.equal(h.api.getAnimeDubStatus({ id: "mal:1" }).availability, null);
});

test("fresh persisted data skips availability and mapping network requests", async () => {
  const h = fixture({
    [KEY("english")]: JSON.stringify({ at: START, data: { dubbed: [1], partial: [] } }),
    [KEY("anilist")]: JSON.stringify({ at: START, data: { "31": 1 } }),
    [KEY("kitsu")]: JSON.stringify({ at: START, data: { "101": 1 } }),
  });
  await h.api.ensureAnimeDubData();
  assert.deepEqual(h.calls, ["schedule"]);
});

test("invalid persisted data is replaced and disabled storage does not prevent badges", async () => {
  const h = fixture({
    [KEY("english")]: "{broken",
    [KEY("anilist")]: JSON.stringify({ at: START, data: { "31": "1" } }),
  });
  await h.api.ensureAnimeDubData();
  assert.equal(h.api.getAnimeDubStatus({ id: "anilist:31" }).availability, "dub");
  assert.deepEqual(JSON.parse(h.storage.get(KEY("english"))!).data, {
    dubbed: [1, 2],
    partial: [2],
  });
  const blocked = fixture();
  blocked.state.storageUnavailable = true;
  await blocked.api.ensureAnimeDubData();
  assert.equal(blocked.api.getAnimeDubStatus({ id: "mal:2" }).availability, "partial");
});

test("failed startup retries after five minutes without caching empty availability", async () => {
  const h = fixture();
  h.state.offline = true;
  await h.api.ensureAnimeDubData();
  assert.equal(h.storage.size, 0);
  h.state.offline = false;
  await h.advance(5 * MINUTE - 1);
  await h.api.ensureAnimeDubData();
  assert.equal(h.calls.length, 4);
  await h.advance(1);
  await h.api.ensureAnimeDubData();
  assert.equal(h.calls.length, 8);
  assert.equal(h.api.getAnimeDubStatus({ id: "mal:1" }).availability, "dub");
});

test("24-hour refresh updates mounted cards and seven-day refresh updates mappings", async () => {
  const h = fixture();
  const observed: number[] = [];
  const stop = h.api.subscribeAnimeDub(() => {
    observed.push(h.api.animeDubVersion());
  });
  await h.api.ensureAnimeDubData();
  const version = h.api.animeDubVersion();
  h.state.data = { dubbed: [2], partial: [1] };
  await h.advance(DAY);
  assert.equal(h.api.getAnimeDubStatus({ id: "mal:1" }).availability, "partial");
  assert.ok(h.api.animeDubVersion() > version);
  assert.equal(h.calls.filter((name) => name === "english").length, 2);
  assert.equal(h.calls.filter((name) => name === "anilist").length, 1);
  h.state.anilist = '{"mal_id":2,"anilist_id":31}';
  await h.advance(6 * DAY);
  assert.equal(h.api.getAnimeDubStatus({ id: "anilist:31" }).availability, "dub");
  assert.equal(h.calls.filter((name) => name === "anilist").length, 2);
  assert.ok(observed.every((value, i) => i === 0 || value > observed[i - 1]));
  stop();
  assert.equal(h.timers.size, 0);
});

test("malformed refreshes preserve the last successful data and retry later", async () => {
  const h = fixture();
  await h.api.ensureAnimeDubData();
  const saved = h.storage.get(KEY("english"));
  h.state.data = { error: "Unavailable" };
  await h.advance(DAY);
  await h.api.ensureAnimeDubData();
  assert.equal(h.api.getAnimeDubStatus({ id: "mal:1" }).availability, "dub");
  assert.equal(h.storage.get(KEY("english")), saved);
  h.state.data = { dubbed: [2], partial: [1] };
  await h.advance(5 * MINUTE);
  await h.api.ensureAnimeDubData();
  assert.equal(h.api.getAnimeDubStatus({ id: "mal:1" }).availability, "partial");
});

test("upcoming batches override availability and ongoing dubs retain partial status", async () => {
  const h = fixture();
  h.state.feed = [
    episode({ unaired: true, episodeNumber: 12 }),
    episode({ media: { media: { idMal: 2, id: 32, format: "TV" } } }),
    episode({ media: { media: { id: 999, format: "TV" } } }),
  ];
  await h.api.ensureAnimeDubData();
  const t = (key: string) => key;
  assert.equal(animeDubLabel(h.api.getAnimeDubStatus({ id: "kitsu:101" }), t), "DUB UPCOMING");
  assert.equal(animeDubLabel(h.api.getAnimeDubStatus({ id: "mal:2" }), t), "PARTIAL DUB · DUBBING");
  assert.equal(animeDubLabel(h.api.getAnimeDubStatus({ id: "anilist:999" }), t), "DUBBING");
  assert.equal(h.api.getAnimeDubStatus({ id: "anilist:999" }).availability, null);
});

test("invalid, indefinitely delayed, elapsed, or ambiguous schedule entries have no indicator", () => {
  const h = fixture();
  for (const changes of [
    { episodeDate: "invalid" },
    { episodeDate: null },
    { delayedIndefinitely: true },
    { episodeNumber: 13 },
    { episodeNumber: null },
    { unaired: undefined },
    { episodeDate: new Date(START).toISOString(), episodeNumber: 12 },
  ]) {
    assert.equal(h.schedule.dubScheduleEntryStatus(episode(changes), START), null);
  }
  assert.equal(
    h.schedule.dubScheduleEntryStatus(episode({ delayedUntil: "0001-01-01T00:00:00Z" }), START),
    "dubbing",
  );
  assert.equal(
    h.schedule.dubScheduleEntryStatus(
      episode({
        episodeDate: new Date(START - MINUTE).toISOString(),
        delayedUntil: new Date(START + MINUTE).toISOString(),
      }),
      START,
    ),
    "dubbing",
  );
});

test("episode and freshness deadlines update mounted badges even when refresh fails", async () => {
  const h = fixture();
  h.state.feed = [episode({ episodeNumber: 12 })];
  const labels: string[] = [];
  const stop = h.api.subscribeAnimeDub(() => {
    labels.push(animeDubLabel(h.api.getAnimeDubStatus({ id: "mal:1" }), (key) => key));
  });
  await h.api.ensureAnimeDubData();
  h.state.offline = true;
  await h.advance(20 * MINUTE);
  assert.equal(labels.at(-1), "DUB");
  assert.equal(h.api.getAnimeDubStatus({ id: "mal:1" }).schedule, null);
  stop();

  const stale = fixture();
  stale.state.feed = [episode({ episodeDate: new Date(START + DAY).toISOString() })];
  const stopStale = stale.api.subscribeAnimeDub(() => {});
  await stale.api.ensureAnimeDubData();
  stale.state.offline = true;
  await stale.advance(30 * MINUTE);
  assert.equal(stale.api.getAnimeDubStatus({ id: "mal:1" }).schedule, null);
  assert.equal(stale.api.getAnimeDubStatus({ id: "mal:1" }).availability, "dub");
  assert.equal((await stale.schedule.fetchDubSchedule()).length, 1);
  stopStale();
});

test("invalid schedule refresh preserves calendar entries while hiding stale card indicators", async () => {
  const h = fixture();
  h.state.feed = [episode()];
  const before = await h.schedule.fetchDubSchedule();
  h.state.feed = { error: "Unavailable" };
  await h.advance(30 * MINUTE);
  const after = await h.schedule.fetchDubSchedule();
  assert.deepEqual(after, before);
  assert.equal(h.schedule.getDubScheduleStatus("mal:1", 1), null);
});

test("one timer serves all subscribers and is removed after the last card unmounts", async () => {
  const h = fixture();
  const stops = Array.from({ length: 100 }, () => h.api.subscribeAnimeDub(() => {}));
  await h.api.ensureAnimeDubData();
  assert.equal(h.timers.size, 1);
  stops.slice(0, 99).forEach((stop) => stop());
  assert.equal(h.timers.size, 1);
  stops[99]();
  assert.equal(h.timers.size, 0);
});

test("the disabled badge hook neither subscribes nor fetches", () => {
  const h = fixture();
  const hook = load<typeof import("../src/lib/use-anime-dub-badge")>(
    "../src/lib/use-anime-dub-badge.ts",
    {
      react: {
        useCallback: (fn: unknown) => fn,
        useEffect: (fn: () => void) => fn(),
        useSyncExternalStore: (subscribe: (fn: () => void) => () => void) => subscribe(() => {}),
      },
      "./providers/anime-dub-availability": h.api,
      "./providers/anime-dub-status": { animeDubLabel },
    },
    h.globals,
  );
  assert.equal(
    hook.useAnimeDubBadge({ id: "mal:1" }, false, (key) => key),
    "",
  );
  assert.equal(h.calls.length, 0);
  assert.equal(h.timers.size, 0);
});

test("labels use translations and title-level status does not change stream audio labels", () => {
  assert.equal(
    animeDubLabel({ availability: "dub", schedule: "dubbing" }, (key) => `translated ${key}`),
    "translated DUBBING",
  );
  assert.equal(
    animeDubLabel({ availability: "dub", schedule: null }, (key) => key),
    "DUB",
  );
  assert.equal(
    animeDubLabel({ availability: "partial", schedule: "dubbing" }, (key) => key),
    "PARTIAL DUB · DUBBING",
  );
  const stream = load<typeof import("../src/components/dub-sub-pill")>(
    "../src/components/dub-sub-pill.tsx",
    {
      "react/jsx-runtime": {},
    },
  );
  assert.equal(stream.streamDubSub(["english", "japanese"], true), "dual");
  assert.equal(stream.streamDubSub(["english"], true), "dub");
  assert.equal(stream.streamDubSub(["japanese"], true), "sub");
  assert.equal(stream.streamDubSub(["english"], false), null);
});

test("Big Picture cards preserve award priority and expose the complete partial-dub label", () => {
  const settings = { showDubBadge: true, showCardBadges: true, watchlistBadge: "off" };
  const state = { award: false };
  const marks = load<typeof import("../src/views/big-picture/bp-card-marks")>(
    "../src/views/big-picture/bp-card-marks.tsx",
    {
      react: React,
      "react/jsx-runtime": jsxRuntime,
      "@/lib/anime-award-labels": { CR_CATEGORY_SHORT: { example: "Example award" } },
      "@/lib/anime-awards": {
        findTopAward: () => (state.award ? { year: 2020, categoryKey: "example" } : null),
        parseAwardYear: () => 2020,
      },
      "@/lib/anime-awards-source": { useAwardMasterVersion: () => 0 },
      "@/lib/awards-history": { mergeBundledAwards: () => null },
      "@/lib/use-bundled-awards": { useBundledAwardsVersion: () => 0 },
      "@/lib/use-anime-dub-badge": {
        useAnimeDubBadge: (_meta: unknown, enabled: boolean) =>
          enabled ? "PARTIAL DUB · DUBBING" : "",
      },
      "@/lib/providers/anime-dub-status": { isDubId },
      "@/lib/providers/tmdb": { useTmdbImdbId: () => undefined },
      "@/lib/providers/wikidata": { awardSummary: () => [] },
      "@/lib/settings": { useSettings: () => ({ settings }) },
      "@/lib/watchlist": { useInWatchlist: () => false },
      "./bp-award-mark": {},
      "./bp-card-state-marks": {},
      "./bp-i18n": { useBpT: () => (key: string) => key },
      "./use-bp-card-badges": { BP_ANIME_ID: /^(kitsu|mal|anilist|anidb|simkl):/ },
    },
  );
  const render = (id = "mal:2", malId?: number) =>
    renderToStaticMarkup(
      React.createElement(marks.BpCardMarks, {
        meta: { id, malId, type: "series", name: "Example", releaseInfo: "2020" },
      }),
    );
  const markup = render();
  assert.match(markup, /title="PARTIAL DUB · DUBBING"/);
  assert.match(markup, /aria-label="PARTIAL DUB · DUBBING"/);
  assert.match(markup, /max-w-full.*truncate/);
  assert.match(render("tt123", 2), /PARTIAL DUB/);
  assert.equal(render("tt123"), "");
  state.award = true;
  assert.match(render(), /2020 Example award/);
  assert.doesNotMatch(render(), /PARTIAL DUB/);
  state.award = false;
  settings.showDubBadge = false;
  assert.equal(render(), "");
});

test("Big Picture hero uses precise dub labels and respects the existing toggle", () => {
  const settings = { showDubBadge: true };
  const state = { label: "DUB UPCOMING" };
  const hero = load<typeof import("../src/views/big-picture/bp-anime-hero-meta")>(
    "../src/views/big-picture/bp-anime-hero-meta.tsx",
    {
      "react/jsx-runtime": jsxRuntime,
      "lucide-react": { Check: () => null },
      "@/components/icons/mal-logo": {},
      "@/lib/anime-awards": {},
      "@/lib/anime-awards-source": {},
      "@/lib/mal-rating": {},
      "@/lib/use-anime-dub-badge": {
        useAnimeDubBadge: (_meta: unknown, enabled: boolean) => (enabled ? state.label : ""),
      },
      "@/lib/settings": { useSettings: () => ({ settings }) },
      "./bp-card-marks": {},
      "./bp-i18n": { useBpT: () => (key: string) => key },
    },
  );
  const render = () =>
    renderToStaticMarkup(
      React.createElement(hero.BpAnimeHeroAvailability, {
        hero: { id: "mal:2", type: "series", name: "Example" },
        fade: "",
      }),
    );
  for (const label of ["DUB UPCOMING", "PARTIAL DUB", "PARTIAL DUB · DUBBING"]) {
    state.label = label;
    assert.ok(render().includes(`aria-label="${label}"`));
    assert.ok(render().includes(`>${label}</span>`));
  }
  settings.showDubBadge = false;
  assert.equal(render(), "");
});
