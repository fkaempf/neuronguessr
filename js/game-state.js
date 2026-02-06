/**
 * Game state machine for NeuronGuessr.
 * Manages rounds, neuron selection, guesses, and scoring.
 */

import { computeScore } from './scoring.js';

export const ROUNDS_PER_GAME = 5;

export class GameState {
    constructor() {
        this._seenNeuronFiles = new Set(); // tracks across games to avoid repeats
        this.reset();
    }

    reset() {
        this.currentRound = 0;
        this.roundScores = [];
        this.totalScore = 0;
        this.selectedNeurons = [];
        this.currentGuess = null;
        this.currentSynapseGuess = null;
        this.phase = 'start'; // start | guessing | result | final
    }

    /**
     * Start a new game. Picks neurons not yet seen; resets pool when exhausted.
     * @param {Array} neurons - manifest.neurons array
     */
    startNewGame(neurons) {
        this.reset();

        // Filter out already-seen neurons
        let available = neurons.filter(n => !this._seenNeuronFiles.has(n.file));

        // If not enough unseen neurons remain, reset the pool
        if (available.length < ROUNDS_PER_GAME) {
            this._seenNeuronFiles.clear();
            available = [...neurons];
        }

        // Shuffle and pick
        const shuffled = available.sort(() => Math.random() - 0.5);
        this.selectedNeurons = shuffled.slice(0, ROUNDS_PER_GAME);

        // Mark as seen
        for (const n of this.selectedNeurons) {
            this._seenNeuronFiles.add(n.file);
        }

        this.phase = 'guessing';
    }

    getCurrentNeuronFile() {
        return this.selectedNeurons[this.currentRound].file;
    }

    getCurrentNeuronMeta() {
        return this.selectedNeurons[this.currentRound];
    }

    /**
     * Record player's position guess.
     */
    setGuess(position) {
        this.currentGuess = position;
    }

    /**
     * Record player's synapse count guess.
     */
    setSynapseGuess(count) {
        this.currentSynapseGuess = count;
    }

    /**
     * Submit the current round. Computes combined score.
     * Considers both hemispheres (original + mirrored) and uses the closer one.
     * @param {number[]} answerPosition - [x, y, z]
     * @param {number} maxDistance - brain diagonal
     * @param {number} actualSynapses - total synapse count
     * @param {number} midlineX - brain midline X for hemisphere mirroring
     * @returns {Object} round result
     */
    submitRound(answerPosition, maxDistance, actualSynapses, midlineX) {
        const result = computeScore(
            this.currentGuess, answerPosition, maxDistance,
            this.currentSynapseGuess, actualSynapses, midlineX
        );

        this.roundScores.push({
            score: result.score,
            locationScore: result.locationScore,
            synapseScore: result.synapseScore,
            distance: result.distance,
            synapseGuess: this.currentSynapseGuess,
            synapseActual: actualSynapses,
            guess: [...this.currentGuess],
            answer: [...result.usedAnswer],
            neuronMeta: this.getCurrentNeuronMeta(),
        });

        this.totalScore += result.score;
        this.phase = 'result';
        return result;
    }

    nextRound() {
        this.currentRound++;
        this.currentGuess = null;
        this.currentSynapseGuess = null;

        if (this.currentRound >= ROUNDS_PER_GAME) {
            this.phase = 'final';
            return 'final';
        }

        this.phase = 'guessing';
        return 'guessing';
    }

    isGameOver() {
        return this.currentRound >= ROUNDS_PER_GAME - 1 && this.phase === 'result';
    }
}
