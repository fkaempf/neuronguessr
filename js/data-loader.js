/**
 * Data loading module. Fetches preprocessed neuron and brain mesh data.
 */

const DATA_BASE = 'data/';

/**
 * Load the neuron manifest.
 * @returns {Promise<Object>}
 */
export async function loadManifest() {
    const resp = await fetch(`${DATA_BASE}neurons/manifest.json`);
    if (!resp.ok) throw new Error(`Failed to load manifest: ${resp.status}`);
    return resp.json();
}

/**
 * Load a single neuron skeleton.
 * @param {string} filename - e.g. "neuron_42.json"
 * @returns {Promise<Object>}
 */
export async function loadNeuron(filename) {
    const resp = await fetch(`${DATA_BASE}neurons/${filename}`);
    if (!resp.ok) throw new Error(`Failed to load neuron ${filename}: ${resp.status}`);
    return resp.json();
}

/**
 * Load neuropil config (ROI names, colors, file paths).
 * @returns {Promise<Object>}
 */
export async function loadNeuropilConfig() {
    const resp = await fetch(`${DATA_BASE}brain/neuropils.json`);
    if (!resp.ok) throw new Error(`Failed to load neuropil config: ${resp.status}`);
    return resp.json();
}

/**
 * Load an OBJ file as text.
 * @param {string} path - relative to data/, e.g. "brain/rois/ME_R.obj"
 * @returns {Promise<string>}
 */
export async function loadOBJText(path) {
    const resp = await fetch(`${DATA_BASE}${path}`);
    if (!resp.ok) throw new Error(`Failed to load OBJ ${path}: ${resp.status}`);
    return resp.text();
}
