/**
 * Leaderboard and histogram for NeuronGuessr.
 */

import { PROXY_BASE } from './config.js';

/**
 * Submit a score to the leaderboard.
 */
export async function submitScore(mode, date, name, score, roundScores) {
    const resp = await fetch(`${PROXY_BASE}/api/scores`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ mode, date, name, score, roundScores }),
    });
    return resp.json();
}

/**
 * Fetch scores for a given mode and date.
 */
export async function fetchScores(mode, date) {
    const resp = await fetch(
        `${PROXY_BASE}/api/scores?mode=${mode}&date=${date}`
    );
    return resp.json();
}

/**
 * Render leaderboard table into a container.
 */
export function renderLeaderboard(container, scores, myScore) {
    if (!scores || scores.length === 0) {
        container.innerHTML = '<p class="leaderboard-empty">No scores yet. Be the first!</p>';
        return;
    }

    const top = scores.slice(0, 20);
    let html = '<table class="leaderboard-table"><thead><tr><th>#</th><th>Player</th><th>Score</th></tr></thead><tbody>';

    for (let i = 0; i < top.length; i++) {
        const s = top[i];
        const isMe = myScore !== undefined && s.score === myScore && s.timestamp === scores.find(x => x.score === myScore)?.timestamp;
        const cls = isMe ? ' class="leaderboard-me"' : '';
        html += `<tr${cls}><td>${i + 1}</td><td>${escapeHtml(s.name)}</td><td>${s.score.toLocaleString()}</td></tr>`;
    }

    html += '</tbody></table>';
    container.innerHTML = html;
}

/**
 * Render score histogram on a canvas.
 * Bins adapt to actual score range. Current run shown as dotted cyan line.
 */
export function renderHistogram(canvas, scores, myScore) {
    if (!scores || scores.length === 0) {
        canvas.style.display = 'none';
        return;
    }
    canvas.style.display = 'block';

    const dpr = window.devicePixelRatio || 1;
    const w = canvas.clientWidth;
    const h = canvas.clientHeight;
    canvas.width = w * dpr;
    canvas.height = h * dpr;
    const ctx = canvas.getContext('2d');
    ctx.scale(dpr, dpr);

    // Determine score range from actual data
    const allScoreVals = scores.map(s => s.score);
    const maxScore = Math.max(...allScoreVals, myScore || 0);
    const minScore = Math.min(...allScoreVals, myScore || 0);

    // Dynamic bin sizing: aim for ~10-15 bins with nice round boundaries
    const range = Math.max(maxScore - 0, 1000); // always start from 0
    const rawBinSize = range / 12;
    const niceSteps = [100, 200, 500, 1000, 2000, 2500, 5000, 10000];
    let binSize = niceSteps[0];
    for (const step of niceSteps) {
        if (step <= rawBinSize * 1.5) binSize = step;
    }

    const binCount = Math.ceil(maxScore / binSize) + 1;
    const bins = new Array(binCount).fill(0);

    for (const s of scores) {
        const bin = Math.min(Math.floor(s.score / binSize), binCount - 1);
        bins[bin]++;
    }

    const maxBin = Math.max(...bins, 1);
    const pad = { top: 10, right: 10, bottom: 28, left: 10 };
    const plotW = w - pad.left - pad.right;
    const plotH = h - pad.top - pad.bottom;
    const barW = plotW / binCount;

    // Background
    ctx.fillStyle = '#12121f';
    ctx.fillRect(0, 0, w, h);

    // Bars
    for (let i = 0; i < binCount; i++) {
        const barH = (bins[i] / maxBin) * plotH;
        const x = pad.left + i * barW;
        const y = pad.top + plotH - barH;

        ctx.fillStyle = '#2a4a2e';
        ctx.fillRect(x + 1, y, barW - 2, barH);

        // Count label
        if (bins[i] > 0) {
            ctx.fillStyle = '#aaa';
            ctx.font = '10px system-ui';
            ctx.textAlign = 'center';
            ctx.textBaseline = 'bottom';
            ctx.fillText(bins[i], x + barW / 2, y - 2);
        }
    }

    // Current run: dotted cyan vertical line
    if (myScore !== undefined) {
        const myX = pad.left + (myScore / binSize) * barW;
        ctx.strokeStyle = '#00e5ff';
        ctx.lineWidth = 2;
        ctx.setLineDash([4, 4]);
        ctx.beginPath();
        ctx.moveTo(myX, pad.top);
        ctx.lineTo(myX, pad.top + plotH);
        ctx.stroke();
        ctx.setLineDash([]);

        // Label
        ctx.fillStyle = '#00e5ff';
        ctx.font = 'bold 10px system-ui';
        ctx.textAlign = 'center';
        ctx.textBaseline = 'bottom';
        ctx.fillText('You', myX, pad.top - 1);
    }

    // X-axis labels
    ctx.fillStyle = '#666';
    ctx.font = '10px system-ui';
    ctx.textAlign = 'center';
    ctx.textBaseline = 'top';
    const labelEvery = Math.max(1, Math.floor(binCount / 6));
    for (let i = 0; i <= binCount; i += labelEvery) {
        const val = i * binSize;
        const label = val >= 1000 ? (val / 1000) + 'K' : String(val);
        ctx.fillText(label, pad.left + i * barW, pad.top + plotH + 4);
    }
}

function escapeHtml(str) {
    return str.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
}
