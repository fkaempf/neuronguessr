/**
 * NeuronGuessr configuration.
 *
 * Copy this file to config.js and fill in your deployment values.
 *
 *   cp js/config.example.js js/config.js
 */

/** Base URL of your deployed CORS proxy (Cloudflare Worker) for neuPrint API requests. */
export const PROXY_BASE = 'https://neuprint-proxy.neuronguessr.workers.dev';

/** neuPrint dataset identifier. */
export const DATASET = 'male-cns:v0.9';

/** DVID server for neuron mesh data (public, CORS-enabled, no auth needed). */
export const DVID_BASE = 'https://emdata-mcns.janelia.org';

/** DVID node UUID for the v0.9 snapshot (647K+ precomputed meshes). */
export const DVID_NODE = '79f9a4cb54b0';
