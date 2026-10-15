/**
 * Plain names for everything a region_transfer release holds. Words, chip groups, prices
 * and kinds follow seanome/protein-function-annotation-leaderboard (PR 2,
 * scripts/build_site.py and scripts/tools.py) so the two sites say the same thing.
 */

export const TRUTH_LABELS: Record<string, { label: string; help: string }> = {
  pfam: { label: 'Pfam', help: 'Pfam-A domain families' },
  pfamn: {
    label: 'Pfam-N',
    help: "regions a deep-learning model added where Pfam-A's own models found nothing (Pfam 35.0)",
  },
  swissprot: {
    label: 'Swiss-Prot features',
    help: 'curated features from Swiss-Prot entries, such as active sites and membrane-spanning segments',
  },
}

export const SPECIES_NAMES: Record<string, string> = {
  ptroglodytes: 'chimpanzee',
  rnorvegicus: 'rat',
  clupus: 'dog',
  btaurus: 'cow',
  mouse: 'mouse',
  mdomestica: 'opossum',
  chicken: 'chicken',
  xtropicalis: 'western clawed frog',
  zebrafish: 'zebrafish',
  ciona: 'sea squirt (Ciona)',
  fly: 'fruit fly',
  worm: 'nematode (C. elegans)',
  yeast: "baker's yeast",
  arabidopsis: 'thale cress (Arabidopsis)',
  ecoli: 'E. coli',
  all: 'none: Pfam models (hmmscan only)',
}

export const SPECIES_GROUPS: { label: string; members: string[] }[] = [
  { label: 'mammals', members: ['ptroglodytes', 'rnorvegicus', 'clupus', 'btaurus', 'mouse', 'mdomestica'] },
  { label: 'other vertebrates', members: ['chicken', 'xtropicalis', 'zebrafish'] },
  { label: 'invertebrates', members: ['ciona', 'fly', 'worm'] },
  { label: 'fungus, plant, bacterium', members: ['yeast', 'arabidopsis', 'ecoli'] },
  { label: 'no relative', members: ['all'] },
]

export interface StratumAxis {
  axis: string
  label: string
  help: string
  groups: { label?: string; bins: [string, string][] }[]
}

export const STRATUM_AXES: StratumAxis[] = [
  {
    axis: 'identity',
    label: 'Nearest reviewed relative: % identity',
    help: '% identity of each human domain to the closest domain of the same family in that relative',
    groups: [{
      bins: [['0-20%', '0–20%'], ['20-30%', '20–30%'], ['30-40%', '30–40%'], ['40-60%', '40–60%'],
        ['60-100%', '60–100%'], ['no_homolog', 'no same-family domain']],
    }],
  },
  {
    axis: 'feature_length_bin',
    label: 'Region type and length',
    help: 'length of the annotated region the call must find',
    groups: [
      { label: 'short feature, 60 aa or less', bins: [['1', '1 aa'], ['2-15', '2–15 aa'], ['16-30', '16–30 aa'], ['31-60', '31–60 aa']] },
      { label: 'folded domain, 61 aa or more', bins: [['61-120', '61–120 aa'], ['121-250', '121–250 aa'], ['251+', '251 aa or more']] },
      { bins: [['whole_protein', 'whole protein']] },
    ],
  },
  {
    axis: 'plddt',
    label: 'Disorder',
    help: 'mean AlphaFold confidence (pLDDT, 0–100) of the human protein; low values mean disordered or unknown shape',
    groups: [{ bins: [['0-50', '0–50'], ['50-70', '50–70'], ['70-90', '70–90'], ['90-100', '90–100']] }],
  },
  {
    axis: 'feature_type',
    label: 'Feature type',
    help: 'Swiss-Prot feature key; only the Swiss-Prot truth set has these',
    groups: [{
      bins: [['ACT_SITE', 'ACT_SITE'], ['BINDING', 'BINDING'], ['COILED', 'COILED'], ['DNA_BIND', 'DNA_BIND'],
        ['DOMAIN', 'DOMAIN'], ['INTRAMEM', 'INTRAMEM'], ['MOTIF', 'MOTIF'], ['REGION', 'REGION'],
        ['REPEAT', 'REPEAT'], ['SITE', 'SITE'], ['TRANSMEM', 'TRANSMEM'], ['ZN_FING', 'ZN_FING']],
    }],
  },
]

export const FEATURE_WORDS: Record<string, string> = {
  ACT_SITE: 'active site residue', BINDING: 'binding site residue', COILED: 'coiled coil',
  DNA_BIND: 'DNA-binding region', DOMAIN: 'domain',
  INTRAMEM: 'region inside the membrane that does not cross it', MOTIF: 'short motif',
  REGION: 'region of interest', REPEAT: 'repeat', SITE: 'other single-residue site',
  TRANSMEM: 'membrane-spanning segment', ZN_FING: 'zinc finger',
}

export function binLabel(axis: string, bin: string): string {
  if (bin === 'all') return 'any'
  for (const a of STRATUM_AXES) {
    if (a.axis !== axis) continue
    for (const g of a.groups) for (const [v, w] of g.bins) if (v === bin) return w
  }
  return bin
}

/**
 * Kind of method: one colour per kind on every page. Tools of one kind share the colour
 * and differ by marker shape. These five hues are not used by any GO method
 * (hooks/useMethodColors.ts), so each colour on the site means one thing.
 */
export const KINDS: Record<string, { label: string; color: string }> = {
  letters: { label: 'aligns amino-acid letters', color: '#332288' },
  profiles: { label: 'builds a profile of a protein family', color: '#A6761D' },
  shapes: { label: 'compares 3-D shape letters (3Di)', color: '#7A9A01' },
  kmers: { label: 'counts shared k-mers in a reduced alphabet', color: '#A50F15' },
  models: { label: 'scans curated Pfam family models', color: '#9467BD' },
}

export type MarkerShape = 'circle' | 'square' | 'triangle' | 'diamond'

export const TOOLS: Record<string, { name: string; kind: string; shape: MarkerShape }> = {
  hmmer3_phmmer: { name: 'phmmer', kind: 'letters', shape: 'circle' },
  mmseqs2_seqseq: { name: 'MMseqs2', kind: 'letters', shape: 'square' },
  hmmer3_jackhmmer: { name: 'jackhmmer', kind: 'profiles', shape: 'circle' },
  mmseqs2_iterative: { name: 'MMseqs2, three rounds', kind: 'profiles', shape: 'square' },
  hhblits: { name: 'HH-suite (hhsearch)', kind: 'profiles', shape: 'triangle' },
  foldseek: { name: 'Foldseek', kind: 'shapes', shape: 'circle' },
  prostt5: { name: 'ProstT5 + Foldseek', kind: 'shapes', shape: 'square' },
  kmerseek: { name: 'kmerseek', kind: 'kmers', shape: 'circle' },
  hmmscan: { name: 'hmmscan with Pfam', kind: 'models', shape: 'circle' },
}

/** kmerseek settings differ by alphabet; each alphabet gets its own marker shape. */
const KMERSEEK_SHAPES: Record<string, MarkerShape> = {
  protein20: 'circle', gbmr4: 'square', wwmj5: 'triangle', hp_thomas_dill2: 'diamond',
}

export function toolColor(tool: string): string {
  return KINDS[TOOLS[tool]?.kind]?.color ?? '#5E6663'
}

export function toolShape(tool: string, setting: string): MarkerShape {
  if (tool === 'kmerseek') {
    const m = setting.match(/^(.+)_k\d+_lc(True|False)$/)
    if (m && KMERSEEK_SHAPES[m[1]]) return KMERSEEK_SHAPES[m[1]]
  }
  return TOOLS[tool]?.shape ?? 'circle'
}

export function toolName(tool: string): string {
  return TOOLS[tool]?.name ?? tool
}

const ALPHABETS: Record<string, string> = {
  protein20: 'the 20 amino acids, not reduced',
  gbmr4: '4 letters: ADKERNTSQ, YFLIVMCWH, G, P (Solis and Rackovsky 2000)',
  wwmj5: '5 letters: CMFILVWY, ATH, GP, DE, SNQRK (Wang and Wang 1999)',
  hp_thomas_dill2: '2 letters, hydrophobic ACFILMVWY and polar DEGHKNPQRST (Thomas and Dill 1996)',
}

const SETTING_WORDS: Record<string, string> = {
  'hmmer3_phmmer|default': "phmmer's default options, E-value cutoff 10",
  'hmmer3_jackhmmer|n3': 'three rounds of search (-N 3)',
  'mmseqs2_seqseq|s7': 'sensitivity 7 (-s 7), one round',
  'mmseqs2_iterative|s7': 'sensitivity 7 (-s 7), three rounds',
  'hhblits|single_seq': 'profiles built from single proteins, no family database',
  'foldseek|3di_aa': '3Di shape letters and amino acids together',
  'prostt5|3di_from_seq': '3Di letters predicted from sequence by ProstT5',
  'hmmscan|direct': "scans Pfam's models; no relative searched",
}

/** What a setting name means, in words. */
export function settingWords(tool: string, setting: string): string {
  const known = SETTING_WORDS[`${tool}|${setting}`]
  if (known) return known
  const m = setting.match(/^(.+)_k(\d+)_lc(True|False)$/)
  if (tool === 'kmerseek' && m) {
    const lc = m[3] === 'False' ? 'low-complexity k-mers kept' : 'low-complexity k-mers removed'
    return `alphabet ${m[1]} (${ALPHABETS[m[1]] ?? 'see the kmerseek README'}), k = ${m[2]}, ${lc}`
  }
  return setting
}

/** Short setting name for tables: "gbmr4 k21" rather than "gbmr4_k21_lcFalse". */
export function settingShort(tool: string, setting: string): string {
  const m = setting.match(/^(.+)_k(\d+)_lc(True|False)$/)
  if (tool === 'kmerseek' && m) return `${m[1]} k${m[2]}${m[3] === 'True' ? ' lc' : ''}`
  return setting
}

export const DEFAULT_FILTERS = {
  truthSet: 'pfam',
  dedup: false,
  species: 'zebrafish',
  stratumAxis: 'all',
  stratumBin: 'all',
}

export type RegionFilters = typeof DEFAULT_FILTERS
