// Fallout terminal-hacking solver.
//
// The minigame is Mastermind with words. Every candidate word is the same
// length. "Likeness" between two words = number of positions with the same
// letter. The password gives likeness == word length when guessed.
//
// Strategy: minimax. For each possible guess, assume the worst-case likeness
// response (the one that leaves the largest remaining candidate set) and pick
// the guess that minimizes that worst case. Ties broken by smaller average
// remaining set, then alphabetically for determinism.

/** Likeness between two equal-length words (matching positions). */
export function likeness(a, b) {
  let n = 0;
  for (let i = 0; i < a.length; i++) if (a[i] === b[i]) n++;
  return n;
}

/**
 * Filter candidates consistent with a guess/response history.
 * history: Array<{ guess: string, result: number }>
 */
export function filterCandidates(candidates, history) {
  return candidates.filter((word) =>
    history.every(({ guess, result }) => likeness(word, guess) === result)
  );
}

/**
 * Score a guess against the current candidate pool.
 * Returns { worst, avg } where `worst` is the largest bucket size across all
 * possible likeness responses, and `avg` the expected remaining count.
 */
function scoreGuess(guess, candidates) {
  const buckets = new Map();
  for (const word of candidates) {
    const k = likeness(guess, word);
    buckets.set(k, (buckets.get(k) || 0) + 1);
  }
  let worst = 0;
  let sumSquares = 0;
  for (const count of buckets.values()) {
    if (count > worst) worst = count;
    sumSquares += count * count;
  }
  return { worst, avg: sumSquares / candidates.length };
}

/**
 * Recommend the best next guess from the remaining candidates.
 * Returns { best, ranked } — ranked is every candidate with its scores.
 */
export function recommend(candidates) {
  if (candidates.length === 0) return { best: null, ranked: [] };
  if (candidates.length === 1) {
    return {
      best: candidates[0],
      ranked: [{ word: candidates[0], worst: 1, avg: 1 }],
    };
  }

  const ranked = candidates
    .map((word) => {
      const { worst, avg } = scoreGuess(word, candidates);
      return { word, worst, avg };
    })
    .sort(
      (a, b) => a.worst - b.worst || a.avg - b.avg || a.word.localeCompare(b.word)
    );

  return { best: ranked[0].word, ranked };
}

/** Normalize a raw letter-run list into the dominant-length candidate list. */
function pickWordsByLength(letterRuns) {
  const tokens = letterRuns.filter((t) => t.length >= 3);
  const byLen = new Map();
  for (const t of tokens) {
    if (!byLen.has(t.length)) byLen.set(t.length, []);
    byLen.get(t.length).push(t);
  }
  if (byLen.size === 0) return [];
  let bestLen = 0;
  let bestCount = -1;
  for (const [len, arr] of byLen) {
    if (arr.length > bestCount) {
      bestCount = arr.length;
      bestLen = len;
    }
  }
  return [...new Set(byLen.get(bestLen))];
}

const ADDR_RE = /0X[0-9A-FO]{2,4}/gi;

/**
 * Reconstruct candidate words from PaddleOCR-style regions with bounding boxes.
 *
 * Memory order is rebuilt purely from GEOMETRY (not the OCR'd address values,
 * which are often corrupted): regions are clustered into columns by x, sorted
 * into rows by y, and their payloads concatenated in address order
 * (each column top-to-bottom, columns left-to-right). Words that wrap across
 * rows/columns rejoin automatically because payloads are concatenated directly.
 *
 * @param {Array<{text:string, position:{x:number,y:number,width:number,height:number}}>} regions
 */
export function reconstructFromRegions(regions) {
  const items = regions
    .map((r) => {
      const p = r.position || r.box || {};
      return {
        text: (r.text || '').toUpperCase(),
        x: p.x,
        cy: p.y + p.height / 2,
      };
    })
    .filter((it) => it.text && Number.isFinite(it.x));

  // Address regions anchor the memory grid.
  const addrs = items.filter((it) => new RegExp(ADDR_RE.source, 'i').test(it.text));
  if (addrs.length < 4) {
    // Not a recognizable grid: fall back to plain text extraction.
    return extractWords(items.map((it) => it.text).join(' '));
  }

  // Cluster address x-positions into columns (split on large horizontal gaps).
  const xs = addrs.map((a) => a.x).sort((a, b) => a - b);
  const colBreaks = [];
  for (let i = 1; i < xs.length; i++) {
    if (xs[i] - xs[i - 1] > 300) colBreaks.push((xs[i] + xs[i - 1]) / 2);
  }
  const colOf = (x) => {
    let c = 0;
    for (const b of colBreaks) if (x > b) c++;
    return c;
  };

  // Row step: median gap between consecutive addresses WITHIN a column (the two
  // columns interleave in y, so a merged gap would be misleadingly small).
  const perColGaps = [];
  const addrByCol = new Map();
  for (const a of addrs) {
    const c = colOf(a.x);
    if (!addrByCol.has(c)) addrByCol.set(c, []);
    addrByCol.get(c).push(a.cy);
  }
  for (const cys of addrByCol.values()) {
    cys.sort((p, q) => p - q);
    for (let i = 1; i < cys.length; i++) perColGaps.push(cys[i] - cys[i - 1]);
  }
  perColGaps.sort((a, b) => a - b);
  const rowStep = perColGaps.length
    ? perColGaps[Math.floor(perColGaps.length / 2)]
    : 66;

  // Keep grid rows by vertical band: from just above the first address row to
  // one row below the last (to catch trailing continuation rows like a wrapped
  // final letter whose address OCR may have missed). Excludes header/footer.
  const addrYs = addrs.map((a) => a.cy).sort((a, b) => a - b);
  const yTop = addrYs[0] - rowStep * 0.6;
  const yBottom = addrYs[addrYs.length - 1] + rowStep * 1.4;
  const grid = items.filter((it) => it.cy >= yTop && it.cy <= yBottom);

  // Build column -> rows. Remove address tokens ENTIRELY so words that wrap
  // across rows rejoin, but keep junk-symbol payloads so they act as separators
  // between distinct words.
  const columns = new Map();
  for (const it of grid) {
    const payload = it.text.replace(ADDR_RE, '');
    if (!payload) continue; // pure address region -> contributes nothing
    const col = colOf(it.x);
    if (!columns.has(col)) columns.set(col, []);
    columns.get(col).push({ x: it.x, y: it.cy, payload });
  }

  // Concatenate: columns left-to-right, rows top-to-bottom, x-order within row.
  let stream = '';
  for (const col of [...columns.keys()].sort((a, b) => a - b)) {
    const rows = columns.get(col).sort((a, b) => a.y - b.y || a.x - b.x);
    for (const r of rows) stream += r.payload;
  }

  return pickWordsByLength(stream.match(/[A-Z]+/g) || []);
}

/**
 * Merge candidate word-lists from several OCR passes (e.g. a raw pass and a
 * glare-flattened pass, which each recover different words) into one list.
 * Union, then keep only the dominant length — Fallout passwords are all the
 * same length, so this drops stray mis-length misreads while maximizing recall.
 */
export function combineWordLists(lists) {
  const all = lists.flat();
  const byLen = new Map();
  for (const w of all) {
    if (!byLen.has(w.length)) byLen.set(w.length, []);
    byLen.get(w.length).push(w);
  }
  let best = [];
  for (const arr of byLen.values()) if (arr.length > best.length) best = arr;
  return [...new Set(best)];
}

/**
 * Reconstruct the candidate word list from raw text.
 *
 * Two input shapes are supported:
 *  - Clean list: user typed/pasted words (whitespace/newline separated).
 *  - Raw terminal dump: OCR of the ROBCO memory grid, where each 0xXXXX
 *    address is followed by 12 characters and words WRAP across rows in
 *    address order. Because a two-column terminal is read left-to-right by
 *    OCR, we must re-order the 12-char payloads by their numeric address
 *    before concatenating, otherwise wrapped words (TECHN|ICAL) scramble.
 */
export function extractWords(text) {
  const upper = text.toUpperCase();
  // Tolerant address matcher: OCR often reads the leading 0 of "0x" as
  // 8/B/O/9/A/D, so accept any of those before the X. Hex digits may also have
  // O misread for 0.
  const addrRe = /\b[0689ABDO]X[0-9A-FO]{2,4}\b/g;
  const addrMatches = [...upper.matchAll(addrRe)];

  let letterRuns;
  if (addrMatches.length >= 4) {
    // Address-aware mode: split into { addr, payload } segments.
    const segments = [];
    for (let i = 0; i < addrMatches.length; i++) {
      const m = addrMatches[i];
      const start = m.index + m[0].length;
      const end =
        i + 1 < addrMatches.length ? addrMatches[i + 1].index : upper.length;
      // Normalize O->0 in the hex part before parsing.
      const hex = m[0].slice(2).replace(/O/g, '0');
      segments.push({
        addr: parseInt(hex, 16),
        payload: upper.slice(start, end),
      });
    }
    segments.sort((a, b) => a.addr - b.addr);
    // Join payloads in memory order; keep symbols so distinct words stay
    // separated, but drop whitespace so wrapped words rejoin across rows.
    const stream = segments.map((s) => s.payload.replace(/[^A-Z]+/g, ' ')).join('');
    letterRuns = stream.match(/[A-Z]+/g) || [];
  } else {
    letterRuns = upper.match(/[A-Z]+/g) || [];
  }

  const tokens = letterRuns.filter((t) => t.length >= 3);

  // Fallout passwords are all the same length. Pick the most common length.
  const byLen = new Map();
  for (const t of tokens) {
    if (!byLen.has(t.length)) byLen.set(t.length, []);
    byLen.get(t.length).push(t);
  }
  if (byLen.size === 0) return [];
  let bestLen = 0;
  let bestCount = -1;
  for (const [len, arr] of byLen) {
    if (arr.length > bestCount) {
      bestCount = arr.length;
      bestLen = len;
    }
  }
  // De-dupe, preserve order.
  return [...new Set(byLen.get(bestLen))];
}
