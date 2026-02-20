# Daily Share Button + Re-show Results Implementation Plan

> **For Claude:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task.

**Goal:** Add a Wordle-style share button for daily challenge results, and make the daily button re-show stored results when the player has already played today.

**Architecture:** Store full round data in localStorage at game end (daily only). `generateShareText()` maps per-round scores to emoji blocks. Re-show reuses `showFinalScore()` by injecting stored data into `gameState` and `manifest` before calling it.

**Tech Stack:** Vanilla JS, no build step. Web Share API with clipboard fallback. No new files needed.

---

### Task 1: Store full daily result in localStorage

**Files:**
- Modify: `js/main.js` — `showFinalScore()` function (~line 361)

**Context:** `gameState.roundScores` entries already contain `{ score, locationScore, synapseScore, distance, synapseGuess, synapseActual, guess, answer, neuronMeta }`. `manifest.date` is available at module scope.

**Step 1: Add localStorage save inside `showFinalScore()`**

Find the line in `showFinalScore()` that calls `loadLeaderboard()` at the bottom. Just before it, add:

```js
// Save full daily result for re-show and sharing
if (gameMode === 'daily' && manifest?.date) {
    localStorage.setItem(
        `daily_result_${manifest.date}`,
        JSON.stringify({ totalScore: gameState.totalScore, roundScores: gameState.roundScores, date: manifest.date })
    );
}
```

**Step 2: Verify manually**

Open the app, play a daily game to completion. In DevTools console:
```js
JSON.parse(localStorage.getItem(`daily_result_${new Date().toISOString().split('T')[0]}`))
```
Expected: object with `totalScore`, `date`, `roundScores` (array of 5 objects, each with `locationScore`, `synapseScore`, `guess`, `answer`).

**Step 3: Commit**

```bash
git add js/main.js
git commit -m "feat: store full daily result in localStorage on game completion"
```

---

### Task 2: Add `scoreToBlocks()` and `generateShareText()` helpers

**Files:**
- Modify: `js/main.js` — add two functions after the `synapsesToSlider` function (~line 36)

**Step 1: Add helper functions**

After the `synapsesToSlider` function, add:

```js
// --- Share helpers ---

/**
 * Convert a dimension score (0–5000) to 3 emoji blocks.
 * Thresholds at 20% / 50% / 85% of max.
 * 🟩 = reached, 🟨 = within 60% of threshold, ⬛ = below.
 */
function scoreToBlocks(score, max = 5000) {
    const thresholds = [max * 0.20, max * 0.50, max * 0.85]; // 1000, 2500, 4250
    return thresholds.map(t => {
        if (score >= t) return '🟩';
        if (score >= t * 0.6) return '🟨';
        return '⬛';
    }).join('');
}

/**
 * Generate a Wordle-style share text for a completed daily game.
 * @param {string} date - ISO date string e.g. "2026-02-20"
 * @param {number} totalScore
 * @param {Array} roundScores - gameState.roundScores array
 * @returns {string}
 */
function generateShareText(date, totalScore, roundScores) {
    const header = `NeuronGuessr ${date} ${totalScore.toLocaleString()}/50,000`;
    const rows = roundScores.map(r =>
        `📍${scoreToBlocks(r.locationScore)} ⚡${scoreToBlocks(r.synapseScore)}`
    ).join('\n');
    const url = window.location.origin;
    return `${header}\n${rows}\n${url}`;
}

/**
 * Copy text to clipboard, using Web Share API on mobile if available.
 * Returns a promise that resolves when done.
 */
async function shareText(text) {
    if (navigator.share) {
        await navigator.share({ text });
    } else {
        await navigator.clipboard.writeText(text);
    }
}
```

**Step 2: Sanity-check in console**

After loading the app, paste into DevTools console:
```js
// Test scoreToBlocks
// 0 pts → all black
// 2500 pts → 🟩🟩⬛
// 4250+ pts → 🟩🟩🟩
```
(No automated tests — this is a vanilla JS app.)

**Step 3: Commit**

```bash
git add js/main.js
git commit -m "feat: add scoreToBlocks and generateShareText helpers"
```

---

### Task 3: Add share button HTML

**Files:**
- Modify: `index.html`

**Step 1: Add share button to final screen**

Find the `final-card` div. After the `<div id="final-score" class="big-score">0</div>` and before `<p class="final-subtitle">out of 50,000</p>`, add:

```html
<button id="btn-share" class="btn-share" style="display:none;">Share</button>
```

**Step 2: Add share button to start screen**

Find the `daily-status` paragraph:
```html
<p id="daily-status" class="daily-status" style="display:none;"></p>
```

Replace it with a wrapper row:
```html
<div id="daily-status-row" class="daily-status-row" style="display:none;">
    <p id="daily-status" class="daily-status"></p>
    <button id="btn-share-start" class="btn-share-start">Share</button>
</div>
```

**Step 3: Commit**

```bash
git add index.html
git commit -m "feat: add share button elements to final and start screens"
```

---

### Task 4: Add CSS for share buttons

**Files:**
- Modify: `css/style.css` — add after the `.daily-status` rule (~line 208)

**Step 1: Add styles**

After the `.daily-status` rule, add:

```css
.daily-status-row {
    display: flex;
    align-items: center;
    gap: 10px;
    margin-bottom: 8px;
    justify-content: center;
}

.btn-share,
.btn-share-start {
    background: transparent;
    border: 1px solid #4CAF50;
    color: #4CAF50;
    padding: 5px 14px;
    border-radius: 6px;
    cursor: pointer;
    font-size: 13px;
    transition: background 0.15s;
    white-space: nowrap;
}

.btn-share:hover,
.btn-share-start:hover {
    background: rgba(76, 175, 80, 0.12);
}

/* Larger share button on final screen */
.btn-share {
    padding: 8px 20px;
    font-size: 14px;
    margin: 4px 0 2px;
}
```

**Step 2: Verify**

Reload the app. Temporarily remove `style="display:none;"` from `btn-share` in DevTools to verify it looks correct on the final screen. Re-add it.

**Step 3: Commit**

```bash
git add css/style.css
git commit -m "feat: add share button styles"
```

---

### Task 5: Wire share button on final screen

**Files:**
- Modify: `js/main.js`

**Step 1: Add DOM ref**

Near the other DOM refs at the top of `main.js` (around line 80), add:
```js
const $btnShare = document.getElementById('btn-share');
```

**Step 2: Show button only for daily mode in `showFinalScore()`**

Inside `showFinalScore()`, after the existing `showScreen('screen-final')` call, add:
```js
$btnShare.style.display = gameMode === 'daily' ? 'inline-block' : 'none';
$btnShare.textContent = 'Share';
```

**Step 3: Add event listener**

After the other button event listeners (near `$btnReplay` listener), add:
```js
$btnShare.addEventListener('click', async () => {
    const stored = JSON.parse(localStorage.getItem(`daily_result_${manifest.date}`) || 'null');
    if (!stored) return;
    const text = generateShareText(stored.date, stored.totalScore, stored.roundScores);
    try {
        await shareText(text);
        $btnShare.textContent = 'Copied!';
        setTimeout(() => { $btnShare.textContent = 'Share'; }, 2000);
    } catch {
        // User cancelled share sheet or clipboard denied — silently ignore
    }
});
```

**Step 4: Verify manually**

Play a daily game to completion. Share button should appear. Clicking it should copy text. Paste in a text editor to confirm format:
```
NeuronGuessr 2026-02-20 43,135/50,000
📍🟩🟩🟨 ⚡🟩⬛⬛
...
http://localhost:XXXX
```

**Step 5: Commit**

```bash
git add js/main.js
git commit -m "feat: wire share button on final score screen"
```

---

### Task 6: Wire share button on start screen

**Files:**
- Modify: `js/main.js`

**Step 1: Add DOM refs**

Near the other DOM refs, add:
```js
const $dailyStatusRow = document.getElementById('daily-status-row');
const $btnShareStart = document.getElementById('btn-share-start');
```

**Step 2: Update `updateAuthUI()` to show/hide the row and wire button**

Find the `updateAuthUI()` function. The current code:
```js
const dailyPlayed = localStorage.getItem(`daily_played_${today}`);
if (dailyPlayed) {
    $dailyStatus.style.display = 'block';
    $dailyStatus.textContent = `Today's score: ${parseInt(dailyPlayed).toLocaleString()}`;
} else {
    $dailyStatus.style.display = 'none';
}
```

Replace with:
```js
const dailyPlayed = localStorage.getItem(`daily_played_${today}`);
if (dailyPlayed) {
    $dailyStatusRow.style.display = 'flex';
    $dailyStatus.textContent = `Today's score: ${parseInt(dailyPlayed).toLocaleString()}`;
} else {
    $dailyStatusRow.style.display = 'none';
}
```

**Step 3: Add event listener for start screen share button**

After the `$btnShare` event listener added in Task 5, add:
```js
$btnShareStart.addEventListener('click', async () => {
    const today = new Date().toISOString().split('T')[0];
    const stored = JSON.parse(localStorage.getItem(`daily_result_${today}`) || 'null');
    if (!stored) return;
    const text = generateShareText(stored.date, stored.totalScore, stored.roundScores);
    try {
        await shareText(text);
        $btnShareStart.textContent = 'Copied!';
        setTimeout(() => { $btnShareStart.textContent = 'Share'; }, 2000);
    } catch {
        // ignore
    }
});
```

**Step 4: Verify manually**

With a stored daily result in localStorage, reload the app. The start screen should show `Today's score: X,XXX  [Share]` side by side. Clicking Share should copy the emoji block text.

**Step 5: Commit**

```bash
git add js/main.js
git commit -m "feat: wire share button on start screen"
```

---

### Task 7: Re-show results when daily already played

**Files:**
- Modify: `js/main.js`

**Step 1: Add `showStoredDailyResult()` function**

Add this function before `startGame()`:

```js
/**
 * Re-display the final score screen from a previously completed daily game.
 * Reads stored result from localStorage and reconstructs the final screen.
 * @param {Object} stored - { totalScore, roundScores, date }
 */
function showStoredDailyResult(stored) {
    gameMode = 'daily';
    manifest = { date: stored.date, brainBounds: { min: [0,0,0], max: [0,0,0] }, maxDistance: 1, neurons: [] };
    gameState.totalScore = stored.totalScore;
    gameState.roundScores = stored.roundScores;
    showFinalScore();
    // Hide score submit row — they've already played
    $scoreSubmitRow.style.display = 'none';
}
```

**Step 2: Update the daily button click handler**

Find:
```js
$btnDaily.addEventListener('click', () => startGame('daily'));
```

Replace with:
```js
$btnDaily.addEventListener('click', () => {
    const today = new Date().toISOString().split('T')[0];
    const stored = JSON.parse(localStorage.getItem(`daily_result_${today}`) || 'null');
    if (stored) {
        showStoredDailyResult(stored);
    } else {
        startGame('daily');
    }
});
```

**Step 3: Verify manually**

1. Play a daily game all the way through (creates the localStorage entry).
2. Click "Play Again" to return to start screen.
3. Click "Daily Challenge" — should immediately show your final score screen with brain overview and round breakdown, no loading spinner, submit row hidden.
4. Share button should be visible and functional.
5. Clear localStorage (`localStorage.clear()` in console) and reload — clicking Daily should start a fresh game as normal.

**Step 4: Commit**

```bash
git add js/main.js
git commit -m "feat: re-show stored daily result when daily button clicked after completion"
```

---

## Done

All five touchpoints covered:
- `js/main.js` — helpers, storage, event wiring, re-show logic
- `index.html` — share button elements
- `css/style.css` — share button styles
