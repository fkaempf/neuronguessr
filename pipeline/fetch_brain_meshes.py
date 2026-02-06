#!/usr/bin/env python3
"""Fetch brain region (ROI) meshes from neuPrint for the NeuronGuessr game.

Usage:
    export NEUPRINT_APPLICATION_CREDENTIALS="your-token-here"
    python fetch_brain_meshes.py

Outputs:
    ../data/brain/rois/*.obj      - OBJ mesh files for each ROI
    ../data/brain/neuropils.json  - ROI metadata (name, file, color)
"""

import json
import os
import sys

from neuprint import Client

# --- Configuration ---
NEUPRINT_SERVER = "neuprint.janelia.org"
DATASET = "male-cns:v0.9"
OUTPUT_DIR = os.path.join(os.path.dirname(__file__), "..", "data", "brain")

# Color palette grouped by brain region
ROI_COLORS = {
    # Central Brain
    "MB": "#FF6B35",
    "AL": "#FFD700",
    "LH": "#FF4444",
    "CX": "#FF8C00",
    "LX": "#FFA07A",
    "SLP": "#CD853F",
    "SIP": "#DEB887",
    "SMP": "#D2691E",
    "AVLP": "#F4A460",
    "PVLP": "#E9967A",
    "WED": "#DAA520",
    "IB": "#BC8F8F",
    "ATL": "#F08080",
    "CRE": "#FA8072",
    "SCL": "#E0C068",
    "ICL": "#BDB76B",
    "IPS": "#C0A060",
    "SPS": "#D2B48C",
    "EPA": "#FFDAB9",
    "GOR": "#FFE4B5",
    "PRW": "#FFECD2",
    "GA": "#FFB347",
    "PLP": "#CC7722",
    "AOTU": "#FF7F50",
    "FLA": "#FF6347",
    "CAN": "#FF4500",
    "AMMC": "#FF8C69",
    "VES": "#FFA500",
    "GNG": "#B8860B",
    # Optic Lobes
    "ME": "#4169E1",
    "LO": "#00CED1",
    "LOP": "#20B2AA",
    "LA": "#87CEEB",
    "AME": "#6495ED",
    # VNC
    "ANm": "#9370DB",
    "T1": "#9370DB",
    "T2": "#BA55D3",
    "T3": "#DA70D6",
    "AbN": "#EE82EE",
    "IntTct": "#DDA0DD",
    "NTct": "#D8BFD8",
    "HTct": "#C71585",
    "CV": "#DB7093",
    "mVAC": "#FF69B4",
}


def get_roi_color(roi_name):
    """Assign a color based on ROI name prefix matching."""
    for prefix, color in ROI_COLORS.items():
        if roi_name.startswith(prefix):
            return color
    return "#AAAAAA"


def sanitize_filename(name):
    """Make a ROI name safe for filenames."""
    return name.replace("(", "_").replace(")", "").replace(" ", "_").replace("/", "_")


def main():
    token = os.environ.get("NEUPRINT_APPLICATION_CREDENTIALS")
    if not token:
        print("ERROR: Set NEUPRINT_APPLICATION_CREDENTIALS environment variable")
        print("Get your token from: https://neuprint.janelia.org (click Account -> Auth Token)")
        sys.exit(1)

    print(f"Connecting to {NEUPRINT_SERVER}, dataset={DATASET}...")
    client = Client(NEUPRINT_SERVER, dataset=DATASET, token=token)

    # Ensure output directories exist
    rois_dir = os.path.join(OUTPUT_DIR, "rois")
    os.makedirs(rois_dir, exist_ok=True)

    # Fetch available ROIs
    all_rois = client.primary_rois
    print(f"Found {len(all_rois)} primary ROIs")

    roi_metadata = []
    for roi_name in sorted(all_rois):
        safe_name = sanitize_filename(roi_name)
        filepath = os.path.join(rois_dir, f"{safe_name}.obj")
        rel_path = f"rois/{safe_name}.obj"

        try:
            mesh_bytes = client.fetch_roi_mesh(roi_name)
            with open(filepath, "wb") as f:
                f.write(mesh_bytes)

            color = get_roi_color(roi_name)
            roi_metadata.append({
                "name": roi_name,
                "file": rel_path,
                "color": color,
            })
            print(f"  OK: {roi_name} -> {rel_path} ({len(mesh_bytes)} bytes)")
        except Exception as e:
            print(f"  SKIP: {roi_name} - {e}")

    # Write neuropils.json
    neuropils_path = os.path.join(OUTPUT_DIR, "neuropils.json")
    with open(neuropils_path, "w") as f:
        json.dump({"rois": roi_metadata}, f, indent=2)

    print(f"\nDone! Saved {len(roi_metadata)} ROI meshes")
    print(f"Metadata: {neuropils_path}")


if __name__ == "__main__":
    main()
