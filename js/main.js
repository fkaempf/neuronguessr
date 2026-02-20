/**
 * NeuronGuessr - Main entry point.
 * Wires together viewers, game state, data loading, and DOM.
 */

import { NeuronViewer } from './neuron-viewer.js';
import { BrainViewer } from './brain-viewer.js';
import { GameState, ROUNDS_PER_GAME } from './game-state.js';
import { MAX_POINTS } from './scoring.js';
import { loadNeuropilConfig, loadOBJText } from './data-loader.js';
import { initAuth, isSignedIn, getToken, getUserEmail, setManualToken, signOut, onAuthChange } from './auth.js';
import { loadOnlineManifest, loadDailyManifest, loadOnlineNeuron } from './online-data-loader.js';
import { submitScore, fetchScores, renderLeaderboard, renderHistogram } from './leaderboard.js';
import { showScreen, animateScore } from './ui.js';

// --- State ---
let gameState = new GameState();
let neuronViewer;
let brainViewer;
let manifest;
let currentNeuronData;
let gameMode = 'daily'; // 'daily' or 'freeplay'

// Synapse slider: logarithmic mapping from slider (0-1000) to synapse count (10-200000)
const SYNAPSE_MIN = 10;
const SYNAPSE_MAX = 200000;

function sliderToSynapses(val) {
    const t = val / 1000;
    return Math.round(SYNAPSE_MIN * Math.pow(SYNAPSE_MAX / SYNAPSE_MIN, t));
}

function synapsesToSlider(count) {
    const t = Math.log(count / SYNAPSE_MIN) / Math.log(SYNAPSE_MAX / SYNAPSE_MIN);
    return Math.round(t * 1000);
}

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

// --- DOM refs ---
const $roundCounter = document.getElementById('round-counter');
const $totalScore = document.getElementById('total-score');
const $guessCoords = document.getElementById('guess-coords');
const $btnDaily = document.getElementById('btn-daily');
const $btnFreeplay = document.getElementById('btn-freeplay');
const $dailyDate = document.getElementById('daily-date');
const $dailyStatus = document.getElementById('daily-status');
const $dailyStatusRow = document.getElementById('daily-status-row');
const $btnShareStart = document.getElementById('btn-share-start');
const $btnSubmit = document.getElementById('btn-submit');
const $btnNext = document.getElementById('btn-next');
const $btnReplay = document.getElementById('btn-replay');
const $btnShare = document.getElementById('btn-share');
const $btnToggleRoi = document.getElementById('btn-toggle-roi');
const $btnToggleOrtho = document.getElementById('btn-toggle-ortho');
const $resultTitle = document.getElementById('result-title');
const $resultScore = document.getElementById('result-score');
const $resultLocScore = document.getElementById('result-loc-score');
const $resultSynScore = document.getElementById('result-syn-score');
const $resultDistance = document.getElementById('result-distance');
const $resultSynapses = document.getElementById('result-synapses');
const $resultType = document.getElementById('result-type');
const $resultRegion = document.getElementById('result-region');
const $finalScore = document.getElementById('final-score');
const $roundBreakdown = document.getElementById('round-breakdown');
const $loadingText = document.getElementById('loading-text');
const $brainCanvasContainer = document.getElementById('brain-canvas-container');
const $resultBrainContainer = document.getElementById('result-brain-container');
const $roundCounterResult = document.getElementById('round-counter-result');
const $totalScoreResult = document.getElementById('total-score-result');
const $synapseSlider = document.getElementById('synapse-slider');
const $synapseValue = document.getElementById('synapse-value');
const $btnScoring = document.getElementById('btn-scoring');
const $btnCloseScoring = document.getElementById('btn-close-scoring');
const $finalBrainContainer = document.getElementById('final-brain-container');
const $btnResetView = document.getElementById('btn-reset-view');
const $btnResetNeuron = document.getElementById('btn-reset-neuron');
const $btnShowNeuron = document.getElementById('btn-show-neuron');
const $btnShowBrain = document.getElementById('btn-show-brain');
const $panelNeuron = document.getElementById('panel-neuron');
const $panelBrain = document.getElementById('panel-brain');
const $depthSliderRow = document.getElementById('depth-slider-row');
const $depthSlider = document.getElementById('depth-slider');
const $playerName = document.getElementById('player-name');
const $btnSubmitScore = document.getElementById('btn-submit-score');
const $scoreSubmitRow = document.getElementById('score-submit-row');
const $leaderboardSection = document.getElementById('leaderboard-section');
const $leaderboardContainer = document.getElementById('leaderboard-container');
const $histogramCanvas = document.getElementById('histogram-canvas');

// Auth DOM refs
const $authNotSignedIn = document.getElementById('auth-not-signed-in');
const $authSignedIn = document.getElementById('auth-signed-in');
const $authEmail = document.getElementById('auth-email');
const $neuprintToken = document.getElementById('neuprint-token');
const $btnSetToken = document.getElementById('btn-set-token');
const $btnSignOut = document.getElementById('btn-sign-out');

// --- Initialization ---
async function init() {
    showScreen('screen-loading');
    $loadingText.textContent = 'Loading brain model...';

    try {
        neuronViewer = new NeuronViewer(
            document.getElementById('neuron-canvas-container')
        );
        brainViewer = new BrainViewer(
            $brainCanvasContainer,
            onGuessPlaced
        );

        $loadingText.textContent = 'Loading brain mesh...';
        await brainViewer.loadFusedBrain();

        loadNeuropilConfig().then(config => {
            brainViewer.loadIndividualRois(config, loadOBJText);
        }).catch(() => {});

        brainViewer.resetCamera();

        // Initialize auth and update UI
        initAuth();
        onAuthChange(updateAuthUI);
        updateAuthUI();

        showScreen('screen-start');
    } catch (err) {
        console.error('Init failed:', err);
        $loadingText.textContent = `Error: ${err.message}. Check that data/ files exist.`;
    }
}

function updateAuthUI() {
    if (isSignedIn()) {
        $authNotSignedIn.style.display = 'none';
        $authSignedIn.style.display = 'flex';
        $authEmail.textContent = getUserEmail() || '';
        $btnDaily.disabled = false;
        $btnFreeplay.disabled = false;
    } else {
        $authNotSignedIn.style.display = 'block';
        $authSignedIn.style.display = 'none';
        $authEmail.textContent = '';
        $btnDaily.disabled = true;
        $btnFreeplay.disabled = true;
    }

    // Show today's date on daily button
    const today = new Date().toISOString().split('T')[0];
    $dailyDate.textContent = today;

    // Check if daily already played
    const dailyPlayed = localStorage.getItem(`daily_played_${today}`);
    if (dailyPlayed) {
        $dailyStatusRow.style.display = 'flex';
        $dailyStatus.textContent = `Today's score: ${parseInt(dailyPlayed).toLocaleString()}`;
    } else {
        $dailyStatusRow.style.display = 'none';
    }
}

function moveBrainCanvas(targetContainer) {
    const canvas = brainViewer.renderer.domElement;
    targetContainer.appendChild(canvas);
    // Force layout reflow so container dimensions are available
    void targetContainer.offsetHeight;
    brainViewer._onResize();
}

// --- Synapse slider + manual input ---
function updateSynapseFromSlider() {
    const count = sliderToSynapses(parseInt($synapseSlider.value));
    $synapseValue.value = count.toLocaleString();
    gameState.setSynapseGuess(count);
    updateSubmitButton();
}

function updateSynapseFromInput() {
    const raw = $synapseValue.value.replace(/[^0-9]/g, '');
    let count = parseInt(raw) || 0;
    count = Math.max(SYNAPSE_MIN, Math.min(SYNAPSE_MAX, count));
    $synapseSlider.value = synapsesToSlider(count);
    gameState.setSynapseGuess(count);
    updateSubmitButton();
}

$synapseSlider.addEventListener('input', updateSynapseFromSlider);

$synapseValue.addEventListener('input', updateSynapseFromInput);

// Format nicely on blur, select all on focus
$synapseValue.addEventListener('focus', () => $synapseValue.select());
$synapseValue.addEventListener('blur', () => {
    const count = gameState.currentSynapseGuess || sliderToSynapses(parseInt($synapseSlider.value));
    $synapseValue.value = count.toLocaleString();
});
// Submit on Enter
$synapseValue.addEventListener('keydown', (e) => {
    if (e.key === 'Enter') {
        $synapseValue.blur();
    }
});

function updateSubmitButton() {
    $btnSubmit.disabled = !gameState.currentGuess || !gameState.currentSynapseGuess;
}

// --- Mobile panel toggle ---
function showMobilePanel(panel) {
    if (panel === 'neuron') {
        $panelNeuron.classList.remove('mobile-hidden');
        $panelBrain.classList.add('mobile-hidden');
        $btnShowNeuron.classList.add('active');
        $btnShowBrain.classList.remove('active');
        neuronViewer._onResize();
    } else {
        $panelBrain.classList.remove('mobile-hidden');
        $panelNeuron.classList.add('mobile-hidden');
        $btnShowBrain.classList.add('active');
        $btnShowNeuron.classList.remove('active');
        brainViewer._onResize();
    }
}

// --- Game Flow ---
async function startGame(mode = 'daily') {
    gameMode = mode;
    showScreen('screen-loading');

    if (mode === 'daily') {
        $loadingText.textContent = 'Loading daily challenge...';
    } else {
        $loadingText.textContent = 'Querying neuPrint for neurons...';
    }

    try {
        manifest = mode === 'daily'
            ? await loadDailyManifest(getToken())
            : await loadOnlineManifest(getToken());
    } catch (err) {
        console.error('Failed to load manifest:', err);
        const isAuth = err.message && (err.message.includes('401') || err.message.includes('jwt') || err.message.includes('credentials'));
        if (isAuth) {
            $loadingText.textContent = 'Token expired or invalid. Please sign in again.';
            signOut();
        } else {
            $loadingText.textContent = `Error: ${err.message}`;
        }
        await new Promise(r => setTimeout(r, 2500));
        showScreen('screen-start');
        return;
    }

    gameState.startNewGame(manifest.neurons);
    brainViewer.clearOverview();
    await loadRound();
}

async function loadRound() {
    const neuronMeta = gameState.getCurrentNeuronMeta();

    showScreen('screen-loading');
    $loadingText.textContent = `Fetching neuron ${neuronMeta.bodyId}...`;
    try {
        currentNeuronData = await loadOnlineNeuron(neuronMeta);
    } catch (err) {
        console.error(`Failed to load neuron ${neuronMeta.bodyId}:`, err);
        const isAuth = err.message && (err.message.includes('401') || err.message.includes('jwt') || err.message.includes('credentials'));
        if (isAuth) {
            $loadingText.textContent = 'Token expired or invalid. Please sign in again.';
            signOut();
            await new Promise(r => setTimeout(r, 2500));
            showScreen('screen-start');
            return;
        }
        $loadingText.textContent = 'Failed to load neuron. Retrying...';
        throw err;
    }

    // Show game screen BEFORE moving canvas so container has real dimensions
    showScreen('screen-game');
    showMobilePanel('neuron');
    moveBrainCanvas($brainCanvasContainer);

    neuronViewer.displayNeuron(currentNeuronData);

    brainViewer.clearGuess();
    brainViewer.resetCamera();

    // Reset depth slider
    $depthSliderRow.style.display = 'none';
    $depthSlider.value = 0;

    // Update HUD
    $roundCounter.textContent = `Round ${gameState.currentRound + 1} / ${ROUNDS_PER_GAME}`;
    $totalScore.textContent = `Score: ${gameState.totalScore.toLocaleString()}`;
    $btnSubmit.disabled = true;
    $guessCoords.textContent = '';
    gameState.currentGuess = null;
    gameState.currentSynapseGuess = null;

    // Reset synapse slider to middle
    $synapseSlider.value = 500;
    updateSynapseFromSlider();
}

function onGuessPlaced(position) {
    gameState.setGuess(position);
    updateSubmitButton();
    $guessCoords.textContent = `(${position[0].toFixed(0)}, ${position[1].toFixed(0)}, ${position[2].toFixed(0)})`;

    // Show depth slider on mobile when guess is placed
    if (window.innerWidth <= 768) {
        $depthSliderRow.style.display = 'flex';
    }
}

function submitGuess() {
    if (!gameState.currentGuess || !gameState.currentSynapseGuess) return;

    const answer = currentNeuronData.answer;
    const actualSynapses = (currentNeuronData.pre || 0) + (currentNeuronData.post || 0);
    const midlineX = (manifest.brainBounds.min[0] + manifest.brainBounds.max[0]) / 2;
    const result = gameState.submitRound(answer, manifest.maxDistance, actualSynapses, midlineX);

    // Show answer on brain (uses whichever hemisphere was closer)
    brainViewer.showAnswer(result.usedAnswer, currentNeuronData, midlineX);

    // Populate result card (before showing screen so content is ready)
    $resultTitle.textContent = `Round ${gameState.currentRound + 1} Result`;
    $resultLocScore.textContent = `Location: ${result.locationScore.toLocaleString()}`;
    $resultSynScore.textContent = `Synapses: ${result.synapseScore.toLocaleString()}`;

    const distanceUm = result.distance * 8 / 1000;
    $resultDistance.textContent = `${distanceUm.toFixed(1)} \u03BCm`;
    $resultSynapses.textContent = `${gameState.currentSynapseGuess.toLocaleString()} / ${actualSynapses.toLocaleString()}`;
    $resultType.textContent = currentNeuronData.type || 'Unknown';
    $resultRegion.textContent = currentNeuronData.region || 'Unknown';

    // Update HUD
    $totalScore.textContent = `Score: ${gameState.totalScore.toLocaleString()}`;
    $roundCounterResult.textContent = `Round ${gameState.currentRound + 1} / ${ROUNDS_PER_GAME}`;
    $totalScoreResult.textContent = `Score: ${gameState.totalScore.toLocaleString()}`;

    $btnNext.textContent = gameState.isGameOver() ? 'See Final Score' : 'Next Round';

    // Show result screen BEFORE moving canvas so container has real dimensions
    showScreen('screen-result');
    moveBrainCanvas($resultBrainContainer);
    brainViewer.resetCamera();

    // Animate score after screen is visible
    requestAnimationFrame(() => animateScore($resultScore, result.score));
}

async function nextRound() {
    const phase = gameState.nextRound();
    if (phase === 'final') {
        showFinalScore();
    } else {
        await loadRound();
    }
}

function showFinalScore() {
    // Show all guesses on the brain
    brainViewer.clearGuess();
    brainViewer.showAllRounds(gameState.roundScores);

    // Populate breakdown before showing screen
    $roundBreakdown.innerHTML = gameState.roundScores.map((r, i) => {
        const distUm = r.distance * 8 / 1000;
        return `
        <div class="round-row">
            <span class="round-label">Round ${i + 1}</span>
            <span class="round-distance">${distUm.toFixed(1)} \u03BCm</span>
            <span class="round-score-detail">
                <span class="loc-pts">${r.locationScore.toLocaleString()}</span>
                + <span class="syn-pts">${r.synapseScore.toLocaleString()}</span>
                = <span class="total-pts">${r.score.toLocaleString()}</span>
            </span>
        </div>
    `;
    }).join('');

    // Reset leaderboard UI
    $scoreSubmitRow.style.display = 'flex';
    $btnSubmitScore.disabled = false;
    $btnSubmitScore.textContent = 'Submit Score';
    $leaderboardSection.style.display = 'none';

    // Restore saved player name
    const savedName = localStorage.getItem('player_name');
    if (savedName) $playerName.value = savedName;

    // Show final screen BEFORE moving canvas so container has real dimensions
    showScreen('screen-final');
    $btnShare.style.display = gameMode === 'daily' ? 'inline-block' : 'none';
    $btnShare.textContent = 'Share';
    moveBrainCanvas($finalBrainContainer);
    brainViewer.resetCamera();

    // Animate score after screen is visible
    requestAnimationFrame(() => animateScore($finalScore, gameState.totalScore, 1200));

    // Save full daily result for re-show and sharing
    if (gameMode === 'daily' && manifest?.date) {
        localStorage.setItem(
            `daily_result_${manifest.date}`,
            JSON.stringify({ totalScore: gameState.totalScore, roundScores: gameState.roundScores, date: manifest.date })
        );
    }

    // Auto-load leaderboard
    loadLeaderboard();
}

// --- Leaderboard ---
async function loadLeaderboard() {
    const date = manifest?.date || new Date().toISOString().split('T')[0];
    try {
        const data = await fetchScores(gameMode, date);
        $leaderboardSection.style.display = 'block';
        renderLeaderboard($leaderboardContainer, data.scores || [], gameState.totalScore);
        // Use all-time scores for histogram
        const histScores = (data.allTimeScores || []).map(s => ({ score: s }));
        histScores.push({ score: gameState.totalScore }); // include current game
        renderHistogram($histogramCanvas, histScores, gameState.totalScore);
    } catch (err) {
        console.error('Failed to load leaderboard:', err);
        $leaderboardSection.style.display = 'block';
        renderLeaderboard($leaderboardContainer, [], gameState.totalScore);
    }
}

async function handleScoreSubmit() {
    const name = $playerName.value.trim();
    if (!name) { $playerName.focus(); return; }

    localStorage.setItem('player_name', name);
    $btnSubmitScore.disabled = true;
    $btnSubmitScore.textContent = 'Submitting...';

    const date = manifest?.date || new Date().toISOString().split('T')[0];
    const roundScoresData = gameState.roundScores.map(r => ({
        score: r.score,
        locationScore: r.locationScore,
        synapseScore: r.synapseScore,
        distance: r.distance,
    }));

    try {
        const result = await submitScore(gameMode, date, name, gameState.totalScore, roundScoresData);
        if (result.error) {
            $btnSubmitScore.textContent = result.error;
        } else {
            $scoreSubmitRow.style.display = 'none';
            // Save daily completion
            if (gameMode === 'daily') {
                localStorage.setItem(`daily_played_${date}`, String(gameState.totalScore));
            }
        }
        await loadLeaderboard();
    } catch (err) {
        console.error('Score submit failed:', err);
        $btnSubmitScore.textContent = 'Failed - Retry';
        $btnSubmitScore.disabled = false;
    }
}

// --- Event Listeners ---
$btnDaily.addEventListener('click', () => startGame('daily'));
$btnFreeplay.addEventListener('click', () => startGame('freeplay'));
$btnSubmit.addEventListener('click', submitGuess);
$btnNext.addEventListener('click', nextRound);
$btnReplay.addEventListener('click', () => {
    showScreen('screen-start');
    updateAuthUI();
});
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
$btnSubmitScore.addEventListener('click', handleScoreSubmit);
$playerName.addEventListener('keydown', (e) => {
    if (e.key === 'Enter') handleScoreSubmit();
});

// Auth event listeners
$btnSetToken.addEventListener('click', () => {
    setManualToken($neuprintToken.value);
    $neuprintToken.value = '';
});
$neuprintToken.addEventListener('keydown', (e) => {
    if (e.key === 'Enter') {
        setManualToken($neuprintToken.value);
        $neuprintToken.value = '';
    }
});
$btnSignOut.addEventListener('click', () => {
    signOut();
});

$btnToggleOrtho.addEventListener('click', () => {
    brainViewer.toggleProjection();
    $btnToggleOrtho.textContent = brainViewer.isOrtho
        ? 'Perspective View'
        : 'Ortho View';
});

$btnResetView.addEventListener('click', () => brainViewer.resetCamera());
$btnResetNeuron.addEventListener('click', () => neuronViewer.resetCamera());
$btnShowNeuron.addEventListener('click', () => showMobilePanel('neuron'));
$btnShowBrain.addEventListener('click', () => showMobilePanel('brain'));

// Depth slider for mobile (replaces Shift+scroll)
$depthSlider.addEventListener('input', () => {
    const val = parseInt($depthSlider.value);
    // Reset to 0 first, then set to target (adjustDepth is relative)
    if (brainViewer._guessDepthTarget !== undefined) {
        const delta = val * 30 - brainViewer._guessDepthTarget;
        brainViewer.adjustDepth(delta);
    }
});

// Arrow keys / = / - for depth adjustment
document.onkeydown = function(e) {
    if (e.target.tagName === 'INPUT' || e.target.tagName === 'TEXTAREA') return;
    if (!brainViewer) return;
    if (e.key === 'ArrowUp' || e.key === '=' || e.key === '+') {
        e.preventDefault();
        brainViewer.adjustDepth(1500);
    } else if (e.key === 'ArrowDown' || e.key === '-') {
        e.preventDefault();
        brainViewer.adjustDepth(-1500);
    }
};

document.getElementById('btn-info-toggle').addEventListener('click', () => {
    const el = document.getElementById('tech-stack');
    el.style.display = el.style.display === 'none' ? 'block' : 'none';
});

$btnScoring.addEventListener('click', () => {
    showScreen('screen-scoring');
    drawScoringCharts();
});
$btnCloseScoring.addEventListener('click', () => showScreen('screen-start'));

// --- Scoring Charts ---
function drawScoringCharts() {
    const D = 1050; // brain diagonal in µm
    const k = 6.6;
    drawChart('chart-location', {
        fn: (x) => { const r = k * x / D; return 5000 * Math.exp(-(r * r)); },
        xMax: 600,
        xLabel: 'Distance (\u03BCm)',
        yLabel: 'Points',
        color: '#4CAF50',
        points: [
            { x: 0, label: '0' },
            { x: 105, label: '105' },
            { x: 210, label: '210' },
            { x: 315, label: '315' },
            { x: 525, label: '525' },
        ],
    });

    drawChart('chart-synapse', {
        fn: (x) => 5000 * Math.exp(-1.5 * Math.abs(Math.log(x))),
        xMin: 0.1,
        xMax: 15,
        xLabel: 'Guess / Actual ratio',
        yLabel: 'Points',
        color: '#00BCD4',
        logX: true,
        points: [
            { x: 1, label: '1x' },
            { x: 2, label: '2x' },
            { x: 0.5, label: '\u00BDx' },
            { x: 5, label: '5x' },
            { x: 10, label: '10x' },
        ],
    });
}

function drawChart(canvasId, opts) {
    const canvas = document.getElementById(canvasId);
    const dpr = window.devicePixelRatio || 1;
    const w = canvas.clientWidth;
    const h = canvas.clientHeight;
    canvas.width = w * dpr;
    canvas.height = h * dpr;
    const ctx = canvas.getContext('2d');
    ctx.scale(dpr, dpr);

    const pad = { top: 12, right: 16, bottom: 32, left: 48 };
    const plotW = w - pad.left - pad.right;
    const plotH = h - pad.top - pad.bottom;
    const xMin = opts.xMin || 0;
    const xMax = opts.xMax;
    const yMax = 5000;

    function toCanvasX(x) {
        if (opts.logX) {
            const logMin = Math.log(xMin);
            const logMax = Math.log(xMax);
            return pad.left + ((Math.log(x) - logMin) / (logMax - logMin)) * plotW;
        }
        return pad.left + ((x - xMin) / (xMax - xMin)) * plotW;
    }
    function toCanvasY(y) {
        return pad.top + (1 - y / yMax) * plotH;
    }

    // Background
    ctx.fillStyle = '#12121f';
    ctx.fillRect(pad.left, pad.top, plotW, plotH);

    // Grid lines
    ctx.strokeStyle = '#2a2a3a';
    ctx.lineWidth = 0.5;
    for (let y = 0; y <= 5000; y += 1000) {
        const cy = toCanvasY(y);
        ctx.beginPath();
        ctx.moveTo(pad.left, cy);
        ctx.lineTo(pad.left + plotW, cy);
        ctx.stroke();
    }

    // Y axis labels
    ctx.fillStyle = '#666';
    ctx.font = '10px system-ui';
    ctx.textAlign = 'right';
    ctx.textBaseline = 'middle';
    for (let y = 0; y <= 5000; y += 1000) {
        ctx.fillText(y.toLocaleString(), pad.left - 6, toCanvasY(y));
    }

    // Draw curve
    ctx.strokeStyle = opts.color;
    ctx.lineWidth = 2;
    ctx.beginPath();
    const steps = 200;
    for (let i = 0; i <= steps; i++) {
        let x;
        if (opts.logX) {
            x = xMin * Math.pow(xMax / xMin, i / steps);
        } else {
            x = xMin + (xMax - xMin) * (i / steps);
        }
        const y = opts.fn(x);
        const cx = toCanvasX(x);
        const cy = toCanvasY(Math.max(0, Math.min(yMax, y)));
        if (i === 0) ctx.moveTo(cx, cy);
        else ctx.lineTo(cx, cy);
    }
    ctx.stroke();

    // Reference points with dots and labels
    ctx.fillStyle = opts.color;
    for (const pt of opts.points) {
        const y = opts.fn(pt.x);
        const cx = toCanvasX(pt.x);
        const cy = toCanvasY(Math.max(0, Math.min(yMax, y)));

        // Dot
        ctx.beginPath();
        ctx.arc(cx, cy, 3.5, 0, Math.PI * 2);
        ctx.fill();

        // Score label above dot
        ctx.fillStyle = '#ccc';
        ctx.font = '10px system-ui';
        ctx.textAlign = 'center';
        ctx.textBaseline = 'bottom';
        ctx.fillText(Math.round(y).toLocaleString(), cx, cy - 6);

        // X label below axis
        ctx.fillStyle = '#888';
        ctx.textBaseline = 'top';
        ctx.fillText(pt.label, cx, pad.top + plotH + 4);

        // Dotted vertical line
        ctx.strokeStyle = 'rgba(255,255,255,0.1)';
        ctx.lineWidth = 0.5;
        ctx.setLineDash([3, 3]);
        ctx.beginPath();
        ctx.moveTo(cx, cy);
        ctx.lineTo(cx, pad.top + plotH);
        ctx.stroke();
        ctx.setLineDash([]);

        ctx.fillStyle = opts.color;
    }

    // Axis labels
    ctx.fillStyle = '#666';
    ctx.font = '11px system-ui';
    ctx.textAlign = 'center';
    ctx.textBaseline = 'top';
    ctx.fillText(opts.xLabel, pad.left + plotW / 2, h - 12);

    ctx.save();
    ctx.translate(12, pad.top + plotH / 2);
    ctx.rotate(-Math.PI / 2);
    ctx.textBaseline = 'top';
    ctx.fillText(opts.yLabel, 0, 0);
    ctx.restore();
}

if ($btnToggleRoi) {
    $btnToggleRoi.addEventListener('click', () => {
        brainViewer.toggleRoiMode();
        $btnToggleRoi.textContent = brainViewer.showIndividualRois
            ? 'Show Fused Brain'
            : 'Show Brain Regions';
    });
}

// --- Boot ---
init();
