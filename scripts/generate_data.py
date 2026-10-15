#!/usr/bin/env python3
"""
Shared LAFA data contract generator.

Transforms validated release TSV files into JSON consumed by the React frontend.
The validation rules mirror the Streamlit frontend's release/data guardrails.
"""

import csv
import json
import sys
from collections import defaultdict
from datetime import datetime, timezone
from pathlib import Path


SCRIPT_DIR = Path(__file__).resolve().parent
REPO_ROOT = SCRIPT_DIR.parent
FRONTEND_DIR = REPO_ROOT / "frontend"
DATA_ROOT = REPO_ROOT / "data"
RELEASES_DIR = DATA_ROOT / "releases"
OUTPUT_DIR = FRONTEND_DIR / "public" / "data"

sys.path.insert(0, str(SCRIPT_DIR))
from release_contract import (  # noqa: E402
    REGION_EXTRA_COLUMNS,
    REGION_FLOAT_COLUMNS,
    REGION_INT_COLUMNS,
    REGION_METRIC_COLUMNS,
    REGION_SOURCE_COLUMNS,
    TASK_GO,
    TASK_LABELS,
    TASK_NS,
    TASK_REGION,
    TASK_SUBSETS,
    all_columns,
    all_numeric,
    best_columns,
    best_numeric,
    extension_values,
    optional_float,
    optional_int,
    read_release_info,
    release_task,
    required_release_files,
    validate_extension_columns,
)

# Import config from app module
sys.path.insert(0, str(REPO_ROOT / "app"))
try:
    from config import (
        DATA_DATES,
        METHOD_HELP_MSG,
        METHOD_DOCKER_URLS,
        BASELINE_METHOD_LABELS,
        GO_ASPECTS,
    )
except ImportError:
    print("Warning: Could not import from app/config.py, using defaults")
    DATA_DATES = {}
    METHOD_HELP_MSG = {}
    METHOD_DOCKER_URLS = {}
    BASELINE_METHOD_LABELS = set()
    GO_ASPECTS = {
        "biological_process": "Biological Process",
        "molecular_function": "Molecular Function",
        "cellular_component": "Cellular Component",
    }

SUBSETS = ["NK", "LK", "PK"]
ASPECT_SHORT = {"biological_process": "P", "molecular_function": "F", "cellular_component": "C"}
ASPECT_LONG = {v: k for k, v in ASPECT_SHORT.items()}
ALLOWED_ASPECTS = set(ASPECT_SHORT)
ALLOWED_GT_ASPECTS = set(ASPECT_LONG)
REQUIRED_GT_COLUMNS = {"EntryID", "aspect"}
REQUIRED_METHOD_COLUMNS = {"filename", "label"}
BOOLEAN_VALUES = {"true": True, "false": False, "1": True, "0": False, "yes": True, "no": False}


class ContractError(ValueError):
    """Raised when a release does not satisfy the shared frontend data contract."""


def parse_tsv(path: Path) -> list[dict]:
    """Parse a TSV file into a list of dicts."""
    if not path.exists():
        raise ContractError(f"{path} does not exist")

    with path.open("r", encoding="utf-8", newline="") as f:
        reader = csv.DictReader(f, delimiter="\t")
        if reader.fieldnames is None:
            return []
        return [dict(row) for row in reader if any((value or "").strip() for value in row.values())]


def validate_required_columns(rows: list[dict], required_columns: set[str], name: str) -> None:
    fieldnames = set(rows[0].keys()) if rows else set()
    missing = sorted(required_columns - fieldnames)
    if missing:
        raise ContractError(f"{name} missing required columns: {', '.join(missing)}")


def validate_numeric_columns(rows: list[dict], numeric_columns: list[str], name: str) -> None:
    for row_idx, row in enumerate(rows, start=2):
        for column in numeric_columns:
            try:
                float(row.get(column, ""))
            except (TypeError, ValueError):
                raise ContractError(f"{name} has non-numeric value in column '{column}' on row {row_idx}")


def validate_ns_values(rows: list[dict], name: str) -> None:
    invalid = sorted({str(row.get("ns", "")).strip() for row in rows} - ALLOWED_ASPECTS)
    if invalid:
        raise ContractError(f"{name} has invalid ns values: {', '.join(invalid)}")


def validate_gt_aspects(rows: list[dict], name: str) -> None:
    invalid = sorted({str(row.get("aspect", "")).strip() for row in rows} - ALLOWED_GT_ASPECTS)
    if invalid:
        raise ContractError(f"{name} has invalid aspect values: {', '.join(invalid)}")


def coerce_bool(value: str, field_name: str) -> bool:
    normalized = str(value).strip().lower()
    if normalized not in BOOLEAN_VALUES:
        raise ContractError(f"{field_name} must contain true/false style values")
    return BOOLEAN_VALUES[normalized]


def inspect_release_dir(release_dir: Path, task: str = TASK_GO) -> list[str]:
    errors = []
    for relative_path in required_release_files(task):
        if not (release_dir / relative_path).exists():
            errors.append(f"missing {relative_path}")
    return errors


def split_release_id(release_id: str) -> tuple[str, str]:
    """Split a release folder name into start and end time points."""
    parts = str(release_id).split("_")
    if len(parts) != 4:
        raise ValueError(f"Release id must follow Mon_YYYY_Mon_YYYY: {release_id}")
    return "_".join(parts[:2]), "_".join(parts[2:])


def parse_timepoint_label(timepoint_label: str) -> datetime:
    """Parse a Mon_YYYY label into a sortable datetime."""
    return datetime.strptime(str(timepoint_label), "%b_%Y")


def normalize_catalog_entry(entry: dict) -> dict:
    release_id = entry.get("release_id") or entry.get("id") or entry.get("name")
    release_path = entry.get("path")
    status = entry.get("status", "ready")

    if not release_id and release_path:
        release_id = Path(release_path).name
    if not release_id:
        raise ContractError("catalog entry missing release_id")

    if release_path:
        path = Path(release_path)
        if not path.is_absolute():
            path = REPO_ROOT / path
    else:
        path = RELEASES_DIR / release_id

    return {"release_id": release_id, "path": path, "status": status}


def generate_catalog() -> dict:
    """Generate catalog.json from existing catalog and release directories."""
    catalog_path = RELEASES_DIR / "catalog.json"

    if catalog_path.exists():
        with open(catalog_path, "r", encoding="utf-8") as f:
            raw_catalog = json.load(f)
        raw_releases = raw_catalog.get("releases", raw_catalog)
    else:
        raw_releases = []
        for item in sorted(RELEASES_DIR.iterdir()):
            if item.is_dir() and not item.name.startswith("."):
                raw_releases.append({
                    "release_id": item.name,
                    "path": str(item.relative_to(REPO_ROOT)),
                    "status": "ready"
                })

    releases = []
    other_task_releases = []
    invalid = {}
    timepoints = set()

    for entry in raw_releases:
        try:
            normalized_entry = normalize_catalog_entry(entry)
            release_id = normalized_entry["release_id"]
            release_dir = normalized_entry["path"]
            status = normalized_entry["status"]
        except ContractError as exc:
            invalid["catalog"] = invalid.get("catalog", []) + [str(exc)]
            continue

        try:
            if status != "ready":
                invalid[release_id] = [f"catalog status is '{status}'"]
                continue
            if not release_dir.exists():
                invalid[release_id] = [f"release path not found: {release_dir}"]
                continue
            task = release_task(release_dir)
            release_errors = inspect_release_dir(release_dir, task)
            if release_errors:
                invalid[release_id] = release_errors
                continue

            if task != TASK_GO:
                # A non-GO release is not a T0-T1 window, so it stays off the timeline.
                info = read_release_info(release_dir)
                other_task_releases.append({
                    "id": release_id,
                    "startTimepoint": info.get("start_timepoint", ""),
                    "endTimepoint": info.get("end_timepoint", ""),
                    "status": "ready",
                    "task": task,
                    "title": info.get("title", release_id),
                })
                continue

            start_tp, end_tp = split_release_id(release_id)
            timepoints.add(start_tp)
            timepoints.add(end_tp)

            releases.append({
                "id": release_id,
                "startTimepoint": start_tp,
                "endTimepoint": end_tp,
                "status": "ready",
                "task": TASK_GO,
            })
        except ValueError as e:
            invalid[release_id] = [str(e)]
            continue

    releases.sort(key=lambda r: (parse_timepoint_label(r["startTimepoint"]),
                                  parse_timepoint_label(r["endTimepoint"])))
    releases.extend(sorted(other_task_releases, key=lambda r: r["id"]))
    sorted_timepoints = sorted(timepoints, key=parse_timepoint_label)
    timepoint_dates = {
        timepoint: {
            "goa": DATA_DATES.get(timepoint, {}).get("goa", "N/A"),
            "uniprot": DATA_DATES.get(timepoint, {}).get("uniprot", "N/A"),
        }
        for timepoint in sorted_timepoints
    }

    return {
        "releases": releases,
        "invalidReleases": invalid,
        "timepoints": sorted_timepoints,
        "timepointDates": timepoint_dates,
        "generatedAt": datetime.now(timezone.utc).isoformat()
    }


def generate_methods_config() -> dict:
    """Generate methods.json with help text, URLs, and baseline flags."""
    methods = {}

    # Combine all known methods from various sources
    all_method_names = set(METHOD_HELP_MSG.keys()) | set(METHOD_DOCKER_URLS.keys()) | BASELINE_METHOD_LABELS

    for name in all_method_names:
        methods[name] = {
            "label": name,
            "description": METHOD_HELP_MSG.get(name, ""),
            "dockerUrl": METHOD_DOCKER_URLS.get(name, ""),
            "isBaseline": name in BASELINE_METHOD_LABELS
        }

    return {
        "methods": methods,
        "aspects": GO_ASPECTS,
        "subsets": {
            "NK": "No Knowledge - targets with no existing experimental annotations",
            "LK": "Limited Knowledge - targets with some existing experimental annotations",
            "PK": "Partial Knowledge - targets with existing experimental annotations"
        },
        "tasks": TASK_LABELS,
        "taskSubsets": {
            TASK_REGION: {
                "ALL": "All query proteins; region transfer has no knowledge settings"
            }
        },
    }


def count_groundtruth_targets(release_dir: Path) -> dict:
    """Count targets by subset and aspect from groundtruth files."""
    counts = {"uniqueAcrossSubsets": 0}
    all_entry_ids = set()

    for subset in SUBSETS:
        gt_path = release_dir / f"groundtruth_{subset}.tsv"
        rows = parse_tsv(gt_path)
        validate_required_columns(rows, REQUIRED_GT_COLUMNS, str(gt_path))
        validate_gt_aspects(rows, str(gt_path))

        if not rows:
            counts[subset] = {"total": 0, "byAspect": {}}
            continue

        rows = [row for row in rows if row.get("EntryID") and row.get("aspect")]
        entry_ids = set(row.get("EntryID", "") for row in rows)
        all_entry_ids.update(entry_ids)
        total = len(entry_ids)

        aspect_counts = defaultdict(set)
        for row in rows:
            entry_id = row.get("EntryID", "")
            aspect_code = row.get("aspect", "")
            if entry_id and aspect_code:
                aspect_name = ASPECT_LONG.get(aspect_code, aspect_code)
                aspect_counts[aspect_name].add(entry_id)

        counts[subset] = {
            "total": total,
            "byAspect": {
                aspect: len(ids) for aspect, ids in aspect_counts.items()
            }
        }

    counts["uniqueAcrossSubsets"] = len(all_entry_ids)
    return counts


def generate_region_meta(release_id: str, release_dir: Path) -> dict:
    """meta.json for a region_transfer release, read from release_info.tsv."""
    info = read_release_info(release_dir)
    n_queries = int(info["n_queries"])
    by_truth = {
        truth: int(info[f"n_truth_instances_{truth}"])
        for truth in TASK_NS[TASK_REGION]
        if info.get(f"n_truth_instances_{truth}")
    }
    return {
        "releaseId": release_id,
        "task": TASK_REGION,
        "title": info.get("title", release_id),
        "startTimepoint": info.get("start_timepoint", ""),
        "endTimepoint": info.get("end_timepoint", ""),
        "dates": {"goaStart": "N/A", "goaEnd": "N/A", "uniprotStart": "N/A", "uniprotEnd": "N/A"},
        "targetCounts": {
            "ALL": {"total": n_queries, "byAspect": by_truth},
            "uniqueAcrossSubsets": n_queries,
        },
        "info": info,
        "sources": region_sources(release_dir),
    }


def region_sources(release_dir: Path) -> dict:
    """Each source column's values, once per tool (versions) or once overall (the rest)."""
    rows = parse_tsv(release_dir / "results_ALL" / "evaluation_best_f_micro_w.tsv")
    out = {}
    for column in REGION_SOURCE_COLUMNS:
        if column == "tool_version":
            by_tool = defaultdict(set)
            for row in rows:
                by_tool[row["tool"]].add(row.get(column, ""))
            out[camel(column)] = {tool: sorted(v) for tool, v in sorted(by_tool.items())}
        elif column == "truth_version":
            by_truth = defaultdict(set)
            for row in rows:
                by_truth[row["ns"]].add(row.get(column, ""))
            out[camel(column)] = {truth: sorted(v) for truth, v in sorted(by_truth.items())}
        else:
            out[camel(column)] = sorted({row.get(column, "") for row in rows})
    return out


def generate_release_meta(release_id: str, release_dir: Path) -> dict:
    """Generate meta.json for a release."""
    if release_task(release_dir) == TASK_REGION:
        return generate_region_meta(release_id, release_dir)
    start_tp, end_tp = split_release_id(release_id)

    start_dates = DATA_DATES.get(start_tp, {})
    end_dates = DATA_DATES.get(end_tp, {})

    return {
        "releaseId": release_id,
        "startTimepoint": start_tp,
        "endTimepoint": end_tp,
        "dates": {
            "goaStart": start_dates.get("goa", "N/A"),
            "goaEnd": end_dates.get("goa", "N/A"),
            "uniprotStart": start_dates.get("uniprot", "N/A"),
            "uniprotEnd": end_dates.get("uniprot", "N/A")
        },
        "targetCounts": count_groundtruth_targets(release_dir)
    }


def generate_release_methods(release_dir: Path) -> dict:
    """Generate methods.json for a release from method_names and method_availability."""
    methods = {}
    task = release_task(release_dir)
    subsets = TASK_SUBSETS[task]

    names_rows = parse_tsv(release_dir / "method_names.tsv")
    validate_required_columns(names_rows, REQUIRED_METHOD_COLUMNS, str(release_dir / "method_names.tsv"))
    for row in names_rows:
        filename = row.get("filename", "").strip()
        label = row.get("label", "").strip()
        group = row.get("group", "")
        if label:
            methods[label] = {
                "filename": filename,
                "label": label,
                "group": group,
                "availability": {}
            }
            if task != TASK_GO:
                methods[label]["tool"] = row.get("tool", "")
                methods[label]["setting"] = row.get("setting", "")

    avail_rows = parse_tsv(release_dir / "method_availability.tsv")
    validate_required_columns(avail_rows, {"method", *subsets}, str(release_dir / "method_availability.tsv"))
    for row in avail_rows:
        method_name = row.get("method", "")
        if method_name in methods:
            for subset in subsets:
                methods[method_name]["availability"][subset] = coerce_bool(
                    row.get(subset, ""),
                    f"{release_dir / 'method_availability.tsv'} column '{subset}'",
                )

    return {"methods": methods}


def load_method_name_map(release_dir: Path) -> dict[str, str]:
    names_rows = parse_tsv(release_dir / "method_names.tsv")
    validate_required_columns(names_rows, REQUIRED_METHOD_COLUMNS, str(release_dir / "method_names.tsv"))
    return {
        row.get("filename", "").strip(): row.get("label", "").strip()
        for row in names_rows
        if row.get("filename") and row.get("label")
    }


def validate_ns_for_task(rows: list[dict], task: str, name: str) -> None:
    if task == TASK_GO:
        validate_ns_values(rows, name)
        return
    invalid = sorted({str(row.get("ns", "")).strip() for row in rows} - set(TASK_NS[task]))
    if invalid:
        raise ContractError(f"{name} has invalid ns values for {task}: {', '.join(invalid)}")


def read_results_table(path: Path, task: str, columns, numeric) -> list[dict]:
    rows = parse_tsv(path)
    validate_required_columns(rows, set(columns), str(path))
    validate_ns_for_task(rows, task, str(path))
    validate_numeric_columns(rows, list(numeric), str(path))
    errors = validate_extension_columns(rows, str(path), task)
    if errors:
        raise ContractError("; ".join(errors[:5]))
    return rows


def camel(column: str) -> str:
    return "".join(w.capitalize() if i else w for i, w in enumerate(column.split("_")))


def region_values(row: dict) -> dict:
    """The region_transfer columns of one row, typed, with camelCase keys."""
    out = {}
    for column in REGION_EXTRA_COLUMNS + REGION_METRIC_COLUMNS:
        if column in REGION_SOURCE_COLUMNS:
            continue
        value = row.get(column, "")
        if column in REGION_INT_COLUMNS:
            out[camel(column)] = optional_int(value)
        elif column in REGION_FLOAT_COLUMNS:
            out[camel(column)] = optional_float(value)
        else:
            out[camel(column)] = value
    # Short names the frontend filters on: the truth set id (ns), the relative searched
    # ("QfO zebrafish" -> zebrafish; a model library such as Pfam-A -> all) and dedup.
    target = row.get("target_db", "")
    out["truthSet"] = row.get("ns", "")
    out["species"] = target[len("QfO "):] if target.startswith("QfO ") else "all"
    out["speciesMya"] = out["targetMyaToHuman"]
    out["dedup"] = row.get("dedup_or_raw", "") == "dedup"
    return out


def generate_best_metrics(release_dir: Path) -> dict:
    """Generate best.json with best metrics by subset and aspect."""
    best = {}
    name_map = load_method_name_map(release_dir)
    task = release_task(release_dir)

    for subset in TASK_SUBSETS[task]:
        best_path = release_dir / f"results_{subset}" / "evaluation_best_f_micro_w.tsv"
        rows = read_results_table(best_path, task, best_columns(task), best_numeric(task))

        if not rows:
            continue

        for row in rows:
            filename = row.get("filename", "").strip()
            aspect = row.get("ns", "").strip()
            method_label = filename.replace("_predictions.tsv", "").replace("_", " ").title()
            method_label = name_map.get(filename, method_label)

            key = f"{subset}_{aspect}"

            entry = {
                "method": method_label,
                "subset": subset,
                "aspect": aspect,
                "precision": float(row.get("pr_micro_w", 0)),
                "recall": float(row.get("rc_micro_w", 0)),
                "fmax": float(row.get("f_micro_w", 0)),
                "coverage": (
                    float(row.get("cov_w", 0)) if task == TASK_GO
                    else optional_float(row.get("cov_w"))
                ),
                "threshold": (
                    float(row.get("tau", 0)) if task == TASK_GO
                    else optional_float(row.get("tau"))
                ),
                "n": float(row.get("n", 0))
            }
            entry.update(extension_values(row, task))
            if task != TASK_GO:
                entry.update(region_values(row))

            if key not in best:
                best[key] = []
            best[key].append(entry)

    for key in best:
        best[key].sort(key=lambda x: x["fmax"], reverse=True)

    return best


def curve_key(subset: str, aspect: str, method: str, row: dict, task: str) -> str:
    """GO keeps LAFA's key. A region row is one point per stratum, so its key names it."""
    if task == TASK_GO:
        return f"{subset}_{aspect}_{method}"
    return "|".join([
        subset, aspect, method, row.get("dedup_or_raw", ""), row.get("target_db", ""),
        row.get("stratum_axis", "all"), row.get("stratum_bin", "all"),
    ])


def generate_curves(release_dir: Path) -> dict:
    """Generate curves.json with PR curve points."""
    curves = {}
    name_map = load_method_name_map(release_dir)
    task = release_task(release_dir)

    for subset in TASK_SUBSETS[task]:
        all_path = release_dir / f"results_{subset}" / "evaluation_all.tsv"
        rows = read_results_table(all_path, task, all_columns(task), all_numeric(task))

        if not rows:
            continue

        grouped = defaultdict(list)
        for row in rows:
            filename = row.get("filename", "").strip()
            aspect = row.get("ns", "").strip()
            method = name_map.get(filename, filename.replace("_predictions.tsv", ""))

            point = {
                "tau": float(row.get("tau", 0)) if task == TASK_GO else optional_float(row.get("tau")),
                "precision": float(row.get("pr_micro_w", 0)),
                "recall": float(row.get("rc_micro_w", 0))
            }
            key = curve_key(subset, aspect, method, row, task)
            grouped[key].append(point)

        for key, points in grouped.items():
            points.sort(key=lambda p: p["tau"])
            curves[key] = points

    return curves


def process_release(release_id: str, release_dir: Path, output_dir: Path):
    """Process a single release and generate all JSON files."""
    release_output = output_dir / "releases" / release_id
    release_output.mkdir(parents=True, exist_ok=True)

    print(f"  Generating meta.json...")
    meta = generate_release_meta(release_id, release_dir)
    with open(release_output / "meta.json", "w", encoding="utf-8") as f:
        json.dump(meta, f, indent=2)

    print(f"  Generating methods.json...")
    methods = generate_release_methods(release_dir)
    with open(release_output / "methods.json", "w", encoding="utf-8") as f:
        json.dump(methods, f, indent=2)

    print(f"  Generating best.json...")
    best = generate_best_metrics(release_dir)
    with open(release_output / "best.json", "w", encoding="utf-8") as f:
        # A region release has one row per stratum (about 30,000), so it is written compact.
        indent = 2 if release_task(release_dir) == TASK_GO else None
        json.dump(best, f, indent=indent)

    print(f"  Generating curves.json...")
    curves = generate_curves(release_dir)
    with open(release_output / "curves.json", "w", encoding="utf-8") as f:
        json.dump(curves, f)  # No indent for size efficiency


def main():
    """Main entry point."""
    print(f"LAFA Frontend Data Generator")
    print(f"=" * 40)
    print(f"Data source: {RELEASES_DIR}")
    print(f"Output dir:  {OUTPUT_DIR}")
    print()

    # Create output directory
    OUTPUT_DIR.mkdir(parents=True, exist_ok=True)

    # Generate catalog
    print("Generating catalog.json...")
    catalog = generate_catalog()
    with open(OUTPUT_DIR / "catalog.json", "w", encoding="utf-8") as f:
        json.dump(catalog, f, indent=2)
    print(f"  Found {len(catalog['releases'])} releases, {len(catalog['timepoints'])} timepoints")

    # Generate methods config
    print("\nGenerating methods.json...")
    methods_config = generate_methods_config()
    with open(OUTPUT_DIR / "methods.json", "w", encoding="utf-8") as f:
        json.dump(methods_config, f, indent=2)
    print(f"  Configured {len(methods_config['methods'])} methods")

    # Tool cards: one JSON per tool, copied as they are
    cards_dir = DATA_ROOT / "tool_cards"
    if cards_dir.is_dir():
        cards_out = OUTPUT_DIR / "tools"
        cards_out.mkdir(parents=True, exist_ok=True)
        names = []
        for card in sorted(cards_dir.glob("*.json")):
            (cards_out / card.name).write_text(card.read_text(encoding="utf-8"), encoding="utf-8")
            if card.name != "SOURCE.json":
                names.append(card.stem)
        with open(cards_out / "index.json", "w", encoding="utf-8") as f:
            json.dump({"tools": names}, f, indent=2)
        print(f"\nCopied {len(names)} tool cards")

    # Process each release
    print("\nProcessing releases...")
    for release in catalog["releases"]:
        release_id = release["id"]
        release_dir = RELEASES_DIR / release_id

        if not release_dir.exists():
            print(f"\n  Skipping {release_id}: directory not found")
            continue

        print(f"\n[{release_id}]")
        process_release(release_id, release_dir, OUTPUT_DIR)

    print("\n" + "=" * 40)
    print("Data generation complete!")

    # Print summary
    total_size = sum(f.stat().st_size for f in OUTPUT_DIR.rglob("*.json"))
    print(f"Total output size: {total_size / 1024:.1f} KB")


if __name__ == "__main__":
    main()
