#!/usr/bin/env python3
"""
Turn one experiment of the leaderboard's long tables (results.parquet and compute.parquet)
into a release folder in LAFA's layout (data/releases/{release_id}/), task region_transfer.

The two tables come from `make leaderboard-tables` in seanome/2024-kmerseek-analysis
(scripts/build_leaderboard_long.py, PR 148). results.parquet has one row per (experiment,
tool, setting, query_set, target_db, truth_source, dedup_or_raw, stratum_axis, stratum_bin,
metric). This script keeps one experiment and writes one row of
results_ALL/evaluation_best_f_micro_w.tsv per key below, with one column per metric:

    LAFA column    long-table source
    filename       "{tool}__{setting}"
    ns             truth_source, as a short id (pfam, pfamn, swissprot)
    n              n_instances (the truth count, not the denominator of the recall)
    pr_micro_w     metric fmax_precision
    rc_micro_w     metric fmax_recall
    f_micro_w      metric fmax
    tau            metric fmax_threshold: the score threshold at Fmax, in the tool's own
                   score (phmmer bits, kmerseek region score), so it compares only within
                   one tool and setting; empty where the source has none
    cov_w          empty (CAFA's coverage has no counterpart here)
    <metric>       every other metric (auprc, median_iou_tp, ...) under its own name

and every other long-table column under its own name, so `release_to_results()` gives the
long rows back. Each key must carry every metric except fmax_threshold, which may be absent,
and one value of each other column; the script refuses the input otherwise, so nothing is
merged away or filled in.

Cost comes from compute.parquet's search step for the same (experiment, tool, setting).
That row sums all relatives searched, so per 1,000 queries and per relative searched:

    cpu_h          cpu_h / n_target_dbs * 1000 / n_queries   (reserved core-hours:
                   cores x wall time)
    peak_ram_gb    peak_ram_gb (largest single task)
    gpu_h          gpu_h / n_target_dbs * 1000 / n_queries
    provenance     measured (the numbers come from the run's Nextflow traces)
    cost_usd_est   cpu_h * price_cpu_h + gpu_h * price_gpu_h

Building each relative's database is a separate step and is not counted. A setting with no
compute row keeps all five empty: not measured, never estimated.
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
from release_contract import TASK_REGION  # noqa: E402

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

DEFAULT_EXPERIMENT = "qfo_region_midi_plus"

LONG_SCHEMA = {
    "experiment": pl.String, "tool": pl.String, "tool_version": pl.String,
    "setting": pl.String, "query_set": pl.String, "target_db": pl.String,
    "target_db_version": pl.String, "target_mya_to_human": pl.Float64,
    "stratum_axis": pl.String, "stratum_bin": pl.String, "metric": pl.String,
    "value": pl.Float64, "n_instances": pl.Int64, "truth_source": pl.String,
    "truth_version": pl.String, "dedup_or_raw": pl.String, "source_path": pl.String,
    "source_commit": pl.String,
}
KEY = ["tool", "setting", "query_set", "target_db", "truth_source", "dedup_or_raw",
       "stratum_axis", "stratum_bin"]
CARRIED = ["experiment", "tool_version", "target_db_version", "target_mya_to_human",
           "n_instances", "truth_version", "source_path", "source_commit"]
METRIC_COLUMNS = {"fmax": "f_micro_w", "fmax_precision": "pr_micro_w", "fmax_recall": "rc_micro_w",
                  "fmax_threshold": "tau"}
# A key may lack these; their column is then empty, and reading back writes no row for it.
OPTIONAL_METRICS = {"fmax_threshold"}
TRUTH_IDS = {
    "Pfam-A domain instances": "pfam",
    "Pfam-N domain instances": "pfamn",
    "Swiss-Prot features": "swissprot",
}
SEARCH_STEP_SUFFIXES = ("Search", "Annotate")


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


def widen(long: pl.DataFrame) -> tuple[pl.DataFrame, list[str]]:
    """One row per KEY with one column per metric. Refuses input it cannot widen losslessly."""
    if long["value"].is_null().any():
        raise ValueError("results rows with an empty value cannot be widened without loss")
    if long.select(KEY + ["metric"]).is_duplicated().any():
        raise ValueError("more than one results row per key and metric")
    metrics = sorted(long["metric"].unique().to_list())
    required = [m for m in metrics if m not in OPTIONAL_METRICS]
    per_key = long.group_by(KEY).agg(
        pl.col("metric").filter(pl.col("metric").is_in(required)).n_unique().alias("n_metrics"),
        *[pl.col(c).n_unique().alias(f"n_{c}") for c in CARRIED],
    )
    if (per_key["n_metrics"] != len(required)).any():
        raise ValueError("some keys lack some metrics; widening would invent empty values")
    for c in CARRIED:
        if (per_key[f"n_{c}"] != 1).any():
            raise ValueError(f"column {c} differs between metrics of one key")
    wide = long.pivot(on="metric", index=KEY + CARRIED, values="value").sort(KEY)
    for m in OPTIONAL_METRICS - set(metrics):
        wide = wide.with_columns(pl.lit(None, dtype=pl.Float64).alias(m))
    return wide, sorted(set(metrics) | OPTIONAL_METRICS)


def join_cost(wide: pl.DataFrame, compute: pl.DataFrame, experiment: str,
              price_cpu_h: float, price_gpu_h: float) -> pl.DataFrame:
    """Add cpu_h, peak_ram_gb, gpu_h, provenance and cost_usd_est per 1,000 queries."""
    search = compute.filter(
        (pl.col("experiment") == experiment)
        & pl.any_horizontal([pl.col("step").str.ends_with(s) for s in SEARCH_STEP_SUFFIXES])
    )
    if search.select("tool", "setting").is_duplicated().any():
        raise ValueError("compute.parquet has more than one search step per (tool, setting)")
    per_1000 = 1000.0 / pl.col("n_queries") / pl.col("n_target_dbs")
    cost = search.select(
        "tool",
        "setting",
        (pl.col("cpu_h") * per_1000).alias("cpu_h"),
        pl.col("peak_ram_gb"),
        (pl.col("gpu_h") * per_1000).alias("gpu_h"),
        pl.when(pl.col("cpu_h").is_not_null()).then(pl.lit("measured")).alias("provenance"),
    ).with_columns(
        (pl.col("cpu_h") * price_cpu_h + pl.col("gpu_h").fill_null(0.0) * price_gpu_h)
        .alias("cost_usd_est")
    )
    joined = wide.join(cost, on=["tool", "setting"], how="left", maintain_order="left")
    if joined.height != wide.height:
        raise ValueError("joining compute.parquet changed the number of rows")
    return joined


def write_tsv(path: Path, header, rows) -> None:
    path.parent.mkdir(parents=True, exist_ok=True)
    with open(path, "w", encoding="utf-8", newline="") as handle:
        writer = csv.writer(handle, delimiter="\t", lineterminator="\n")
        writer.writerow(header)
        for row in rows:
            writer.writerow([fmt(row.get(column)) for column in header])


def write_release(results_path: Path, compute_path: Path, out_dir: Path, release_id: str,
                  title: str, source_repo: str, source_commit: str, run_date: str,
                  experiment: str = DEFAULT_EXPERIMENT,
                  price_cpu_h: float = PRICE_CPU_H, price_gpu_h: float = PRICE_GPU_H,
                  results: pl.DataFrame | None = None) -> Path:
    """Write the release folder. `results` replaces the file's rows (used by the checks)."""
    long = pl.read_parquet(results_path) if results is None else results
    missing = set(LONG_SCHEMA) - set(long.columns)
    if missing:
        raise ValueError(f"results.parquet lacks columns: {sorted(missing)}")
    long = long.filter(pl.col("experiment") == experiment).select(list(LONG_SCHEMA))
    if long.height == 0:
        raise ValueError(f"no results rows for experiment {experiment}")
    unknown = set(long["truth_source"].unique().to_list()) - set(TRUTH_IDS)
    if unknown:
        raise ValueError(f"truth sources with no short id: {sorted(unknown)}")

    wide, metrics = widen(long)
    compute = pl.read_parquet(compute_path)
    joined = join_cost(wide, compute, experiment, price_cpu_h, price_gpu_h)

    other_metrics = [m for m in metrics if m not in METRIC_COLUMNS]
    header = (["filename", "ns", "tau", "n", "pr_micro_w", "rc_micro_w", "f_micro_w", "cov_w",
               "task", "stratum_axis", "stratum_bin", "cpu_h", "peak_ram_gb", "gpu_h",
               "provenance", "cost_usd_est"]
              + [c for c in KEY if c not in ("stratum_axis", "stratum_bin")]
              + [c for c in CARRIED if c != "n_instances"] + other_metrics)
    rows = []
    for record in joined.iter_rows(named=True):
        row = dict(record)
        row.update({METRIC_COLUMNS[m]: record[m] for m in METRIC_COLUMNS})
        row["filename"] = method_filename(record["tool"], record["setting"])
        row["ns"] = TRUTH_IDS[record["truth_source"]]
        row["n"] = record["n_instances"]
        row["task"] = TASK_REGION
        rows.append(row)

    release_dir = out_dir / release_id
    write_tsv(release_dir / "results_ALL" / "evaluation_best_f_micro_w.tsv", header, rows)
    all_header = ["filename", "ns", "tau", "cov", "rc_micro_w", "pr_micro_w", "f_micro_w",
                  "task", "stratum_axis", "stratum_bin", "target_db", "dedup_or_raw",
                  "tool", "setting"]
    write_tsv(release_dir / "results_ALL" / "evaluation_all.tsv", all_header, rows)

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

    n_queries = compute.filter(pl.col("experiment") == experiment)["n_queries"].unique().drop_nulls().to_list()
    if len(n_queries) != 1:
        raise ValueError(f"compute.parquet should hold one n_queries value, found {n_queries}")
    overall = long.filter((pl.col("stratum_axis") == "all") & (pl.col("dedup_or_raw") == "raw"))
    info = {
        "task": TASK_REGION,
        "title": title,
        "experiment": experiment,
        "run_date": run_date,
        "n_queries": n_queries[0],
        "source_repo": source_repo,
        "source_commit": source_commit,
        "results_sha256": sha256(results_path),
        "compute_sha256": sha256(compute_path),
        "price_cpu_h_usd": price_cpu_h,
        "price_gpu_h_usd": price_gpu_h,
        "price_source": PRICE_SOURCE,
        "cpu_h_unit": ("reserved core-hours (cores x wall time) of the search step, per relative "
                       "searched and per 1,000 query proteins; building the relative's database "
                       "is not counted"),
        "gpu_h_unit": "GPU-hours of the search step, per relative searched and per 1,000 query proteins",
    }
    for truth, n in overall.group_by("truth_source").agg(pl.col("n_instances").max()).sort("truth_source").iter_rows():
        info[f"n_truth_instances_{TRUTH_IDS[truth]}"] = n
    write_tsv(release_dir / "release_info.tsv", ("key", "value"),
              [{"key": k, "value": v} for k, v in info.items()])
    return release_dir


def release_to_results(release_dir: Path) -> pl.DataFrame:
    """Read results_ALL/evaluation_best_f_micro_w.tsv back into the long table's rows."""
    path = Path(release_dir) / "results_ALL" / "evaluation_best_f_micro_w.tsv"
    back = {v: k for k, v in METRIC_COLUMNS.items()}
    out: dict[str, list] = {c: [] for c in LONG_SCHEMA}

    def typed(name: str, text: str):
        if text == "":
            return None
        dtype = LONG_SCHEMA[name]
        if dtype == pl.Int64:
            return int(text)
        if dtype == pl.Float64:
            return float(text)
        return text

    with open(path, encoding="utf-8", newline="") as handle:
        reader = csv.DictReader(handle, delimiter="\t")
        fixed = set(KEY) | set(CARRIED) | {
            "filename", "ns", "n", "cov_w", "task", "cpu_h", "peak_ram_gb", "gpu_h",
            "provenance", "cost_usd_est"}
        metric_columns = [c for c in reader.fieldnames if c in back or c not in fixed]
        for row in reader:
            row = dict(row, n_instances=row["n"])
            for column in metric_columns:
                if row[column] == "" and back.get(column, column) in OPTIONAL_METRICS:
                    continue
                for name in LONG_SCHEMA:
                    if name == "metric":
                        out[name].append(back.get(column, column))
                    elif name == "value":
                        out[name].append(float(row[column]))
                    else:
                        out[name].append(typed(name, row[name]))
    return pl.DataFrame(out, schema=LONG_SCHEMA)


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
    parser.add_argument("--experiment", default=DEFAULT_EXPERIMENT,
                        help=f"experiment to publish (default {DEFAULT_EXPERIMENT})")
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
        args.source_repo, args.source_commit, args.run_date, args.experiment,
        args.price_cpu_h, args.price_gpu_h,
    )
    print(f"wrote {release_dir}")
    if args.update_catalog:
        repo_root = Path(__file__).resolve().parent.parent
        print(f"wrote {update_catalog(args.out_dir, repo_root)}")
    return 0


if __name__ == "__main__":
    sys.exit(main())
