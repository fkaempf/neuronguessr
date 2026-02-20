# NeuronGuessr

A [GeoGuessr](https://www.geoguessr.com/)-inspired web game where you identify neurons in the *Drosophila* fly brain. View a 3D neuron skeleton, study its shape, then guess where in the brain it belongs and how many synapses it has.

Neuron data is fetched live from [neuPrint](https://neuprint.janelia.org) — players provide their own free API token to play.

## How to Play

1. You see a 3D neuron skeleton — drag to rotate, scroll to zoom.
2. Click on the 3D brain model to place your location guess. Use Shift+scroll to adjust depth.
3. Use the synapse slider to estimate the neuron's total synapse count.
4. Submit your guess and see how close you were.
5. Play 5 rounds per game. Each round scores up to **10,000 points** (5,000 for location accuracy + 5,000 for synapse estimate), for a perfect game total of **50,000**.

## Setup

### 1. Deploy the CORS Proxy

The `cors-proxy/` directory contains a Cloudflare Worker that proxies neuPrint API requests with CORS headers (needed because neuPrint doesn't serve them).

```bash
cd cors-proxy
npx wrangler deploy
```

Note your deployed worker URL (e.g., `https://neuprint-proxy.your-subdomain.workers.dev`).

### 2. Configure the App

```bash
cp js/config.example.js js/config.js
```

Edit `js/config.js`:

| Key | Description |
|-----|-------------|
| `PROXY_BASE` | Your deployed CORS proxy URL |
| `DATASET` | neuPrint dataset identifier (default: `male-cns:v0.9`) |

`js/config.js` is gitignored so secrets are not committed.

### 3. Deploy

NeuronGuessr is a pure static site (HTML, JS, CSS) with no build step.

**GitHub Pages:**

```bash
git push origin main
# Enable Pages in repo Settings -> Pages -> Source: main branch
```

**Netlify / Vercel:**

- Connect your repo, no build command needed, publish directory: `/` (root)

**Local development:**

```bash
python -m http.server 8000
```

### 4. Play

Players get their own neuPrint API token by visiting [neuprint.janelia.org](https://neuprint.janelia.org), signing in with Google, and copying the token from their account menu. They paste it on the start screen to begin playing.

## Data Pipeline (Optional)

The brain meshes used for the 3D viewer are included in the repository. To refresh them:

```bash
pip install -r pipeline/requirements.txt
export NEUPRINT_APPLICATION_CREDENTIALS="your-neuprint-token"
python pipeline/fetch_brain_meshes.py
```

## Data Attribution

Neuron data from the [Male CNS Connectome](https://male-cns.janelia.org/) (Janelia Research Campus), accessed via [neuPrint](https://neuprint.janelia.org).
