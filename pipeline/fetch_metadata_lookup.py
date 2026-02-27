#!/usr/bin/env python3
"""Fetch metadata (synapse counts, type, region, etc.) for all game-eligible neurons.

Generates a lookup table keyed by bodyId so that the game and worker can
resolve neuron metadata without requiring a user-facing neuPrint token.

Usage:
    export NEUPRINT_APPLICATION_CREDENTIALS="your-token-here"
    python fetch_metadata_lookup.py

Output:
    ../data/neuron-metadata.json
"""

import json
import os
import sys

from neuprint import Client

# --- Configuration ---
NEUPRINT_SERVER = "neuprint.janelia.org"
DATASET = "male-cns:v0.9"
OUTPUT_PATH = os.path.join(os.path.dirname(__file__), "..", "data", "neuron-metadata.json")
WORKER_OUTPUT_PATH = os.path.join(os.path.dirname(__file__), "..", "cors-proxy", "neuron-types.json")


def connect():
    """Connect to neuPrint."""
    token = os.environ.get("NEUPRINT_APPLICATION_CREDENTIALS")
    if not token:
        print("ERROR: Set NEUPRINT_APPLICATION_CREDENTIALS environment variable")
        print("Get your token from: https://neuprint.janelia.org")
        sys.exit(1)
    return Client(NEUPRINT_SERVER, dataset=DATASET, token=token)


def fetch_all_eligible_neurons(client):
    """Query all game-eligible neurons from neuPrint."""
    print("Querying neuPrint for all eligible neurons...")

    cypher = """
        MATCH (n:Neuron)
        WHERE n.status = "Traced"
          AND n.pre >= 20
          AND n.post >= 20
          AND n.type IS NOT NULL
        RETURN n.bodyId AS bodyId,
               n.type AS type,
               n.instance AS instance,
               n.pre AS pre,
               n.post AS post,
               n.somaLocation AS somaLocation,
               n.roiInfo AS roiInfo
    """

    result = client.fetch_custom(cypher)
    print(f"  Found {len(result)} eligible neurons")
    return result


def determine_primary_roi(roi_info):
    """Find the ROI with the highest total synapse count."""
    if roi_info is None or not isinstance(roi_info, dict):
        return ""
    max_syn = 0
    primary = ""
    for roi, counts in roi_info.items():
        if not isinstance(counts, dict):
            continue
        total = (counts.get("pre", 0) or 0) + (counts.get("post", 0) or 0)
        if total > max_syn:
            max_syn = total
            primary = roi
    return primary


def build_lookup(df):
    """Convert DataFrame to a bodyId-keyed lookup dict."""
    neurons = {}
    for _, row in df.iterrows():
        body_id = str(int(row["bodyId"]))

        soma = row.get("somaLocation")
        if soma is not None:
            if isinstance(soma, str):
                try:
                    soma = json.loads(soma)
                except (json.JSONDecodeError, ValueError):
                    soma = None
            if isinstance(soma, dict) and "x" in soma:
                soma = [soma["x"], soma["y"], soma["z"]]
            elif isinstance(soma, (list, tuple)) and len(soma) >= 3:
                soma = [soma[0], soma[1], soma[2]]
            else:
                soma = None

        region = determine_primary_roi(row.get("roiInfo"))

        neurons[body_id] = {
            "type": str(row.get("type", "unknown") or "unknown"),
            "instance": str(row.get("instance", "") or ""),
            "pre": int(row.get("pre", 0) or 0),
            "post": int(row.get("post", 0) or 0),
            "region": region,
        }
        if soma:
            neurons[body_id]["somaLocation"] = soma

    return neurons


def build_worker_lookup(neurons):
    """Build a compact type-keyed lookup for the Cloudflare Worker.

    Groups neurons by type and picks one representative per type (the one
    with the highest total synapse count). This keeps the file small enough
    to bundle directly with the worker (~1MB vs 14MB for the full lookup).
    """
    by_type = {}
    for body_id, meta in neurons.items():
        t = meta["type"]
        if t == "unknown":
            continue
        total = meta["pre"] + meta["post"]
        if t not in by_type or total > by_type[t]["pre"] + by_type[t]["post"]:
            entry = {
                "bodyId": int(body_id),
                "pre": meta["pre"],
                "post": meta["post"],
                "region": meta["region"],
            }
            if "somaLocation" in meta:
                entry["somaLocation"] = meta["somaLocation"]
            by_type[t] = entry
    return by_type


def main():
    client = connect()
    df = fetch_all_eligible_neurons(client)
    neurons = build_lookup(df)

    # Collect distinct types for daily challenge selection
    types = sorted(set(n["type"] for n in neurons.values() if n["type"] != "unknown"))

    # Full lookup (for reference / future use)
    output = {
        "dataset": DATASET,
        "count": len(neurons),
        "typeCount": len(types),
        "types": types,
        "neurons": neurons,
    }

    os.makedirs(os.path.dirname(OUTPUT_PATH), exist_ok=True)
    with open(OUTPUT_PATH, "w") as f:
        json.dump(output, f)

    size_mb = os.path.getsize(OUTPUT_PATH) / (1024 * 1024)
    print(f"\nFull lookup: {OUTPUT_PATH}")
    print(f"  Neurons: {len(neurons)}")
    print(f"  Distinct types: {len(types)}")
    print(f"  File size: {size_mb:.1f} MB")

    # Compact worker lookup (one neuron per type, keyed by type name)
    worker_lookup = build_worker_lookup(neurons)
    with open(WORKER_OUTPUT_PATH, "w") as f:
        json.dump(worker_lookup, f)

    worker_size_mb = os.path.getsize(WORKER_OUTPUT_PATH) / (1024 * 1024)
    print(f"\nWorker lookup: {WORKER_OUTPUT_PATH}")
    print(f"  Types: {len(worker_lookup)}")
    print(f"  File size: {worker_size_mb:.1f} MB")


if __name__ == "__main__":
    main()
