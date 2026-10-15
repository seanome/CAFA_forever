#!/usr/bin/env python3
"""
Validate and publish frontend-ready release windows.

This script implements two backend tasks:
1) Standardize a single publish surface under data/releases.
2) Post-hoc validate each release window discovered in data/time_periods.

Only windows that pass validation are published as ready releases.
"""

from __future__ import annotations

import argparse
import csv
import json
import shutil
from dataclasses import dataclass, field
from datetime import datetime, timezone
from pathlib import Path
from typing import Dict, Iterable, List, Sequence, Set, Tuple

import sys

sys.path.insert(0, str(Path(__file__).resolve().parent))
from release_contract import (  # noqa: E402
    TASK_NS,
    TASK_REGION,
    TASK_SUBSETS,
    all_columns,
    all_numeric,
    best_columns,
    best_numeric,
    release_task,
    required_release_files,
    validate_extension_columns,
)


SUBSETS: Sequence[str] = ("NK", "LK", "PK")
ALLOWED_GT_ASPECTS: Set[str] = {"P", "F", "C"}
ALLOWED_NS: Set[str] = {
    "biological_process",
    "molecular_function",
    "cellular_component",
}

REQUIRED_RELEASE_FILES: Sequence[str] = (
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

REQUIRED_METHOD_COLUMNS: Sequence[str] = ("filename", "label")
REQUIRED_GT_COLUMNS: Sequence[str] = ("EntryID", "term", "aspect")
REQUIRED_BEST_COLUMNS: Sequence[str] = (
    "filename",
    "ns",
    "tau",
    "n",
    "pr_micro_w",
    "rc_micro_w",
    "f_micro_w",
    "cov_w",
)
REQUIRED_ALL_COLUMNS: Sequence[str] = (
    "filename",
    "ns",
    "tau",
    "cov",
    "rc_micro_w",
    "pr_micro_w",
    "f_micro_w",
)

NUMERIC_BEST_COLUMNS: Sequence[str] = (
    "tau",
    "n",
    "pr_micro_w",
    "rc_micro_w",
    "f_micro_w",
    "cov_w",
)
NUMERIC_ALL_COLUMNS: Sequence[str] = (
    "tau",
    "cov",
    "rc_micro_w",
    "pr_micro_w",
    "f_micro_w",
)


@dataclass
class ValidationResult:
    release_id: str
    source_dir: Path
    errors: List[str] = field(default_factory=list)

    @property
    def is_valid(self) -> bool:
        return not self.errors


def parse_args() -> argparse.Namespace:
    parser = argparse.ArgumentParser(
        description="Validate and publish release windows from data/time_periods to data/releases."
    )
    parser.add_argument(
        "--repo-root",
        type=Path,
        default=Path(__file__).resolve().parent.parent,
        help="Repository root directory (default: parent of this script).",
    )
    parser.add_argument(
        "--source-dir",
        type=Path,
        default=None,
        help="Directory containing release windows to validate (default: <repo>/data/time_periods).",
    )
    parser.add_argument(
        "--publish-dir",
        type=Path,
        default=None,
        help="Directory where validated releases are published (default: <repo>/data/releases).",
    )
    parser.add_argument(
        "--dry-run",
        action="store_true",
        help="Validate and report only; do not copy files or write catalog.",
    )
    parser.add_argument(
        "--shared-method-names",
        type=Path,
        default=None,
        help=(
            "Optional path to a shared method_names.tsv used for all release windows. "
            "When provided, this file is used for validation and copied into each "
            "published release as method_names.tsv."
        ),
    )
    parser.add_argument(
        "--results-copy-mode",
        choices=("all", "minimal"),
        default="all",
        help=(
            "How to copy files from each results_<subset> folder into data/releases: "
            "'all' copies all files (default), 'minimal' copies only "
            "evaluation_best_f_micro_w.tsv and evaluation_all.tsv."
        ),
    )
    return parser.parse_args()


def read_tsv(path: Path) -> Tuple[List[str], List[Dict[str, str]]]:
    with path.open("r", encoding="utf-8", newline="") as handle:
        reader = csv.DictReader(handle, delimiter="\t")
        if reader.fieldnames is None:
            return [], []
        headers = [h.strip() for h in reader.fieldnames]
        rows: List[Dict[str, str]] = []
        for row in reader:
            normalized = {}
            for key, value in row.items():
                if key is None:
                    continue
                normalized[key.strip()] = (value or "").strip()
            rows.append(normalized)
        return headers, rows


def add_missing_column_errors(
    errors: List[str],
    path: Path,
    headers: Sequence[str],
    required_columns: Iterable[str],
) -> bool:
    missing = [column for column in required_columns if column not in headers]
    if missing:
        errors.append(f"{path}: missing required columns: {', '.join(missing)}")
        return True
    return False


def validate_numeric_columns(
    errors: List[str],
    path: Path,
    rows: Sequence[Dict[str, str]],
    numeric_columns: Iterable[str],
) -> None:
    for row_index, row in enumerate(rows, start=2):
        for column in numeric_columns:
            value = row.get(column, "")
            if value == "":
                errors.append(f"{path}:{row_index}: empty numeric value in column '{column}'")
                continue
            try:
                float(value)
            except ValueError:
                errors.append(
                    f"{path}:{row_index}: non-numeric value '{value}' in column '{column}'"
                )


def validate_method_names(method_file: Path, errors: List[str]) -> Set[str]:
    headers, rows = read_tsv(method_file)
    if add_missing_column_errors(errors, method_file, headers, REQUIRED_METHOD_COLUMNS):
        return set()

    filenames: Set[str] = set()
    labels: Set[str] = set()
    for row_index, row in enumerate(rows, start=2):
        filename = row.get("filename", "")
        label = row.get("label", "")
        if not filename:
            errors.append(f"{method_file}:{row_index}: empty filename")
            continue
        if not label:
            errors.append(f"{method_file}:{row_index}: empty label")
            continue

        filenames.add(filename)
        if label in labels:
            errors.append(f"{method_file}:{row_index}: duplicate label '{label}'")
        labels.add(label)

    if not rows:
        errors.append(f"{method_file}: file is empty")
    return filenames


def validate_ground_truth_file(path: Path, errors: List[str]) -> None:
    headers, rows = read_tsv(path)
    if add_missing_column_errors(errors, path, headers, REQUIRED_GT_COLUMNS):
        return

    for row_index, row in enumerate(rows, start=2):
        aspect = row.get("aspect", "")
        if aspect not in ALLOWED_GT_ASPECTS:
            errors.append(
                f"{path}:{row_index}: invalid aspect '{aspect}', expected one of {sorted(ALLOWED_GT_ASPECTS)}"
            )


def validate_evaluation_file(
    path: Path,
    errors: List[str],
    required_columns: Sequence[str],
    numeric_columns: Sequence[str],
    expected_filenames: Set[str],
    observed_filenames: Set[str],
    allowed_ns: Set[str] = ALLOWED_NS,
    task: str | None = None,
) -> None:
    headers, rows = read_tsv(path)
    if add_missing_column_errors(errors, path, headers, required_columns):
        return

    validate_numeric_columns(errors, path, rows, numeric_columns)
    if task is not None:
        errors.extend(validate_extension_columns(rows, str(path), task)[:20])

    for row_index, row in enumerate(rows, start=2):
        ns_value = row.get("ns", "")
        if ns_value not in allowed_ns:
            errors.append(
                f"{path}:{row_index}: invalid ns '{ns_value}', expected one of {sorted(allowed_ns)}"
            )

        filename = row.get("filename", "")
        if not filename:
            errors.append(f"{path}:{row_index}: empty filename")
            continue

        observed_filenames.add(filename)
        if filename not in expected_filenames:
            errors.append(
                f"{path}:{row_index}: filename '{filename}' is missing from method_names.tsv"
            )


def validate_release_window(
    release_dir: Path,
    shared_method_names: Path | None = None,
) -> ValidationResult:
    result = ValidationResult(release_id=release_dir.name, source_dir=release_dir)

    try:
        task = release_task(release_dir)
    except ValueError as exc:
        result.errors.append(str(exc))
        return result
    if task == TASK_REGION:
        return validate_region_release(release_dir, result)

    for relative_path in REQUIRED_RELEASE_FILES:
        if relative_path == "method_names.tsv" and shared_method_names is not None:
            continue
        file_path = release_dir / relative_path
        if not file_path.exists():
            result.errors.append(f"{file_path}: missing required file")

    if result.errors:
        return result

    method_file = shared_method_names or (release_dir / "method_names.tsv")
    method_filenames = validate_method_names(method_file, result.errors)

    for subset in SUBSETS:
        validate_ground_truth_file(release_dir / f"groundtruth_{subset}.tsv", result.errors)

    observed_filenames: Set[str] = set()
    for subset in SUBSETS:
        subset_dir = release_dir / f"results_{subset}"
        validate_evaluation_file(
            path=subset_dir / "evaluation_best_f_micro_w.tsv",
            errors=result.errors,
            required_columns=REQUIRED_BEST_COLUMNS,
            numeric_columns=NUMERIC_BEST_COLUMNS,
            expected_filenames=method_filenames,
            observed_filenames=observed_filenames,
            task=task,
        )
        validate_evaluation_file(
            path=subset_dir / "evaluation_all.tsv",
            errors=result.errors,
            required_columns=REQUIRED_ALL_COLUMNS,
            numeric_columns=NUMERIC_ALL_COLUMNS,
            expected_filenames=method_filenames,
            observed_filenames=observed_filenames,
            task=task,
        )

    if method_filenames and not observed_filenames:
        result.errors.append(f"{release_dir}: no method filenames found in evaluation tables")

    return result


def validate_region_release(release_dir: Path, result: ValidationResult) -> ValidationResult:
    """A region_transfer release: release_info.tsv and one subset, results_ALL."""
    for relative_path in required_release_files(TASK_REGION):
        if not (release_dir / relative_path).exists():
            result.errors.append(f"{release_dir / relative_path}: missing required file")
    if result.errors:
        return result

    method_filenames = validate_method_names(release_dir / "method_names.tsv", result.errors)
    observed_filenames: Set[str] = set()
    for subset in TASK_SUBSETS[TASK_REGION]:
        subset_dir = release_dir / f"results_{subset}"
        for table, columns, numeric in (
            ("evaluation_best_f_micro_w.tsv", best_columns(TASK_REGION), best_numeric(TASK_REGION)),
            ("evaluation_all.tsv", all_columns(TASK_REGION), all_numeric(TASK_REGION)),
        ):
            validate_evaluation_file(
                path=subset_dir / table,
                errors=result.errors,
                required_columns=columns,
                numeric_columns=numeric,
                expected_filenames=method_filenames,
                observed_filenames=observed_filenames,
                allowed_ns=set(TASK_NS[TASK_REGION]),
                task=TASK_REGION,
            )
    if method_filenames and not observed_filenames:
        result.errors.append(f"{release_dir}: no method filenames found in evaluation tables")
    return result


def ensure_clean_dir(path: Path) -> None:
    if path.exists():
        shutil.rmtree(path)
    path.mkdir(parents=True, exist_ok=True)


def copy_release_contract(
    source_dir: Path,
    target_dir: Path,
    results_copy_mode: str,
    shared_method_names: Path | None = None,
) -> None:
    staging_dir = target_dir.parent / f".{target_dir.name}.staging"
    if release_task(source_dir) == TASK_REGION:
        # A region release has no ground-truth files or GO subsets: copy it whole.
        if staging_dir.exists():
            shutil.rmtree(staging_dir)
        shutil.copytree(source_dir, staging_dir)
        if target_dir.exists():
            shutil.rmtree(target_dir)
        staging_dir.rename(target_dir)
        return
    ensure_clean_dir(staging_dir)

    files_to_copy = [
        "groundtruth_NK.tsv",
        "groundtruth_LK.tsv",
        "groundtruth_PK.tsv",
        "groundtruth_PK_known.tsv",
        "groundtruth_terms_of_interest.txt",
        "groundtruth_targets.tsv",
        "groundtruth_targets.fasta",
        "method_availability.tsv",
    ]

    for relative_path in files_to_copy:
        source_path = source_dir / relative_path
        if source_path.exists():
            destination_path = staging_dir / relative_path
            destination_path.parent.mkdir(parents=True, exist_ok=True)
            shutil.copy2(source_path, destination_path)

    method_source = shared_method_names or (source_dir / "method_names.tsv")
    if method_source.exists():
        shutil.copy2(method_source, staging_dir / "method_names.tsv")

    for subset in SUBSETS:
        src_subset_dir = source_dir / f"results_{subset}"
        dst_subset_dir = staging_dir / f"results_{subset}"
        dst_subset_dir.mkdir(parents=True, exist_ok=True)

        if results_copy_mode == "minimal":
            for filename in ("evaluation_best_f_micro_w.tsv", "evaluation_all.tsv"):
                shutil.copy2(src_subset_dir / filename, dst_subset_dir / filename)
        else:
            for source_path in src_subset_dir.rglob("*"):
                if source_path.is_file():
                    relative_path = source_path.relative_to(src_subset_dir)
                    destination_path = dst_subset_dir / relative_path
                    destination_path.parent.mkdir(parents=True, exist_ok=True)
                    shutil.copy2(source_path, destination_path)

    if target_dir.exists():
        shutil.rmtree(target_dir)
    staging_dir.rename(target_dir)


def build_catalog_entries(
    results: Sequence[ValidationResult], publish_dir: Path, repo_root: Path | None = None
) -> List[Dict[str, str]]:
    entries: List[Dict[str, str]] = []
    for result in sorted(results, key=lambda r: r.release_id):
        status = "ready" if result.is_valid else "invalid"
        release_path = publish_dir / result.release_id
        if repo_root is not None:
            try:
                catalog_path = release_path.resolve().relative_to(repo_root.resolve()).as_posix()
            except ValueError:
                catalog_path = str(release_path.resolve())
        else:
            catalog_path = str(release_path)
        entries.append(
            {
                "release_id": result.release_id,
                "path": catalog_path,
                "status": status,
            }
        )
    return entries


def main() -> int:
    args = parse_args()

    repo_root = args.repo_root.resolve()
    source_dir = (args.source_dir or (repo_root / "data" / "time_periods")).resolve()
    publish_dir = (args.publish_dir or (repo_root / "data" / "releases")).resolve()
    shared_method_names = args.shared_method_names
    if shared_method_names is not None:
        shared_method_names = shared_method_names.resolve()

    if shared_method_names is not None and not shared_method_names.exists():
        print(f"Error: shared method_names file does not exist: {shared_method_names}")
        return 2

    if not source_dir.exists():
        print(f"Error: source directory does not exist: {source_dir}")
        return 2

    release_dirs = sorted(path for path in source_dir.iterdir() if path.is_dir())
    if not release_dirs:
        print(f"No release directories found in: {source_dir}")
        return 0

    results: List[ValidationResult] = [
        validate_release_window(path, shared_method_names=shared_method_names)
        for path in release_dirs
    ]

    if not args.dry_run:
        publish_dir.mkdir(parents=True, exist_ok=True)

    for result in results:
        if result.is_valid and not args.dry_run:
            copy_release_contract(
                result.source_dir,
                publish_dir / result.release_id,
                args.results_copy_mode,
                shared_method_names=shared_method_names,
            )

    catalog = {
        "generated_at": datetime.now(timezone.utc).replace(microsecond=0).isoformat(),
        "validator": "scripts/publish_release_windows.py",
        "releases": build_catalog_entries(results, publish_dir, repo_root=repo_root),
    }

    if not args.dry_run:
        catalog_path = publish_dir / "catalog.json"
        with catalog_path.open("w", encoding="utf-8") as handle:
            json.dump(catalog, handle, indent=2)
            handle.write("\n")

    print(f"Source windows: {len(results)}")
    print(f"Valid windows: {sum(1 for r in results if r.is_valid)}")
    print(f"Invalid windows: {sum(1 for r in results if not r.is_valid)}")

    for result in results:
        state = "READY" if result.is_valid else "INVALID"
        print(f"[{state}] {result.release_id}")
        if not result.is_valid:
            for error in result.errors:
                print(f"  - {error}")

    return 0 if all(result.is_valid for result in results) else 1


if __name__ == "__main__":
    raise SystemExit(main())
