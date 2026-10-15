"""
Round-trip test for scripts/leaderboard_to_release.py, and contract checks for both tasks.

Needs results.parquet and compute.parquet from seanome/2024-kmerseek-analysis
(`make leaderboard-tables`). Point LEADERBOARD_TABLES at the folder holding them:

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


def convert(tmp_path: Path, results: pl.DataFrame) -> Path:
    results_path = tmp_path / "results.parquet"
    results.write_parquet(results_path)
    return conv.write_release(
        results_path, TABLES / "compute.parquet", tmp_path / "releases", "region_test",
        "test", "seanome/2024-kmerseek-analysis", "0" * 40, "2026-09-13",
    )


@needs_tables
def test_ten_rows_round_trip(tmp_path):
    results = pl.read_parquet(TABLES / "results.parquet")
    ten = results.sample(n=10, seed=20261015)
    back = conv.release_to_results(convert(tmp_path, ten))
    assert_frame_equal(back, ten.select(conv.RESULTS_COLUMNS), check_exact=True)


@needs_tables
def test_whole_table_round_trips(tmp_path):
    results = pl.read_parquet(TABLES / "results.parquet")
    back = conv.release_to_results(convert(tmp_path, results))
    assert_frame_equal(back, results.select(conv.RESULTS_COLUMNS), check_exact=True)


@needs_tables
def test_cost_is_empty_where_compute_has_no_row(tmp_path):
    results = pl.read_parquet(TABLES / "results.parquet")
    compute = pl.read_parquet(TABLES / "compute.parquet")
    joined = conv.join_cost(results, compute, conv.PRICE_CPU_H, conv.PRICE_GPU_H)
    unmatched = results.join(compute.select("tool", "setting", "species"),
                             on=["tool", "setting", "species"], how="anti")
    assert unmatched.height > 0
    assert joined.filter(pl.col("provenance").is_null()).height == unmatched.height
    assert joined.filter(pl.col("cost_usd_est").is_null()).height == unmatched.height


@needs_tables
def test_cost_formula(tmp_path):
    results = pl.read_parquet(TABLES / "results.parquet")
    compute = pl.read_parquet(TABLES / "compute.parquet")
    row = conv.join_cost(results, compute, 2.0, 10.0).filter(
        pl.col("tool") == "prostt5").row(0, named=True)
    assert row["cost_usd_est"] == pytest.approx(row["cpu_h"] * 2.0 + row["gpu_h"] * 10.0)


@needs_tables
def test_region_release_passes_both_checkers(tmp_path):
    results = pl.read_parquet(TABLES / "results.parquet").head(200)
    release_dir = convert(tmp_path, results)
    assert rc.release_task(release_dir) == rc.TASK_REGION
    result = pub.validate_release_window(release_dir)
    assert result.is_valid, result.errors[:5]


@needs_tables
def test_wrong_task_value_is_refused(tmp_path):
    release_dir = convert(tmp_path, pl.read_parquet(TABLES / "results.parquet").head(5))
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
