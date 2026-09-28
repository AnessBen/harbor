import assert from "node:assert/strict";
import test from "node:test";
import {
  capstanId,
  capstanMetaFrom,
  isCapstanId,
  loadCapstanMeta,
  parseCapstanId,
} from "../src/lib/streams/plugins/extension/detail.ts";
import type { BridgeMedia } from "../src/lib/streams/plugins/extension/bridge.ts";

const media = (over: Partial<BridgeMedia> = {}): BridgeMedia => ({
  name: "Example Show",
  url: "https://provider.example/watch/1",
  type: "tvseries",
  year: 2019,
  playableData: null,
  episodes: [],
  ...over,
});

test("a catalogue id carries its provider and url back out intact", () => {
  for (const [providerId, url] of [
    ["ext/provider", "https://provider.example/watch/1?id=2&x=a:b"],
    ["plugin:abc.def", "https://p.example/a/b/c?q=1:2:3#frag"],
    ["plain", "https://p.example/é/ünïcode"],
    ["ext/with:colon", "https://p.example/"],
  ] as Array<[string, string]>) {
    assert.deepEqual(parseCapstanId(capstanId(providerId, url)), { providerId, url });
  }
});

test("only a well formed catalogue id is claimed", () => {
  assert.ok(isCapstanId(capstanId("p", "https://x/")));
  for (const id of ["", "tt0133093", "tmdb:movie:603", "harbor-plugin://x", "capstan", "CAPSTAN:a:b"]) {
    assert.equal(isCapstanId(id), false, id);
    assert.equal(parseCapstanId(id), null, id);
  }
  // The separator is the first colon after the prefix, so a prefix-only or provider-less id is junk.
  assert.equal(parseCapstanId("capstan:"), null);
  assert.equal(parseCapstanId("capstan:provideronly"), null);
  assert.equal(parseCapstanId("capstan::https%3A%2F%2Fx%2F"), null);
});

test("the provider's answer becomes the year, artwork and episode list the detail page reads", () => {
  const meta = capstanMetaFrom(
    capstanId("p", "https://x/1"),
    "series",
    media({
      year: 2019,
      plot: "A plot.",
      posterUrl: "https://x/p.jpg",
      backgroundPosterUrl: "https://x/b.jpg",
      tags: ["Drama", "Mystery"],
      episodes: [
        { data: "d1", name: "Pilot", season: 1, episode: 1, track: "" },
        { data: "d2", name: null, season: 1, episode: 2, track: "sub" },
      ],
    }),
  );
  assert.equal(meta.releaseInfo, "2019");
  assert.equal(meta.poster, "https://x/p.jpg");
  assert.equal(meta.background, "https://x/b.jpg");
  assert.equal(meta.description, "A plot.");
  assert.deepEqual(meta.genres, ["Drama", "Mystery"]);
  assert.deepEqual(meta.videos, [
    { season: 1, episode: 1, name: "Pilot", title: "Pilot", overview: undefined, description: undefined, thumbnail: undefined, released: undefined },
    { season: 1, episode: 2, name: undefined, title: undefined, overview: undefined, description: undefined, thumbnail: undefined, released: undefined },
  ]);
});

test("an episode keeps its own still and description when the provider sent them", () => {
  const meta = capstanMetaFrom(
    capstanId("p", "https://x/1"),
    "series",
    media({
      episodes: [
        {
          data: "d1",
          name: "Pilot",
          season: 1,
          episode: 1,
          track: "",
          posterUrl: "https://x/e1.jpg",
          description: "Where it begins.",
        },
      ],
    }),
  );
  const [video] = meta.videos ?? [];
  assert.equal(video.thumbnail, "https://x/e1.jpg");
  assert.equal(video.overview, "Where it begins.");
  assert.equal(video.description, "Where it begins.");
});

test("an episode date is read in whichever unit the provider used", () => {
  const asMillis = 1568000000000;
  const iso = new Date(asMillis).toISOString();
  for (const airDate of [asMillis, asMillis / 1000]) {
    const meta = capstanMetaFrom(
      capstanId("p", "https://x/1"),
      "series",
      media({ episodes: [{ data: "d", name: null, season: 1, episode: 1, track: "", airDate }] }),
    );
    assert.equal(meta.videos?.[0].released, iso, String(airDate));
  }
  const none = capstanMetaFrom(
    capstanId("p", "https://x/1"),
    "series",
    media({ episodes: [{ data: "d", name: null, season: 1, episode: 1, track: "", airDate: 0 }] }),
  );
  assert.equal(none.videos?.[0].released, undefined);
});

test("an unknown year and an empty episode list leave the fields out rather than faking them", () => {
  const meta = capstanMetaFrom(capstanId("p", "https://x/1"), "movie", media({ year: null }));
  assert.equal(meta.releaseInfo, undefined);
  assert.equal(meta.videos, undefined);
  assert.equal(meta.description, undefined);
  assert.equal(meta.genres, undefined);
  const zero = capstanMetaFrom(capstanId("p", "https://x/1"), "movie", media({ year: 0 }));
  assert.equal(zero.releaseInfo, undefined);
});

test("a provider numbering no episodes still yields a list rather than losing them", () => {
  const meta = capstanMetaFrom(
    capstanId("p", "https://x/1"),
    "series",
    media({
      episodes: [{ data: "d1", name: "One", season: null, episode: null, track: "" }],
    }),
  );
  assert.deepEqual(meta.videos?.[0], {
    season: undefined,
    episode: undefined,
    name: "One",
    title: "One",
    overview: undefined,
    description: undefined,
    thumbnail: undefined,
    released: undefined,
  });
});

test("loading without a live bridge answers nothing instead of throwing", async () => {
  assert.equal(await loadCapstanMeta("tt0133093", "movie"), null);
  assert.equal(await loadCapstanMeta("capstan:", "movie"), null);
  // Off desktop there is no bridge at all, which is the same empty answer as a provider that
  // did not resolve the item.
  assert.equal(await loadCapstanMeta(capstanId("p", "https://x/1"), "movie"), null);
});
