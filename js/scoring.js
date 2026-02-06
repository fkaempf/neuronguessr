/**
 * Scoring module for NeuronGuessr.
 *
 * Location: exponential decay on 3D distance (max 5000).
 * Synapses: exponential decay on log-ratio (max 5000).
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
 * Formula: 5000 * exp(-(3.5 * d / D)^2)
 *   d = 0      -> 5000 (perfect)
 *   d = D/10   -> 4,423
 *   d = D/5    -> 3,063
 *   d = 0.3D   -> 1,661
 *   d = D/2    -> 234
 */
export function computeLocationScore(guess, answer, maxDistance) {
    const distance = euclideanDistance(guess, answer);
    const k = 3.5;
    const r = k * distance / maxDistance;
    const score = Math.round(MAX_LOCATION_POINTS * Math.exp(-(r * r)));
    return { score, distance };
}

/**
 * Compute synapse count score.
 *
 * Uses log-ratio so being 2x off costs the same whether the neuron
 * has 100 or 100,000 synapses.
 *
 * Formula: 5000 * exp(-1.5 * |ln(guess / actual)|)
 *   exact  -> 5000
 *   2x off -> ~1770
 *   3x off -> ~960
 *   5x off -> ~360
 *   10x off -> ~160
 */
export function computeSynapseScore(guess, actual) {
    if (guess <= 0 || actual <= 0) return { score: 0, ratio: Infinity };
    const logRatio = Math.abs(Math.log(guess / actual));
    const score = Math.round(MAX_SYNAPSE_POINTS * Math.exp(-1.5 * logRatio));
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
