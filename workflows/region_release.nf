include {
    BUILD_REGION_RELEASE
    VALIDATE_REGION_RELEASE
} from '../modules/local/region_release'

include {
    PUBLISH_RELEASE_DIRECTORY
    BUILD_RELEASE_CATALOG
} from '../modules/local/release_contract'

workflow REGION_RELEASE {
    take:
    region_inputs_ch

    main:
    built_release_ch     = BUILD_REGION_RELEASE(region_inputs_ch)
    validated_release_ch = VALIDATE_REGION_RELEASE(built_release_ch)
    published_release_ch = PUBLISH_RELEASE_DIRECTORY(validated_release_ch)
    release_catalog_ch   = BUILD_RELEASE_CATALOG(published_release_ch)

    emit:
    published_release_ch
    release_catalog_ch
}
