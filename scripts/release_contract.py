"""
Task-aware rules for a published release folder, shared by generate_data.py and
publish_release_windows.py so the two cannot disagree.

A release folder holds one of two tasks:

* go_whole_protein: LAFA's GO release, unchanged. Subsets NK, LK, PK; ns is a GO aspect.
* region_transfer: region-level annotation transfer (where on the protein a domain or
  feature sits). One subset, ALL; ns is the truth set (pfam, pfamn, swissprot).
  The folder carries release_info.tsv, which names the task.

Both tasks may carry the extension columns below on evaluation_best_f_micro_w.tsv and
evaluation_all.tsv. A GO release written before they existed has none of them, and reads
as task go_whole_protein, stratum "all", with cost unknown.
"""

from __future__ import annotations

import csv
from pathlib import Path

TASK_GO = "go_whole_protein"
TASK_REGION = "region_transfer"
TASKS = (TASK_GO, TASK_REGION)

TASK_LABELS = {
    TASK_GO: "GO terms, whole protein",
    TASK_REGION: "Region transfer",
}

TASK_SUBSETS = {
    TASK_GO: ("NK", "LK", "PK"),
    TASK_REGION: ("ALL",),
}

GO_ASPECTS = ("biological_process", "molecular_function", "cellular_component")
REGION_TRUTH_SETS = ("pfam", "pfamn", "swissprot")
TASK_NS = {TASK_GO: GO_ASPECTS, TASK_REGION: REGION_TRUTH_SETS}

# Added by this fork. Every one is optional for a GO release.
#   task          go_whole_protein or region_transfer
#   stratum_axis  what the rows are split by (identity, plddt, ...), or "all"
#   stratum_bin   which part of that axis the row covers, or "all"
#   cpu_h         CPU-hours per 1,000 query proteins (search step only)
#   peak_ram_gb   peak resident memory of one search task, GB
#   gpu_h         GPU-hours per 1,000 query proteins
#   provenance    measured (from the run's own task records) or reported (by a submitter)
#   cost_usd_est  cpu_h x price per CPU-hour + gpu_h x price per GPU-hour, US dollars;
#                 the prices are in release_info.tsv
EXTENSION_COLUMNS = (
    "task",
    "stratum_axis",
    "stratum_bin",
    "cpu_h",
    "peak_ram_gb",
    "gpu_h",
    "provenance",
    "cost_usd_est",
)
EXTENSION_NUMERIC = ("cpu_h", "peak_ram_gb", "gpu_h", "cost_usd_est")
PROVENANCE_VALUES = ("measured", "reported")

# Columns a region_transfer row carries beyond the GO ones, named as in the leaderboard's
# long results.parquet (seanome/2024-kmerseek-analysis PR 148). Metric columns other than
# fmax, fmax_precision and fmax_recall (which fill f_micro_w, pr_micro_w, rc_micro_w) keep
# their metric name.
REGION_EXTRA_COLUMNS = (
    "tool",
    "setting",
    "truth_source",
    "dedup_or_raw",
    "target_db",
    "target_mya_to_human",
    "experiment",
    "query_set",
    "tool_version",
    "target_db_version",
    "truth_version",
    "source_path",
    "source_commit",
)
# Columns that are the same for every row of one tool or truth set (versions, source file).
# generate_data.py lists them once in meta.json instead of on each row of best.json.
REGION_SOURCE_COLUMNS = (
    "experiment", "query_set", "tool_version", "target_db_version", "truth_version",
    "source_path", "source_commit",
)
REGION_METRIC_COLUMNS = ("auprc", "median_iou_tp", "family_fmax", "recall_reachable")
REGION_INT_COLUMNS: tuple[str, ...] = ()
REGION_FLOAT_COLUMNS = ("target_mya_to_human",) + REGION_METRIC_COLUMNS

GO_REQUIRED_RELEASE_FILES = (
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
)
REGION_REQUIRED_RELEASE_FILES = (
    "release_info.tsv",
    "method_names.tsv",
    "method_availability.tsv",
    "results_ALL/evaluation_best_f_micro_w.tsv",
    "results_ALL/evaluation_all.tsv",
)

GO_BEST_COLUMNS = ("filename", "ns", "n", "pr_micro_w", "rc_micro_w", "f_micro_w", "cov_w", "tau")
GO_ALL_COLUMNS = ("filename", "ns", "tau", "cov", "rc_micro_w", "pr_micro_w", "f_micro_w")
# cov_w and cov are left empty for region_transfer: CAFA's coverage (share of proteins
# given any prediction) has no counterpart in results.parquet.
# tau is left empty for region_transfer: the long table holds no score threshold.
REGION_BEST_COLUMNS = (
    "filename", "ns", "n", "pr_micro_w", "rc_micro_w", "f_micro_w",
    "task", "stratum_axis", "stratum_bin", "target_db", "dedup_or_raw",
)
REGION_ALL_COLUMNS = (
    "filename", "ns", "rc_micro_w", "pr_micro_w", "f_micro_w",
    "task", "stratum_axis", "stratum_bin", "target_db", "dedup_or_raw",
)
GO_BEST_NUMERIC = ("n", "pr_micro_w", "rc_micro_w", "f_micro_w", "cov_w", "tau")
GO_ALL_NUMERIC = ("tau", "cov", "rc_micro_w", "pr_micro_w", "f_micro_w")
REGION_BEST_NUMERIC = ("n", "pr_micro_w", "rc_micro_w", "f_micro_w")
REGION_ALL_NUMERIC = ("rc_micro_w", "pr_micro_w", "f_micro_w")

RELEASE_INFO_FILE = "release_info.tsv"


def read_release_info(release_dir: Path) -> dict[str, str]:
    """Read release_info.tsv (columns key, value). A GO release has none: return {}."""
    path = Path(release_dir) / RELEASE_INFO_FILE
    if not path.exists():
        return {}
    with path.open("r", encoding="utf-8", newline="") as handle:
        return {
            row["key"].strip(): (row.get("value") or "").strip()
            for row in csv.DictReader(handle, delimiter="\t")
            if row.get("key")
        }


def release_task(release_dir: Path) -> str:
    task = read_release_info(release_dir).get("task", TASK_GO)
    if task not in TASKS:
        raise ValueError(f"{release_dir}: unknown task '{task}', expected one of {', '.join(TASKS)}")
    return task


def required_release_files(task: str) -> tuple[str, ...]:
    return REGION_REQUIRED_RELEASE_FILES if task == TASK_REGION else GO_REQUIRED_RELEASE_FILES


def best_columns(task: str) -> tuple[str, ...]:
    return REGION_BEST_COLUMNS if task == TASK_REGION else GO_BEST_COLUMNS


def all_columns(task: str) -> tuple[str, ...]:
    return REGION_ALL_COLUMNS if task == TASK_REGION else GO_ALL_COLUMNS


def best_numeric(task: str) -> tuple[str, ...]:
    return REGION_BEST_NUMERIC if task == TASK_REGION else GO_BEST_NUMERIC


def all_numeric(task: str) -> tuple[str, ...]:
    return REGION_ALL_NUMERIC if task == TASK_REGION else GO_ALL_NUMERIC


def optional_float(value) -> float | None:
    text = "" if value is None else str(value).strip()
    return None if text == "" else float(text)


def optional_int(value) -> int | None:
    text = "" if value is None else str(value).strip()
    return None if text == "" else int(text)


def parse_bool(value) -> bool:
    text = str(value).strip().lower()
    if text in ("true", "1", "yes"):
        return True
    if text in ("false", "0", "no"):
        return False
    raise ValueError(f"not a true/false value: '{value}'")


def extension_values(row: dict, release_task_name: str) -> dict:
    """The extension columns of one row, typed; defaults for a row that lacks them."""
    task = (row.get("task") or "").strip() or release_task_name
    provenance = (row.get("provenance") or "").strip() or None
    if provenance is not None and provenance not in PROVENANCE_VALUES:
        raise ValueError(f"provenance must be one of {PROVENANCE_VALUES}, got '{provenance}'")
    return {
        "task": task,
        "stratumAxis": (row.get("stratum_axis") or "").strip() or "all",
        "stratumBin": (row.get("stratum_bin") or "").strip() or "all",
        "cpuH": optional_float(row.get("cpu_h")),
        "peakRamGb": optional_float(row.get("peak_ram_gb")),
        "gpuH": optional_float(row.get("gpu_h")),
        "provenance": provenance,
        "costUsdEst": optional_float(row.get("cost_usd_est")),
    }


def validate_extension_columns(rows: list[dict], name: str, release_task_name: str) -> list[str]:
    """Errors for extension values that are present but wrong; absent ones are fine."""
    errors = []
    for row_idx, row in enumerate(rows, start=2):
        try:
            values = extension_values(row, release_task_name)
        except ValueError as exc:
            errors.append(f"{name}:{row_idx}: {exc}")
            continue
        if values["task"] != release_task_name:
            errors.append(
                f"{name}:{row_idx}: task '{values['task']}' differs from the release task "
                f"'{release_task_name}'"
            )
    return errors
