"""
Round-trip test for scripts/leaderboard_to_release.py, and contract checks for both tasks.

Needs the long results.parquet and compute.parquet from seanome/2024-kmerseek-analysis
(`make leaderboard-tables`, PR 148). Point LEADERBOARD_TABLES at the folder holding them:

    LEADERBOARD_TABLES=/path/to/results/leaderboard python -m pytest checks/
"""

import os
import sys
from pathlib import Path

import polars as pl
import pytest
from polars.testing import assert_frame_equal

REPO = Path(__file__).resolve().parent.parent
sys.path.insert(0, str(REPO / "scripts"))

import leaderboard_to_release as conv  # noqa: E402
import publish_release_windows as pub  # noqa: E402
import release_contract as rc  # noqa: E402

TABLES = Path(os.environ.get("LEADERBOARD_TABLES", REPO / "checks" / "data"))
needs_tables = pytest.mark.skipif(
    not (TABLES / "results.parquet").exists(), reason="set LEADERBOARD_TABLES to run"
)
EXPERIMENT = conv.DEFAULT_EXPERIMENT
ORDER = list(conv.LONG_SCHEMA)


def experiment_rows() -> pl.DataFrame:
    return pl.read_parquet(TABLES / "results.parquet").filter(pl.col("experiment") == EXPERIMENT)


def convert(tmp_path: Path, rows: pl.DataFrame) -> Path:
    return conv.write_release(
        TABLES / "results.parquet", TABLES / "compute.parquet", tmp_path / "releases",
        "region_test", "test", "seanome/2024-kmerseek-analysis", "0" * 40, "2026-09-13",
        results=rows,
    )


def sort(df: pl.DataFrame) -> pl.DataFrame:
    return df.select(ORDER).sort(conv.KEY + ["metric"])


@needs_tables
def test_ten_rows_round_trip(tmp_path):
    rows = experiment_rows()
    ten = rows.sample(n=10, seed=20261015)
    # A release row holds every metric of its key, so convert the ten rows' keys whole.
    keys = rows.join(ten.select(conv.KEY).unique(), on=conv.KEY, how="semi")
    back = conv.release_to_results(convert(tmp_path, keys))
    assert_frame_equal(sort(back), sort(keys), check_exact=True)
    found = back.join(ten, on=ORDER, how="semi", nulls_equal=True)
    assert found.height == 10


@needs_tables
def test_whole_experiment_round_trips(tmp_path):
    rows = experiment_rows()
    back = conv.release_to_results(convert(tmp_path, rows))
    assert back.height == rows.height
    assert_frame_equal(sort(back), sort(rows), check_exact=True)


@needs_tables
def test_key_missing_a_metric_is_refused(tmp_path):
    rows = experiment_rows()
    with pytest.raises(ValueError, match="lack some metrics"):
        convert(tmp_path, rows.slice(1))


@needs_tables
def test_key_without_threshold_is_kept(tmp_path):
    rows = experiment_rows()
    keys = rows.select(conv.KEY).unique(maintain_order=True).head(5)
    some = rows.join(keys, on=conv.KEY, how="semi")
    first = some.filter(pl.col("metric") == "fmax_threshold").head(1).select(conv.KEY)
    dropped = some.join(first.with_columns(pl.lit("fmax_threshold").alias("metric")),
                        on=conv.KEY + ["metric"], how="anti")
    assert dropped.height == some.height - 1
    back = conv.release_to_results(convert(tmp_path, dropped))
    assert_frame_equal(sort(back), sort(dropped), check_exact=True)


@needs_tables
def test_threshold_is_tau(tmp_path):
    rows = experiment_rows()
    pick = rows.filter((pl.col("tool") == "hmmer3_phmmer") & (pl.col("target_db") == "QfO mouse")
                       & (pl.col("truth_source") == "Pfam-A domain instances")
                       & (pl.col("stratum_axis") == "all") & (pl.col("dedup_or_raw") == "raw"))
    release_dir = convert(tmp_path, pick)
    best = pl.read_csv(release_dir / "results_ALL" / "evaluation_best_f_micro_w.tsv", separator="\t")
    assert best["tau"].to_list() == pick.filter(pl.col("metric") == "fmax_threshold")["value"].to_list()


@needs_tables
def test_cost_per_1000_queries_per_relative(tmp_path):
    rows = experiment_rows()
    wide, _ = conv.widen(rows.filter(pl.col("tool") == "hmmer3_phmmer"))
    compute = pl.read_parquet(TABLES / "compute.parquet")
    joined = conv.join_cost(wide, compute, EXPERIMENT, 2.0, 10.0)
    c = compute.filter((pl.col("experiment") == EXPERIMENT) & (pl.col("step") == "phmmerSearch")).row(0, named=True)
    expected = c["cpu_h"] / c["n_target_dbs"] * 1000 / c["n_queries"]
    row = joined.row(0, named=True)
    assert row["cpu_h"] == pytest.approx(expected)
    assert row["cost_usd_est"] == pytest.approx(expected * 2.0)
    assert row["provenance"] == "measured"


@needs_tables
def test_cost_is_empty_where_compute_has_no_row(tmp_path):
    rows = experiment_rows()
    wide, _ = conv.widen(rows)
    compute = pl.read_parquet(TABLES / "compute.parquet")
    joined = conv.join_cost(wide, compute, EXPERIMENT, conv.PRICE_CPU_H, conv.PRICE_GPU_H)
    no_cost = joined.filter(pl.col("cpu_h").is_null())
    assert no_cost.height > 0
    assert no_cost["provenance"].is_null().all()
    assert no_cost["cost_usd_est"].is_null().all()


@needs_tables
def test_region_release_passes_both_checkers(tmp_path):
    rows = experiment_rows()
    keys = rows.select(conv.KEY).unique(maintain_order=True).head(30)
    release_dir = convert(tmp_path, rows.join(keys, on=conv.KEY, how="semi"))
    assert rc.release_task(release_dir) == rc.TASK_REGION
    result = pub.validate_release_window(release_dir)
    assert result.is_valid, result.errors[:5]


@needs_tables
def test_wrong_task_value_is_refused(tmp_path):
    rows = experiment_rows()
    keys = rows.select(conv.KEY).unique(maintain_order=True).head(3)
    release_dir = convert(tmp_path, rows.join(keys, on=conv.KEY, how="semi"))
    best = release_dir / "results_ALL" / "evaluation_best_f_micro_w.tsv"
    best.write_text(best.read_text().replace("\tregion_transfer\t", "\tgo_whole_protein\t", 1))
    assert not pub.validate_release_window(release_dir).is_valid


def test_lafa_releases_still_pass():
    for release_dir in sorted((REPO / "data" / "releases").iterdir()):
        if release_dir.is_dir() and not release_dir.name.startswith("."):
            result = pub.validate_release_window(release_dir)
            assert result.is_valid, (release_dir.name, result.errors[:5])
            if rc.release_task(release_dir) == rc.TASK_GO:
                assert not (release_dir / rc.RELEASE_INFO_FILE).exists()


def test_go_row_without_extension_columns_reads_as_go():
    values = rc.extension_values({"filename": "blast_predictions.tsv"}, rc.TASK_GO)
    assert values == {"task": rc.TASK_GO, "stratumAxis": "all", "stratumBin": "all",
                      "cpuH": None, "peakRamGb": None, "gpuH": None, "provenance": None,
                      "costUsdEst": None}


def test_bad_provenance_is_refused():
    with pytest.raises(ValueError):
        rc.extension_values({"provenance": "guessed"}, rc.TASK_GO)
