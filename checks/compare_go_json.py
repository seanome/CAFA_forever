"""Check that the fork's JSON for LAFA's GO releases equals upstream's, apart from added keys.

Usage: python3 checks/compare_go_json.py <upstream_data_dir> <fork_data_dir>
Each argument is a frontend/public/data folder written by scripts/generate_data.py.
"""
import json
import sys
from pathlib import Path

ADDED_ENTRY_KEYS = {"task", "stratumAxis", "stratumBin", "cpuH", "peakRamGb", "gpuH",
                    "provenance", "costUsdEst"}
ADDED_TOP_KEYS = {"tasks", "taskSubsets"}
IGNORED = {"generatedAt"}


def strip(obj, path, added):
    if isinstance(obj, dict):
        return {k: strip(v, path + [k], added) for k, v in obj.items()
                if k not in IGNORED and k not in added}
    if isinstance(obj, list):
        return [strip(v, path, added) for v in obj]
    return obj


def main(old_dir: Path, new_dir: Path) -> int:
    old_files = sorted(p.relative_to(old_dir) for p in old_dir.rglob("*.json"))
    failures = 0
    for rel in old_files:
        new_path = new_dir / rel
        if not new_path.exists():
            print(f"MISSING {rel}")
            failures += 1
            continue
        old = json.loads((old_dir / rel).read_text())
        new = json.loads(new_path.read_text())
        added = ADDED_ENTRY_KEYS | ADDED_TOP_KEYS
        if rel.name == "catalog.json":
            new = dict(new, releases=[r for r in new["releases"]
                                      if r.get("task", "go_whole_protein") == "go_whole_protein"])
        same = strip(old, [], set()) == strip(new, [], added)
        n_added = json.dumps(new).count('"task"')
        print(f"{'SAME' if same else 'DIFFERENT'} {rel} (task keys added: {n_added})")
        failures += not same
    print(f"{len(old_files)} files compared, {failures} differ")
    return 1 if failures else 0


if __name__ == "__main__":
    sys.exit(main(Path(sys.argv[1]), Path(sys.argv[2])))
