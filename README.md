# NeuronGuessr

A web game inspired by [TimeGuessr](https://timeguessr.com/) for neurons in the *Drosophila* Male CNS connectome. You see a 3D neuron skeleton, rotate it, study its shape, then guess where in the brain it belongs by clicking on a 3D brain model.

## Setup

### 1. Get a neuPrint API token

1. Go to https://neuprint.janelia.org
2. Log in with your Google account
3. Click your account icon (top right) → **Auth Token**
4. Copy the token

### 2. Create conda environment and install dependencies

```bash
conda create -n neuronguessr python=3.11 -y
conda activate neuronguessr
pip install -r /Users/fkampf/Documents/neuronguessr/pipeline/requirements.txt
```

### 3. Set your API token

```bash
export NEUPRINT_APPLICATION_CREDENTIALS="your-token-here"
```

### 4. Run the data pipeline

```bash
python /Users/fkampf/Documents/neuronguessr/pipeline/fetch_brain_meshes.py
python /Users/fkampf/Documents/neuronguessr/pipeline/fetch_neurons.py
```

This fetches ~150 neuron skeletons and brain region meshes from neuPrint. It only needs to be run once.

### 5. Start the game

```bash
python -m http.server 8000 --directory /Users/fkampf/Documents/neuronguessr
```

Open http://localhost:8000 in your browser.

## How to play

1. You see a 3D neuron skeleton (drag to rotate, scroll to zoom)
2. Click on the 3D brain model to place your guess
3. Submit and see how close you were
4. 5 rounds per game, max 5,000 points per round (25,000 perfect score)
5. Scoring uses exponential decay on 3D Euclidean distance

## Data

Neuron data from the [Male CNS Connectome](https://male-cns.janelia.org/) (Janelia Research Campus), accessed via [neuPrint](https://neuprint.janelia.org).
# neuronguessr
