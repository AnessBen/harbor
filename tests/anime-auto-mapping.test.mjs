import assert from "node:assert/strict";
import { existsSync, readFileSync } from "node:fs";
import test from "node:test";
import vm from "node:vm";
import ts from "typescript";

function load(file, dependencies, globals = {}) {
  const code = ts.transpileModule(readFileSync(new URL("../" + file, import.meta.url), "utf8"), {
    compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 },
  }).outputText;
  const module = { exports: {} };
  vm.runInNewContext(code, {
    ...globals,
    module,
    exports: module.exports,
    require: (id) => {
      assert.ok(id in dependencies, "Unexpected dependency: " + id);
      return dependencies[id];
    },
  });
  return module.exports;
}

function anime(
  id,
  title = "Orbit School",
  subtype = "TV",
  year = "2020",
  episodeCount = 24,
  altTitles = [],
) {
  return { id, title, subtype, year, episodeCount, altTitles };
}

const source = {
  kind: "tv",
  titles: ["Orbit School"],
  year: "2020",
  tmdbTvId: 999,
  imdbId: "tt999",
  episodeCount: 24,
  allowSearch: true,
};

function fixture({
  entries = [anime(700, "Orbit School", "OVA", "2019", 1), anime(701)],
  tmdbId = 700,
  imdbId = tmdbId,
  hits = [701],
  parents = {},
  fail = false,
  onDetail,
  hideAdult = false,
} = {}) {
  const calls = [];
  const byId = new Map(entries.map((entry) => [entry.id, entry]));
  const resource = (entry) => ({
    id: String(entry.id),
    type: "anime",
    attributes: {
      canonicalTitle: entry.title,
      titles: { en: entry.title, en_jp: entry.altTitles[0], ja_jp: entry.altTitles[1] },
      subtype: entry.subtype,
      startDate: entry.year ? entry.year + "-01-01" : undefined,
      episodeCount: entry.episodeCount,
      ageRating: entry.ageRating,
    },
  });
  const kitsu = load(
    "src/lib/providers/kitsu.ts",
    {
      "@/lib/cache": {},
      "@/lib/maintenance": { registerEvictable() {} },
      "@/lib/addons-store/adult-filter": { adultContentHidden: () => hideAdult },
      "@/lib/safe-fetch": {
        safeFetch: async (url) => {
          calls.push(url);
          if (fail) throw new Error("Offline");
          const parsed = new URL(url);
          const match = /\/anime\/(\d+)/.exec(parsed.pathname);
          let body;
          if (parsed.pathname.endsWith("/media-relationships")) {
            const parent = byId.get(parents[Number(match[1])]);
            body = {
              data: parent
                ? [
                    {
                      attributes: { role: "parent_story" },
                      relationships: {
                        destination: { data: { id: String(parent.id), type: "anime" } },
                      },
                    },
                  ]
                : [],
              included: parent ? [resource(parent)] : [],
            };
          } else if (match) {
            await onDetail?.(Number(match[1]));
            const entry = byId.get(Number(match[1]));
            body = { data: entry ? resource(entry) : null };
          } else {
            const allowedRatings = parsed.searchParams.get("filter[ageRating]")?.split(",");
            body = {
              data: hits
                .map((id) => byId.get(id))
                .filter(Boolean)
                .filter((entry) => !allowedRatings || allowedRatings.includes(entry.ageRating))
                .map(resource),
            };
          }
          return { ok: true, json: async () => body };
        },
      },
    },
    { URL },
  );
  const mapping = (id) =>
    id == null ? null : { mappings: { kitsu_id: id, type: byId.get(id)?.subtype } };
  const raw = load(
    "src/lib/providers/anime-mapping.ts",
    {
      "@/lib/providers/anizip": {
        aniZipByTmdbTv: async (id) => {
          calls.push(["tmdb", id]);
          return mapping(tmdbId);
        },
        aniZipByImdb: async (id) => {
          calls.push(["imdb", id]);
          return mapping(imdbId);
        },
      },
      "@/lib/providers/kitsu": kitsu,
      "@/lib/streams/anime-identity-core": {},
      "./mapping-store": {
        mappingStore: () => {
          const entries = new Map();
          return { get: (key) => entries.get(key), set: (key, value) => entries.set(key, value) };
        },
      },
    },
    { fetch: async () => ({ ok: false }) },
  );
  const resolverPath = new URL("../src/lib/providers/anime-auto-mapping.ts", import.meta.url);
  const resolver = existsSync(resolverPath)
    ? load("src/lib/providers/anime-auto-mapping.ts", {
        "@/lib/providers/anime-mapping": raw,
        "@/lib/providers/kitsu": kitsu,
      })
    : {};
  return { raw, kitsu, resolver, calls, setHideAdult: (value) => (hideAdult = value) };
}

// Run the actual automatic detection effect, including its native-ID guard and cleanup.
function detectFromDetail(h, { native = false, meta = {}, detail = {} } = {}) {
  const file = ts.createSourceFile(
    "detail.tsx",
    readFileSync(new URL("../src/views/detail.tsx", import.meta.url), "utf8"),
    ts.ScriptTarget.ESNext,
    true,
    ts.ScriptKind.TSX,
  );
  let effect;
  const helpers = [];
  function visit(node) {
    if (
      ts.isFunctionDeclaration(node) &&
      ["parseYear", "kitsuYearVerdict"].includes(node.name?.text)
    )
      helpers.push(node.getText(file));
    if (
      ts.isCallExpression(node) &&
      node.expression.getText(file) === "useEffect" &&
      node.arguments[0]
        ?.getText(file)
        .includes("if (idAnime || detectedKitsu != null || addonNative) return;")
    )
      effect = node.getText(file);
    ts.forEachChild(node, visit);
  }
  visit(file);
  assert.ok(effect, "Automatic anime detection effect exists");
  let selected = null,
    started = false,
    cleanup;
  let complete;
  const done = new Promise((resolve) => {
    complete = resolve;
  });
  const scope = {
    ...h.raw,
    ...h.kitsu,
    ...h.resolver,
    useEffect: (fn) => {
      cleanup = fn();
    },
    detectGen: { current: 0 },
    window: { setTimeout, clearTimeout },
    idAnime: native,
    detectedKitsu: null,
    addonNative: false,
    failedKitsu: { current: null },
    meta: { id: "tmdb:tv:999", type: "series", name: "Orbit School", releaseInfo: "2020", ...meta },
    detail: {
      title: "Orbit School",
      originalTitle: "Orbit School",
      year: "2020",
      numberOfEpisodes: 24,
      ...detail,
    },
    isOrphanAnimeCandidate: () => true,
    searchAnime: async () => [],
    setDetectingAnime: (value) => {
      if (value) started = true;
      else complete();
    },
    setDetectedKitsu: (id) => {
      selected = id;
    },
    AbortController,
  };
  const code = ts.transpileModule(helpers.join("\n") + "\n" + effect, {
    compilerOptions: { target: ts.ScriptTarget.ES2022 },
  }).outputText;
  vm.runInNewContext(code, scope);
  if (!started) complete();
  return { done: done.then(() => selected), cancel: () => cleanup?.(), selection: () => selected };
}

test("automatic TV detection recovers from a generic one-episode OVA mapping", async () => {
  assert.equal(await detectFromDetail(fixture()).done, 701);
});

test("an unverified mismatch preserves the original TV episode path", async () => {
  assert.equal(await detectFromDetail(fixture({ hits: [] })).done, null);
});

test("explicit anime entries bypass automatic remapping", async () => {
  const h = fixture();
  assert.equal(await detectFromDetail(h, { native: true, meta: { id: "kitsu:700" } }).done, null);
  assert.deepEqual(h.calls, []);
});

function episodeGate(component, scope) {
  const file = ts.createSourceFile(
    "detail.tsx",
    readFileSync(new URL("../src/views/detail.tsx", import.meta.url), "utf8"),
    ts.ScriptTarget.ESNext,
    true,
    ts.ScriptKind.TSX,
  );
  let condition;
  function visit(node) {
    if (
      (ts.isJsxOpeningElement(node) || ts.isJsxSelfClosingElement(node)) &&
      node.tagName.getText(file) === component
    ) {
      let parent = node.parent;
      while (parent && !ts.isBinaryExpression(parent)) parent = parent.parent;
      assert.ok(parent && parent.operatorToken.kind === ts.SyntaxKind.AmpersandAmpersandToken);
      condition = parent.left.getText(file);
    }
    ts.forEachChild(node, visit);
  }
  visit(file);
  assert.ok(condition);
  return new Function(...Object.keys(scope), "return !!(" + condition + ");")(
    ...Object.values(scope),
  );
}

test("Black Clover's captured TV-to-OVA mismatch recovers 170 TV episodes without a title override", async () => {
  const h = fixture({
    entries: [
      anime(12625, "Black Clover", "OVA", "2016", 1),
      anime(13209, "Black Clover", "TV", "2017", 170),
    ],
    tmdbId: 12625,
    hits: [12625, 13209],
  });
  const selected = await detectFromDetail(h, {
    meta: { id: "tmdb:tv:73223", name: "Black Clover", releaseInfo: "2017" },
    detail: {
      title: "Black Clover",
      originalTitle: "ブラッククローバー",
      year: "2017",
      imdbId: "tt7441658",
      numberOfEpisodes: 170,
    },
  }).done;
  assert.equal(selected, 13209);
  assert.equal(
    episodeGate("AnimeEpisodes", {
      liveContext: false,
      detail: {},
      isAnime: selected != null,
      animeEpisodes: Array(170),
      franchise: [],
    }),
    true,
  );
});

test("unresolved mappings leave the actual SeriesEpisodes render condition enabled", async () => {
  const selected = await detectFromDetail(fixture({ hits: [] })).done;
  assert.equal(selected, null);
  assert.equal(
    episodeGate("SeriesEpisodes", {
      liveContext: false,
      tmdbEpisodeList: true,
      isAnime: selected != null,
      detectingAnime: false,
      isSeries: true,
    }),
    true,
  );
});

test("anime auto-detection in flight hides the SeriesEpisodes render condition", () => {
  assert.equal(
    episodeGate("SeriesEpisodes", {
      liveContext: false,
      tmdbEpisodeList: true,
      isAnime: false,
      detectingAnime: true,
      isSeries: true,
    }),
    false,
  );
});

test("healthy direct TV mappings need no title search or relationship requests", async () => {
  const h = fixture({ entries: [anime(701)], tmdbId: 701 });
  assert.equal(await h.resolver.resolveAutoAnime(source), 701);
  assert.equal(h.calls.filter((call) => typeof call === "string").length, 1);
  assert.equal(
    h.calls.some((call) => Array.isArray(call) && call[0] === "imdb"),
    false,
  );
});

test("a conflicting TMDB title falls back to a verified IMDb mapping", async () => {
  const h = fixture({ entries: [anime(700, "Another Show"), anime(701)], imdbId: 701, hits: [] });
  assert.equal(await h.resolver.resolveAutoAnime(source), 701);
  assert.ok(h.calls.some((call) => Array.isArray(call) && call[0] === "imdb"));
});

test("verified parent-story mappings recover TV entries without arbitrary franchise links", async () => {
  const h = fixture({ parents: { 700: 701 }, hits: [] });
  assert.equal(await h.resolver.resolveAutoAnime(source), 701);
});

test("a parent from a different title is rejected", async () => {
  const h = fixture({
    entries: [anime(700, "Orbit School", "OVA", "2019", 1), anime(701, "Another Show")],
    parents: { 700: 701 },
    hits: [],
  });
  assert.equal(await h.resolver.resolveAutoAnime(source), null);
});

test("multi-episode ONAs and legitimate movie mappings retain their identities", async () => {
  const ona = fixture({ entries: [anime(700, "Orbit School", "ONA", "2020", 12)] });
  assert.equal(await ona.resolver.resolveAutoAnime(source), 700);
  const movie = fixture({ entries: [anime(700, "Orbit School", "movie", "2020", 1)] });
  assert.equal(
    await movie.resolver.resolveAutoAnime({ ...source, kind: "movie", tmdbTvId: null }),
    700,
  );
});

test("TV replacement rejects movie, special, single-episode ONA, and one-episode TV mismatches", async () => {
  for (const subtype of ["movie", "special", "ONA", "TV"]) {
    const h = fixture({ entries: [anime(700, "Orbit School", subtype, "2020", 1)], hits: [] });
    assert.equal(await h.resolver.resolveAutoAnime(source), null, subtype);
  }
});

test("full Unicode alternate titles verify localized names without truncating season labels", async () => {
  const h = fixture({
    entries: [anime(700, "Orbit School: Part 2", "TV", "2020", 12, ["軌道学校 第二部"])],
    hits: [],
  });
  assert.equal(await h.resolver.resolveAutoAnime({ ...source, titles: ["軌道学校 第二部"] }), 700);
  assert.equal(await h.resolver.resolveAutoAnime(source), null);
});

test("missing metadata, distant years, and missing source years never authorize replacement", async () => {
  for (const entry of [
    anime(700, "Orbit School", "TV", "2010"),
    { ...anime(700), year: undefined },
    { ...anime(700), subtype: undefined },
  ]) {
    const h = fixture({ entries: [entry], hits: [] });
    assert.equal(await h.resolver.resolveAutoAnime(source), null);
  }
  const h = fixture({ entries: [], hits: [] });
  assert.equal(await h.resolver.resolveAutoAnime(source), null);
  assert.equal(await h.resolver.resolveAutoAnime({ ...source, year: undefined }), null);
});

test("fallback search requires an exact year, full title, and one unambiguous entry", async () => {
  for (const entries of [
    [anime(701, "Orbit School", "TV", "2019")],
    [anime(701, "Orbit School Season 2")],
    [anime(701), anime(702)],
  ]) {
    const h = fixture({
      entries,
      tmdbId: null,
      imdbId: null,
      hits: entries.map((entry) => entry.id),
    });
    assert.equal(await h.resolver.resolveAutoAnime(source), null);
  }
});

test("orphan anime entries can recover independently of cross-provider search deduplication", async () => {
  const h = fixture({ entries: [anime(701)], tmdbId: null, imdbId: null });
  assert.equal(await h.resolver.resolveAutoAnime(source), 701);
  const noHint = fixture({ entries: [anime(701)], tmdbId: null, imdbId: null });
  assert.equal(await noHint.resolver.resolveAutoAnime({ ...source, allowSearch: false }), null);
  assert.equal(
    noHint.calls.some((call) => typeof call === "string" && call.includes("filter[text]")),
    false,
  );
});

test("unavailable providers retain TV metadata and failed detail IDs are excluded", async () => {
  const offline = fixture({ fail: true });
  assert.equal(await offline.resolver.resolveAutoAnime(source), null);
  const failed = fixture({ entries: [anime(701)], tmdbId: 701 });
  assert.equal(await failed.resolver.resolveAutoAnime({ ...source, excludeKitsuId: 701 }), null);
});

test("cancellation stops verification and prevents a stale detail selection", async () => {
  const controller = new AbortController();
  const h = fixture({ entries: [anime(701)], tmdbId: 701, onDetail: () => controller.abort() });
  assert.equal(await h.resolver.resolveAutoAnime({ ...source, signal: controller.signal }), null);
  assert.equal(
    h.calls.some((call) => Array.isArray(call) && call[0] === "imdb"),
    false,
  );
  let release;
  const pending = new Promise((resolve) => {
    release = resolve;
  });
  const delayed = fixture({ entries: [anime(701)], tmdbId: 701, onDetail: () => pending });
  const detection = detectFromDetail(delayed);
  detection.cancel();
  release();
  // Cleanup deliberately leaves setDetectingAnime untouched; drain the resolver microtasks.
  await new Promise((resolve) => setImmediate(resolve));
  assert.equal(detection.selection(), null);
  assert.equal(
    delayed.calls.some((call) => Array.isArray(call) && call[0] === "imdb"),
    false,
  );
});

test("ambiguous search records stay unresolved when one detail provider fails", async () => {
  const h = fixture({
    entries: [anime(701), anime(702)],
    tmdbId: null,
    imdbId: null,
    hits: [701, 702],
    onDetail: (id) => {
      if (id === 702) throw new Error("Unavailable candidate");
    },
  });
  assert.equal(await h.resolver.resolveAutoAnime(source), null);
});

test("detail release year is used when the search result has no parseable year", async () => {
  const h = fixture({ entries: [anime(701)], tmdbId: 701 });
  assert.equal(await detectFromDetail(h, { meta: { releaseInfo: "Unknown" } }).done, 701);
});

test("unrated Polar Opposites recovers its original identity instead of the mapped second season", async () => {
  const title = "You and I Are Polar Opposites";
  const nativeTitle = "正反対な君と僕";
  const h = fixture({
    entries: [
      { ...anime(49372, title, "TV", "2026", 12, [nativeTitle]), ageRating: null },
      { ...anime(50634, title + " Season 2", "TV", "2026", 13), ageRating: null },
    ],
    tmdbId: 50634,
    hits: [49372, 50634],
    hideAdult: true,
  });
  const selected = await detectFromDetail(h, {
    meta: { id: "tmdb:tv:278043", name: title, releaseInfo: "2026" },
    detail: {
      title,
      originalTitle: nativeTitle,
      year: "2026",
      imdbId: "tt36034547",
      numberOfEpisodes: 25,
    },
  }).done;
  assert.equal(selected, 49372);
  for (const component of ["AddToMalButton", "AddToAnilistButton"]) {
    assert.equal(episodeGate(component, { actionStage: 0, isAnime: selected != null }), true);
  }
});

test("identity search allows missing and nonadult ratings while hiding explicit R18 entries", async () => {
  const ratings = [undefined, null, "G", "PG", "R", "R18"];
  const entries = ratings.map((ageRating, index) => ({ ...anime(701 + index), ageRating }));
  const h = fixture({ entries, hits: entries.map((entry) => entry.id), hideAdult: true });
  const hits = await h.kitsu.kitsuSearchAnime("Orbit School");
  assert.deepEqual(
    Array.from(hits, (hit) => hit.id),
    [701, 702, 703, 704, 705],
  );
  const url = h.calls.find((call) => typeof call === "string");
  assert.equal(new URL(url).searchParams.get("filter[text]"), "Orbit School");
  assert.equal(new URL(url).searchParams.has("filter[ageRating]"), false);
});

test("identity search includes explicit R18 entries when adult filtering is disabled", async () => {
  const h = fixture({ entries: [{ ...anime(701), ageRating: "R18" }], hideAdult: false });
  assert.deepEqual(
    Array.from(await h.kitsu.kitsuSearchAnime("Orbit School"), (hit) => hit.id),
    [701],
  );
});

test("adult setting changes re-filter cached identity results without another request", async () => {
  const h = fixture({
    entries: [
      { ...anime(701), ageRating: null },
      { ...anime(702), ageRating: "R18" },
    ],
    hits: [701, 702],
    hideAdult: true,
  });
  const ids = async () =>
    Array.from(await h.kitsu.kitsuSearchAnime("Orbit School"), (hit) => hit.id);
  assert.deepEqual(await ids(), [701]);
  h.setHideAdult(false);
  assert.deepEqual(await ids(), [701, 702]);
  h.setHideAdult(true);
  assert.deepEqual(await ids(), [701]);
  assert.equal(h.calls.length, 1);
});

test("automatic fallback does not select an explicitly adult search entry when hidden", async () => {
  const h = fixture({
    entries: [{ ...anime(701), ageRating: "R18" }],
    tmdbId: null,
    imdbId: null,
    hideAdult: true,
  });
  assert.equal(await h.resolver.resolveAutoAnime(source), null);
  h.setHideAdult(false);
  assert.equal(await h.resolver.resolveAutoAnime(source), 701);
});
