# NeuronGuessr

A web game inspired by [GeoGuessr](https://www.geoguessr.com/) and [TimeGuessr](https://timeguessr.com/) where you identify neurons in the *Drosophila* (fruit fly) brain. Study a 3D neuron mesh, guess where in the brain it belongs and how many synapses it has.

**[Play now](https://fkaempf.github.io/neuronguessr/)** (requires a free neuPrint API token)

## How It Works

1. You see a 3D neuron — drag to rotate, scroll to zoom.
2. Click on the brain model to place your location guess. Shift+scroll adjusts depth.
3. Use the slider to estimate total synapse count.
4. Submit and see how close you were.
5. Five rounds per game, up to **10,000 points** per round (5,000 location + 5,000 synapses), **50,000** for a perfect game.

## Where the Data Comes From

| What | Source | Auth |
|------|--------|------|
| Neuron metadata & synapse counts | [neuPrint](https://neuprint.janelia.org) REST API (Cypher queries) | Bearer token (player-provided) |
| 3D neuron meshes | [DVID](https://github.com/janelia-flyem/dvid) — neuroglancer `.ngmesh` format | None (public, CORS-enabled) |
| Brain neuropil meshes | Static OBJ/PLY files from the Male CNS dataset | None (bundled) |

Neuron selection uses type-balanced sampling (random types first, then one random neuron per type) to avoid bias towards the most numerous cell types.

## Tech Stack

- **Three.js** for all 3D rendering (neuron meshes, brain neuropils, guess markers)
- **Vanilla JS** with ES modules via `<script type="importmap">` — no build step, no framework
- **Cloudflare Worker** as a CORS proxy for neuPrint (which doesn't serve CORS headers)
- DVID is accessed directly from the browser (it supports CORS natively)

## Setup (Self-Hosting)

### 1. Deploy the CORS Proxy

The `cors-proxy/` directory contains a Cloudflare Worker that proxies neuPrint API requests.

```bash
cd cors-proxy
npx wrangler deploy
```

Note your deployed URL (e.g., `https://neuprint-proxy.your-subdomain.workers.dev`).

### 2. Configure

```bash
cp js/config.example.js js/config.js
```

Edit `js/config.js`:

| Key | Description |
|-----|-------------|
| `PROXY_BASE` | Your deployed CORS proxy URL |
| `DATASET` | neuPrint dataset (default: `male-cns:v0.9`) |
| `DVID_BASE` | DVID server URL (default: `https://emdata-mcns.janelia.org`) |
| `DVID_NODE` | DVID node UUID for precomputed meshes (default: `79f9a4cb54b0`, the v0.9 snapshot with 647K+ meshes) |

`js/config.js` is gitignored.

### 3. Serve

NeuronGuessr is a static site — any web server works.

```bash
# Local development
python -m http.server 8000

# GitHub Pages: enable in repo Settings -> Pages -> Source: main branch
# Netlify / Vercel: no build command, publish directory: /
```

### 4. Get a Token and Play

Visit [neuprint.janelia.org/account](https://neuprint.janelia.org/account), sign in with Google, copy the auth token, and paste it on the start screen.

## Project Structure

```
index.html              Single-page app entry point
css/style.css           All styles
js/
  main.js               Game controller & UI logic
  auth.js               Token management (session storage)
  brain-viewer.js       3D brain + neuropil viewer (Three.js)
  neuron-viewer.js      3D neuron viewer with scale bar
  neuprint-client.js    neuPrint REST API client
  online-data-loader.js Fetches neurons (neuPrint) & meshes (DVID)
  swc-parser.js         SWC skeleton format parser
  data-loader.js        Static data loader (brain meshes, neuropil config)
  scoring.js            Scoring formulas
  game-state.js         Round/score state management
  ui.js                 DOM helpers
  config.js             Deployment config (gitignored)
cors-proxy/
  worker.js             Cloudflare Worker CORS proxy
data/                   Static brain mesh files (OBJ/PLY)
assets/                 Static assets
pipeline/               Scripts to refresh brain mesh data
```

## Data Attribution

Neuron data from the [Male CNS Connectome](https://male-cns.janelia.org/) (Janelia Research Campus), accessed via [neuPrint](https://neuprint.janelia.org) and [DVID](https://emdata-mcns.janelia.org).
