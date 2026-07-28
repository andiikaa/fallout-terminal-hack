import './style.css';
import { recognize } from './ocr.js';
import { recognizeRegions } from './paddle-ocr.js';
import {
  extractWords,
  reconstructFromRegions,
  combineWordLists,
  filterCandidates,
  recommend,
} from './solver.js';

const $ = (id) => document.getElementById(id);

// ---- State ----
let allWords = []; // original full candidate list
let history = []; // [{ guess, result }]

// ---- Elements ----
const fileInput = $('file-input');
const cameraInput = $('camera-input');
const clearBtn = $('clear-btn');
const startBtn = $('start-btn');
const restartBtn = $('restart-btn');
const wordsInput = $('words-input');
const ocrStatus = $('ocr-status');
const previewCanvas = $('preview-canvas');
const inputSection = $('input-section');
const solverSection = $('solver-section');
const recommendationEl = $('recommendation');
const candidatesEl = $('candidates');
const feedbackModal = $('feedback-modal');
const guessedWordEl = $('guessed-word');
const likenessButtons = $('likeness-buttons');
const feedbackCancel = $('feedback-cancel');

// ---- OCR ----
async function handleImageFile(input) {
  const file = input.files?.[0];
  if (!file) return;
  input.value = ''; // allow re-selecting the same file

  ocrStatus.hidden = false;
  previewCanvas.hidden = false;
  ocrStatus.textContent = 'Reading image…';

  const setProgress = (status, progress) => {
    ocrStatus.textContent = `${status}… ${Math.round((progress || 0) * 100)}%`;
  };

  let words = [];
  try {
    // Primary: PaddleOCR + geometric layout reconstruction. Multiple OCR passes
    // (orientation-corrected, glare-flattened) each recover different words;
    // union them by dominant length.
    const { passes } = await recognizeRegions(file, {
      previewCanvas,
      onProgress: setProgress,
    });
    words = combineWordLists(passes.map(reconstructFromRegions));
  } catch (err) {
    console.warn('PaddleOCR failed, falling back to Tesseract:', err);
    try {
      const text = await recognize(file, {
        previewCanvas,
        onProgress: setProgress,
      });
      words = extractWords(text);
    } catch (err2) {
      console.error(err2);
      ocrStatus.textContent = 'OCR failed: ' + (err2?.message || err2);
      return;
    }
  }

  if (words.length) {
    wordsInput.value = words.join('\n');
    ocrStatus.textContent = `Found ${words.length} candidate word(s) of length ${words[0].length}. Check & fix any misreads, then Analyze.`;
  } else {
    ocrStatus.textContent =
      'No words detected. Try a sharper, straight-on photo — or type them in below.';
  }
}

fileInput.addEventListener('change', () => handleImageFile(fileInput));
cameraInput.addEventListener('change', () => handleImageFile(cameraInput));

// ---- Clear / restart ----
clearBtn.addEventListener('click', () => {
  wordsInput.value = '';
  ocrStatus.hidden = true;
  previewCanvas.hidden = true;
});

restartBtn.addEventListener('click', () => {
  history = [];
  allWords = [];
  solverSection.hidden = true;
  inputSection.hidden = false;
});

// ---- Start solving ----
startBtn.addEventListener('click', () => {
  const words = extractWords(wordsInput.value);
  if (words.length < 2) {
    alert('Enter at least 2 candidate words of the same length.');
    return;
  }
  allWords = words;
  history = [];
  inputSection.hidden = true;
  solverSection.hidden = false;
  renderSolver();
});

// ---- Solver rendering ----
function renderSolver() {
  const remaining = filterCandidates(allWords, history);

  if (remaining.length === 0) {
    recommendationEl.innerHTML =
      '<div class="alert">No word matches that feedback. Check the likeness values you entered.</div>';
    candidatesEl.innerHTML = '';
    return;
  }

  if (remaining.length === 1) {
    recommendationEl.innerHTML = `<div class="solved">PASSWORD:<br><span class="big">${remaining[0]}</span></div>`;
    candidatesEl.innerHTML = '';
    return;
  }

  const { best, ranked } = recommend(remaining);
  recommendationEl.innerHTML = `
    <div class="best">
      <span class="big">${best}</span>
      <button class="btn primary select-btn" data-word="${best}">SELECT &amp; ENTER LIKENESS</button>
    </div>
    <p class="hint">${remaining.length} words remain. Ranked by worst-case elimination:</p>
  `;

  candidatesEl.innerHTML = ranked
    .map(
      (r) => `
      <button class="candidate ${r.word === best ? 'is-best' : ''}" data-word="${r.word}">
        <span class="cw">${r.word}</span>
        <span class="cs">worst ≤ ${r.worst}</span>
      </button>`
    )
    .join('');

  for (const el of candidatesEl.querySelectorAll('.candidate')) {
    el.addEventListener('click', () => openFeedback(el.dataset.word));
  }
  recommendationEl
    .querySelector('.select-btn')
    ?.addEventListener('click', (e) => openFeedback(e.target.dataset.word));
}

// ---- Likeness feedback ----
function openFeedback(word) {
  guessedWordEl.textContent = word;
  const len = word.length;
  likenessButtons.innerHTML = '';
  for (let i = 0; i <= len; i++) {
    const b = document.createElement('button');
    b.className = 'btn likeness-btn';
    b.textContent = i;
    if (i === len) {
      b.textContent = `${i} ✓`;
      b.classList.add('correct');
    }
    b.addEventListener('click', () => {
      history.push({ guess: word, result: i });
      feedbackModal.hidden = true;
      renderSolver();
    });
    likenessButtons.appendChild(b);
  }
  feedbackModal.hidden = false;
}

feedbackCancel.addEventListener('click', () => {
  feedbackModal.hidden = true;
});
feedbackModal.addEventListener('click', (e) => {
  if (e.target === feedbackModal) feedbackModal.hidden = true;
});

// ---- Service worker (offline / cache WASM) ----
if ('serviceWorker' in navigator) {
  window.addEventListener('load', () => {
    navigator.serviceWorker.register('./sw.js').catch(() => {});
  });
}
