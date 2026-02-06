/**
 * NeuronGuessr - Main entry point.
 * Wires together viewers, game state, data loading, and DOM.
 */

import { NeuronViewer } from './neuron-viewer.js';
import { BrainViewer } from './brain-viewer.js';
import { GameState, ROUNDS_PER_GAME } from './game-state.js';
import { MAX_POINTS } from './scoring.js';
import { loadManifest, loadNeuron, loadNeuropilConfig, loadOBJText } from './data-loader.js';
import { showScreen, animateScore } from './ui.js';

// --- State ---
let gameState = new GameState();
let neuronViewer;
let brainViewer;
let manifest;
let currentNeuronData;

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

// --- DOM refs ---
const $roundCounter = document.getElementById('round-counter');
const $totalScore = document.getElementById('total-score');
const $guessCoords = document.getElementById('guess-coords');
const $btnStart = document.getElementById('btn-start');
const $btnSubmit = document.getElementById('btn-submit');
const $btnNext = document.getElementById('btn-next');
const $btnReplay = document.getElementById('btn-replay');
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

// --- Initialization ---
async function init() {
    showScreen('screen-loading');
    $loadingText.textContent = 'Loading neuron database...';

    try {
        manifest = await loadManifest();

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
        showScreen('screen-start');
    } catch (err) {
        console.error('Init failed:', err);
        $loadingText.textContent = `Error: ${err.message}. Check that data/ files exist.`;
    }
}

function moveBrainCanvas(targetContainer) {
    const canvas = brainViewer.renderer.domElement;
    targetContainer.appendChild(canvas);
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

// --- Game Flow ---
async function startGame() {
    gameState.startNewGame(manifest.neurons);
    brainViewer.clearOverview();
    moveBrainCanvas($brainCanvasContainer);
    showScreen('screen-game');
    await loadRound();
}

async function loadRound() {
    moveBrainCanvas($brainCanvasContainer);

    const neuronFile = gameState.getCurrentNeuronFile();
    currentNeuronData = await loadNeuron(neuronFile);

    neuronViewer.displayNeuron(currentNeuronData);

    brainViewer.clearGuess();
    brainViewer.resetCamera();

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
}

function submitGuess() {
    if (!gameState.currentGuess || !gameState.currentSynapseGuess) return;

    const answer = currentNeuronData.answer;
    const actualSynapses = (currentNeuronData.pre || 0) + (currentNeuronData.post || 0);
    const midlineX = (manifest.brainBounds.min[0] + manifest.brainBounds.max[0]) / 2;
    const result = gameState.submitRound(answer, manifest.maxDistance, actualSynapses, midlineX);

    // Show answer on brain (uses whichever hemisphere was closer)
    brainViewer.showAnswer(result.usedAnswer, currentNeuronData, midlineX);
    moveBrainCanvas($resultBrainContainer);
    brainViewer.resetCamera();

    // Populate result card
    $resultTitle.textContent = `Round ${gameState.currentRound + 1} Result`;
    animateScore($resultScore, result.score);
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
    showScreen('screen-result');
}

async function nextRound() {
    const phase = gameState.nextRound();
    if (phase === 'final') {
        showFinalScore();
    } else {
        showScreen('screen-game');
        await loadRound();
    }
}

function showFinalScore() {
    // Show all guesses on the brain
    brainViewer.clearGuess();
    brainViewer.showAllRounds(gameState.roundScores);
    moveBrainCanvas($finalBrainContainer);
    brainViewer.resetCamera();

    animateScore($finalScore, gameState.totalScore, 1200);

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

    showScreen('screen-final');
}

// --- Event Listeners ---
$btnStart.addEventListener('click', startGame);
$btnSubmit.addEventListener('click', submitGuess);
$btnNext.addEventListener('click', nextRound);
$btnReplay.addEventListener('click', startGame);

$btnToggleOrtho.addEventListener('click', () => {
    brainViewer.toggleProjection();
    $btnToggleOrtho.textContent = brainViewer.isOrtho
        ? 'Perspective View'
        : 'Ortho View';
});

$btnResetView.addEventListener('click', () => brainViewer.resetCamera());
$btnResetNeuron.addEventListener('click', () => neuronViewer.resetCamera());

$btnScoring.addEventListener('click', () => {
    showScreen('screen-scoring');
    drawScoringCharts();
});
$btnCloseScoring.addEventListener('click', () => showScreen('screen-start'));

// --- Scoring Charts ---
function drawScoringCharts() {
    const D = 1050; // brain diagonal in µm
    const k = 3.5;
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
