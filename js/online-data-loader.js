/**
 * Online data loader for NeuronGuessr.
 *
 * Drop-in replacement for data-loader.js functions when in online mode.
 * Queries neuPrint live for random neurons instead of loading static files.
 *
 * Brain meshes are still loaded from static files (they don't change).
 */

import { queryRandomNeurons, fetchSkeleton, setToken } from './neuprint-client.js';
import { parseSkeletonToNeuron } from './swc-parser.js';

// Dataset constants (same as in the static manifest)
const BRAIN_BOUNDS = {
    min: [4096.0, 5376.0, 8640.0],
    max: [92664.0, 68864.0, 134528.0],
};
const MAX_DISTANCE = 166501.67;

/**
 * Generate a manifest by querying neuPrint for random neurons.
 *
 * @param {string} token - Auth token (neuPrint API token or Google JWT)
 * @param {number} poolSize - How many neurons to query (default 30)
 * @returns {Promise<Object>} - Manifest-shaped object compatible with GameState
 */
export async function loadOnlineManifest(token, poolSize = 30) {
    setToken(token);

    const neurons = await queryRandomNeurons(poolSize);

    const manifestNeurons = neurons.map(n => ({
        file: `online_${n.bodyId}`,  // synthetic key for GameState dedup
        bodyId: n.bodyId,
        id: n.bodyId,
        type: n.type,
        region: n.region,
        nodeCount: 0,    // unknown until skeleton fetched
        _metadata: n,     // full metadata for skeleton parsing
    }));

    return {
        count: manifestNeurons.length,
        neurons: manifestNeurons,
        brainBounds: BRAIN_BOUNDS,
        maxDistance: MAX_DISTANCE,
    };
}

/**
 * Fetch and parse a single neuron by body ID from neuPrint.
 *
 * @param {Object} neuronEntry - Entry from manifest.neurons (has bodyId and _metadata)
 * @returns {Promise<Object>} - Neuron data matching the app's interface
 */
export async function loadOnlineNeuron(neuronEntry) {
    const skeletonResp = await fetchSkeleton(neuronEntry.bodyId);

    // neuPrint may return { data: [[...], ...] } or a flat array
    let rows;
    if (skeletonResp && skeletonResp.data && Array.isArray(skeletonResp.data)) {
        rows = skeletonResp.data;
    } else if (Array.isArray(skeletonResp)) {
        rows = skeletonResp;
    } else {
        throw new Error(`Unexpected skeleton format for bodyId ${neuronEntry.bodyId}`);
    }

    return parseSkeletonToNeuron(rows, neuronEntry._metadata);
}
