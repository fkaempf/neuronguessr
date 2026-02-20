/**
 * Cloudflare Worker — CORS proxy + backend for NeuronGuessr.
 *
 * Routes:
 *   /api/daily              GET  — today's 5 daily challenge neurons
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

// ---------- Seeded PRNG (mulberry32) ----------

function mulberry32(seed) {
    return function () {
        seed |= 0; seed = seed + 0x6D2B79F5 | 0;
        let t = Math.imul(seed ^ seed >>> 15, 1 | seed);
        t = t + Math.imul(t ^ t >>> 7, 61 | t) ^ t;
        return ((t ^ t >>> 14) >>> 0) / 4294967296;
    };
}

function hashString(str) {
    let h = 0;
    for (let i = 0; i < str.length; i++) {
        h = Math.imul(31, h) + str.charCodeAt(i) | 0;
    }
    return h;
}

function seededShuffle(arr, rng) {
    const a = [...arr];
    for (let i = a.length - 1; i > 0; i--) {
        const j = Math.floor(rng() * (i + 1));
        [a[i], a[j]] = [a[j], a[i]];
    }
    return a;
}

// ---------- Daily Challenge ----------

function todayUTC() {
    return new Date().toISOString().split('T')[0];
}

async function getDailyNeurons(env) {
    const date = todayUTC();
    const cacheKey = `daily:${date}:neurons`;

    // Check cache
    const cached = await env.SCORES.get(cacheKey, 'json');
    if (cached) return { date, neurons: cached };

    // Query neuPrint for a large pool of types
    const token = env.NEUPRINT_TOKEN;
    if (!token) throw new Error('NEUPRINT_TOKEN secret not configured');

    const cypher = `
        MATCH (n:Neuron)
        WHERE n.status = "Traced"
          AND n.pre >= 20
          AND n.post >= 20
          AND n.type IS NOT NULL
        WITH DISTINCT n.type AS t
        RETURN t
    `;

    const resp = await fetch(`${UPSTREAM}/api/custom/custom`, {
        method: 'POST',
        headers: {
            'Content-Type': 'application/json',
            'Authorization': `Bearer ${token}`,
        },
        body: JSON.stringify({ cypher, dataset: DATASET }),
    });
    if (!resp.ok) {
        const text = await resp.text();
        throw new Error(`neuPrint query failed (${resp.status}): ${text}`);
    }

    const result = await resp.json();
    const allTypes = result.data.map(row => row[0]);

    // Deterministically pick 5 types using date-seeded PRNG
    const rng = mulberry32(hashString(date));
    const shuffled = seededShuffle(allTypes, rng);
    const selectedTypes = shuffled.slice(0, 5);

    // For each type, pick one neuron (also deterministic)
    const neurons = [];
    for (const type of selectedTypes) {
        const q = `
            MATCH (m:Neuron)
            WHERE m.type = "${type.replace(/"/g, '\\"')}"
              AND m.status = "Traced"
              AND m.pre >= 20
              AND m.post >= 20
            RETURN m.bodyId AS bodyId,
                   m.type AS type,
                   m.instance AS instance,
                   m.pre AS pre,
                   m.post AS post,
                   m.somaLocation AS somaLocation,
                   m.roiInfo AS roiInfo
            LIMIT 20
        `;
        const r = await fetch(`${UPSTREAM}/api/custom/custom`, {
            method: 'POST',
            headers: {
                'Content-Type': 'application/json',
                'Authorization': `Bearer ${token}`,
            },
            body: JSON.stringify({ cypher: q, dataset: DATASET }),
        });
        if (!r.ok) continue;
        const res = await r.json();
        if (!res.data || res.data.length === 0) continue;

        const cols = res.columns;
        const idx = {};
        cols.forEach((c, i) => idx[c] = i);

        // Deterministically pick one from results
        const pick = Math.floor(rng() * res.data.length);
        const row = res.data[pick];

        const roiInfo = row[idx.roiInfo];
        let primaryRoi = '';
        if (roiInfo && typeof roiInfo === 'object') {
            let maxSyn = 0;
            for (const [roi, counts] of Object.entries(roiInfo)) {
                const total = (counts.pre || 0) + (counts.post || 0);
                if (total > maxSyn) { maxSyn = total; primaryRoi = roi; }
            }
        }

        neurons.push({
            bodyId: row[idx.bodyId],
            type: row[idx.type] || 'unknown',
            instance: row[idx.instance] || '',
            pre: row[idx.pre] || 0,
            post: row[idx.post] || 0,
            somaLocation: row[idx.somaLocation],
            region: primaryRoi,
        });
    }

    if (neurons.length < 5) {
        throw new Error(`Only got ${neurons.length} neurons for daily challenge`);
    }

    // Cache for 48 hours
    await env.SCORES.put(cacheKey, JSON.stringify(neurons), { expirationTtl: 172800 });

    return { date, neurons };
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

    // Rate limit by IP
    const ip = request.headers.get('CF-Connecting-IP') || 'unknown';
    const rateKey = `rate:${mode}:${date}:${ip}`;
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
    const histKey = `histogram:${mode}`;
    const allScores = await env.SCORES.get(histKey, 'json') || [];
    allScores.push(score);
    // Keep only last 10000 scores to avoid unbounded growth
    if (allScores.length > 10000) allScores.splice(0, allScores.length - 10000);
    await env.SCORES.put(histKey, JSON.stringify(allScores));

    // Update rate limit (expires end of day)
    await env.SCORES.put(rateKey, String(rateCount + 1), { expirationTtl: 86400 });

    // Find rank
    const rank = existing.findIndex(e => e.timestamp === existing[existing.length - 1].timestamp) + 1;

    return corsJson({ success: true, rank, total: existing.length });
}

async function getScores(url, env) {
    const mode = url.searchParams.get('mode') || 'daily';
    const date = url.searchParams.get('date') || todayUTC();

    if (!['daily', 'freeplay'].includes(mode)) return corsError('Invalid mode');

    const scoreKey = `scores:${mode}:${date}`;
    const scores = await env.SCORES.get(scoreKey, 'json') || [];

    // All-time histogram scores
    const histKey = `histogram:${mode}`;
    const allTimeScores = await env.SCORES.get(histKey, 'json') || [];

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

        // Daily challenge neurons
        if (url.pathname === '/api/daily' && request.method === 'GET') {
            try {
                const data = await getDailyNeurons(env);
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
