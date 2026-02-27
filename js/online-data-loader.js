/**
 * Data loader for NeuronGuessr.
 *
 * Loads neuron metadata from data/neuron-metadata.json (pre-computed lookup
 * of all game-eligible neurons in the dataset). Skeletons are fetched from
 * neuPrint via the worker's /api/skeleton/:bodyId endpoint (no user token
 * needed). 3D meshes come from DVID (public, no auth).
 */

import { parseSkeletonToNeuron } from './swc-parser.js';
import { PROXY_BASE, DVID_BASE, DVID_NODE } from './config.js';

// Dataset constants (same as in the static manifest)
const BRAIN_BOUNDS = {
    min: [4096.0, 5376.0, 8640.0],
    max: [92664.0, 68864.0, 134528.0],
};
const MAX_DISTANCE = 166501.67;

// Cached metadata (loaded once, reused across games)
let _metadataCache = null;
// Type → best neuron index (built once from metadata)
let _typeIndex = null;

/**
 * Load and cache the neuron metadata lookup.
 * @returns {Promise<Object>} - { count, typeCount, types, neurons }
 */
async function getMetadata() {
    if (_metadataCache) return _metadataCache;
    const resp = await fetch('data/neuron-metadata.json');
    if (!resp.ok) throw new Error(`Failed to load neuron metadata: ${resp.status}`);
    _metadataCache = await resp.json();

    // Build type → {bodyId, ...meta} index (one per type, highest synapse count)
    _typeIndex = {};
    for (const [bodyId, meta] of Object.entries(_metadataCache.neurons)) {
        const t = meta.type;
        const total = (meta.pre || 0) + (meta.post || 0);
        if (!_typeIndex[t] || total > (_typeIndex[t].pre || 0) + (_typeIndex[t].post || 0)) {
            _typeIndex[t] = { bodyId: parseInt(bodyId), ...meta };
        }
    }

    return _metadataCache;
}

// ---------- Seeded PRNG (mulberry32) — for deterministic daily selection ----------

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

// ---------- Manifest builders ----------

/**
 * Build a manifest-shaped object from selected neuron entries.
 */
function buildManifest(entries, date = null) {
    const manifestNeurons = entries.map(e => ({
        file: `meta_${e.bodyId}`,
        bodyId: e.bodyId,
        id: e.bodyId,
        type: e.type,
        region: e.region,
        nodeCount: 0,
        _metadata: e,
    }));

    const result = {
        count: manifestNeurons.length,
        neurons: manifestNeurons,
        brainBounds: BRAIN_BOUNDS,
        maxDistance: MAX_DISTANCE,
    };
    if (date) result.date = date;
    return result;
}

/**
 * Pick neurons from the pre-built type index for a given type list.
 */
function pickNeuronsFromTypes(types) {
    const entries = [];
    for (const type of types) {
        const entry = _typeIndex[type];
        if (entry) entries.push(entry);
    }
    return entries;
}

/**
 * Load the daily challenge manifest. Uses date-seeded PRNG to pick the
 * same 5 neurons for everyone on a given day.
 *
 * @returns {Promise<Object>} - Manifest-shaped object
 */
export async function loadDailyManifest() {
    const metadata = await getMetadata();
    const date = new Date().toISOString().split('T')[0];

    const rng = mulberry32(hashString(date));
    const shuffled = seededShuffle(metadata.types, rng);
    const selectedTypes = shuffled.slice(0, 5);

    const entries = pickNeuronsFromTypes(selectedTypes);
    if (entries.length < 5) {
        throw new Error(`Only resolved ${entries.length}/5 daily neurons`);
    }

    return buildManifest(entries, date);
}

/**
 * Load a free play manifest. Picks random neuron types from the metadata.
 *
 * @param {number} poolSize - How many neurons to include (default 30)
 * @returns {Promise<Object>} - Manifest-shaped object
 */
export async function loadFreeplayManifest(poolSize = 30) {
    const metadata = await getMetadata();

    // Shuffle types randomly and pick a pool
    const shuffled = [...metadata.types].sort(() => Math.random() - 0.5);
    const selectedTypes = shuffled.slice(0, poolSize);

    const entries = pickNeuronsFromTypes(selectedTypes);
    return buildManifest(entries);
}

// ---------- Single neuron loading ----------

/**
 * Fetch a neuron skeleton via the worker's proxy (no user token needed).
 */
async function fetchSkeletonViaProxy(bodyId) {
    const resp = await fetch(`${PROXY_BASE}/api/skeleton/${bodyId}`);
    if (!resp.ok) {
        throw new Error(`Skeleton fetch failed for ${bodyId}: ${resp.status}`);
    }
    return resp.json();
}

/**
 * Fetch and parse a single neuron by body ID.
 * Skeleton comes from the worker proxy; mesh from DVID (public).
 *
 * @param {Object} neuronEntry - Entry from manifest.neurons (has bodyId and _metadata)
 * @returns {Promise<Object>} - Neuron data matching the app's interface
 */
export async function loadOnlineNeuron(neuronEntry) {
    // Fetch skeleton and mesh in parallel
    const [skeletonResp, meshData] = await Promise.all([
        fetchSkeletonViaProxy(neuronEntry.bodyId),
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

// ---------- DVID mesh loading ----------

/**
 * Fetch a neuron mesh from DVID in neuroglancer .ngmesh format.
 * Returns null if mesh is not available.
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
