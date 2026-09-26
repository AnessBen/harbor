// @ts-expect-error Node test types are intentionally outside the browser-only tsconfig.
import assert from "node:assert/strict";
// @ts-expect-error Node test types are intentionally outside the browser-only tsconfig.
import test from "node:test";
import {
  isOwnTrackerEntry,
  resolveTrackEpisodeNumber,
  resolveTrackerProgress,
} from "../src/lib/tracker-progress.ts";

test("isOwnTrackerEntry matches the row entry against the tracker", () => {
  assert.equal(isOwnTrackerEntry("kitsu:45619", "kitsu:45619"), true);
  assert.equal(isOwnTrackerEntry("kitsu:45398", "kitsu:45619"), false);
  assert.equal(isOwnTrackerEntry(null, "kitsu:45619"), false);
  assert.equal(isOwnTrackerEntry("kitsu:45619", null), false);
});

test("resolveTrackEpisodeNumber prefers cour numbers for own-entry rows", () => {
  const own = { sourceMetaId: "kitsu:45619", imdbEpisode: 13, seasonForeign: false, ownEntry: true };
  assert.equal(resolveTrackEpisodeNumber(1, own), 1);
  const direct = { sourceMetaId: null, imdbEpisode: 13, seasonForeign: false, ownEntry: true };
  assert.equal(resolveTrackEpisodeNumber(1, direct), 1);
  const pooled = { sourceMetaId: "kitsu:45619", imdbEpisode: 13, seasonForeign: false, ownEntry: true };
  assert.equal(resolveTrackEpisodeNumber(1, pooled), 1);
});

test("resolveTrackEpisodeNumber keeps legacy branches off own entry", () => {
  assert.equal(
    resolveTrackEpisodeNumber(5, { sourceMetaId: null, imdbEpisode: 5, seasonForeign: true, ownEntry: false }),
    5,
  );
  assert.equal(
    resolveTrackEpisodeNumber(1, { sourceMetaId: "kitsu:9", imdbEpisode: 13, seasonForeign: false, ownEntry: false }),
    1,
  );
  assert.equal(
    resolveTrackEpisodeNumber(7, { sourceMetaId: null, imdbEpisode: 9, seasonForeign: false, ownEntry: false }),
    9,
  );
  assert.equal(
    resolveTrackEpisodeNumber(undefined, { sourceMetaId: null, imdbEpisode: 9, seasonForeign: false, ownEntry: true }),
    9,
  );
});

test("resolveTrackerProgress never completes a part entry early", () => {
  // Spy x Family Part 2 cour #1: part-relative absolute must not complete 13/13.
  assert.equal(resolveTrackerProgress(1, 13, 13), 1);
  // Genuine finale still completes.
  assert.equal(resolveTrackerProgress(13, 13, 13), 13);
  // Full-season tracker advances via absolute.
  assert.equal(resolveTrackerProgress(1, 13, 25), 13);
  // Absolute-counting tracker (tt-opened long show) advances via absolute.
  assert.equal(resolveTrackerProgress(5, 500, 1100), 500);
  // Equal numbers pass through.
  assert.equal(resolveTrackerProgress(1089, 1089, 1500), 1089);
  assert.equal(resolveTrackerProgress(5, 5, 25), 5);
  // Garbage absolute beyond the entry falls back to the episode.
  assert.equal(resolveTrackerProgress(1, 500, 13), 1);
  // Unknown total keeps the legacy absolute preference.
  assert.equal(resolveTrackerProgress(1, 13, 0), 13);
  // Missing absolute sends the episode.
  assert.equal(resolveTrackerProgress(7, null, 25), 7);
});
