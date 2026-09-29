import assert from "node:assert/strict";
import test from "node:test";
import { createMikuListeningPerformance } from "../src/lib/music/miku-listening";

const pulse = (beat: number, excitement = .7) => ({ beat, excitement, period: 500, locked: true,
  bob: .6 + .3 * Math.cos(beat * Math.PI * 2), sway: .5 * Math.sin(beat * Math.PI) });

test("listening reactions are brief, spaced, and alternate instead of repeating one lean", () => {
  const performance = createMikuListeningPerformance();
  const reactions: { kind: string; start: number; end: number }[] = [];
  let prior: string | null = null;
  for (let now = 0; now < 40000; now += 10) {
    const p = performance.advance(10, pulse(now / 500), true);
    if (p.reaction && p.reaction !== prior) reactions.push({ kind: p.reaction, start: now, end: now });
    if (p.reaction) reactions.at(-1)!.end = now;
    prior = p.reaction;
  }
  assert.deepEqual(reactions.slice(0, 3).map(r => r.kind), ["lean-left", "lean-right", "accent"]);
  for (let i = 0; i < reactions.length; i++) {
    assert.ok(reactions[i].end - reactions[i].start >= 900 && reactions[i].end - reactions[i].start <= 1100);
    if (i) assert.ok(reactions[i].start - reactions[i - 1].end >= 7500);
  }
});

test("reactions preserve one head dip per measured beat at slow and fast tempos", () => {
  for (const period of [300, 500, 850]) {
    const performance = createMikuListeningPerformance();
    const poses: { time: number; bob: number; sway: number }[] = [];
    for (let now = 0; now < 25000; now += 10) poses.push({ time: now,
      ...performance.advance(10, { ...pulse(now / period), period }, true) });
    const peaks = poses.filter((p, i) => i > 0 && i < poses.length - 1 && p.bob > poses[i - 1].bob && p.bob >= poses[i + 1].bob);
    assert.ok(Math.abs(peaks.length - 25000 / period) <= 1);
    for (const p of peaks) assert.ok(Math.abs(p.time - Math.round(p.time / period) * period) <= 20);
    for (let i = 1; i < poses.length; i++) assert.ok(Math.abs(poses[i].sway - poses[i - 1].sway) < .07);
  }
});

test("quiet sections, choreography and broken clocks cannot trigger extra gestures", () => {
  const performance = createMikuListeningPerformance();
  for (let n = 0; n < 3000; n++) {
    const p = performance.advance(10, pulse(n / 50, .2), true);
    assert.equal(p.reaction, null);
  }
  for (let n = 0; n < 3000; n++) assert.equal(performance.advance(10, pulse(n / 50), false).reaction, null);
  for (let n = 0; n < 3000; n++) assert.equal(performance.advance(10, { ...pulse(n / 50), locked: false, bob: 0, sway: 0 }, true).bob, 0);
  for (let n = 0; n < 950; n++) performance.advance(10, pulse(n / 50), true);
  assert.equal(performance.advance(1000, pulse(300), true).reaction, null);
  performance.reset();
  assert.equal(performance.advance(10, { ...pulse(0), bob: 0, sway: 0 }, false).bob, 0);
});
