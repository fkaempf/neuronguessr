/**
 * Scoring module for NeuronGuessr.
 *
 * Location: exponential decay on 3D distance (max 5000).
 * Synapses: Gaussian on fourth-root distance (max 5000).
 * Total: 10,000 per round, 50,000 perfect game.
 */

export const MAX_LOCATION_POINTS = 5000;
export const MAX_SYNAPSE_POINTS = 5000;
export const MAX_POINTS = MAX_LOCATION_POINTS + MAX_SYNAPSE_POINTS;

/**
 * Compute 3D Euclidean distance between two points.
 */
export function euclideanDistance(a, b) {
    const dx = a[0] - b[0];
    const dy = a[1] - b[1];
    const dz = a[2] - b[2];
    return Math.sqrt(dx * dx + dy * dy + dz * dz);
}

/**
 * Compute location score.
 *
 * Gaussian curve - flat plateau near perfect, then drops off.
 * Formula: 5000 * exp(-(6.6 * d / D)^2)
 *   d = 0      -> 5000 (perfect)
 *   d = 75µm   -> 4,000
 *   d = 150µm  -> 2,060
 *   d = 250µm  -> 340
 *   d = 350µm  -> 12
 */
export function computeLocationScore(guess, answer, maxDistance) {
    const distance = euclideanDistance(guess, answer);
    const k = 6.6;
    const r = k * distance / maxDistance;
    const score = Math.round(MAX_LOCATION_POINTS * Math.exp(-(r * r)));
    return { score, distance };
}

/**
 * Compute synapse count score.
 *
 * Gaussian on fourth-root distance — absolute synapse count matters.
 * Being 2x off hurts more on a large neuron than a small one.
 *
 * Formula: 5000 * exp(-(|guess^0.25 - actual^0.25| / 3)^2)
 *
 *              100 syn   1K syn   10K syn   50K syn
 *   2x off      4800     4400     3360      2060
 *   3x off      4480     3520     1650       420
 *   5x off      3810     2110      330        10
 *   10x off     2550      600        6         0
 */
export function computeSynapseScore(guess, actual) {
    if (guess <= 0 || actual <= 0) return { score: 0, ratio: Infinity };
    const diff = Math.abs(Math.pow(guess, 0.25) - Math.pow(actual, 0.25));
    const k = 3;
    const score = Math.round(MAX_SYNAPSE_POINTS * Math.exp(-(diff / k) * (diff / k)));
    return { score, ratio: guess / actual };
}

/**
 * Mirror a position across the brain midline (X axis).
 */
export function mirrorX(pos, midlineX) {
    return [2 * midlineX - pos[0], pos[1], pos[2]];
}

/**
 * Compute combined score for a round.
 * Considers both the original answer and its hemisphere-mirrored version,
 * using whichever is closer to the guess (since hemisphere is hard to tell).
 */
export function computeScore(posGuess, posAnswer, maxDistance, synapseGuess, synapseActual, midlineX) {
    const loc = computeLocationScore(posGuess, posAnswer, maxDistance);

    let bestLoc = loc;
    let usedAnswer = posAnswer;

    if (midlineX != null) {
        const mirrored = mirrorX(posAnswer, midlineX);
        const locMirrored = computeLocationScore(posGuess, mirrored, maxDistance);
        if (locMirrored.score > loc.score) {
            bestLoc = locMirrored;
            usedAnswer = mirrored;
        }
    }

    const syn = computeSynapseScore(synapseGuess, synapseActual);
    return {
        locationScore: bestLoc.score,
        synapseScore: syn.score,
        score: bestLoc.score + syn.score,
        distance: bestLoc.distance,
        synapseRatio: syn.ratio,
        usedAnswer,
    };
}
