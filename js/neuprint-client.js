/**
 * neuPrint REST API client for NeuronGuessr.
 *
 * All requests go through the CORS proxy since neuprint.janelia.org
 * does not serve CORS headers.
 */

import { PROXY_BASE, DATASET } from './config.js';

let _token = null;

/**
 * Set the auth token for all subsequent API calls.
 */
export function setToken(token) {
    _token = token;
}

function _headers() {
    const h = { 'Content-Type': 'application/json' };
    if (_token) h['Authorization'] = `Bearer ${_token}`;
    return h;
}

/**
 * Execute a Cypher query against neuPrint.
 * @param {string} cypher - Cypher query string
 * @returns {Promise<{columns: string[], data: any[][]}>}
 */
export async function cypherQuery(cypher) {
    const resp = await fetch(`${PROXY_BASE}/api/custom/custom`, {
        method: 'POST',
        headers: _headers(),
        body: JSON.stringify({ cypher, dataset: DATASET }),
    });
    if (!resp.ok) {
        const text = await resp.text();
        throw new Error(`neuPrint query failed (${resp.status}): ${text}`);
    }
    return resp.json();
}

/**
 * Fetch a neuron skeleton by body ID.
 * @param {number} bodyId
 * @returns {Promise<Object>} - Raw skeleton response from neuPrint
 */
export async function fetchSkeleton(bodyId) {
    const resp = await fetch(
        `${PROXY_BASE}/api/skeletons/skeleton/${DATASET}/${bodyId}`,
        { headers: _headers() }
    );
    if (!resp.ok) {
        throw new Error(`Skeleton fetch failed for ${bodyId}: ${resp.status}`);
    }
    return resp.json();
}

/**
 * Query for random neurons with good properties for the game.
 * Returns 2x the requested count as buffer for skeleton fetch failures.
 *
 * @param {number} count - Number of neurons desired
 * @returns {Promise<Object[]>} - Array of neuron metadata objects
 */
export async function queryRandomNeurons(count = 5) {
    const limit = count * 2;
    // Two-stage sampling: pick random types first, then one random neuron per type.
    // This prevents optic lobe neurons (most numerous) from dominating.
    const cypher = `
        MATCH (n:Neuron)
        WHERE n.status = "Traced"
          AND n.pre >= 20
          AND n.post >= 20
          AND n.type IS NOT NULL
        WITH DISTINCT n.type AS t
        WITH t, rand() AS r
        ORDER BY r
        LIMIT ${limit}
        MATCH (m:Neuron)
        WHERE m.type = t
          AND m.status = "Traced"
          AND m.pre >= 20
          AND m.post >= 20
        WITH t, m, rand() AS r2
        ORDER BY t, r2
        WITH t, head(collect(m)) AS m
        RETURN m.bodyId AS bodyId,
               m.type AS type,
               m.instance AS instance,
               m.pre AS pre,
               m.post AS post,
               m.somaLocation AS somaLocation,
               m.roiInfo AS roiInfo
    `;

    const result = await cypherQuery(cypher);
    const cols = result.columns;
    const idx = {};
    cols.forEach((c, i) => idx[c] = i);

    return result.data.map(row => {
        const roiInfo = row[idx.roiInfo];
        // Determine primary ROI (highest total synapse count)
        let primaryRoi = '';
        if (roiInfo && typeof roiInfo === 'object') {
            let maxSyn = 0;
            for (const [roi, counts] of Object.entries(roiInfo)) {
                const total = (counts.pre || 0) + (counts.post || 0);
                if (total > maxSyn) {
                    maxSyn = total;
                    primaryRoi = roi;
                }
            }
        }

        return {
            bodyId: row[idx.bodyId],
            type: row[idx.type] || 'unknown',
            instance: row[idx.instance] || '',
            pre: row[idx.pre] || 0,
            post: row[idx.post] || 0,
            somaLocation: row[idx.somaLocation],
            region: primaryRoi,
        };
    });
}
