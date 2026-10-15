process PREDICT_NAIVE {
    label 'cpu_medium'
    tag "${meta.release_id ?: meta.timepoint_id}"

    input:
    tuple val(meta), path(releaseDir), val(queryFastaName)

    output:
    tuple val(meta), path('naive_predictions.tsv')

    script:
    """
    module load singularity || true
    export SINGULARITY_CACHEDIR=${params.workspace_root}/.singularity_cache
    export SINGULARITY_TMPDIR=${params.workspace_root}/.singularity_tmp
    mkdir -p "\$SINGULARITY_CACHEDIR" "\$SINGULARITY_TMPDIR" output

    singularity exec --pwd /app \
      --bind "${releaseDir}:/app/data" \
      --bind "\$PWD/output:/app/output" \
      "${params.workspace_root}/containers/naive_predictor_v0.sif" \
      python3 naive.py \
      --annot_file /app/data/train_terms.tsv \
      --query_file "/app/data/${queryFastaName}" \
      --graph /app/data/go-basic.obo \
      --output_baseline /app/output/naive_predictions.tsv \
      --n_terms 1500

    cp output/naive_predictions.tsv .
    """

    stub:
    """
    touch naive_predictions.tsv
    """
}

process PREDICT_GOA_NONEXP {
    label 'cpu_medium'
    tag "${meta.release_id ?: meta.timepoint_id}"

    input:
    tuple val(meta), path(releaseDir), val(queryFastaName)

    output:
    tuple val(meta), path('goa_nonexp_predictions.tsv')

    script:
    """
    module load singularity || true
    export SINGULARITY_CACHEDIR=${params.workspace_root}/.singularity_cache
    export SINGULARITY_TMPDIR=${params.workspace_root}/.singularity_tmp
    export APPTAINER_TMPDIR="\$SINGULARITY_TMPDIR"
    mkdir -p "\$SINGULARITY_CACHEDIR" "\$SINGULARITY_TMPDIR" output

    singularity exec --pwd /app \
      --bind "${releaseDir}:/app/data" \
      --bind "\$PWD/output:/app/output" \
      "${params.workspace_root}/containers/goa_nonexp_predictor_v0.sif" \
      python3 goa_nonexp.py \
      --annot_file /app/data/goa_uniprot_sprot.gaf.gz \
      --selected_go 'Computational,Phylogenetical,Electronic,ND,NAS' \
      --query_file "/app/data/${queryFastaName}" \
      --graph /app/data/go-basic.obo \
      --output_baseline /app/output/goa_nonexp_predictions.tsv

    cp output/goa_nonexp_predictions.tsv .
    """

    stub:
    """
    touch goa_nonexp_predictions.tsv
    """
}

process PREDICT_BLAST {
    label 'gpu_a100'
    tag "${meta.release_id ?: meta.timepoint_id}"

    input:
    tuple val(meta), path(releaseDir), val(queryFastaName)

    output:
    tuple val(meta), path('blast_predictions.tsv')

    script:
    """
    module load singularity || true
    export SINGULARITY_CACHEDIR=${params.workspace_root}/.singularity_cache
    export SINGULARITY_TMPDIR=${params.workspace_root}/.singularity_tmp
    mkdir -p "\$SINGULARITY_CACHEDIR" "\$SINGULARITY_TMPDIR" output

    nvidia-cuda-mps-server || true

    singularity exec --nv --pwd /app \
      --bind "${releaseDir}:/app/data" \
      --bind "\$PWD/output:/app/output" \
      "${params.workspace_root}/containers/blast_predictor_v0.sif" \
      python3 blast_main.py \
      --annot_file /app/data/train_terms_propagated.tsv \
      --query_file "/app/data/${queryFastaName}" \
      --graph /app/data/go-basic.obo \
      --train_sequences /app/data/train_sequences.fasta \
      --train_taxonomy /app/data/train_taxonomy.tsv \
      --output_baseline /app/output/blast_predictions.tsv \
      --num_threads 16

    cp output/blast_predictions.tsv .
    """

    stub:
    """
    touch blast_predictions.tsv
    """
}

process PREDICT_PROTT5 {
    label 'gpu_a100'
    tag "${meta.release_id ?: meta.timepoint_id}"

    input:
    tuple val(meta), path(releaseDir), val(queryFastaName)

    output:
    tuple val(meta), path('prott5_predictions.tsv')

    script:
    """
    module load singularity || true
    export SINGULARITY_CACHEDIR=\${TMPDIR:-${params.workspace_root}/.singularity_tmp}
    export SINGULARITY_TMPDIR=\${TMPDIR:-${params.workspace_root}/.singularity_tmp}
    mkdir -p output

    nvidia-cuda-mps-server || true

    singularity exec --nv --pwd /app \
      --bind "${releaseDir}:/app/data" \
      --bind "\$PWD/output:/app/output" \
      "${params.workspace_root}/containers/prott5_predictor_v0.sif" \
      python3 prott5_main.py \
      --annot_file /app/data/train_terms.tsv \
      --query_file "/app/data/${queryFastaName}" \
      --graph /app/data/go-basic.obo \
      --train_sequences /app/data/train_sequences.fasta \
      --output_baseline /app/output/prott5_predictions.tsv \
      --num_threads 16 \
      --top_k 5

    cp output/prott5_predictions.tsv .
    """

    stub:
    """
    touch prott5_predictions.tsv
    """
}

process PREDICT_TRANSFEW {
    label 'gpu_a100'
    tag "${meta.release_id}"

    input:
    tuple val(meta), path(releaseDir), val(queryFastaName)

    output:
    tuple val(meta), path('transfew_predictions.tsv')

    script:
    """
    module load singularity || true
    export SINGULARITY_CACHEDIR=\${TMPDIR:-${params.workspace_root}/.singularity_tmp}
    export SINGULARITY_TMPDIR=\${TMPDIR:-${params.workspace_root}/.singularity_tmp}
    mkdir -p output

    for ontology in mf bp cc; do
      XDG_CACHE_HOME=/root/.cache/ singularity run --nv \
        --pwd /workspace \
        --bind "${releaseDir}:/root/data" \
        --bind "\$PWD/output:/root/output" \
        --bind "${params.workspace_root}/checkpoints_TransFew:/root/.cache/torch/hub/checkpoints" \
        "${params.workspace_root}/containers/transfew_predictor_latest.sif" \
        --fasta-path "/root/data/${queryFastaName}" \
        --working-dir /root/output \
        --ontology "\${ontology}" \
        --output "transfew_predictions_\${ontology}.tsv.gz"

      gunzip "output/transfew_predictions_\${ontology}.tsv.gz"
      awk -F'\\t' 'BEGIN{OFS="\\t"} {split(\$1,a,"|"); print a[2], \$2, \$3}' \
        "output/transfew_predictions_\${ontology}.tsv" > "output/transfew_predictions2_\${ontology}.tsv"
    done

    cat output/transfew_predictions2_mf.tsv output/transfew_predictions2_bp.tsv output/transfew_predictions2_cc.tsv > transfew_predictions.tsv
    """

    stub:
    """
    touch transfew_predictions.tsv
    """
}

process PREDICT_FUNBIND_BATCH {
    label 'gpu_scavenger'
    tag "${meta.release_id}:funbind:${batchIndex}"

    input:
    tuple val(meta), val(batchIndex), val(expectedBatchCount), path(releaseDir), path(batchFastas)

    output:
    tuple val(meta), val(batchIndex), val(expectedBatchCount), path("funbind_batch_${String.format('%03d', batchIndex as Integer)}.tsv"), path("funbind_batch_${String.format('%03d', batchIndex as Integer)}.manifest.tsv")

    script:
    def batchOutputName = "funbind_batch_${String.format('%03d', batchIndex as Integer)}.tsv"
    def batchManifestName = "funbind_batch_${String.format('%03d', batchIndex as Integer)}.manifest.tsv"
    """
    module load apptainer || true
    export SINGULARITY_CACHEDIR=\${TMPDIR:-${params.workspace_root}/.singularity_tmp}
    export SINGULARITY_TMPDIR=\${TMPDIR:-${params.workspace_root}/.singularity_tmp}
    mkdir -p output

    nvidia-cuda-mps-server || true
    release_dir=\$(readlink -f "${releaseDir}")

    : > "${batchManifestName}"
    shopt -s nullglob
    batch_fastas=(part_*.fasta)
    if [[ "\${#batch_fastas[@]}" -eq 0 ]]; then
      echo "No staged FunBind FASTA parts found for batch ${batchIndex}" >&2
      exit 1
    fi
    mapfile -t sorted_batch_fastas < <(printf '%s\\n' "\${batch_fastas[@]}" | sort)
    for fasta_path in "\${sorted_batch_fastas[@]}"; do
      fasta_name=\$(basename "\${fasta_path}")
      part_name=\$(basename "\${fasta_name}" .fasta)
      printf '%s\\n' "\${fasta_name}" >> "${batchManifestName}"
      apptainer run --nv --pwd /software/FunBind --writable-tmpfs \
        --bind "\${release_dir}:/root/data" \
        --bind "\$PWD:/root/batch" \
        --bind "\$PWD/output:/root/output" \
        --bind "${params.workspace_root}/cache/pretrained_huggingface_models/cache_folder:/root/.cache/huggingface/hub" \
        --bind "${params.workspace_root}/checkpoints_FunBind:/root/.cache/checkpoints" \
        "${params.workspace_root}/containers/test_funbind_latest.sif" \
        --data-path /root/.cache/checkpoints \
        --sequence-path "/root/batch/\${fasta_name}" \
        --output "/root/output/\${part_name}"
    done

    mapfile -t result_files < <(find output -type f \\( -path "*/BP/Sequence_BP.tsv" -o -path "*/MF/Sequence_MF.tsv" -o -path "*/CC/Sequence_CC.tsv" \\) | sort)
    if [[ "\${#result_files[@]}" -eq 0 ]]; then
      echo "No FunBind output fragments were produced for batch ${batchIndex}" >&2
      exit 1
    fi
    cat "\${result_files[@]}" > "${batchOutputName}"
    """

    stub:
    def batchOutputName = "funbind_batch_${String.format('%03d', batchIndex as Integer)}.tsv"
    def batchManifestName = "funbind_batch_${String.format('%03d', batchIndex as Integer)}.manifest.tsv"
    """
    touch "${batchOutputName}"
    printf 'part_001.fasta\\n' > "${batchManifestName}"
    """
}

process MERGE_FUNBIND_BATCHES {
    label 'packaging'
    tag "${meta.release_id}:funbind"

    input:
    tuple val(meta), val(expectedBatchCount), val(batchIndexes), path(batchPredictionFiles), path(batchManifestFiles)

    output:
    tuple val(meta), path('funbind_predictions.tsv')

    script:
    """
    python3 "${params.workspace_root}/scripts/merge_funbind_batches.py" \
      --batch-dir . \
      --expected-batch-count ${expectedBatchCount} \
      --output funbind_predictions.tsv
    """

    stub:
    """
    touch funbind_predictions.tsv
    """
}

process PREDICT_DEEPGOPLUS {
    label 'gpu_a100'
    tag "${meta.release_id}"

    input:
    tuple val(meta), path(releaseDir), val(queryFastaName)

    output:
    tuple val(meta), path('deepgoplus_predictions.tsv')

    script:
    """
    module load apptainer || true
    export SINGULARITY_CACHEDIR=\${TMPDIR:-${params.workspace_root}/.singularity_tmp}
    export SINGULARITY_TMPDIR=\${TMPDIR:-${params.workspace_root}/.singularity_tmp}
    
    nvidia-cuda-mps-server || true
    apptainer run --nv --pwd /deepgoplus --writable-tmpfs \
      --bind "\$PWD:/output" \
      --bind "${releaseDir}:/ext_data" \
      "${params.workspace_root}/containers/deepgoplus_latest.sif" \
      -if /ext_data/${queryFastaName} \
      -of /output/deepgoplus_predictions.tsv

    awk -F'\\t' 'BEGIN{OFS="\\t"} {split(\$1,a,"|"); print a[2], \$2, \$3}' \
      deepgoplus_predictions.tsv > deepgoplus_predictions2.tsv
    mv deepgoplus_predictions2.tsv deepgoplus_predictions.tsv
    """

    stub:
    """
    touch deepgoplus_predictions.tsv
    """
}

process ASSEMBLE_TIMEPOINT_PREDICTIONS {
    label 'packaging'
    tag "${meta.timepoint_id}"

    input:
    tuple val(meta), path(naivePred), path(goaPred), path(blastPred), path(prott5Pred)

    output:
    tuple val(meta), path('predictions')

    script:
    """
    mkdir -p predictions
    cp "${naivePred}" predictions/
    cp "${goaPred}" predictions/
    cp "${blastPred}" predictions/
    cp "${prott5Pred}" predictions/
    """

    stub:
    """
    mkdir -p predictions
    touch predictions/naive_predictions.tsv
    touch predictions/goa_nonexp_predictions.tsv
    touch predictions/blast_predictions.tsv
    touch predictions/prott5_predictions.tsv
    """
}

process INIT_EMPTY_PREDICTIONS_DIR {
    label 'packaging'
    tag "${meta.timepoint_id}"

    input:
    tuple val(meta), path(releaseDir)

    output:
    tuple val(meta), path('predictions')

    script:
    """
    mkdir -p predictions
    """

    stub:
    """
    mkdir -p predictions
    """
}

process ASSEMBLE_WINDOW_PREDICTIONS {
    label 'packaging'
    tag "${meta.release_id}"

    input:
    tuple val(meta), path(predictionFiles)

    output:
    tuple val(meta), path('predictions_window')

    script:
    """
    mkdir -p predictions_window
    cp ${predictionFiles} predictions_window/
    """

    stub:
    """
    mkdir -p predictions_window
    for file in ${predictionFiles}; do
      touch "predictions_window/\$(basename "\$file")"
    done
    """
}

process PACKAGE_WINDOW_PREDICTIONS {
    label 'packaging'
    tag "${meta.release_id}"

    input:
    tuple val(meta), path(t0Dir), path(predictionsDir)

    output:
    tuple val(meta), path('published_window_predictions.txt')

    script:
    """
    target_dir="${t0Dir}/${params.window_prediction_subdir}/${meta.release_id}"
    mkdir -p "\${target_dir}"
    cp -r "${predictionsDir}/." "\${target_dir}/"
    printf '%s\\n' "\${target_dir}" > published_window_predictions.txt
    """

    stub:
    """
    target_dir="${t0Dir}/${params.window_prediction_subdir}/${meta.release_id}"
    mkdir -p "\${target_dir}"
    cp -r "${predictionsDir}/." "\${target_dir}/"
    printf '%s\\n' "\${target_dir}" > published_window_predictions.txt
    """
}

process PACKAGE_TIMEPOINT_DIRECTORY {
    label 'packaging'
    tag "${meta.timepoint_id}"

    input:
    tuple val(meta), path(goBasic), path(filteredGaf), path(trainTerms), path(trainSequences), path(trainTaxonomy), path(testSequences), path(trainTermsPropagated), path(iaTsv), path(splitDir), path(releaseDir), path(predictionsDir)

    output:
    tuple val(meta), path('published_timepoint.txt')

    script:
    """
    target_dir="${meta.timepoint_root}"
    mkdir -p "\${target_dir}"
    cp "${filteredGaf}" "\${target_dir}/goa_uniprot_sprot.gaf.gz"
    cp "${trainTerms}" "\${target_dir}/train_terms.tsv"
    cp "${trainSequences}" "\${target_dir}/train_sequences.fasta"
    cp "${trainTaxonomy}" "\${target_dir}/train_taxonomy.tsv"
    cp "${testSequences}" "\${target_dir}/test_sequences.fasta"
    cp "${trainTermsPropagated}" "\${target_dir}/train_terms_propagated.tsv"
    cp "${iaTsv}" "\${target_dir}/IA.tsv"
    mkdir -p "\${target_dir}/test_sequences_split" "\${target_dir}/release" "\${target_dir}/predictions"
    cp -r "${splitDir}/." "\${target_dir}/test_sequences_split/"
    cp -r "${releaseDir}/." "\${target_dir}/release/"
    cp -r "${predictionsDir}/." "\${target_dir}/predictions/"
    printf '%s\\n' "\${target_dir}" > published_timepoint.txt
    """

    stub:
    """
    target_dir="${meta.timepoint_root}"
    mkdir -p "\${target_dir}"
    touch "\${target_dir}/goa_uniprot_sprot.gaf.gz"
    touch "\${target_dir}/train_terms.tsv"
    touch "\${target_dir}/train_sequences.fasta"
    touch "\${target_dir}/train_taxonomy.tsv"
    touch "\${target_dir}/test_sequences.fasta"
    touch "\${target_dir}/train_terms_propagated.tsv"
    touch "\${target_dir}/IA.tsv"
    mkdir -p "\${target_dir}/test_sequences_split" "\${target_dir}/release" "\${target_dir}/predictions"
    cp -r "${splitDir}/." "\${target_dir}/test_sequences_split/"
    cp -r "${releaseDir}/." "\${target_dir}/release/"
    cp -r "${predictionsDir}/." "\${target_dir}/predictions/"
    printf '%s\\n' "\${target_dir}" > published_timepoint.txt
    """
}
