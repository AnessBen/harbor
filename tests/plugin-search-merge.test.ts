import assert from "node:assert/strict";
import test from "node:test";
import { relevanceScore } from "../src/lib/streams/plugins/extension/match.ts";
import { mergeHits, searchGroups } from "../src/lib/streams/plugins/extension/search.ts";
import type { Meta } from "../src/lib/cinemeta.ts";

const hit = (id: string, name = id): Meta => ({ id, type: "movie", name });

test("the same item reached through two providers is one result", () => {
  // Two providers of the same plugin can both answer with the same title, and they arrive as
  // different Meta objects carrying the same id.
  const merged = mergeHits([[hit("a"), hit("b")], [hit("b"), hit("c")]], 100);
  assert.deepEqual(
    merged.map((m) => m.id),
    ["a", "b", "c"],
  );
  // The first one to arrive is the one kept, so the order the plugins answered in is respected.
  const first = mergeHits([[hit("a", "first")], [hit("a", "second")]], 100);
  assert.equal(first[0].name, "first");
});

test("each plugin keeps its own results, and one title found twice stays twice", () => {
  const plugins = [
    { id: "p1", name: "UHDmoviesProvider", icon: "u.png" },
    { id: "p2", name: "Moviesmod" },
    { id: "p3", name: "Perverzija" },
  ];
  const groups = searchGroups(plugins, [[hit("same"), hit("only-uhd")], [hit("same")], null], 10);
  // p3 failed, so it leaves no rail behind.
  assert.deepEqual(
    groups.map((g) => g.pluginId),
    ["p1", "p2"],
  );
  assert.equal(groups[0].pluginName, "UHDmoviesProvider");
  assert.equal(groups[0].pluginIcon, "u.png");
  // The same title found by two plugins stays two groups: they are different sources of it.
  assert.deepEqual(
    groups.map((g) => g.metas.map((m) => m.id)),
    [["same", "only-uhd"], ["same"]],
  );
});

test("a plugin that found nothing gets no group", () => {
  const plugins = [{ id: "p1", name: "One" }, { id: "p2", name: "Two" }];
  assert.deepEqual(searchGroups(plugins, [[], [hit("b")]], 10).map((g) => g.pluginId), ["p2"]);
  assert.deepEqual(searchGroups([], [], 10), []);
});

test("a plugin's own results are still de-duplicated and capped", () => {
  const plugins = [{ id: "p1", name: "One" }];
  const many = Array.from({ length: 5 }, (_, i) => hit(`m${i}`));
  const groups = searchGroups(plugins, [[hit("m0"), hit("m0"), ...many]], 3);
  assert.deepEqual(
    groups[0].metas.map((m) => m.id),
    ["m0", "m1", "m2"],
  );
});

test("the title that was asked for scores above loose matches of the same words", () => {
  // The apostrophe is furniture: it normalises away, so both spellings of the query score alike.
  for (const query of ["india got latent", "india's got latent"]) {
    const exact = relevanceScore("India's Got Latent", query);
    // A season range is furniture too, so the same show under a season heading is the same answer.
    assert.equal(exact, relevanceScore("India Got Latent Season 2", query), query);
    assert.ok(exact > relevanceScore("India", query), query);
    assert.ok(exact > relevanceScore("Got Latent", query), query);
    assert.ok(relevanceScore("India", query) > 0, query);
  }
  // A name with none of the words in it is worth nothing, and neither is an empty query.
  assert.equal(relevanceScore("Breaking Bad", "india got latent"), 0);
  assert.equal(relevanceScore("India's Got Latent", "   "), 0);
});

test("sorting by relevance puts the answer first, whatever order the provider used", () => {
  const query = "india got latent";
  // What a provider's own search returns: the wanted title buried among looser matches.
  const fromProvider = ["India", "Latent India", "India's Got Latent", "Best Of India"].map((name) =>
    hit(name, name),
  );
  const ordered = fromProvider
    .map((meta) => ({ meta, score: relevanceScore(meta.name, query) }))
    .sort((a, b) => b.score - a.score)
    .map((entry) => entry.meta.name);
  assert.equal(ordered[0], "India's Got Latent");
});

test("results are capped without dropping one that came earlier", () => {
  const merged = mergeHits([[hit("a"), hit("b"), hit("c")], [hit("d")]], 2);
  assert.deepEqual(
    merged.map((m) => m.id),
    ["a", "b"],
  );
  assert.deepEqual(mergeHits([], 10), []);
  assert.deepEqual(mergeHits([[]], 10), []);
});
