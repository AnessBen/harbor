import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";
import ts from "typescript";

function load(file, mocks) {
  const source = readFileSync(new URL(`../src/lib/music/${file}.ts`, import.meta.url), "utf8");
  const { outputText } = ts.transpileModule(source, {
    compilerOptions: { target: ts.ScriptTarget.ES2022, module: ts.ModuleKind.CommonJS },
  });
  const module = { exports: {} };
  new Function("require", "module", "exports", "navigator", outputText)((name) => {
    assert.ok(Object.hasOwn(mocks, name), `Unexpected dependency: ${name}`);
    return mocks[name];
  }, module, module.exports, {});
  return module.exports;
}

const saved = Array.from({ length: 10 }, (_, index) => ({
  id: `song-${index + 1}`, connectorId: "local", title: `Song ${index + 1}`, artist: "Artist",
  artwork: "", durationSeconds: 180, durationLabel: "3:00", sourceId: `C:/Music/${index + 1}.flac`,
}));

function fixture() {
  const events = new Map();
  const calls = [];
  const noop = () => {};
  const player = load("player", {
    "@/lib/active-profile-id": { activeProfileId: () => "test" },
    "./listening-affinity": { observeMusicListening: noop },
    "./artist-blocks": { filterBlockedTracks: tracks => tracks },
    "./liked": load("liked", {}),
    "./track-identity": {
      sameMusicTrack: (a, b) => a.id === b.id,
      dedupeMusicTracks: tracks => tracks,
    },
    "./queue-order": load("queue-order", {}),
    "./deck-sync": {
      answerDeckRequests: noop, broadcastDeckState: noop, isDeckWindow: () => false,
      sendDeckAdopted: noop, sendDeckCommand: noop, serveDeckCommands: noop,
    },
    "./deck-primary": { createDeckAdoption: () => ({ deck: () => 0, adopt: () => false }) },
    "./queue-insert": {},
    "@tauri-apps/api/core": { invoke: async (command, args) => {
      calls.push({ command, args });
      if (command === "music_db_init") return {
        likedIds: saved.map(track => track.id), likedTracks: saved, recents: [], queue: [],
      };
      if (command === "music_source_candidates") return [];
    } },
    "@tauri-apps/api/event": { listen: async (name, callback) => {
      events.set(name, callback);
      return noop;
    } },
    react: { useSyncExternalStore: (_subscribe, read) => read() },
    "./preferences": { readMusicPreference: () => null, writeMusicPreference: noop },
    "./audio-settings": {
      clampMusicVolume: volume => volume, initializeMusicAudioSettings: async () => {},
      subscribeMusicAudioSettings: noop,
    },
    "./session-checkpoint": {
      newerCheckpoint: () => null, readCheckpointFromDb: async () => null,
      usableCheckpointPosition: () => 0, writeCheckpointToDb: noop,
    },
    "./playback-origin": {
      beginMusicQueue: noop, getMusicPlaybackOrigin: () => null, restoreMusicPlaybackOrigin: noop,
    },
    "@/lib/cast-ownership": { stopCastOwner: async () => {} },
    "./casting": { getMusicSpeakerState: () => ({ active: false }), subscribeMusicSpeakerState: noop },
    "./hidden-recents": { unhideMusicRecent: noop },
  });
  const hook = load("use-collection-playback", {
    "./player": player,
    "@/components/music/music-queue": { useMusicTransport: () => ({ shuffle: false }) },
  });
  return {
    player, calls,
    controls: () => hook.useCollectionPlayback(player.getMusicState().likedTracks, () => {
      assert.fail("The active Saved collection must toggle playback, not start a new queue");
    }),
    event: payload => events.get("music://event")?.({ payload }),
  };
}

test("playing the eighth saved song preserves its position while refreshing its metadata", async () => {
  const { player } = fixture();
  const refreshed = { ...saved[7], artwork: "https://example.test/refreshed.jpg" };
  await player.playMusic(refreshed, saved);
  const state = player.getMusicState();
  assert.equal(state.error, null);
  assert.deepEqual(state.likedTracks.map(track => track.id), saved.map(track => track.id));
  assert.equal(state.likedTracks[7].artwork, refreshed.artwork);
  assert.equal(state.queueIndex, 7);
  assert.equal(state.recents[0].id, saved[7].id);
});

test("Saved controls recognize a row-started queue and pause/resume without restarting", async () => {
  const { player, controls, event, calls } = fixture();
  await player.playMusic({ ...saved[7], collectionOrigin: { id: saved[7].id, connectorId: "local" } }, saved);
  assert.equal(controls().busy, true);
  event({ event: "file-loaded" });
  assert.equal(controls().playing, true);
  controls().play();
  event({ event: "property-change", name: "pause", data: true });
  assert.equal(controls().playing, false);
  controls().play();
  assert.equal(player.getMusicState().current.id, saved[7].id);
  assert.equal(player.getMusicState().queueIndex, 7);
  assert.equal(calls.filter(call => call.command === "music_engine_pause").length, 2);
});
