/**
 * Cloudflare Worker — CORS proxy + backend for NeuronGuessr.
 *
 * Routes:
 *   /api/skeleton/:bodyId   GET  — fetch neuron skeleton (uses worker's token)
 *   /api/scores             POST — submit a score
 *   /api/scores?mode=&date= GET  — fetch leaderboard
 *   /api/*                  *    — CORS proxy to neuprint.janelia.org
 *
 * Deploy: cd cors-proxy && npx wrangler deploy
 * Secrets: wrangler secret put NEUPRINT_TOKEN
 */

const UPSTREAM = 'https://neuprint.janelia.org';
const DATASET = 'male-cns:v0.9';

const CORS_HEADERS = {
    'Access-Control-Allow-Origin': '*',
    'Access-Control-Allow-Methods': 'GET, POST, OPTIONS',
    'Access-Control-Allow-Headers': 'Authorization, Content-Type',
    'Access-Control-Max-Age': '86400',
};

function corsJson(data, status = 200) {
    return new Response(JSON.stringify(data), {
        status,
        headers: { ...CORS_HEADERS, 'Content-Type': 'application/json' },
    });
}

function corsError(msg, status = 400) {
    return corsJson({ error: msg }, status);
}

// ---------- Skeleton proxy ----------

/**
 * Fetch a neuron skeleton from neuPrint using the worker's own token.
 * Clients don't need their own token — the worker handles auth.
 */
async function fetchSkeleton(bodyId, env) {
    const token = env.NEUPRINT_TOKEN;
    if (!token) throw new Error('NEUPRINT_TOKEN secret not configured');

    const resp = await fetch(
        `${UPSTREAM}/api/skeletons/skeleton/${DATASET}/${bodyId}`,
        { headers: { 'Authorization': `Bearer ${token}` } }
    );
    if (!resp.ok) {
        const text = await resp.text();
        throw new Error(`Skeleton fetch failed for ${bodyId}: ${resp.status} ${text}`);
    }
    return resp.json();
}

function todayUTC() {
    return new Date().toISOString().split('T')[0];
}

// ---------- Scores ----------

async function submitScore(request, env) {
    let body;
    try { body = await request.json(); }
    catch { return corsError('Invalid JSON'); }

    const { mode, date, name, score, roundScores } = body;

    if (!['daily', 'freeplay'].includes(mode)) return corsError('Invalid mode');
    if (!date || !/^\d{4}-\d{2}-\d{2}$/.test(date)) return corsError('Invalid date');
    if (!name || typeof name !== 'string' || name.trim().length === 0 || name.trim().length > 20) {
        return corsError('Name must be 1-20 characters');
    }
    if (typeof score !== 'number' || score < 0 || score > 50000) return corsError('Invalid score');
    if (!Array.isArray(roundScores) || roundScores.length !== 5) return corsError('Invalid roundScores');

    // Rate limit by clientId (generated per browser via crypto.randomUUID)
    const { clientId } = body;
    const rateSuffix = clientId && typeof clientId === 'string' ? clientId : (request.headers.get('CF-Connecting-IP') || 'unknown');
    const rateKey = `rate:${mode}:${date}:${rateSuffix}`;
    const rateCount = parseInt(await env.SCORES.get(rateKey) || '0');
    const maxSubmissions = mode === 'daily' ? 1 : 10;

    if (rateCount >= maxSubmissions) {
        return corsError(
            mode === 'daily'
                ? 'You already submitted a daily score today'
                : 'Too many submissions today',
            429
        );
    }

    // Read current scores
    const scoreKey = `scores:${mode}:${date}`;
    const existing = await env.SCORES.get(scoreKey, 'json') || [];

    existing.push({
        name: name.trim(),
        score,
        roundScores,
        timestamp: Date.now(),
    });

    // Sort by score descending
    existing.sort((a, b) => b.score - a.score);

    // Store (daily: 30 days, freeplay: 7 days)
    const ttl = mode === 'daily' ? 2592000 : 604800;
    await env.SCORES.put(scoreKey, JSON.stringify(existing), { expirationTtl: ttl });

    // Append to all-time histogram (just scores, no names, capped at 10000)
    const histKey = `histogram:daily`;
    const allScores = await env.SCORES.get(histKey, 'json') || [];
    allScores.push(score);
    // Keep only last 10000 scores to avoid unbounded growth
    if (allScores.length > 10000) allScores.splice(0, allScores.length - 10000);
    await env.SCORES.put(histKey, JSON.stringify(allScores));

    // For freeplay: maintain persistent all-time leaderboard (no TTL)
    let rank, total;
    if (mode === 'freeplay') {
        const lbKey = 'leaderboard:freeplay';
        const allTime = await env.SCORES.get(lbKey, 'json') || [];
        const entry = { name: name.trim(), score, roundScores, timestamp: Date.now() };
        allTime.push(entry);
        allTime.sort((a, b) => b.score - a.score);
        if (allTime.length > 200) allTime.length = 200;
        await env.SCORES.put(lbKey, JSON.stringify(allTime));
        rank = allTime.findIndex(e => e.timestamp === entry.timestamp) + 1;
        total = allTime.length;
    } else {
        rank = existing.findIndex(e => e.timestamp === existing[existing.length - 1].timestamp) + 1;
        total = existing.length;
    }

    // Update rate limit (expires end of day)
    await env.SCORES.put(rateKey, String(rateCount + 1), { expirationTtl: 86400 });

    return corsJson({ success: true, rank, total });
}

async function getScores(url, env) {
    const mode = url.searchParams.get('mode') || 'daily';
    const date = url.searchParams.get('date') || todayUTC();

    if (!['daily', 'freeplay'].includes(mode)) return corsError('Invalid mode');

    // Freeplay returns all-time persistent leaderboard; daily returns date-specific
    const scores = mode === 'freeplay'
        ? (await env.SCORES.get('leaderboard:freeplay', 'json') || [])
        : (await env.SCORES.get(`scores:${mode}:${date}`, 'json') || []);

    // All-time histogram always uses the unified daily histogram
    const allTimeScores = await env.SCORES.get('histogram:daily', 'json') || [];

    return corsJson({ mode, date, scores, total: scores.length, allTimeScores });
}

// ---------- Main handler ----------

export default {
    async fetch(request, env) {
        // CORS preflight
        if (request.method === 'OPTIONS') {
            return new Response(null, { status: 204, headers: CORS_HEADERS });
        }

        const url = new URL(request.url);

        // --- Custom endpoints ---

        // Skeleton proxy — fetch from neuPrint using worker's token
        const skelMatch = url.pathname.match(/^\/api\/skeleton\/(\d+)$/);
        if (skelMatch && request.method === 'GET') {
            try {
                const data = await fetchSkeleton(skelMatch[1], env);
                return corsJson(data);
            } catch (err) {
                return corsError(err.message, 500);
            }
        }

        // Score submission
        if (url.pathname === '/api/scores' && request.method === 'POST') {
            return submitScore(request, env);
        }

        // Score retrieval / leaderboard
        if (url.pathname === '/api/scores' && request.method === 'GET') {
            return getScores(url, env);
        }

        // --- CORS proxy for neuPrint ---

        if (!/^\/api\//.test(url.pathname)) {
            return new Response('Not found', { status: 404 });
        }

        const upstreamUrl = UPSTREAM + url.pathname + url.search;
        const headers = new Headers();
        const auth = request.headers.get('Authorization');
        if (auth) headers.set('Authorization', auth);
        headers.set('Content-Type', request.headers.get('Content-Type') || 'application/json');

        const upstream = await fetch(upstreamUrl, {
            method: request.method,
            headers,
            body: request.method === 'POST' ? request.body : undefined,
        });

        const respHeaders = new Headers(upstream.headers);
        for (const [k, v] of Object.entries(CORS_HEADERS)) {
            respHeaders.set(k, v);
        }

        return new Response(upstream.body, {
            status: upstream.status,
            headers: respHeaders,
        });
    },
};
