#!/usr/bin/env python3
"""Fetch and preprocess neuron skeletons from neuPrint for NeuronGuessr.

Usage:
    export NEUPRINT_APPLICATION_CREDENTIALS="your-token-here"
    python fetch_neurons.py

Outputs:
    ../data/neurons/neuron_*.json  - Individual neuron skeleton files
    ../data/neurons/manifest.json  - Index of all neurons + brain bounds
"""

import json
import os
import sys

import numpy as np
import pandas as pd
from neuprint import Client, NeuronCriteria as NC, fetch_neurons

# --- Configuration ---
NEUPRINT_SERVER = "neuprint.janelia.org"
DATASET = "male-cns:v0.9"
OUTPUT_DIR = os.path.join(os.path.dirname(__file__), "..", "data", "neurons")
VOXEL_TO_UM = 8.0 / 1000.0  # 8nm voxels -> micrometers
TARGET_NEURONS = 150


def connect():
    """Connect to neuPrint."""
    token = os.environ.get("NEUPRINT_APPLICATION_CREDENTIALS")
    if not token:
        print("ERROR: Set NEUPRINT_APPLICATION_CREDENTIALS environment variable")
        print("Get your token from: https://neuprint.janelia.org")
        sys.exit(1)
    return Client(NEUPRINT_SERVER, dataset=DATASET, token=token)


def curate_neuron_list(client):
    """Select ~150 diverse, visually interesting neurons across brain regions."""
    print("Querying neuron database for candidates...")

    primary_rois = client.primary_rois
    print(f"  Found {len(primary_rois)} primary ROIs")

    all_selected = []

    for roi in sorted(primary_rois):
        # Skip 'unspecified' catch-all ROIs
        if "unspecified" in roi.lower():
            continue

        try:
            neurons_df, roi_counts = fetch_neurons(
                NC(
                    inputRois=[roi],
                    outputRois=[roi],
                    status="Traced",
                    min_pre=20,
                    min_post=20,
                ),
                client=client,
            )

            if len(neurons_df) == 0:
                continue

            # Prefer neurons with type annotations
            typed = neurons_df[neurons_df["type"].notna()]
            pool = typed if len(typed) >= 5 else neurons_df

            # Sample from different size quartiles for morphological diversity
            pool = pool.copy()
            pool["total_syn"] = pool["pre"] + pool["post"]
            pool = pool.sort_values("total_syn")

            # Take up to 3 per ROI, spread across size range
            n_take = min(3, len(pool))
            indices = np.linspace(0, len(pool) - 1, n_take, dtype=int)
            sampled = pool.iloc[indices].copy()
            sampled["primary_roi"] = roi

            all_selected.append(sampled)
            print(f"  {roi}: selected {len(sampled)} from {len(neurons_df)} candidates")
        except Exception as e:
            print(f"  {roi}: ERROR - {e}")

    if not all_selected:
        print("ERROR: No neurons selected!")
        sys.exit(1)

    combined = pd.concat(all_selected, ignore_index=True)

    # Remove duplicates (neurons can appear in multiple ROIs)
    combined = combined.drop_duplicates(subset="bodyId")

    # If we have more than target, subsample keeping regional balance
    if len(combined) > TARGET_NEURONS:
        combined = combined.sample(n=TARGET_NEURONS, random_state=42)

    print(f"\nTotal curated neurons: {len(combined)}")
    return combined


def fetch_and_simplify_skeleton(body_id, client):
    """Fetch a skeleton from neuPrint and simplify it for web display.

    Returns a DataFrame with columns [rowId, x, y, z, radius, link] or None.
    The 'link' column is the parent rowId (-1 for root).
    """
    try:
        skel = client.fetch_skeleton(body_id, format="pandas")
        if skel is None or len(skel) == 0:
            return None

        # Downsample: keep every Nth node while preserving branch points and tips.
        # Simple approach: subsample but keep topology via parent remapping.
        if len(skel) > 1000:
            # Find branch points and tips (nodes referenced as parent more than once = branch)
            parent_counts = skel["link"].value_counts()
            branch_points = set(parent_counts[parent_counts > 1].index.tolist())
            # Tips: nodes that are never a parent
            all_parents = set(skel["link"].tolist())
            all_nodes = set(skel["rowId"].tolist())
            tips = all_nodes - all_parents
            # Root
            root = set(skel[skel["link"] == -1]["rowId"].tolist())

            keep = branch_points | tips | root

            # Also keep every 5th node for even coverage
            keep_indices = set(range(0, len(skel), 5))
            for idx in keep_indices:
                keep.add(skel.iloc[idx]["rowId"])

            skel_small = skel[skel["rowId"].isin(keep)].copy()

            # Remap parent links: for each kept node, find nearest kept ancestor
            kept_set = set(skel_small["rowId"].tolist())
            row_to_link = dict(zip(skel["rowId"], skel["link"]))

            new_links = []
            for _, row in skel_small.iterrows():
                parent = row["link"]
                # Walk up the tree until we find a kept node or root
                while parent != -1 and parent not in kept_set:
                    parent = row_to_link.get(parent, -1)
                new_links.append(parent)

            skel_small["link"] = new_links
            return skel_small
        else:
            return skel

    except Exception as e:
        print(f"    Failed to fetch skeleton for {body_id}: {e}")
        return None


def skeleton_to_json(skel_df, metadata):
    """Convert a skeleton DataFrame to a compact JSON dict.

    Skeleton columns: rowId, x, y, z, radius, link
    Coordinates are in 8nm voxel units, we keep them as-is since
    the brain meshes from fetch_roi_mesh are also in voxel units.
    """
    # Build indexed node list (keep in voxel units to match OBJ meshes)
    row_ids = skel_df["rowId"].values
    row_id_to_idx = {int(rid): i for i, rid in enumerate(row_ids)}

    nodes = []
    for _, row in skel_df.iterrows():
        nodes.append([round(float(row["x"]), 1),
                       round(float(row["y"]), 1),
                       round(float(row["z"]), 1)])

    # Build edge list from parent links
    edges = []
    for _, row in skel_df.iterrows():
        parent_id = int(row["link"])
        if parent_id >= 0 and parent_id in row_id_to_idx:
            parent_idx = row_id_to_idx[parent_id]
            child_idx = row_id_to_idx[int(row["rowId"])]
            edges.append([parent_idx, child_idx])

    coords = np.array(nodes)
    centroid = coords.mean(axis=0).tolist()

    # Soma location from neuron metadata
    soma = None
    soma_loc = metadata.get("somaLocation")
    if soma_loc is not None and isinstance(soma_loc, (list, tuple)) and len(soma_loc) >= 3:
        soma = [round(float(soma_loc[0]), 1),
                round(float(soma_loc[1]), 1),
                round(float(soma_loc[2]), 1)]
    elif isinstance(soma_loc, dict) and "x" in soma_loc:
        soma = [round(float(soma_loc["x"]), 1),
                round(float(soma_loc["y"]), 1),
                round(float(soma_loc["z"]), 1)]

    # Answer position: soma if available, else centroid
    answer = soma if soma else [round(c, 1) for c in centroid]

    bounds_min = coords.min(axis=0).tolist()
    bounds_max = coords.max(axis=0).tolist()

    body_id = int(metadata.get("bodyId", 0))

    return {
        "id": body_id,
        "type": str(metadata.get("type", "unknown")),
        "instance": str(metadata.get("instance", "")),
        "region": str(metadata.get("primary_roi", "")),
        "pre": int(metadata.get("pre", 0)),
        "post": int(metadata.get("post", 0)),
        "nodes": nodes,
        "edges": edges,
        "centroid": [round(c, 1) for c in centroid],
        "soma": soma,
        "answer": answer,
        "bounds": {"min": bounds_min, "max": bounds_max},
    }


def main():
    client = connect()
    os.makedirs(OUTPUT_DIR, exist_ok=True)

    # Step 1: Curate neuron list
    curated = curate_neuron_list(client)

    # Step 2: Process each neuron
    all_meta = []
    global_min = np.array([np.inf, np.inf, np.inf])
    global_max = np.array([-np.inf, -np.inf, -np.inf])

    for i, (_, row) in enumerate(curated.iterrows()):
        body_id = int(row["bodyId"])
        print(f"[{i+1}/{len(curated)}] Processing body {body_id} ({row.get('type', '?')})...")

        skel_df = fetch_and_simplify_skeleton(body_id, client)
        if skel_df is None:
            print("    Skipped (no skeleton)")
            continue

        data = skeleton_to_json(skel_df, row.to_dict())

        if len(data["edges"]) == 0:
            print("    Skipped (no edges)")
            continue

        # Update global bounds
        bmin = np.array(data["bounds"]["min"])
        bmax = np.array(data["bounds"]["max"])
        global_min = np.minimum(global_min, bmin)
        global_max = np.maximum(global_max, bmax)

        # Save individual neuron file
        filename = f"neuron_{len(all_meta)}.json"
        filepath = os.path.join(OUTPUT_DIR, filename)
        with open(filepath, "w") as f:
            json.dump(data, f)

        all_meta.append({
            "file": filename,
            "id": data["id"],
            "type": data["type"],
            "region": data["region"],
            "nodeCount": len(data["nodes"]),
        })
        print(f"    Saved {filename} ({len(data['nodes'])} nodes, {len(data['edges'])} edges)")

    # Step 3: Generate manifest
    diagonal = float(np.linalg.norm(global_max - global_min))
    manifest = {
        "count": len(all_meta),
        "neurons": all_meta,
        "brainBounds": {
            "min": global_min.tolist(),
            "max": global_max.tolist(),
        },
        "maxDistance": round(diagonal, 2),
    }

    manifest_path = os.path.join(OUTPUT_DIR, "manifest.json")
    with open(manifest_path, "w") as f:
        json.dump(manifest, f, indent=2)

    print(f"\nDone! Processed {len(all_meta)} neurons")
    print(f"Brain bounds: {global_min.tolist()} to {global_max.tolist()}")
    print(f"Max distance (diagonal): {diagonal:.1f} voxel units")
    print(f"Manifest: {manifest_path}")


if __name__ == "__main__":
    main()
