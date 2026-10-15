# Map of CAFA_forever (LAFA)

Read from anphan0828/CAFA_forever at commit `c3fd5b9` (2026-08-11), which is also the head of
FriedbergLab/CAFA_forever. This fork is seanome/CAFA_forever. Section 6 lists what the fork adds.

## 1. The parts

| Part | Files | What it does |
|---|---|---|
| Nextflow backend | `main.nf`, `nextflow.config`, `workflows/`, `modules/local/` | Builds a GO snapshot (a "timepoint"), runs predictors on proteins that gained GO terms between two timepoints, scores them with `cafaeval`, and publishes a release folder. |
| Release folders | `data/releases/{release_id}/`, `data/releases/catalog.json` | The published results, as TSV files. Both frontends read only these. |
| JSON builder | `scripts/generate_data.py` | Checks each release folder and turns its TSV files into the JSON files the React frontend loads. |
| Release checker | `scripts/publish_release_windows.py` | Checks release folders and writes `catalog.json`. The Nextflow step `BUILD_RELEASE_CATALOG` imports it. |
| React frontend | `frontend/src/` | The site at functionbench.net. Static files after `npm run build`. |
| Streamlit frontend | `app/` | The older frontend. It reads the same TSV files. `app/config.py` also holds the snapshot dates and method descriptions that `generate_data.py` imports. |
| Deployment | `Dockerfile.react`, `nginx.conf`, `frontend/nginx.conf`, `deploy/` | Docker images that serve the built site through Nginx. |

### Backend modes (`main.nf`)

`--mode` picks one of three workflows.

- `timepoint_build` (`workflows/timepoint_build.nf`, processes in `modules/local/timepoint_build.nf`):
  checks the staged `go-basic.obo`, `goa_uniprot_all.gaf.gz` and `uniprot_sprot.fasta.gz`, keeps
  Swiss-Prot entries with experimental GO terms, writes the training set, the test FASTA and the
  information-accretion weights (`IA.tsv`, from `PROPAGATE_AND_COMPUTE_IA`), and freezes them
  under `<timepoint>/release/`.
- `evaluate_window` (`workflows/evaluate_window.nf`): for a pair of timepoints T0 and T1, it
  1. keeps proteins present at both (`INTERSECT_TARGETS`);
  2. sorts the GO terms gained between T0 and T1 into the three knowledge settings
     (`CLASSIFY_GROUNDTRUTH`, section 4);
  3. writes the FASTA of those proteins (`EXTRACT_GROUNDTRUTH_TARGETS`);
  4. runs each predictor in `modules/local/predictions.nf` (Naive, GOA non-experimental, BLAST,
     ProtT5, TransFew, FunBind, DeepGOPlus; Apptainer images under `containers/`);
  5. scores each setting with `cafaeval` (`EVALUATE_NK`, `EVALUATE_LK`, `EVALUATE_PK` in
     `modules/local/evaluation.nf`);
  6. writes `method_names.tsv` and `method_availability.tsv`, then packages, checks and
     publishes the folder (`modules/local/release_contract.nf`).
- `evaluate_late_predictions` (`workflows/evaluate_late_predictions.nf`): scores prediction files
  dropped into `T0/predictions_uneval/` and merges the rows into an existing release
  (`MERGE_LATE_RESULTS`).

Every process has a `stub:` block, so `nextflow run main.nf -stub` runs the whole graph on empty
files. That stub run is the backend's only test data; there is no `tests/` folder.

## 2. The release folder: which files define it

`data/releases/{release_id}/`, where `release_id` is `Mon_YYYY_Mon_YYYY` (T0 then T1).
`split_release_id()` in `scripts/generate_data.py` rejects any other form.

| File | Columns | Written by |
|---|---|---|
| `method_names.tsv` | `filename`, `label`, `group` | `GENERATE_METHOD_NAMES` |
| `method_availability.tsv` | `method`, `NK`, `LK`, `PK` (true/false) | `GENERATE_METHOD_AVAILABILITY` |
| `groundtruth_{NK,LK,PK}.tsv` | `EntryID`, `term`, `aspect` (P, F or C) | `CLASSIFY_GROUNDTRUTH` |
| `groundtruth_PK_known.tsv` | same | `CLASSIFY_GROUNDTRUTH` |
| `groundtruth_terms_of_interest.txt`, `groundtruth_targets.tsv`, `groundtruth_targets.fasta` | | `CLASSIFY_GROUNDTRUTH`, `EXTRACT_GROUNDTRUTH_TARGETS` |
| `results_{NK,LK,PK}/evaluation_best_f_micro_w.tsv` | one row per method and GO aspect at its best threshold: `filename`, `ns`, `tau`, `n`, `pr_micro_w`, `rc_micro_w`, `f_micro_w`, `cov_w` and about 25 more `cafaeval` columns | `cafaeval` |
| `results_{NK,LK,PK}/evaluation_all.tsv` | one row per method, aspect and threshold: the points of the precision-recall curve | `cafaeval` |
| other `results_*/evaluation_best_*.tsv` | other ways to pick the best threshold | `cafaeval`; not read by the frontends |

The required list is written down four times, and the four copies must agree:

- `REQUIRED_RELEASE_FILES` and `REQUIRED_*_COLUMNS` in `scripts/generate_data.py`
- the same names in `scripts/publish_release_windows.py`
- the `required` list inside `VALIDATE_RELEASE_DIRECTORY` in `modules/local/release_contract.nf`
- `app/config.py` for the Streamlit app

`data/releases/catalog.json` lists each release with `release_id`, `path` and `status`.
`BUILD_RELEASE_CATALOG` writes it from `publish_release_windows.build_catalog_entries()`.

## 3. The JSON that `generate_data.py` writes

Output goes to `frontend/public/data/` (git-ignored), which Vite copies into `dist/data/`.

| File | Function | Content |
|---|---|---|
| `catalog.json` | `generate_catalog()` | Ready releases (`id`, `startTimepoint`, `endTimepoint`, `status`), `invalidReleases` with the reason, sorted `timepoints`, and the GOA and UniProt dates of each from `app/config.py`. |
| `methods.json` | `generate_methods_config()` | Every known method with its description, container URL and whether it is a baseline; the GO aspect names; one sentence per knowledge setting. |
| `releases/{id}/meta.json` | `generate_release_meta()`, `count_groundtruth_targets()` | Snapshot dates, and proteins per setting and per aspect, counted from `groundtruth_*.tsv`. |
| `releases/{id}/methods.json` | `generate_release_methods()` | The release's methods, with which settings each was scored in. |
| `releases/{id}/best.json` | `generate_best_metrics()` | Key `{setting}_{aspect}`, value a list of `{method, subset, aspect, precision, recall, fmax, coverage, threshold, n}` sorted by Fmax, read from `evaluation_best_f_micro_w.tsv`. |
| `releases/{id}/curves.json` | `generate_curves()` | Key `{setting}_{aspect}_{method}`, value the curve points `{tau, precision, recall}`, read from `evaluation_all.tsv`. Loaded only when the curves tab opens. |

The numbers shown are the weighted micro-averaged ones (`*_micro_w`): each GO term counts by its
information accretion from `IA.tsv`.

## 4. The three knowledge settings

They are computed outside this repository, in `democafa.groundtruth.classify_ground_truth`
(anphan0828/democafa_package, read at `1102e34`). `CLASSIFY_GROUNDTRUTH`
(`modules/local/evaluation.nf`, line 33) calls it with the T0 and T1 propagated GO terms and the
proteins present at both timepoints.

- No knowledge (NK): a protein with no experimental GO term at T0 that has one at T1.
- Limited knowledge (LK): a protein that had experimental terms at T0, and gained terms at T1 in
  an aspect (BP, MF or CC) where it had none.
- Partial knowledge (PK): a protein that gained terms at T1 in an aspect where it already had
  terms at T0. Its T0 terms go to `groundtruth_PK_known.tsv`, and `EVALUATE_PK` passes that file
  to `cafaeval -known` so a method gets no credit for repeating them.

The frontend only reads the results. `SUBSETS` in `generate_data.py` and in
`frontend/src/types/method.ts` names the three settings.

## 5. The React frontend (`frontend/src/`)

- `App.tsx` lays out the page and its tabs (Summary, Precision Recall Curves, Comparison).
- `context/AppContext.tsx`: the selected release, the second release for comparison, the
  selected methods, the active tab.
- `hooks/`: `useCatalog`, `useReleaseData` (meta, methods, best; curves on demand),
  `useComparisonData` (differences between two releases), `useComparableMethods`,
  `useMethodColors` (one colour per method, Okabe-Ito order first).
- `lib/dataValidation.ts` checks each JSON file's shape before use. `lib/fscoreContour.ts` draws
  the lines of equal F on the precision-recall plots.
- `components/release/TimelineSelector.tsx`: the timeline that picks T0 and T1.
- `components/methods/MethodSelector.tsx`: the method checklist, with a baselines-only switch.
- `components/charts/`: `OverallRankingChart`, `FmaxSmallMultiples` (3 settings x 3 aspects),
  `TargetCountChart`, `PRCurveGrid` and `PRCurvePlot` (curves with F contours), `ComparisonTab`
  (window against window).
- `components/table/SummaryTable.tsx`: a sortable table with CSV export. Upstream does not use it
  in `App.tsx`.
- `index.css`: the Iowa State colours and Arial.

## 6. What this fork adds

| Addition | Where |
|---|---|
| Optional columns on `evaluation_best_f_micro_w.tsv` and `evaluation_all.tsv`: `task`, `stratum_axis`, `stratum_bin`, `cpu_h`, `peak_ram_gb`, `gpu_h`, `provenance`, `cost_usd_est`. A GO release without them reads as `task = go_whole_protein`, stratum `all`, cost unknown. | `scripts/release_contract.py`, used by `generate_data.py` and `publish_release_windows.py` |
| A second task, `region_transfer`: a release folder with `release_info.tsv` and one setting, `results_ALL/` | same |
| The converter from `results.parquet` and `compute.parquet` to a release folder | `scripts/leaderboard_to_release.py`, `modules/local/region_release.nf`, `workflows/region_release.nf`, `--mode region_release` in `main.nf` |
| The region-transfer views, tool cards, task switch, fonts, and the GitHub Pages build | `frontend/src/`, `.github/workflows/pages.yml` |
