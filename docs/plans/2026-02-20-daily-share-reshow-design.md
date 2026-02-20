# Design: Daily Share Button + Re-show Results

## Summary

Two related features for the daily challenge:
1. A share button that generates a Wordle-style emoji result block
2. Clicking the daily button when already played shows your stored results instead of restarting

## Share Format

```
NeuronGuessr 2026-02-20 43,135/50,000
📍🟩🟩🟨 ⚡🟩⬛⬛
📍🟩🟩🟩 ⚡🟩🟩⬛
📍🟩🟩🟨 ⚡🟩🟩🟩
📍🟩⬛⬛  ⚡🟩🟩🟩
📍🟩🟩🟨 ⚡🟩🟨⬛
https://neuronguessr.com
```

- 📍 = location score, ⚡ = synapse score
- 3 blocks per dimension, progress-bar style
- Thresholds at 20% / 50% / 85% of 5000 (i.e. 1000 / 2500 / 4250)
- 🟩 = reached threshold, 🟨 = ≥60% of threshold, ⬛ = below

## Share Mechanism

- Web Share API on supporting browsers (mobile native sheet)
- Clipboard fallback on desktop
- Button text: "Share" → "Copied!" for 2 seconds after click

## Data Storage

Add per-round result to localStorage at daily game completion:

```js
localStorage.setItem(`daily_result_${date}`, JSON.stringify({ totalScore, roundScores }))
```

`roundScores` entries: `{ score, locationScore, synapseScore, distance }`

Existing `daily_played_${date}` key (total score only) is preserved unchanged.

## UI Placement

- **Final screen**: Share button in `final-card`, below total score, above round breakdown. Only shown for daily mode.
- **Start screen**: Share button inline with the `daily-status` line, only visible when daily already played today.

## Re-show Results Flow

In the Daily button click handler (currently `startGame('daily')`):
- Check localStorage for `daily_result_${today}`
- If found: call `showStoredDailyResult(storedResult)` which populates the final screen and navigates to it — no network calls
- If not found (old session, missing data): fall back to normal `startGame('daily')`

`showStoredDailyResult` reuses `showFinalScore()` logic but with injected data instead of live `gameState`.
