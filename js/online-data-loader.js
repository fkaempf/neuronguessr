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
import { PROXY_BASE, DVID_BASE, DVID_NODE } from './config.js';

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
 * Load the daily challenge manifest from the backend.
 *
 * @param {string} token - Auth token for skeleton/mesh fetching
 * @returns {Promise<Object>} - Manifest-shaped object
 */
export async function loadDailyManifest(token) {
    setToken(token);

    const resp = await fetch(`${PROXY_BASE}/api/daily`);
    if (!resp.ok) {
        const text = await resp.text();
        throw new Error(`Daily challenge failed (${resp.status}): ${text}`);
    }

    const { date, neurons } = await resp.json();

    const manifestNeurons = neurons.map(n => ({
        file: `daily_${date}_${n.bodyId}`,
        bodyId: n.bodyId,
        id: n.bodyId,
        type: n.type,
        region: n.region,
        nodeCount: 0,
        _metadata: n,
    }));

    return {
        count: manifestNeurons.length,
        neurons: manifestNeurons,
        brainBounds: BRAIN_BOUNDS,
        maxDistance: MAX_DISTANCE,
        date,
    };
}

/**
 * Fetch and parse a single neuron by body ID from neuPrint.
 * Also attempts to fetch the 3D mesh from DVID (falls back to skeleton-only).
 *
 * @param {Object} neuronEntry - Entry from manifest.neurons (has bodyId and _metadata)
 * @returns {Promise<Object>} - Neuron data matching the app's interface
 */
export async function loadOnlineNeuron(neuronEntry) {
    // Fetch skeleton and mesh in parallel
    const [skeletonResp, meshData] = await Promise.all([
        fetchSkeleton(neuronEntry.bodyId),
        fetchNeuronMesh(neuronEntry.bodyId),
    ]);

    // neuPrint may return { columns, data: [[...], ...] } or a flat array
    let rows;
    let columns = null;
    if (skeletonResp && skeletonResp.data && Array.isArray(skeletonResp.data)) {
        rows = skeletonResp.data;
        columns = skeletonResp.columns || null;
    } else if (Array.isArray(skeletonResp)) {
        rows = skeletonResp;
    } else {
        throw new Error(`Unexpected skeleton format for bodyId ${neuronEntry.bodyId}`);
    }

    const neuronData = parseSkeletonToNeuron(rows, neuronEntry._metadata, columns);

    // Attach mesh if available (vertices already in 8nm voxel units)
    if (meshData) {
        neuronData.mesh = meshData;
    }

    return neuronData;
}

/**
 * Fetch a neuron mesh from DVID in neuroglancer .ngmesh format.
 * Returns null if mesh is not available.
 *
 * @param {number} bodyId
 * @returns {Promise<{vertices: Float32Array, indices: Uint32Array}|null>}
 */
async function fetchNeuronMesh(bodyId) {
    try {
        const url = `${DVID_BASE}/api/node/${DVID_NODE}/segmentation_meshes/key/${bodyId}.ngmesh`;
        const resp = await fetch(url);
        if (!resp.ok) return null;
        const buffer = await resp.arrayBuffer();
        return parseNgMesh(buffer);
    } catch {
        return null;
    }
}

/**
 * Parse neuroglancer .ngmesh binary format.
 * Format: int32 vertexCount, then vertexCount*3 float32 vertices (nanometers),
 * then remaining int32s are triangle face indices.
 * Converts vertices from nanometers to 8nm voxel units.
 */
function parseNgMesh(buffer) {
    if (buffer.byteLength < 4) return null;

    const view = new DataView(buffer);
    const nVerts = view.getUint32(0, true);

    const vertexByteOffset = 4;
    const vertexByteLength = nVerts * 3 * 4;
    if (buffer.byteLength < vertexByteOffset + vertexByteLength) return null;

    // Read vertices (nanometers) and convert to 8nm voxel units
    const rawVerts = new Float32Array(buffer, vertexByteOffset, nVerts * 3);
    const vertices = new Float32Array(nVerts * 3);
    for (let i = 0; i < rawVerts.length; i++) {
        vertices[i] = rawVerts[i] / 8;
    }

    const indexByteOffset = vertexByteOffset + vertexByteLength;
    const nIndices = (buffer.byteLength - indexByteOffset) / 4;
    if (nIndices < 3) return null;
    const indices = new Uint32Array(buffer, indexByteOffset, nIndices);

    return { vertices, indices };
}
