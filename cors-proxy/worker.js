/**
 * Cloudflare Worker CORS proxy for neuPrint API.
 *
 * Forwards /api/* requests to neuprint.janelia.org with CORS headers added.
 * Deploy: cd cors-proxy && npx wrangler deploy
 *
 * After deploying, update PROXY_BASE in js/neuprint-client.js with your worker URL.
 */

const UPSTREAM = 'https://neuprint.janelia.org';
const ALLOWED_PATH = /^\/api\//;

const CORS_HEADERS = {
    'Access-Control-Allow-Origin': '*',
    'Access-Control-Allow-Methods': 'GET, POST, OPTIONS',
    'Access-Control-Allow-Headers': 'Authorization, Content-Type',
    'Access-Control-Max-Age': '86400',
};

export default {
    async fetch(request) {
        // Handle CORS preflight
        if (request.method === 'OPTIONS') {
            return new Response(null, { status: 204, headers: CORS_HEADERS });
        }

        const url = new URL(request.url);

        // Only proxy /api/ paths to prevent open-proxy abuse
        if (!ALLOWED_PATH.test(url.pathname)) {
            return new Response('Not found', { status: 404 });
        }

        // Forward to neuPrint
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

        // Copy response and add CORS headers
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
