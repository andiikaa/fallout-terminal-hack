// Minimal regression tests for the solver + OCR reconstruction.
// Run with: node test/solver.test.mjs
import assert from 'node:assert';
import { readFileSync } from 'node:fs';
import {
  likeness,
  recommend,
  filterCandidates,
  extractWords,
  reconstructFromRegions,
} from '../src/solver.js';

let passed = 0;
const check = (name, fn) => {
  fn();
  passed++;
  console.log('  ✓', name);
};

console.log('solver:');
check('likeness counts matching positions', () => {
  assert.equal(likeness('LOVER', 'LOWER'), 4);
  assert.equal(likeness('ABCDE', 'VWXYZ'), 0);
});

check('minimax narrows a real board to the password', () => {
  const words = [
    'TECHNICAL', 'CONCERNED', 'SCRUBBERS', 'SOUTHEAST', 'SCORPIONS',
    'SECRETIVE', 'RECYCLING', 'REMINDING', 'BACKSTABS', 'BATHROOMS',
    'TWOBYFOUR', 'PANTHEIST', 'RELIGIOUS', 'CORPORATE',
  ];
  const secret = 'SECRETIVE';
  let history = [];
  let remaining = words;
  for (let i = 0; i < 4 && remaining.length > 1; i++) {
    const { best } = recommend(remaining);
    history.push({ guess: best, result: likeness(best, secret) });
    remaining = filterCandidates(words, history);
  }
  assert.deepEqual(remaining, [secret]);
});

console.log('extractWords:');
check('manual list (newlines / spaces)', () => {
  assert.deepEqual(extractWords('POWER\nTOWER\nLOWER'), ['POWER', 'TOWER', 'LOWER']);
});

console.log('reconstructFromRegions (real PaddleOCR output):');
check('rebuilds wrapped words from box geometry', () => {
  const { regions } = JSON.parse(
    readFileSync(new URL('./paddleocr-sample.json', import.meta.url))
  );
  const words = reconstructFromRegions(regions);
  // Words PaddleOCR captured, correctly de-wrapped:
  for (const w of ['TECHNICAL', 'BACKSTABS', 'TWOBYFOUR', 'CORPORATE', 'RELIGIOUS']) {
    assert.ok(words.includes(w), `expected ${w} in ${words.join(',')}`);
  }
  assert.ok(words.every((w) => w.length === 9), 'all candidates length 9');
});

console.log(`\n${passed} tests passed.`);
