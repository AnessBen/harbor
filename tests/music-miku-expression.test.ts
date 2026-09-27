import assert from "node:assert/strict";
import test from "node:test";
import { createMikuExpression } from "../src/lib/music/miku-expression";

test("eyelids hold an expression through beat variations instead of blinking on each nod", () => {
  for (const period of [350, 500, 800]) {
    const eyes = createMikuExpression();
    let previous = false, changes = 0;
    for (let time = 0; time < 15000; time += 16) {
      const moving = Math.sin(time / period * Math.PI * 2) > -0.7;
      const closed = eyes.advance(16, true, moving);
      if (closed !== previous) changes++;
      previous = closed;
    }
    assert.equal(changes, 1);
    assert.equal(previous, true);
  }
});

test("a brief dip keeps eyes closed; a sustained rest, pause or new track opens them", () => {
  const eyes = createMikuExpression();
  for (let i = 0; i < 70; i++) eyes.advance(16, true, true);
  for (let i = 0; i < 60; i++) assert.equal(eyes.advance(16, true, false), true);
  for (let i = 0; i < 100; i++) eyes.advance(16, true, false);
  assert.equal(eyes.advance(16, true, false), false);
  for (let i = 0; i < 70; i++) eyes.advance(16, true, true);
  assert.equal(eyes.advance(16, false, true), false);
  for (let i = 0; i < 70; i++) eyes.advance(16, true, true);
  eyes.reset();
  assert.equal(eyes.advance(16, true, true), false);
});
