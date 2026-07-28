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
  combineWordLists,
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

check('rejoins a word that wraps across the column boundary', () => {
  // Mimics IMG_7886: WARRIORS is split as "…WARR" (end of the LEFT column,
  // 0x57B4) and "IORS…" (top of the RIGHT column, 0x57C0). Memory order is
  // left-column-then-right-column, so the two halves must rejoin.
  // Left column: addr x≈100, payload x≈300. Right column: addr x≈900, payload
  // x≈1100. Rows step 60px in y; the gap between columns (>300) splits them.
  const row = (addr, x, y, text) => [
    { text: addr, position: { x: x === 300 ? 100 : 900, y, width: 150, height: 40 } },
    { text, position: { x, y, width: 300, height: 40 } },
  ];
  const regions = [
    // LEFT column (top -> bottom)
    ...row('0x5700', 300, 0, '>.)PASSKEYS'),
    ...row('0x570C', 300, 60, '{-TOMATOES]'),
    ...row('0x5718', 300, 120, '#$DISLIKES%'),
    ...row('0x5724', 300, 180, '@PERSISTS/.'),
    ...row('0x57B4', 300, 240, '<]-!$|($WARR'), // ends with WARR
    // RIGHT column (top -> bottom)
    ...row('0x57C0', 1100, 0, "IORS+|:'$;!+"), // starts with IORS
    ...row('0x57CC', 1100, 60, '(:PRODUCED_@'),
    ...row('0x57D8', 1100, 120, '_STRAIGHT.%'),
    ...row('0x57E4', 1100, 180, '/SAMANTHA;?'),
  ].flat();
  const words = reconstructFromRegions(regions);
  assert.ok(words.includes('WARRIORS'), `expected WARRIORS in ${words.join(',')}`);
  assert.ok(words.every((w) => w.length === 8), 'all candidates length 8');
});

console.log('combineWordLists:');
check('unions passes and keeps the dominant length', () => {
  // Raw pass missed DISLIKES; glare pass missed TOMATOES/FIERCELY. A stray
  // 9-letter misread (OPERSISTS) must be dropped in favor of the 8-letter set.
  const raw = ['PASSKEYS', 'TOMATOES', 'FIERCELY', 'OPERSISTS'];
  const glare = ['PASSKEYS', 'DISLIKES'];
  const merged = combineWordLists([raw, glare]);
  assert.ok(merged.includes('DISLIKES') && merged.includes('TOMATOES'));
  assert.ok(!merged.includes('OPERSISTS'), 'drops off-length misread');
  assert.ok(merged.every((w) => w.length === 8));
  assert.equal(new Set(merged).size, merged.length, 'de-duped');
});

console.log(`\n${passed} tests passed.`);
