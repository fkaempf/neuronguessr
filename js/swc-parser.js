/**
 * Parse neuPrint skeleton responses into the NeuronGuessr neuron data format.
 *
 * neuPrint returns skeletons as SWC-like data:
 *   { columns: ["rowId","x","y","z","radius","link"], data: [[...], ...] }
 *
 * This module converts that into our app's format:
 *   { id, type, instance, region, pre, post, nodes, edges, centroid, soma, answer, bounds }
 *
 * Coordinates are in 8nm voxel units (same as the static neuron JSONs).
 * Downsampling logic mirrors pipeline/fetch_neurons.py.
 */

const MAX_NODES_BEFORE_DOWNSAMPLE = 1000;
const KEEP_EVERY_NTH = 5;

/**
 * Parse neuPrint skeleton response into the app's neuron data format.
 *
 * @param {Array<Array>} rows - SWC rows: [[rowId, x, y, z, radius, link], ...]
 * @param {Object} metadata - { bodyId, type, instance, pre, post, somaLocation, region }
 * @param {string[]|null} columns - Column names from the skeleton response
 * @returns {Object} Neuron data matching the app's interface
 */
export function parseSkeletonToNeuron(rows, metadata, columns = null) {
    if (!rows || rows.length === 0) {
        throw new Error(`Empty skeleton data for bodyId ${metadata.bodyId}`);
    }

    let nodes, edges;

    if (rows.length > MAX_NODES_BEFORE_DOWNSAMPLE) {
        ({ nodes, edges } = _downsampleSkeleton(rows));
    } else {
        ({ nodes, edges } = _buildFullSkeleton(rows));
    }

    // Compute geometric properties
    let sumX = 0, sumY = 0, sumZ = 0;
    let minX = Infinity, minY = Infinity, minZ = Infinity;
    let maxX = -Infinity, maxY = -Infinity, maxZ = -Infinity;

    for (const [x, y, z] of nodes) {
        sumX += x; sumY += y; sumZ += z;
        if (x < minX) minX = x;
        if (y < minY) minY = y;
        if (z < minZ) minZ = z;
        if (x > maxX) maxX = x;
        if (y > maxY) maxY = y;
        if (z > maxZ) maxZ = z;
    }

    const n = nodes.length;
    const centroid = [
        Math.round((sumX / n) * 10) / 10,
        Math.round((sumY / n) * 10) / 10,
        Math.round((sumZ / n) * 10) / 10,
    ];

    // Find soma: try somaLocation metadata (converted to skeleton coords), then skeleton heuristics
    const soma = _findSoma(rows, columns, metadata.somaLocation, { minX, minY, minZ, maxX, maxY, maxZ });

    // Answer position: soma if available, else centroid
    const answer = soma ? [...soma] : [...centroid];

    return {
        id: metadata.bodyId,
        type: metadata.type || 'unknown',
        instance: metadata.instance || '',
        region: metadata.region || '',
        pre: metadata.pre || 0,
        post: metadata.post || 0,
        nodes,
        edges,
        centroid,
        soma,
        answer,
        bounds: {
            min: [minX, minY, minZ],
            max: [maxX, maxY, maxZ],
        },
    };
}

/**
 * Build full skeleton without downsampling.
 */
function _buildFullSkeleton(rows) {
    const rowIdToIdx = new Map();
    const nodes = [];

    for (let i = 0; i < rows.length; i++) {
        const [rowId, x, y, z] = rows[i];
        rowIdToIdx.set(rowId, i);
        nodes.push([x, y, z]);
    }

    const edges = [];
    for (const [rowId, x, y, z, radius, link] of rows) {
        if (link >= 0 && rowIdToIdx.has(link)) {
            edges.push([rowIdToIdx.get(link), rowIdToIdx.get(rowId)]);
        }
    }

    return { nodes, edges };
}

/**
 * Downsample skeleton keeping topology (branch points, tips, root, every Nth node).
 * Mirrors the logic in pipeline/fetch_neurons.py fetch_and_simplify_skeleton().
 */
function _downsampleSkeleton(rows) {
    // Build lookup structures
    const parentCounts = new Map(); // parentId -> child count
    const allParents = new Set();
    const rootIds = new Set();
    const linkMap = new Map(); // rowId -> link (parent)

    for (const [rowId, x, y, z, radius, link] of rows) {
        linkMap.set(rowId, link);
        if (link === -1) {
            rootIds.add(rowId);
        } else {
            allParents.add(link);
            parentCounts.set(link, (parentCounts.get(link) || 0) + 1);
        }
    }

    // Branch points: nodes with >1 child
    const branchPoints = new Set();
    for (const [id, count] of parentCounts) {
        if (count > 1) branchPoints.add(id);
    }

    // Tips: nodes that are never referenced as a parent
    const allNodeIds = new Set(rows.map(r => r[0]));
    const tips = new Set();
    for (const id of allNodeIds) {
        if (!allParents.has(id)) tips.add(id);
    }

    // Build keep set
    const keepIds = new Set([...branchPoints, ...tips, ...rootIds]);
    for (let i = 0; i < rows.length; i += KEEP_EVERY_NTH) {
        keepIds.add(rows[i][0]);
    }

    // Build kept rows with new indices
    const keptRows = rows.filter(r => keepIds.has(r[0]));
    const newIdToIdx = new Map();
    const nodes = [];

    for (let i = 0; i < keptRows.length; i++) {
        const [rowId, x, y, z] = keptRows[i];
        newIdToIdx.set(rowId, i);
        nodes.push([x, y, z]);
    }

    // Remap parent links — walk up tree to find nearest kept ancestor
    const edges = [];
    for (const [rowId, x, y, z, radius, link] of keptRows) {
        let parent = link;
        while (parent !== -1 && !keepIds.has(parent)) {
            parent = linkMap.get(parent) ?? -1;
        }
        if (parent !== -1 && newIdToIdx.has(parent)) {
            edges.push([newIdToIdx.get(parent), newIdToIdx.get(rowId)]);
        }
    }

    return { nodes, edges };
}

/**
 * Find soma position using multiple strategies in priority order:
 * 1. somaLocation metadata from neuPrint, snapped to nearest skeleton node
 * 2. SWC type column (type=1 is soma in standard SWC format)
 * 3. Node with largest radius (soma is typically the thickest part)
 * 4. Root node (link = -1)
 */
function _findSoma(rows, columns, somaLocation, bounds) {
    if (!rows || rows.length === 0) return null;

    // Build column index map
    const colIdx = {};
    if (columns) {
        columns.forEach((c, i) => colIdx[c.toLowerCase()] = i);
    }
    // Default column positions if no column info
    const iX = colIdx['x'] ?? 1;
    const iY = colIdx['y'] ?? 2;
    const iZ = colIdx['z'] ?? 3;
    const iRadius = colIdx['radius'] ?? 4;
    const iLink = colIdx['link'] ?? 5;
    const iType = colIdx['type'] ?? -1; // may not exist

    // Strategy 1: somaLocation metadata — snap to nearest skeleton node
    const somaCoord = _parseSomaLocation(somaLocation);
    if (somaCoord) {
        // Try the raw coords and also divided by 8 (nm → voxel)
        for (const scale of [1, 1 / 8]) {
            const sx = somaCoord[0] * scale;
            const sy = somaCoord[1] * scale;
            const sz = somaCoord[2] * scale;

            // Check if this is within reasonable range of skeleton bounds
            const margin = Math.max(
                bounds.maxX - bounds.minX,
                bounds.maxY - bounds.minY,
                bounds.maxZ - bounds.minZ
            );
            if (sx < bounds.minX - margin || sx > bounds.maxX + margin ||
                sy < bounds.minY - margin || sy > bounds.maxY + margin ||
                sz < bounds.minZ - margin || sz > bounds.maxZ + margin) {
                continue;
            }

            // Snap to nearest skeleton node
            let bestDist = Infinity;
            let bestNode = null;
            for (const row of rows) {
                const dx = row[iX] - sx;
                const dy = row[iY] - sy;
                const dz = row[iZ] - sz;
                const d = dx * dx + dy * dy + dz * dz;
                if (d < bestDist) {
                    bestDist = d;
                    bestNode = [row[iX], row[iY], row[iZ]];
                }
            }
            if (bestNode) return bestNode;
        }
    }

    // Strategy 2: SWC type column (type=1 is soma)
    if (iType >= 0) {
        for (const row of rows) {
            if (row[iType] === 1) return [row[iX], row[iY], row[iZ]];
        }
    }

    // Strategy 3: node with largest radius (soma tends to be thickest)
    let bestRadiusNode = null;
    let bestRadius = 0;
    for (const row of rows) {
        const r = row[iRadius];
        if (r > bestRadius) {
            bestRadius = r;
            bestRadiusNode = [row[iX], row[iY], row[iZ]];
        }
    }
    if (bestRadiusNode && bestRadius > 0) return bestRadiusNode;

    // Strategy 4: root node (link = -1)
    for (const row of rows) {
        if (row[iLink] === -1) return [row[iX], row[iY], row[iZ]];
    }

    return null;
}

/**
 * Parse somaLocation from various neuPrint formats.
 */
function _parseSomaLocation(somaLocation) {
    if (!somaLocation) return null;

    if (typeof somaLocation === 'string') {
        try { somaLocation = JSON.parse(somaLocation); }
        catch { return null; }
    }

    if (Array.isArray(somaLocation) && somaLocation.length >= 3) {
        return [somaLocation[0], somaLocation[1], somaLocation[2]];
    }

    if (typeof somaLocation === 'object' && somaLocation.x !== undefined) {
        return [somaLocation.x, somaLocation.y, somaLocation.z];
    }

    return null;
}
