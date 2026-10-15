#!/usr/bin/env python3
"""
Turn a region-transfer benchmark's results.parquet and compute.parquet into a release folder
in LAFA's layout (data/releases/{release_id}/), task region_transfer.

The two tables come from `make leaderboard-tables` in seanome/2024-kmerseek-analysis
(scripts/build_leaderboard_tables.py). One row of results.parquet is one tool at one setting,
graded against one truth set, raw or deduplicated, against one relative's proteome, in one
stratum. It becomes one row of results_ALL/evaluation_best_f_micro_w.tsv, with:

    LAFA column    results.parquet column
    filename       "{tool}__{setting}"
    ns             truth_set
    tau            fmax_threshold
    n              n_truth_instances
    pr_micro_w     fmax_precision
    rc_micro_w     fmax_recall
    f_micro_w      fmax
    cov_w          empty (CAFA's coverage has no counterpart here)
    stratum_bin    stratum

and every other results.parquet column under its own name, so `release_to_results()` gives
back the same table. Cost comes from compute.parquet, joined on (tool, setting, species):

    cpu_h          cpu_h_per_1000_queries
    peak_ram_gb    peak_rss_gb_max
    gpu_h          gpu_h_per_1000_queries
    provenance     provenance
    cost_usd_est   cpu_h * price_cpu_h + gpu_h * price_gpu_h

A row with no compute row keeps all five empty: not measured, never estimated.

evaluation_all.tsv holds the same rows' single point (precision and recall at Fmax), since
results.parquet stores no full precision-recall curve.
"""

from __future__ import annotations

import argparse
import csv
import hashlib
import math
import sys
from pathlib import Path

import polars as pl

sys.path.insert(0, str(Path(__file__).resolve().parent))
from release_contract import (  # noqa: E402
    REGION_EXTRA_COLUMNS,
    TASK_REGION,
)

# Prices behind cost_usd_est: AWS on-demand, US East (N. Virginia), Linux, read 2026-10-15
# from the public price file (publication date 2026-10-12). c7i.large is $0.08925 per hour for
# 2 vCPU; g5.xlarge is $1.006 per hour for one NVIDIA A10G. Same defaults as
# seanome/protein-function-annotation-leaderboard, scripts/build_site.py.
PRICE_CPU_H = 0.08925 / 2
PRICE_GPU_H = 1.006
PRICE_SOURCE = (
    "AWS EC2 on-demand, US East (N. Virginia), Linux, read 2026-10-15: "
    "c7i.large $0.08925/h for 2 vCPU; g5.xlarge $1.006/h for 1 A10G"
)

RESULTS_COLUMNS = (
    "truth_set", "dedup", "tool", "setting", "species", "species_mya", "stratum_axis",
    "stratum", "fmax", "fmax_precision", "fmax_recall", "fmax_threshold", "auprc",
    "median_iou_tp", "n_truth_instances", "n_reachable_instances", "n_instances_found",
    "n_calls", "n_tp_calls", "n_fp_calls", "n_proteins_scored", "median_feature_length",
)
RENAMED = {
    "truth_set": "ns",
    "fmax_threshold": "tau",
    "n_truth_instances": "n",
    "fmax_precision": "pr_micro_w",
    "fmax_recall": "rc_micro_w",
    "fmax": "f_micro_w",
    "stratum": "stratum_bin",
}
BEST_HEADER = (
    "filename", "ns", "tau", "n", "pr_micro_w", "rc_micro_w", "f_micro_w", "cov_w",
    "task", "stratum_axis", "stratum_bin",
    "cpu_h", "peak_ram_gb", "gpu_h", "provenance", "cost_usd_est",
) + tuple(c for c in REGION_EXTRA_COLUMNS if c != "truth_set")
ALL_HEADER = (
    "filename", "ns", "tau", "cov", "rc_micro_w", "pr_micro_w", "f_micro_w",
    "task", "stratum_axis", "stratum_bin", "species", "dedup", "tool", "setting",
)
RESULTS_SCHEMA = {
    "truth_set": pl.String, "dedup": pl.Boolean, "tool": pl.String, "setting": pl.String,
    "species": pl.String, "species_mya": pl.Float64, "stratum_axis": pl.String,
    "stratum": pl.String, "fmax": pl.Float64, "fmax_precision": pl.Float64,
    "fmax_recall": pl.Float64, "fmax_threshold": pl.Float64, "auprc": pl.Float64,
    "median_iou_tp": pl.Float64, "n_truth_instances": pl.Int64,
    "n_reachable_instances": pl.Int64, "n_instances_found": pl.Int64, "n_calls": pl.Int64,
    "n_tp_calls": pl.Int64, "n_fp_calls": pl.Int64, "n_proteins_scored": pl.Int64,
    "median_feature_length": pl.Float64,
}


def method_filename(tool: str, setting: str) -> str:
    return f"{tool}__{setting}"


def method_label(tool: str, setting: str) -> str:
    return f"{tool} {setting}"


def fmt(value) -> str:
    """Write a value so that reading it back gives the same value."""
    if value is None:
        return ""
    if isinstance(value, bool):
        return "true" if value else "false"
    if isinstance(value, float):
        if math.isnan(value):
            raise ValueError("NaN cannot be written to a release table")
        return repr(value)
    return str(value)


def sha256(path: Path) -> str:
    digest = hashlib.sha256()
    with open(path, "rb") as handle:
        for block in iter(lambda: handle.read(1 << 20), b""):
            digest.update(block)
    return digest.hexdigest()


def join_cost(results: pl.DataFrame, compute: pl.DataFrame,
              price_cpu_h: float, price_gpu_h: float) -> pl.DataFrame:
    """Add cpu_h, peak_ram_gb, gpu_h, provenance and cost_usd_est to every results row."""
    keys = ["tool", "setting", "species"]
    if compute.select(keys).is_duplicated().any():
        raise ValueError("compute.parquet has more than one row per (tool, setting, species)")
    cost = compute.select(
        *keys,
        pl.col("cpu_h_per_1000_queries").alias("cpu_h"),
        pl.col("peak_rss_gb_max").alias("peak_ram_gb"),
        pl.col("gpu_h_per_1000_queries").alias("gpu_h"),
        pl.col("provenance"),
    ).with_columns(
        (pl.col("cpu_h") * price_cpu_h + pl.col("gpu_h").fill_null(0.0) * price_gpu_h)
        .alias("cost_usd_est")
    )
    joined = results.join(cost, on=keys, how="left", maintain_order="left")
    if joined.height != results.height:
        raise ValueError("joining compute.parquet changed the number of results rows")
    return joined


def write_tsv(path: Path, header, rows) -> None:
    path.parent.mkdir(parents=True, exist_ok=True)
    with open(path, "w", encoding="utf-8", newline="") as handle:
        writer = csv.writer(handle, delimiter="\t", lineterminator="\n")
        writer.writerow(header)
        for row in rows:
            writer.writerow([fmt(row.get(column)) for column in header])


def results_to_rows(joined: pl.DataFrame) -> list[dict]:
    rows = []
    for record in joined.iter_rows(named=True):
        row = {RENAMED.get(k, k): v for k, v in record.items()}
        row["filename"] = method_filename(record["tool"], record["setting"])
        row["task"] = TASK_REGION
        row["cov_w"] = None
        rows.append(row)
    return rows


def write_release(results_path: Path, compute_path: Path, out_dir: Path, release_id: str,
                  title: str, source_repo: str, source_commit: str, run_date: str,
                  price_cpu_h: float = PRICE_CPU_H, price_gpu_h: float = PRICE_GPU_H) -> Path:
    results = pl.read_parquet(results_path)
    compute = pl.read_parquet(compute_path)
    missing = set(RESULTS_COLUMNS) - set(results.columns)
    if missing:
        raise ValueError(f"results.parquet lacks columns: {sorted(missing)}")
    extra = set(results.columns) - set(RESULTS_COLUMNS)
    if extra:
        raise ValueError(f"results.parquet has columns this converter does not carry: {sorted(extra)}")

    release_dir = out_dir / release_id
    joined = join_cost(results.select(RESULTS_COLUMNS), compute, price_cpu_h, price_gpu_h)
    rows = results_to_rows(joined)

    write_tsv(release_dir / "results_ALL" / "evaluation_best_f_micro_w.tsv", BEST_HEADER, rows)
    all_rows = [dict(r, cov=None) for r in rows]
    write_tsv(release_dir / "results_ALL" / "evaluation_all.tsv", ALL_HEADER, all_rows)

    methods = joined.select("tool", "setting").unique().sort("tool", "setting")
    write_tsv(
        release_dir / "method_names.tsv",
        ("filename", "label", "group", "task", "tool", "setting"),
        [{"filename": method_filename(t, s), "label": method_label(t, s), "group": t,
          "task": TASK_REGION, "tool": t, "setting": s} for t, s in methods.iter_rows()],
    )
    write_tsv(
        release_dir / "method_availability.tsv",
        ("method", "ALL"),
        [{"method": method_label(t, s), "ALL": True} for t, s in methods.iter_rows()],
    )

    n_queries = compute["n_queries"].unique().drop_nulls().to_list()
    if len(n_queries) != 1:
        raise ValueError(f"compute.parquet should hold one n_queries value, found {n_queries}")
    overall = results.filter((pl.col("stratum_axis") == "all") & ~pl.col("dedup"))
    info = {
        "task": TASK_REGION,
        "title": title,
        "run_date": run_date,
        "n_queries": n_queries[0],
        "source_repo": source_repo,
        "source_commit": source_commit,
        "results_sha256": sha256(results_path),
        "compute_sha256": sha256(compute_path),
        "price_cpu_h_usd": price_cpu_h,
        "price_gpu_h_usd": price_gpu_h,
        "price_source": PRICE_SOURCE,
        "cpu_h_unit": "CPU-hours per 1,000 query proteins, search step only",
        "gpu_h_unit": "GPU-hours per 1,000 query proteins",
    }
    for truth, n in overall.group_by("truth_set").agg(pl.col("n_truth_instances").max()).iter_rows():
        info[f"n_truth_instances_{truth}"] = n
    write_tsv(release_dir / "release_info.tsv", ("key", "value"),
              [{"key": k, "value": v} for k, v in info.items()])
    return release_dir


def release_to_results(release_dir: Path) -> pl.DataFrame:
    """Read results_ALL/evaluation_best_f_micro_w.tsv back into results.parquet's schema."""
    path = Path(release_dir) / "results_ALL" / "evaluation_best_f_micro_w.tsv"
    back = {v: k for k, v in RENAMED.items()}
    columns: dict[str, list] = {c: [] for c in RESULTS_COLUMNS}
    with open(path, encoding="utf-8", newline="") as handle:
        for row in csv.DictReader(handle, delimiter="\t"):
            for tsv_column, text in row.items():
                name = back.get(tsv_column, tsv_column)
                if name not in columns:
                    continue
                dtype = RESULTS_SCHEMA[name]
                if text == "":
                    value = None
                elif dtype == pl.Boolean:
                    value = {"true": True, "false": False}[text]
                elif dtype == pl.Int64:
                    value = int(text)
                elif dtype == pl.Float64:
                    value = float(text)
                else:
                    value = text
                columns[name].append(value)
    return pl.DataFrame(columns, schema=RESULTS_SCHEMA)


def update_catalog(publish_dir: Path, repo_root: Path) -> Path:
    """Rewrite {publish_dir}/catalog.json the way BUILD_RELEASE_CATALOG does."""
    import json
    from datetime import datetime, timezone

    import publish_release_windows as pub

    release_dirs = sorted(p for p in publish_dir.iterdir() if p.is_dir() and not p.name.startswith("."))
    results = [pub.validate_release_window(p) for p in release_dirs]
    catalog = {
        "generated_at": datetime.now(timezone.utc).replace(microsecond=0).isoformat(),
        "validator": "scripts/publish_release_windows.py",
        "releases": pub.build_catalog_entries(results, publish_dir, repo_root=repo_root),
    }
    path = publish_dir / "catalog.json"
    with open(path, "w", encoding="utf-8") as handle:
        json.dump(catalog, handle, indent=2)
        handle.write("\n")
    return path


def main() -> int:
    parser = argparse.ArgumentParser(description=__doc__.split("\n\n")[0])
    parser.add_argument("--results", type=Path, required=True)
    parser.add_argument("--compute", type=Path, required=True)
    parser.add_argument("--out-dir", type=Path, required=True,
                        help="folder that will hold {release_id}/, for example data/releases")
    parser.add_argument("--release-id", required=True)
    parser.add_argument("--title", required=True)
    parser.add_argument("--source-repo", required=True)
    parser.add_argument("--source-commit", required=True)
    parser.add_argument("--run-date", required=True, help="date the benchmark run finished")
    parser.add_argument("--price-cpu-h", type=float, default=PRICE_CPU_H)
    parser.add_argument("--price-gpu-h", type=float, default=PRICE_GPU_H)
    parser.add_argument("--update-catalog", action="store_true",
                        help="also rewrite catalog.json in --out-dir")
    args = parser.parse_args()
    release_dir = write_release(
        args.results, args.compute, args.out_dir, args.release_id, args.title,
        args.source_repo, args.source_commit, args.run_date, args.price_cpu_h, args.price_gpu_h,
    )
    print(f"wrote {release_dir}")
    if args.update_catalog:
        repo_root = Path(__file__).resolve().parent.parent
        print(f"wrote {update_catalog(args.out_dir, repo_root)}")
    return 0


if __name__ == "__main__":
    sys.exit(main())
