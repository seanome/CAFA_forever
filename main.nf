nextflow.enable.dsl = 2

include { TIMEPOINT_BUILD } from './workflows/timepoint_build'
include { EVALUATE_WINDOW } from './workflows/evaluate_window'
include { EVALUATE_LATE_PREDICTIONS } from './workflows/evaluate_late_predictions'
include { REGION_RELEASE } from './workflows/region_release'

def requireParam(String name) {
    if( !params[name] ) {
        error "Missing required parameter: --${name}"
    }
    params[name]
}

workflow {
    switch( params.mode ) {
        case 'timepoint_build':
            def timepointId   = requireParam('timepoint_id')
            def timepointRoot = file(params.timepoint_root ?: "${params.output_root}/${timepointId}")

            Channel
                .of(tuple([timepoint_id: timepointId, timepoint_root: timepointRoot.toString()], file("${timepointRoot}/go-basic.obo"), file("${timepointRoot}/goa_uniprot_all.gaf.gz"), file("${timepointRoot}/uniprot_sprot.fasta.gz")))
                .set { timepoint_inputs_ch }

            TIMEPOINT_BUILD(timepoint_inputs_ch)
            break

        case 'evaluate_window':
            def t0Id      = requireParam('t0_id')
            def t1Id      = requireParam('t1_id')
            def releaseId = params.release_id ?: "${t0Id}_${t1Id}"
            def t0Root    = file(params.t0_root ?: "${params.output_root}/${t0Id}")
            def t1Root    = file(params.t1_root ?: "${params.output_root}/${t1Id}")

            Channel
                .of(tuple([t0_id: t0Id, t1_id: t1Id, release_id: releaseId], t0Root, t1Root, (params.method_names_file ?: '')))
                .set { eval_window_inputs_ch }

            EVALUATE_WINDOW(eval_window_inputs_ch)
            break

        case 'evaluate_late_predictions':
            def t0Id      = requireParam('t0_id')
            def releaseId = requireParam('release_id')
            def t0Root    = file(params.t0_root ?: "${params.output_root}/${t0Id}")
            def releaseRoot = file(params.release_root ?: "${params.publish_root}/${releaseId}")

            Channel
                .of(tuple([t0_id: t0Id, release_id: releaseId], t0Root, releaseRoot, (params.method_names_file ?: '')))
                .set { late_eval_inputs_ch }

            EVALUATE_LATE_PREDICTIONS(late_eval_inputs_ch)
            break

        case 'region_release':
            def regionMeta = [
                release_id   : requireParam('release_id'),
                title        : requireParam('release_title'),
                source_repo  : requireParam('source_repo'),
                source_commit: requireParam('source_commit'),
                run_date     : requireParam('run_date'),
            ]

            Channel
                .of(tuple(regionMeta, file(requireParam('results_parquet'), checkIfExists: true), file(requireParam('compute_parquet'), checkIfExists: true)))
                .set { region_inputs_ch }

            REGION_RELEASE(region_inputs_ch)
            break

        default:
            error "Unsupported --mode '${params.mode}'. Expected one of: timepoint_build, evaluate_window, evaluate_late_predictions, region_release"
    }
}
