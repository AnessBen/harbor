import assert from "node:assert/strict";
import test from "node:test";
import type { MusicAudioMeterState } from "../src/lib/music/audio-meter";
import { createMikuGroove, mikuEnergy, mikuFrame, MIKU_ATLAS } from "../src/lib/music/miku-motion";
import { mikuTempo } from "../src/lib/music/miku-tempo";

function signal(rmsDb = -18, bassDb = rmsDb): MusicAudioMeterState {
  return { status: "ready", data: {
    trackId: "current", connectorId: "local", active: true,
    channels: [{ rmsDb, peakDb: rmsDb + 3 }], spectrumDb: Array(8).fill(bassDb),
    outputSampleRateHz: 48000, outputChannels: "stereo", outputDevice: null, outputBackend: null,
  } };
}

test("Miku rejects old tracks, other sources, missing analysis and silence", () => {
  const state = signal();
  assert.ok(mikuEnergy(state, "current", "local") > 0);
  assert.equal(mikuEnergy(state, "previous", "local"), 0);
  assert.equal(mikuEnergy(state, "current", "spotify"), 0);
  assert.equal(mikuEnergy({ status: "unavailable", data: state.data }, "current", "local"), 0);
  assert.equal(mikuEnergy({ status: "ready", data: null }, "current", "local"), 0);
  state.data!.active = false;
  assert.equal(mikuEnergy(state, "current", "local"), 0);
  assert.equal(mikuEnergy(signal(-80), "current", "local"), 0);
  for (const invalid of [NaN, Infinity, -Infinity]) assert.equal(mikuEnergy(signal(invalid), "current", "local"), 0);
});

test("head nods follow different measured rhythms without a preset tempo", () => {
  for (const period of [350, 500, 650, 850]) {
    const groove = createMikuGroove();
    const hits: number[] = [];
    let peak = 0;
    for (let now = 0; now < period * 6; now += 50) {
      const kick = now > 0 && now % period === 0;
      if (groove.sample(signal(-20, kick ? -8 : -48), "current", "local", now)) hits.push(now);
      peak = Math.max(peak, groove.advance(50).bob);
    }
    assert.deepEqual(hits, [1, 2, 3, 4, 5].map(n => n * period));
    assert.ok(peak > 0.18 && peak <= 1);
  }
});

test("steady audio and silence do not create invented beat animation", () => {
  const groove = createMikuGroove();
  for (let now = 0; now < 5000; now += 50) {
    assert.equal(groove.sample(signal(), "current", "local", now), false);
    assert.equal(groove.advance(50).bob, 0);
  }
  groove.sample(signal(-20, -60), "current", "local", 5100);
  assert.equal(groove.sample(signal(-10, -5), "current", "local", 5150), true);
  assert.ok(groove.advance(50).bob > 0);
  for (let n = 0; n < 35; n++) groove.advance(50);
  assert.equal(groove.advance(50).bob, 0);
  groove.reset();
  assert.equal(groove.advance(50).bob, 0);
});

test("a transient changes head velocity without snapping its position", () => {
  const groove = createMikuGroove();
  groove.sample(signal(-30, -60), "current", "local", 0);
  groove.sample(signal(-10, -5), "current", "local", 50);
  assert.equal(groove.advance(0).bob, 0);
  const after = groove.advance(16).bob;
  assert.ok(after > 0 && after < 0.3);
});

test("reach and nod poses stay within the authored atlas", () => {
  const frames = Array.from({ length: 17 }, (_, i) => mikuFrame(i / 17, 1, 0));
  assert.deepEqual([...frames].sort((a, b) => a - b), frames);
  assert.equal(mikuFrame(0, 1, 0), 0);
  for (const lift of [-1, 0, 0.5, 0.99, 1, 8, NaN]) {
    for (const bob of [-1, 0, 0.5, 1, Infinity]) {
      for (const sway of [-1, 0, 1, NaN]) {
        const frame = mikuFrame(lift, bob, sway);
        assert.ok(Number.isInteger(frame) && frame >= 0 && frame < MIKU_ATLAS.frames);
      }
    }
  }
});

test("a learned beat continues through softer hits and rests on loss of audio", () => {
  const groove = createMikuGroove();
  let frame = groove.advance(0);
  for (let now = 0; now < 6000; now += 50) {
    groove.sample(signal(-20, now % 500 === 0 ? -8 : -48), "current", "local", now);
    frame = groove.advance(50);
  }
  assert.ok(frame.locked && frame.period && Math.abs(frame.period - 500) < 30);
  const carried: number[] = [];
  for (let now = 6000; now < 7500; now += 50) {
    groove.sample(signal(-25, -42), "current", "local", now);
    carried.push(groove.advance(50).bob);
  }
  assert.ok(Math.max(...carried) - Math.min(...carried) > 0.1);
  for (let n = 0; n < 50; n++) frame = groove.advance(50, false);
  assert.equal(frame.bob, 0);
});

test("faster percussive sections build more energy and breakdowns relax it", () => {
  const perform = (period: number) => {
    const groove = createMikuGroove();
    let frame = groove.advance(0);
    for (let now = 0; now < 12000; now += 50) {
      groove.sample(signal(-18, now % period === 0 ? -8 : -48), "current", "local", now);
      frame = groove.advance(50);
    }
    return { groove, frame };
  };
  const slow = perform(750), fast = perform(350);
  assert.ok(fast.frame.excitement > slow.frame.excitement + 0.1);
  const before = fast.frame.excitement;
  for (let now = 12000; now < 17000; now += 50) {
    fast.groove.sample(signal(-34, -48), "current", "local", now);
    fast.frame = fast.groove.advance(50);
  }
  assert.ok(fast.frame.excitement < before * 0.75);
});

test("valid volume measurements remain usable while the frequency tap recovers", () => {
  const state = signal(-24, -120);
  assert.ok(mikuEnergy(state, "current", "local") > 0.3);
  const groove = createMikuGroove();
  groove.sample(state, "current", "local", 0);
  state.data!.channels[0].rmsDb = -8;
  assert.equal(groove.sample(state, "current", "local", 50), true);
});

test("alternating loud and softer drum accents keep their full tempo, including nightcore", () => {
  for (const period of [250, 300, 350, 400]) {
    const history = Array.from({ length: 128 }, (_, index) => {
      const time = index * 50;
      return { time, flux: time % period === 0 ? (time % (period * 2) === 0 ? .5 : .2) : 0 };
    });
    const tempo = mikuTempo(history, period * 2);
    assert.ok(tempo && Math.abs(tempo.period - period) < 20, `expected ${period}ms, got ${tempo?.period}`);
  }
});

test("true slow drums stay slow when their subdivisions are empty", () => {
  for (const period of [600, 750, 850]) {
    const history = Array.from({ length: 128 }, (_, index) => ({ time: index * 50, flux: index * 50 % period === 0 ? .4 : 0 }));
    const tempo = mikuTempo(history, null);
    assert.ok(tempo && Math.abs(tempo.period - period) < 25, `expected ${period}ms, got ${tempo?.period}`);
  }
});

test("snare attacks between bass kicks count as beats while rapid top-band hats do not double them", () => {
  for (const period of [300, 400, 500]) {
    const groove = createMikuGroove();
    let frame = groove.advance(0);
    for (let now = 0; now < 16000; now += 50) {
      const kick = now % (period * 2) === 0;
      const snare = now % (period * 2) === period;
      const state = signal(-20);
      state.data!.spectrumDb = [kick ? -8 : -52, kick ? -8 : -52, kick ? -12 : -52,
        snare ? -6 : -52, snare ? -6 : -52, snare ? -6 : -52, now % 100 === 0 ? -4 : -55, -40];
      groove.sample(state, "current", "local", now);
      frame = groove.advance(50);
    }
    assert.ok(frame.locked && frame.period && Math.abs(frame.period - period) < 30, `expected ${period}ms, got ${frame.period}`);
  }
});

test("visible nod peaks land close to the drum beat at EDM and hip-hop tempos", () => {
  for (const period of [300, 400, 500, 650, 850]) {
    const groove = createMikuGroove();
    const frames: { time: number; bob: number }[] = [];
    for (let now = 0; now < 18000; now += 10) {
      if (now % 50 === 0) groove.sample(signal(-20, now % period < 50 ? -8 : -52), "current", "local", now);
      frames.push({ time: now + 10, bob: groove.advance(10).bob });
    }
    const peaks = frames.filter((frame, index) => frame.time > 10000 && index > 0 && index < frames.length - 1
      && frame.bob > frames[index - 1].bob && frame.bob >= frames[index + 1].bob);
    assert.ok(Math.abs(peaks.length - 8000 / period) <= 1, "one visible nod per drum beat");
    for (const peak of peaks) {
      const offset = Math.abs(peak.time - Math.round(peak.time / period) * period);
      assert.ok(offset <= 60, `nod drifted ${offset}ms from a ${period}ms drum pulse`);
    }
  }
});

test("hard bass keeps its full pulse and bounce beneath a softer sustained vocal", () => {
  for (const period of [300, 350, 400]) {
    const run = (softVocal: boolean) => {
      const groove = createMikuGroove();
      const frames: ReturnType<typeof groove.advance>[] = [];
      for (let now = 0; now < 18000; now += 50) {
        const kick = now % period === 0;
        const state = signal(softVocal ? -19 : -8);
        const vocal = (softVocal ? -30 : -12) + Math.sin(now / 1800) * 3;
        // A loud, compressed bass bed: both states used to saturate the
        // detector's -10 dB ceiling, hiding these six-dB kick attacks.
        state.data!.spectrumDb = [kick ? -2 : -8, kick ? -4 : -10, kick ? -9 : -17,
          vocal, vocal - 4, vocal - 7, -35, -45];
        groove.sample(state, "current", "local", now);
        const frame = groove.advance(50);
        if (now > 14000) frames.push(frame);
      }
      return frames;
    };
    const loud = run(false), soft = run(true);
    for (const frame of soft) assert.ok(frame.locked && frame.period && Math.abs(frame.period - period) < 25);
    const average = (frames: typeof soft) => frames.reduce((sum, frame) => sum + frame.excitement, 0) / frames.length;
    assert.ok(average(soft) > .5, "hard drums should stay energetic beneath the soft vocal");
    assert.ok(Math.abs(average(soft) - average(loud)) < .03, "vocal loudness must not control drum intensity");
  }
});
