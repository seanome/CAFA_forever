# A second task for LAFA: where on the protein, and at what cost

A note for the LAFA maintainers from Seanome, about seanome/CAFA_forever, a fork of
anphan0828/CAFA_forever at `c3fd5b9`. Nothing has been sent upstream. This page says what the
fork adds and what a merge would need from each side.

## What the fork adds

LAFA scores GO terms for a whole protein. The fork adds a second task, region transfer: a
method copies a domain or feature onto a human protein from a related protein in another
species, and is scored on where the copy lands. The first release holds the QfO Pfam region
benchmark: 998 human proteins searched against 15 Quest for Orthologs proteomes by 9 tools at
23 settings, graded against Pfam, Pfam-N and Swiss-Prot features: 29,379 release rows, each
holding the 7 metrics of one stratum (205,653 rows of the long results table).

1. **Data contract, extended, not changed.** `evaluation_best_f_micro_w.tsv` and
   `evaluation_all.tsv` may carry eight more columns: `task`, `stratum_axis`, `stratum_bin`,
   `cpu_h`, `peak_ram_gb`, `gpu_h`, `provenance` (measured or reported) and `cost_usd_est`.
   All are optional. A release without them reads as `task = go_whole_protein`, stratum
   `all`, cost unknown. The rules live in one file, `scripts/release_contract.py`, which
   `generate_data.py` and `publish_release_windows.py` both import.
2. **A region release folder** has `release_info.tsv` (task, source commit, checksums,
   prices) and one subset, `results_ALL/`, in place of NK, LK and PK. `ns` holds the truth set
   instead of a GO aspect. Its id is not a T0-T1 window, so it stays off the timeline.
3. **A converter and a Nextflow mode.** `scripts/leaderboard_to_release.py` turns one
   experiment of two long tables (results and compute, one row per metric, from
   seanome/2024-kmerseek-analysis) into that folder;
   `--mode region_release` runs it through `modules/local/region_release.nf` and then your
   `PUBLISH_RELEASE_DIRECTORY` and `BUILD_RELEASE_CATALOG`.
4. **Frontend.** A switch between the two tasks. The GO views are yours, unchanged, plus your
   `SummaryTable` wired in as a Table tab. The region views add filter chips for strata
   (identity to the nearest relative, region length, disorder, feature type, relative
   species), a sortable table with cost, score against CPU-hours, precision and recall at
   Fmax over your F contours, a coverage grid, and one card per tool.
5. **Theme and hosting.** Fraunces, Source Sans 3 and Fantasque Sans Mono; one meaning per
   colour across the site. `npm run build:pages` and `.github/workflows/pages.yml` publish
   `frontend/dist` to GitHub Pages with no Nginx.
6. **One fix that is yours to take.** The `PREDICT_FUNBIND_BATCH` stub used names defined
   only in its `script:` block, so `nextflow run main.nf -stub` failed for any window that
   ran FunBind. The fork defines them in `stub:` too.

## What was checked

- Your six releases give the same JSON as before once the eight added keys are removed
  (26 files; `checks/compare_go_json.py`). Rendered side by side, the Summary and
  Precision Recall Curves tabs show the same text as your build.
- `nextflow run main.nf -stub` passes for `timepoint_build`, `evaluate_window` (all seven
  methods), `evaluate_late_predictions` and `region_release`.
- The converter writes the experiment's 205,653 long rows and reads them back identical,
  value for value; a key missing one metric is refused instead of filled.

## What a merge would need

From LAFA:

- Agree that `release_info.tsv` and the eight optional columns join the published contract.
  The fork's `app/config.py` makes the Streamlit app skip region releases, so it still lists
  your six releases and nothing else; showing region releases there would be new work.
- Decide where region releases appear on functionbench.net: the task switch as built, or a
  separate page.
- Decide on the theme. The fork changes fonts and colours; a merge could keep your Iowa
  State theme and take only the components, since every colour is now a CSS variable.
- Add `--mode region_release` to the deployment docs if you want to publish region releases.

From Seanome:

- Split the fork into small pull requests, in this order: the FunBind stub fix; the
  contract module with the optional columns; the region release layout and converter; the
  frontend task switch and region views; the theme as a separate, optional change.
- Keep the region tables' source public and pinned (commit and sha256 in
  `release_info.tsv`), and add a `cpu_h` source for your GO methods if you want cost there.
- Not open any pull request upstream without your agreement.
