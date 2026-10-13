import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";
import vm from "node:vm";
import ts from "typescript";
import * as jsx from "react/jsx-runtime";

function menuFixture(coordinates) {
  const writes = [], cleared = [];
  let closed = false;
  const dependencies = {
    "react/jsx-runtime": jsx,
    react: { useEffect() {} },
    "react-dom": { createPortal: (tree) => tree },
    "lucide-react": { Ban() {}, Check() {}, Eye() {}, EyeOff() {} },
    "@/lib/i18n": { useT: () => (key) => key },
    "@/lib/manual-watched": { setManualWatched: (...args) => writes.push(args) },
    "@/lib/hidden-episodes": { isEpisodeHidden: () => false },
    "@/lib/settings": { useSettings: () => ({ settings: {} }) },
    "@/lib/resume": { clearResume: (...args) => cleared.push(args) },
    "@/lib/simkl/history": {},
    "@/lib/simkl/ids": {},
    "@/lib/simkl/provider": { useSimkl: () => ({ isConnected: false }) },
  };
  const module = { exports: {} };
  const code = ts.transpileModule(readFileSync(new URL("../src/components/episode-watched-menu.tsx", import.meta.url), "utf8"), {
    compilerOptions: { module: ts.ModuleKind.CommonJS, jsx: ts.JsxEmit.ReactJSX },
  }).outputText;
  vm.runInNewContext(code, {
    module, exports: module.exports,
    require: (name) => {
      assert.ok(name in dependencies, `unmocked dependency ${name}`);
      return dependencies[name];
    },
    window: { innerWidth: 1000, innerHeight: 1000 }, document: { body: {} },
  });
  const tree = module.exports.EpisodeWatchedMenu({
    metaId: "kitsu:44047", meta: { type: "series", name: "Test" },
    target: { x: 10, y: 10, season: 1, episode: 1, watched: true, coordinates },
    onClose: () => { closed = true; },
  });
  tree.props.children[0].props.onClick();
  return { writes, cleared, closed };
}

test("unwatch writes explicit false and clears resumes on every supplied episode coordinate", () => {
  const coordinates = [
    { id: "kitsu:44047", season: 1, episode: 1 },
    { id: "tt5607616", season: 2, episode: 14 },
    { id: "mal:39587", season: 1, episode: 1 },
    { id: "kitsu:44047", season: 2, episode: 1 },
  ];
  const f = menuFixture(coordinates);
  assert.deepEqual(f.writes, coordinates.map(({ id, season, episode }) => [id, season, episode, false]));
  assert.deepEqual(f.cleared, coordinates.map(({ id, season, episode }) => [id, season, episode]));
  assert.equal(f.closed, true);
});

test("ordinary episode menus retain single-coordinate unwatch behavior", () => {
  for (const coordinates of [undefined, []]) {
    const f = menuFixture(coordinates);
    assert.deepEqual(f.writes, [["kitsu:44047", 1, 1, false]]);
    assert.deepEqual(f.cleared, [["kitsu:44047", 1, 1]]);
  }
});
