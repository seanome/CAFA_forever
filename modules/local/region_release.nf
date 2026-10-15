/*
 * Region-transfer releases: turn results.parquet and compute.parquet (from
 * `make leaderboard-tables` in seanome/2024-kmerseek-analysis) into a release folder in
 * LAFA's layout, then check it. Publishing and the catalog reuse PUBLISH_RELEASE_DIRECTORY
 * and BUILD_RELEASE_CATALOG from release_contract.nf, which read the task from
 * release_info.tsv.
 */

def activateLeaderboardEnv() {
    // Same pattern as the GO processes: an optional micromamba env holding polars.
    params.leaderboard_env ? """
    module load micromamba || true
    export MAMBA_ROOT_PREFIX="\${MAMBA_ROOT_PREFIX:-\$HOME/micromamba}"
    eval "\$(micromamba shell hook --shell=bash)"
    micromamba activate "${params.leaderboard_env}"
    """ : ''
}

process BUILD_REGION_RELEASE {
    label 'packaging'
    tag "${meta.release_id}"

    input:
    tuple val(meta), path(resultsParquet), path(computeParquet)

    output:
    tuple val(meta), path("${meta.release_id}")

    script:
    """
    ${activateLeaderboardEnv()}
    python3 "${file(params.workspace_root)}/scripts/leaderboard_to_release.py" \
      --results "${resultsParquet}" \
      --compute "${computeParquet}" \
      --experiment "${params.leaderboard_experiment}" \
      --out-dir . \
      --release-id "${meta.release_id}" \
      --title "${meta.title}" \
      --source-repo "${meta.source_repo}" \
      --source-commit "${meta.source_commit}" \
      --run-date "${meta.run_date}" \
      --price-cpu-h ${params.price_cpu_h_usd} \
      --price-gpu-h ${params.price_gpu_h_usd}
    """

    stub:
    def r = meta.release_id
    """
    mkdir -p "${r}/results_ALL"
    printf 'key\\tvalue\\ntask\\tregion_transfer\\ntitle\\tstub\\nn_queries\\t1\\n' > "${r}/release_info.tsv"
    printf 'filename\\tlabel\\tgroup\\ttask\\ttool\\tsetting\\nstub__default\\tstub default\\tstub\\tregion_transfer\\tstub\\tdefault\\n' > "${r}/method_names.tsv"
    printf 'method\\tALL\\nstub default\\ttrue\\n' > "${r}/method_availability.tsv"
    printf 'filename\\tns\\ttau\\tn\\tpr_micro_w\\trc_micro_w\\tf_micro_w\\tcov_w\\ttask\\tstratum_axis\\tstratum_bin\\ttarget_db\\tdedup_or_raw\\nstub__default\\tpfam\\t\\t1\\t0\\t0\\t0\\t\\tregion_transfer\\tall\\tall\\tQfO stub\\traw\\n' > "${r}/results_ALL/evaluation_best_f_micro_w.tsv"
    printf 'filename\\tns\\ttau\\tcov\\trc_micro_w\\tpr_micro_w\\tf_micro_w\\ttask\\tstratum_axis\\tstratum_bin\\ttarget_db\\tdedup_or_raw\\nstub__default\\tpfam\\t\\t\\t0\\t0\\t0\\tregion_transfer\\tall\\tall\\tQfO stub\\traw\\n' > "${r}/results_ALL/evaluation_all.tsv"
    """
}

process VALIDATE_REGION_RELEASE {
    label 'packaging'
    tag "${meta.release_id}"

    input:
    tuple val(meta), path(releaseDir)

    output:
    tuple val(meta), path(releaseDir)

    script:
    """
    python3 - "${file(params.workspace_root)}" "${releaseDir}" <<'PY'
import pathlib
import sys

sys.path.insert(0, str(pathlib.Path(sys.argv[1]) / "scripts"))
import publish_release_windows as pub
import release_contract as rc

release_dir = pathlib.Path(sys.argv[2])
if rc.release_task(release_dir) != rc.TASK_REGION:
    raise SystemExit(f"{release_dir}: release_info.tsv does not name task {rc.TASK_REGION}")
result = pub.validate_release_window(release_dir)
if not result.is_valid:
    raise SystemExit("\\n".join(result.errors[:20]))
PY
    """
}
