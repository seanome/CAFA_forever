import { useEffect, useMemo, useState } from 'react'
import { AppProvider, useAppState } from './context'
import { useCatalog, useReleaseData, useMethodsConfig, useComparisonData, useComparableMethods, useRegionRelease, useToolCards } from './hooks'
import { Header, Footer, Section } from './components/layout'
import { HeroSection, TimelineSelector } from './components/release'
import { MethodSelector } from './components/methods'
import { OverallRankingChart, FmaxSmallMultiples, TargetCountChart, PRCurveGrid, ComparisonTab } from './components/charts'
import { Tabs, Collapsible, type Tab } from './components/ui'
import { SummaryTable } from './components/table'
import { RegionView } from './components/region/RegionView'
import { MAX_SELECTED_METHODS, releaseTask, type Catalog, type SelectedReleaseBundle, type TaskId } from './types'
import './App.css'

/** LAFA's GO releases only: the timeline and comparison work on T0-T1 windows. */
function goOnly(catalog: Catalog | null): Catalog | null {
  if (!catalog) return null
  return { ...catalog, releases: catalog.releases.filter((r) => releaseTask(r) === 'go_whole_protein') }
}

function AppContent() {
  const { state, dispatch } = useAppState()
  const { catalog: fullCatalog, loading: catalogLoading, error: catalogError } = useCatalog()
  const catalog = useMemo(() => goOnly(fullCatalog), [fullCatalog])
  const regionReleases = useMemo(
    () => (fullCatalog?.releases ?? []).filter((r) => releaseTask(r) === 'region_transfer' && r.status === 'ready'),
    [fullCatalog],
  )
  const [task, setTask] = useState<TaskId>('go_whole_protein')
  const [regionReleaseId, setRegionReleaseId] = useState<string | null>(null)
  const activeRegionRelease = regionReleaseId ?? regionReleases[regionReleases.length - 1]?.id ?? null
  const region = useRegionRelease(task === 'region_transfer' ? activeRegionRelease : null)
  const toolCards = useToolCards()
  const { config: methodsConfig, loading: configLoading, error: configError } = useMethodsConfig()
  const {
    data: releaseData,
    loading: releaseLoading,
    error: releaseError,
    loadCurves,
    curvesLoading,
  } = useReleaseData(state.primaryRelease)

  // Load secondary release data when in compare mode
  const {
    data: secondaryReleaseData,
    loading: secondaryLoading,
    error: secondaryReleaseError,
    loadCurves: loadSecondaryCurves,
    curvesLoading: secondaryCurvesLoading,
  } = useReleaseData(state.compareMode ? state.secondaryRelease : null)

  const selectedReleaseIds = useMemo(() => {
    const ids = state.primaryRelease ? [state.primaryRelease] : []
    if (
      state.compareMode &&
      state.secondaryRelease &&
      state.secondaryRelease !== state.primaryRelease
    ) {
      ids.push(state.secondaryRelease)
    }
    return ids
  }, [state.compareMode, state.primaryRelease, state.secondaryRelease])

  const comparableMethods = useComparableMethods(
    [
      releaseData.methods,
      state.compareMode ? secondaryReleaseData.methods : null,
    ],
    methodsConfig?.methods,
    state.compareMode
  )

  const selectableMethods = useMemo(() => {
    return comparableMethods.filter((method) => {
      if (!state.showBaselinesOnly || !methodsConfig) return true
      return Boolean(methodsConfig.methods[method]?.isBaseline)
    })
  }, [comparableMethods, methodsConfig, state.showBaselinesOnly])

  const selectedMethods = useMemo(() => {
    const available = new Set(selectableMethods)
    return state.selectedMethods.filter((method) => available.has(method))
  }, [selectableMethods, state.selectedMethods])

  const methodSelectorMethods = useMemo(() => {
    if (!releaseData.methods) return {}
    if (!state.compareMode) return releaseData.methods.methods

    const comparable = new Set(comparableMethods)
    return Object.fromEntries(
      Object.entries(releaseData.methods.methods).filter(([method]) => comparable.has(method))
    )
  }, [comparableMethods, releaseData.methods, state.compareMode])

  // Compute comparison data
  const comparisonData = useComparisonData(
    releaseData.best,
    secondaryReleaseData.best,
    selectedMethods,
    selectedMethods
  )

  // Format release ID to readable label
  const formatReleaseLabel = (releaseId: string | null): string => {
    if (!releaseId) return ''
    const parts = releaseId.split('_')
    if (parts.length !== 4) return releaseId
    return `${parts[0]} ${parts[1]} - ${parts[2]} ${parts[3]}`
  }

  const primaryLabel = formatReleaseLabel(state.primaryRelease)
  const secondaryLabel = formatReleaseLabel(state.secondaryRelease)

  const releaseBundles = useMemo(() => {
    const bundles: SelectedReleaseBundle[] = []

    if (state.primaryRelease && releaseData.meta && releaseData.methods && releaseData.best) {
      bundles.push({
        releaseId: state.primaryRelease,
        label: primaryLabel,
        meta: releaseData.meta,
        methods: releaseData.methods,
        best: releaseData.best,
        curves: releaseData.curves,
      })
    }

    if (
      state.compareMode &&
      state.secondaryRelease &&
      state.secondaryRelease !== state.primaryRelease &&
      secondaryReleaseData.meta &&
      secondaryReleaseData.methods &&
      secondaryReleaseData.best
    ) {
      bundles.push({
        releaseId: state.secondaryRelease,
        label: secondaryLabel,
        meta: secondaryReleaseData.meta,
        methods: secondaryReleaseData.methods,
        best: secondaryReleaseData.best,
        curves: secondaryReleaseData.curves,
      })
    }

    return bundles
  }, [
    state.compareMode,
    state.primaryRelease,
    state.secondaryRelease,
    primaryLabel,
    secondaryLabel,
    releaseData.meta,
    releaseData.methods,
    releaseData.best,
    releaseData.curves,
    secondaryReleaseData.meta,
    secondaryReleaseData.methods,
    secondaryReleaseData.best,
    secondaryReleaseData.curves,
  ])

  // Auto-select first release
  useEffect(() => {
    if (catalog?.releases.length && !state.primaryRelease) {
      const readyReleases = catalog.releases.filter((r) => r.status === 'ready')
      if (readyReleases.length > 0) {
        dispatch({ type: 'SET_PRIMARY_RELEASE', payload: readyReleases[0].id })
      }
    }
  }, [catalog, state.primaryRelease, dispatch])

  // Keep selected methods valid for the active release mode.
  useEffect(() => {
    if (!releaseData.methods || !methodsConfig || selectableMethods.length === 0) return

    const nextSelected = state.selectedMethods
      .filter((method) => selectableMethods.includes(method))
      .slice(0, MAX_SELECTED_METHODS)

    if (nextSelected.length === 0) {
      const defaultCount = state.compareMode ? 4 : MAX_SELECTED_METHODS
      dispatch({
        type: 'SET_SELECTED_METHODS',
        payload: selectableMethods.slice(0, defaultCount),
      })
      return
    }

    if (
      nextSelected.length !== state.selectedMethods.length ||
      nextSelected.some((method, index) => method !== state.selectedMethods[index])
    ) {
      dispatch({ type: 'SET_SELECTED_METHODS', payload: nextSelected })
    }
  }, [dispatch, methodsConfig, releaseData.methods, selectableMethods, state.compareMode, state.selectedMethods])

  // Load curves when switching to curves tab
  useEffect(() => {
    if (state.activeTab === 'curves' && !releaseData.curves && !curvesLoading) {
      loadCurves()
    }
    if (
      state.activeTab === 'curves' &&
      state.compareMode &&
      state.secondaryRelease &&
      !secondaryReleaseData.curves &&
      !secondaryCurvesLoading
    ) {
      loadSecondaryCurves()
    }
  }, [
    state.activeTab,
    state.compareMode,
    state.secondaryRelease,
    releaseData.curves,
    secondaryReleaseData.curves,
    curvesLoading,
    secondaryCurvesLoading,
    loadCurves,
    loadSecondaryCurves,
  ])

  // Auto-select secondary release when comparison mode is enabled
  useEffect(() => {
    if (state.compareMode && !state.secondaryRelease && catalog?.releases.length) {
      const readyReleases = catalog.releases.filter((r) => r.status === 'ready')
      // Select a different release than primary, or fallback to first ready release
      const secondaryCandidate = readyReleases.find((r) => r.id !== state.primaryRelease)
        || readyReleases[0]
      if (secondaryCandidate) {
        dispatch({ type: 'SET_SECONDARY_RELEASE', payload: secondaryCandidate.id })
      }
    }
  }, [state.compareMode, state.secondaryRelease, state.primaryRelease, catalog, dispatch])

  const baselineMethods = useMemo(
    () => Object.entries(methodsConfig?.methods ?? {})
      .filter(([, config]) => config.isBaseline)
      .map(([method]) => method),
    [methodsConfig]
  )

  if (catalogLoading || configLoading) {
    return (
      <div className="app">
        <Header />
        <main className="main-content">
          <div className="loading-container">
            <div className="loading-spinner" />
            <p>Loading CAFA Forever...</p>
          </div>
        </main>
        <Footer />
      </div>
    )
  }

  if (catalogError || configError) {
    return (
      <div className="app">
        <Header />
        <main className="main-content">
          <div className="error-container">
            <h2>Error Loading Data</h2>
            <p>{catalogError || configError}</p>
            <p>Please ensure the data pipeline has been run.</p>
          </div>
        </main>
        <Footer />
      </div>
    )
  }

  const methodColorDomain = releaseData.methods
    ? comparableMethods
    : selectedMethods

  const tabs: Tab[] = [
    {
      id: 'summary',
      label: 'Summary',
      content: (
        <div className="tab-content">
          <div className="analysis-window-label">
            <span className="comparison-tab__legend-item comparison-tab__legend-item--a">
              {primaryLabel}
            </span>
          </div>
          <div className="summary-top-grid">
            {releaseData.meta && (
              <TargetCountChart targetCounts={releaseData.meta.targetCounts} />
            )}

            {releaseData.best && (
              <OverallRankingChart
                bestMetrics={releaseData.best}
                selectedMethods={selectedMethods}
                colorDomain={methodColorDomain}
                baselineMethods={baselineMethods}
              />
            )}
          </div>

          {releaseData.best && (
            <FmaxSmallMultiples
              bestMetrics={releaseData.best}
              selectedMethods={selectedMethods}
              colorDomain={methodColorDomain}
              baselineMethods={baselineMethods}
            />
          )}

        </div>
      ),
    },
    {
      id: 'curves',
      label: 'Precision Recall Curves',
      content: (
        <div className="tab-content">
          <div className="analysis-window-label">
          </div>
          {selectedReleaseIds.length > 1 && releaseBundles.length > 1 ? (
            <Tabs
              tabs={releaseBundles.map((bundle) => ({
                id: `curves-${bundle.releaseId}`,
                label: bundle.label,
                content: (
                  bundle.curves && bundle.best ? (
                    <PRCurveGrid
                      curves={bundle.curves}
                      bestMetrics={bundle.best}
                      selectedMethods={selectedMethods}
                      colorDomain={methodColorDomain}
                      totalSelectedCount={selectedMethods.length}
                    />
                  ) : (
                    <div className="loading-container">
                      <div className="loading-spinner" />
                      <p>Loading PR curves...</p>
                    </div>
                  )
                ),
              }))}
            />
          ) : curvesLoading ? (
            <div className="loading-container">
              <div className="loading-spinner" />
              <p>Loading PR curves...</p>
            </div>
          ) : releaseData.curves && releaseData.best ? (
            <PRCurveGrid
              curves={releaseData.curves}
              bestMetrics={releaseData.best}
              selectedMethods={selectedMethods}
              colorDomain={methodColorDomain}
              totalSelectedCount={selectedMethods.length}
            />
          ) : (
            <p>Select a release to view PR curves</p>
          )}
        </div>
      ),
    },
    {
      id: 'table',
      label: 'Table',
      content: (
        <div className="tab-content">
          {releaseData.best && state.primaryRelease ? (
            <SummaryTable
              bestMetrics={releaseData.best}
              selectedMethods={selectedMethods}
              releaseId={state.primaryRelease}
            />
          ) : (
            <p>Select a release to view the table</p>
          )}
        </div>
      ),
    },
    {
      id: 'comparison',
      label: 'Comparison',
      hidden: !state.compareMode,
      content: (
        <div className="tab-content">
          <ComparisonTab
            comparisonData={comparisonData}
            releaseBundles={releaseBundles}
            windowALabel={primaryLabel}
            windowBLabel={secondaryLabel}
            selectedMethods={selectedMethods}
            loading={secondaryLoading}
          />
        </div>
      ),
    },
  ]

  return (
    <div className="app">
      <Header />

      <main id="main-content" className="main-content">
        <HeroSection />

        {regionReleases.length > 0 && (
          <Section id="task">
            <div className="task-switch" role="group" aria-label="Task">
              <button
                type="button"
                aria-pressed={task === 'go_whole_protein'}
                onClick={() => setTask('go_whole_protein')}
              >
                GO terms, whole protein
              </button>
              <button
                type="button"
                aria-pressed={task === 'region_transfer'}
                onClick={() => setTask('region_transfer')}
              >
                Region transfer
              </button>
            </div>
            <p className="task-switch__help">
              {task === 'go_whole_protein'
                ? 'LAFA: methods predict GO terms for a whole protein, scored on terms added to UniProt after a cut-off date.'
                : 'Each method finds where on a human protein a domain or feature sits, by copying it from a related protein in another species, scored by how well the copied region matches the known one.'}
            </p>
          </Section>
        )}

        {task === 'region_transfer' && (
          <Section id="region">
            {regionReleases.length > 1 && (
              <label className="region-release-select">
                Release{' '}
                <select value={activeRegionRelease ?? ''} onChange={(e) => setRegionReleaseId(e.target.value)}>
                  {regionReleases.map((r) => (
                    <option key={r.id} value={r.id}>{r.title ?? r.id}</option>
                  ))}
                </select>
              </label>
            )}
            {region.loading ? (
              <div className="loading-container">
                <div className="loading-spinner" />
                <p>Loading region release...</p>
              </div>
            ) : region.error ? (
              <div className="error-container">
                <h2>Error Loading Release Data</h2>
                <p>{region.error}</p>
              </div>
            ) : region.meta ? (
              <RegionView meta={region.meta} rows={region.rows} cards={toolCards} />
            ) : null}
          </Section>
        )}

        {task === 'go_whole_protein' && catalog && (
          <Section id="analysis">
            <div className="analysis-release-controls">
              <div className="analysis-release-controls__primary">
                <TimelineSelector
                  releases={catalog.releases}
                  timepoints={catalog.timepoints}
                  timepointDates={catalog.timepointDates}
                  selectedRelease={state.primaryRelease}
                  onSelectRelease={(id) => dispatch({ type: 'SET_PRIMARY_RELEASE', payload: id })}
                  selectedTargetCount={releaseData.meta?.targetCounts.uniqueAcrossSubsets}
                  targetPlacement="right"
                />
              </div>

              <div className="analysis-release-controls__comparison-row">
                <label className="analysis-compare-toggle">
                  <input
                    type="checkbox"
                    checked={state.compareMode}
                    onChange={(event) =>
                      dispatch({ type: 'SET_COMPARE_MODE', payload: event.target.checked })
                    }
                  />
                  <span>Compare with another window</span>
                </label>
              </div>
                {state.compareMode && (
                  <div className="analysis-release-control--secondary">
                    <TimelineSelector
                      releases={catalog.releases}
                      timepoints={catalog.timepoints}
                      selectedRelease={state.secondaryRelease}
                      onSelectRelease={(id) => dispatch({ type: 'SET_SECONDARY_RELEASE', payload: id })}
                      label="Comparison Window"
                      selectedTargetCount={secondaryReleaseData.meta?.targetCounts.uniqueAcrossSubsets}
                      showTimepointDetails={false}
                      targetPlacement="right"
                      helpText="Choose another time window to compare evaluation results"
                    />
                  </div>
                )}
            </div>

            <div className="analysis-layout">
              <aside className="analysis-sidebar">
                {releaseData.methods && methodsConfig && (
                  <Collapsible title="Methods" defaultOpen={state.configPanelOpen}>
                    <MethodSelector
                      methods={methodSelectorMethods}
                      methodConfigs={methodsConfig.methods}
                      selectedMethods={selectedMethods}
                      onSelectionChange={(methods) =>
                        dispatch({ type: 'SET_SELECTED_METHODS', payload: methods })
                      }
                      activeSubset={state.activeSubset}
                      showBaselinesOnly={state.showBaselinesOnly}
                      onShowBaselinesOnlyChange={(show) =>
                        dispatch({ type: 'SET_SHOW_BASELINES_ONLY', payload: show })
                      }
                    />
                  </Collapsible>
                )}
              </aside>

              <div className="analysis-main">
                {releaseLoading ? (
                  <div className="loading-container">
                    <div className="loading-spinner" />
                    <p>Loading release data...</p>
                  </div>
                ) : releaseError || secondaryReleaseError ? (
                  <div className="error-container">
                    <h2>Error Loading Release Data</h2>
                    <p>{releaseError || secondaryReleaseError}</p>
                    <p>Refresh the page after rebuilding the frontend data.</p>
                  </div>
                ) : state.primaryRelease && releaseData.best ? (
                  <Tabs
                    tabs={tabs}
                    defaultTab={state.activeTab}
                    onChange={(tabId) =>
                      dispatch({ type: 'SET_ACTIVE_TAB', payload: tabId as typeof state.activeTab })
                    }
                  />
                ) : (
                  <div className="analysis-placeholder">
                    <p>Select an evaluation window to view results</p>
                  </div>
                )}
              </div>
            </div>
          </Section>
        )}
      </main>

      <Footer />
    </div>
  )
}

function App() {
  return (
    <AppProvider>
      <AppContent />
    </AppProvider>
  )
}

export default App
