import assert from "node:assert/strict";
import test from "node:test";
import { createMikuDance, createMikuDanceMemory, MIKU_DANCE } from "../src/lib/music/miku-dance";

function pulse(beat: number, excitement = 0.8, locked = true, period = 500) {
  return { beat, excitement, locked, period };
}
function fixture(kind = 0, period = 500) {
  const memory = createMikuDanceMemory(kind);
  const dance = createMikuDance(memory);
  let now = 0;
  let state = dance.advance(0, pulse(0, .8, true, period), true, true);
  return {
    memory, dance,
    get now() { return now; },
    get state() { return state; },
    tick(energy = .8, active = true, ready = true, locked = true) {
      now += 16;
      return state = dance.advance(16, pulse(now / period, energy, locked, period), active, ready);
    },
    until(stage: string, limit = 160000) {
      const end = now + limit;
      while (state.stage !== stage && now < end) this.tick();
      assert.equal(state.stage, stage);
      return now;
    },
  };
}

test("dances are short complete loops at slow, normal and fast drum tempos, even at a peak", () => {
  for (const period of [300, 400, 500, 750, 850]) for (const kind of [0, 1]) {
    const f = fixture(kind, period);
    const started = f.until("dancing");
    assert.ok(started >= MIKU_DANCE.firstWaitMs);
    const ended = f.until("leaving");
    const duration = ended - started;
    assert.ok(duration >= 9500 && duration <= 15000, `kind ${kind}, period ${period}: ${duration}ms`);
    const cycles = duration / period / MIKU_DANCE.loopBeats[kind];
    assert.ok(Math.abs(cycles - Math.round(cycles)) < .05, "finish the complete choreography loop");
    f.until("listening");
    assert.equal(f.state.opacity, 0);
    assert.notEqual(f.state.kind, kind);
  }
});

test("headphones dominate a continuous energetic song, with a fair nonrepeating repertoire", () => {
  const f = fixture();
  const sequence: number[] = [];
  let dancingMs = 0, last = "listening", returnedAt = 0;
  for (let i = 0; i < 600000 / 16; i++) {
    const state = f.tick();
    assert.ok(state.opacity >= 0 && state.opacity <= 1);
    if (state.opacity > 0) assert.ok(state.frame >= 0 && state.frame < MIKU_DANCE.reachFrames + MIKU_DANCE.loopFrames[state.kind]);
    if (state.stage === "dancing") {
      dancingMs += 16;
      if (last !== "dancing") {
        if (returnedAt) assert.ok(f.now - returnedAt >= 75000);
        assert.notEqual(state.kind, sequence.at(-1));
        sequence.push(state.kind);
      }
    }
    if (state.stage === "listening" && last === "recovering") returnedAt = f.now;
    last = state.stage;
  }
  assert.ok(dancingMs < 90000, "most of this long high-energy track should remain headphone listening");
  assert.ok(sequence.length >= 5);
  assert.deepEqual([...new Set(sequence)].sort(), [0, 1]);
  for (let i = 0; i + 2 <= sequence.length; i += 2) assert.equal(new Set(sequence.slice(i, i + 2)).size, 2);
});

test("the next routine and listening break survive track changes and visibility resets", () => {
  const f = fixture();
  f.until("dancing");
  const next = f.memory.next;
  const breakMs = f.memory.remainingMs;
  f.dance.reset();
  assert.equal(f.dance.next, next);
  assert.equal(f.memory.remainingMs, breakMs);
  const replacement = createMikuDance(f.memory);
  for (let now = 0; now < 45000; now += 16) {
    const state = replacement.advance(16, pulse(now / 500), true, true);
    assert.equal(state.stage, "listening", "changing songs must not buy an immediate new dance");
    assert.equal(state.kind, next);
  }
  let state;
  for (let now = 45000; now < 110000; now += 16) {
    state = replacement.advance(16, pulse(now / 500), true, true);
    if (state.stage === "dancing") break;
  }
  assert.equal(state?.stage, "dancing");
  assert.equal(state?.kind, next);
});

test("a new track still gets listening time even when the shared cooldown has expired", () => {
  const memory = createMikuDanceMemory(1);
  memory.remainingMs = 0;
  const dance = createMikuDance(memory);
  for (let now = 0; now < 7500; now += 16) {
    assert.equal(dance.advance(16, pulse(now / 500), true, true).stage, "listening");
  }
});

test("quiet music, missing art, lost rhythm and pause never start a dance", () => {
  for (const [active, ready, energy, locked] of [[true, false, .8, true], [true, true, .3, true], [true, true, .8, false], [false, true, .8, true]] as const) {
    const f = fixture();
    for (let i = 0; i < 150000 / 16; i++) assert.equal(f.tick(energy, active, ready, locked).stage, "listening");
    if (!active || !locked) assert.equal(f.memory.remainingMs, MIKU_DANCE.firstWaitMs);
  }
});

test("pause cancels every stage, freezes the pose while fading, and settles to listening", () => {
  for (const stopAt of ["preparing", "entering", "dancing", "leaving", "recovering"]) {
    const f = fixture(); f.until(stopAt);
    const lastFrame = f.state.frame;
    for (let n = 0; n < 64; n++) {
      const state = f.tick(.8, false, true, false);
      if (state.opacity > 0) assert.equal(state.frame, lastFrame);
    }
    assert.equal(f.state.opacity, 0);
    assert.equal(f.state.stage, "listening");
  }
});

test("both hands visibly rest down before dancing and before returning to headphones", () => {
  const f = fixture();
  const resting = { entering: 0, leaving: 0 };
  for (let now = 0; now < 65000; now += 16) {
    const state = f.tick();
    if ((state.stage === "entering" || state.stage === "leaving") && state.frame === MIKU_DANCE.restFrame) resting[state.stage] += 16;
  }
  assert.ok(resting.entering >= 64 && resting.entering <= 160);
  assert.ok(resting.leaving >= 48 && resting.leaving <= 160);
});

test("short analysis gaps keep a phrase moving; sustained missing rhythm cancels it", () => {
  const f = fixture(); f.until("dancing");
  const frame = f.state.frame;
  for (let i = 0; i < 25; i++) assert.equal(f.tick(.8, true, true, false).stage, "dancing");
  assert.notEqual(f.state.frame, frame);
  assert.equal(f.tick().stage, "dancing");
  for (let i = 0; i < 60; i++) f.tick(.8, true, true, false);
  assert.equal(f.state.stage, "listening");
  assert.equal(f.state.opacity, 0);
});

test("dance atlas accents advance once per measured beat at different tempos", () => {
  for (const period of [300, 500, 750]) for (const kind of [0, 1]) {
    const f = fixture(kind, period); f.until("dancing");
    const start = f.now, frames: number[] = [];
    while (f.now - start < period * 2.2) frames.push(f.tick().frame - MIKU_DANCE.reachFrames);
    const perBeat = MIKU_DANCE.loopFrames[kind] / MIKU_DANCE.loopBeats[kind];
    let accents = 0;
    for (let i = 1; i < frames.length; i++) if (Math.floor(frames[i] / perBeat) !== Math.floor(frames[i - 1] / perBeat)) accents++;
    assert.equal(accents, 2, `kind ${kind} must not move in half time at ${period}ms`);
  }
});

test("headphone handoffs stay brisk at different tempos and the dance begins on a drum beat", () => {
  for (const period of [300, 400, 500, 650, 850]) for (const kind of [0, 1]) {
    const f = fixture(kind, period);
    const prepare = f.until("preparing");
    const start = f.until("dancing");
    assert.ok(start - prepare >= 550 && start - prepare <= 1050);
    assert.ok(Math.abs(start - Math.round(start / period) * period) <= 17, "the loop must start on the measured pulse");
    const leave = f.until("leaving");
    const rest = f.until("listening");
    assert.ok(rest - leave <= 1050, "return to headphones should not linger");
  }
});
