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

    // Build histogram bins (0-50000, 10 bins of 5000)
    const binCount = 10;
    const binSize = 5000;
    const bins = new Array(binCount).fill(0);

    for (const s of scores) {
        const bin = Math.min(Math.floor(s.score / binSize), binCount - 1);
        bins[bin]++;
    }

    const maxBin = Math.max(...bins);
    const pad = { top: 10, right: 10, bottom: 28, left: 10 };
    const plotW = w - pad.left - pad.right;
    const plotH = h - pad.top - pad.bottom;
    const barW = plotW / binCount;

    // Background
    ctx.fillStyle = '#12121f';
    ctx.fillRect(0, 0, w, h);

    // Bars
    for (let i = 0; i < binCount; i++) {
        const barH = maxBin > 0 ? (bins[i] / maxBin) * plotH : 0;
        const x = pad.left + i * barW;
        const y = pad.top + plotH - barH;

        // Highlight bin containing my score
        const isMy = myScore !== undefined &&
            Math.floor(myScore / binSize) === i;
        ctx.fillStyle = isMy ? '#4CAF50' : '#2a4a2e';
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

    // X-axis labels
    ctx.fillStyle = '#666';
    ctx.font = '10px system-ui';
    ctx.textAlign = 'center';
    ctx.textBaseline = 'top';
    for (let i = 0; i <= binCount; i += 2) {
        const label = (i * binSize / 1000) + 'K';
        ctx.fillText(label, pad.left + i * barW, pad.top + plotH + 4);
    }
}

function escapeHtml(str) {
    return str.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
}
