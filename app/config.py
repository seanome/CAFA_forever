#!/usr/bin/env python3
"""
Configuration and release discovery for the CAFA Forever application.
"""

import json
from datetime import datetime
from pathlib import Path

# Base directories
APP_DIR = Path(__file__).resolve().parent
REPO_ROOT = APP_DIR.parent
DATA_ROOT = REPO_ROOT / "data"
RELEASES_DIR = DATA_ROOT / "releases"
STATIC_DIR = REPO_ROOT / "static"
CATALOG_FILE = RELEASES_DIR / "catalog.json"

# Optional hard-coded provenance fallback keyed by time point rather than release window.
DATA_DATES = {
    "May_2025": {
        "goa": "2025-05-03",
        "uniprot": "2025_02 (2025-04-23)",
    },
    "Sep_2025": {
        "goa": "2025-09-04",
        "uniprot": "2025_03 (2025-06-18)",
    },
    "Nov_2025": {
        "goa": "2025-11-10",
        "uniprot": "2025_04 (2025-10-15)",
    },
    "Dec_2025": {
        "goa": "2025-12-04",
        "uniprot": "2025_04 (2025-10-15)",
    },
    "Mar_2026": {
        "goa": "2026-03-04",
        "uniprot": "2026_01 (2026-01-28)",
    },
}

METHOD_HELP_MSG = dict({
    "BLAST": "Summary: Homology-based GO annotation transfer from training set proteins. Input: protein sequences (FASTA, required, train and test set), GO annotations (GAF, required, train set), GO graph (OBO, required). Documentation: https://github.com/anphan0828/democafa_package/tree/0ab84edbaddf5fef11125dc8adbd19167c3cc038/democafa/baselines/blast_container",
    "Naive": "Summary: GO term frequencies from the training set assigned to all proteins. Input: protein sequences (FASTA, required), GO annotations (GAF, required, train set). Documentation: https://github.com/anphan0828/democafa_package/tree/0ab84edbaddf5fef11125dc8adbd19167c3cc038/democafa/baselines/naive_container",
    "ProtT5": "Summary: ProtT5 embedding-based annotation transfer from training set proteins. Input: protein sequences (FASTA, required), GO annotations (GAF, required, train set). Documentation: https://github.com/anphan0828/democafa_package/tree/0ab84edbaddf5fef11125dc8adbd19167c3cc038/democafa/baselines/prott5_container",
    "GOA Non-exp": "Summary: Use non-experimental GO annotations of all proteins as predictions. Input: protein sequences (FASTA, required), GO annotations (GAF, required, not filtered). Documentation: https://github.com/anphan0828/democafa_package/tree/0ab84edbaddf5fef11125dc8adbd19167c3cc038/democafa/baselines/goa_nonexp_container",
    "FunBind": "Summary: Multi-modality based model combining sequence, structure, domains, textual descriptions, and GO terms. Input: protein sequences (FASTA, required), protein structures (PDB, optional), domains (InterPro, optional), textual descriptions (UniProt flat text, optional). Publication: https://doi.org/10.1101/2025.05.09.653226",
    "TransFew": "Summary: ESM-2-based pipeline combinining representations of both protein sequences and GO terms to improve prediction accuracy for common and rare functions. Input: protein sequences (FASTA). Publication: https://doi.org/10.1093/bioadv/vbae120",
    "DeepGOPlus": "Summary: Combining sequence motifs from deep learning and sequence similarity-based predictions. Input: protein sequences (FASTA). Publication: https://doi.org/10.1093/bioinformatics/btz595",
})

METHOD_DOCKER_URLS = dict({
    "BLAST": "https://hub.docker.com/r/anphan0828/blast_predictor",
    "Naive": "https://hub.docker.com/r/anphan0828/naive_predictor",
    "ProtT5": "https://hub.docker.com/r/anphan0828/prott5_predictor",
    "GOA Non-exp": "https://hub.docker.com/r/anphan0828/goa_nonexp_predictor",
    "FunBind": "https://hub.docker.com/r/yw7bh/funbind_predictor",
    "TransFew": "https://hub.docker.com/r/yw7bh/transfew_predictor",
    "DeepGOPlus": "https://hub.docker.com/r/coolmaksat/deepgoplus",
})

BASELINE_METHOD_LABELS = {"Naive", "BLAST", "ProtT5", "GOA Non-exp"}

SUBSETS = ["NK", "LK", "PK"]

GO_ASPECTS = {
    "biological_process": "Biological Process",
    "molecular_function": "Molecular Function",
    "cellular_component": "Cellular Component",
}

REQUIRED_RELEASE_FILES = [
    "method_names.tsv",
    "groundtruth_NK.tsv",
    "groundtruth_LK.tsv",
    "groundtruth_PK.tsv",
    "results_NK/evaluation_best_f_micro_w.tsv",
    "results_NK/evaluation_all.tsv",
    "results_LK/evaluation_best_f_micro_w.tsv",
    "results_LK/evaluation_all.tsv",
    "results_PK/evaluation_best_f_micro_w.tsv",
    "results_PK/evaluation_all.tsv",
]

STREAMLIT_CONFIG = {
    "page_title": "CAFA Forever",
    "page_icon": "📊",
    "layout": "wide",
    "initial_sidebar_state": "collapsed",
}


def inspect_release_dir(release_dir):
    """Validate the minimum on-disk contract for one release directory."""
    errors = []
    for relative_path in REQUIRED_RELEASE_FILES:
        if not (release_dir / relative_path).exists():
            errors.append(f"missing {relative_path}")

    return {
        "release_id": release_dir.name,
        "path": release_dir,
        "status": "ready" if not errors else "invalid",
        "errors": errors,
    }


def _normalize_catalog_entry(entry):
    """Normalize a catalog entry to a release id, path, and status."""
    release_id = entry.get("release_id") or entry.get("id") or entry.get("name")
    release_path = entry.get("path")
    status = entry.get("status", "ready")

    if not release_id and release_path:
        release_id = Path(release_path).name
    if not release_id:
        raise ValueError("catalog entry missing release_id")

    if release_path:
        path = Path(release_path)
        if not path.is_absolute():
            path = REPO_ROOT / path
    else:
        path = RELEASES_DIR / release_id

    return {
        "release_id": release_id,
        "path": path,
        "status": status,
    }


def _load_catalog_entries():
    """Load optional catalog.json entries if provided by the backend pipeline."""
    if not CATALOG_FILE.exists():
        return []

    with CATALOG_FILE.open("r", encoding="utf-8") as handle:
        raw = json.load(handle)

    entries = raw.get("releases", raw) if isinstance(raw, dict) else raw
    if not isinstance(entries, list):
        raise ValueError("catalog.json must contain a list or a {'releases': [...]} object")

    return [_normalize_catalog_entry(entry) for entry in entries]


def _release_task(release_path):
    """Task named in release_info.tsv; a release without that file is LAFA's GO task."""
    info_path = Path(release_path) / "release_info.tsv"
    if not info_path.exists():
        return "go_whole_protein"
    with info_path.open("r", encoding="utf-8") as handle:
        for line in handle:
            key, _, value = line.rstrip("\n").partition("\t")
            if key == "task":
                return value.strip()
    return "go_whole_protein"


def get_release_catalog():
    """
    Return validated releases and excluded releases.

    Guardrails:
    1. Only releases marked ready in catalog.json are exposed when a catalog exists.
    2. Releases must satisfy the minimum file contract.
    3. Invalid releases are excluded instead of crashing discovery.
    """
    valid = {}
    invalid = {}

    if not RELEASES_DIR.exists():
        return {"valid": valid, "invalid": {"data/releases": ["directory does not exist"]}}

    try:
        catalog_entries = _load_catalog_entries()
    except Exception as exc:
        return {"valid": valid, "invalid": {"catalog.json": [str(exc)]}}

    if catalog_entries:
        release_specs = catalog_entries
    else:
        release_specs = [
            {"release_id": item.name, "path": item, "status": "ready"}
            for item in sorted(RELEASES_DIR.iterdir())
            if item.is_dir() and not item.name.startswith(".")
        ]

    for spec in release_specs:
        release_id = spec["release_id"]
        release_path = spec["path"]
        status = spec.get("status", "ready")

        if status != "ready":
            invalid[release_id] = [f"catalog status is '{status}'"]
            continue

        if not release_path.exists():
            invalid[release_id] = [f"release path not found: {release_path}"]
            continue

        if _release_task(release_path) != "go_whole_protein":
            # Region-transfer releases (seanome fork) are shown by the React frontend only.
            continue

        inspection = inspect_release_dir(release_path)
        if inspection["errors"]:
            invalid[release_id] = inspection["errors"]
            continue

        valid[release_id] = {
            "path": release_path,
            "status": "ready",
        }

    return {"valid": valid, "invalid": invalid}


def get_release_dir(release_id):
    """Return the validated directory for a release id."""
    catalog = get_release_catalog()
    release = catalog["valid"].get(release_id)
    if not release:
        raise ValueError(f"Release is not available: {release_id}")
    return release["path"]


def get_available_timepoints():
    """Return sorted unique time points parsed from validated release ids."""
    timepoints = set()
    for release_id in get_available_release_ids():
        start, end = split_release_id(release_id)
        timepoints.update([start, end])
    return sorted(timepoints, key=parse_timepoint_label)


def get_available_release_ids():
    """Return validated release ids available to the frontend."""
    return sorted(get_release_catalog()["valid"].keys(), key=_release_sort_key)


def split_release_id(release_id):
    """Split a release folder name into start and end time points."""
    parts = str(release_id).split("_")
    if len(parts) != 4:
        raise ValueError(f"Release id must follow Mon_YYYY_Mon_YYYY: {release_id}")
    return "_".join(parts[:2]), "_".join(parts[2:])


def parse_timepoint_label(timepoint_label):
    """Parse a Mon_YYYY label into a sortable datetime."""
    return datetime.strptime(str(timepoint_label), "%b_%Y")


def _release_sort_key(release_id):
    start, end = split_release_id(release_id)
    return parse_timepoint_label(start), parse_timepoint_label(end), str(release_id)


def get_release_dates(release_id):
    """Return provenance metadata for a release by combining start/end time point entries."""
    start_timepoint, end_timepoint = split_release_id(release_id)
    start_dates = DATA_DATES.get(start_timepoint, {})
    end_dates = DATA_DATES.get(end_timepoint, {})

    return {
        "goa_start": start_dates.get("goa", "N/A"),
        "goa_end": end_dates.get("goa", "N/A"),
        "uniprot_start": start_dates.get("uniprot", "N/A"),
        "uniprot_end": end_dates.get("uniprot", "N/A"),
    }
