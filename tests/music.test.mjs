import test from 'node:test';
import assert from 'node:assert/strict';
import { makePattern, mutatePattern, scramblePcm, fadeEdges, nextBarBoundary, ROWS } from '../src/lib/music.js';

test('presets always yield six 16-step boolean lanes', () => {
  for (const name of ['Boom Bap', 'Broken Funk', 'Four on Floor', 'Blank Canvas']) {
    const p = makePattern(name);
    assert.deepEqual(Object.keys(p), ROWS);
    for (const lane of ROWS) {
      assert.equal(p[lane].length, 16);
      assert.ok(p[lane].every(x => typeof x === 'boolean'));
    }
  }
});

test('next capture boundary is at least lead seconds away', () => {
  assert.equal(nextBarBoundary(1.91, 0, 2, 0.16), 4);
  assert.equal(nextBarBoundary(0.1, 1, 2, 0.16), 1);
});

test('chaos never mutates input and returns a usable groove', () => {
  const input = makePattern('Boom Bap');
  const before = JSON.stringify(input);
  const chaos = mutatePattern(input, () => 0.05);
  assert.equal(JSON.stringify(input), before);
  assert.equal(chaos.kick[0], true);
});

test('PCM shuffle preserves length and works with awkward sample counts', () => {
  const pcm = Float32Array.from({ length: 103 }, (_, i) => i / 103);
  const result = scramblePcm(pcm, () => 0.25);
  assert.equal(result.length, pcm.length);
  assert.ok(result.every(Number.isFinite));
  assert.equal(pcm[0], 0);
});

test('boundary fade makes loop edges click-safe', () => {
  const pcm = new Float32Array(2048).fill(1);
  fadeEdges(pcm, 48000);
  assert.equal(pcm[0], 0);
  assert.equal(pcm.at(-1), 0);
  assert.equal(pcm[512], 1);
});
