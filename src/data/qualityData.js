// ─────────────────────────────────────────────
// Quality Control — Single source of truth
// All materials, tests, formulas, and rules.
//
// Adding a new rule to any parameter will
// automatically enable PASS/FAIL — no UI changes needed.
// ─────────────────────────────────────────────

// ── Shared formula definitions ──────────────────────────────
// type: 'formula' → rendered by <FormulaCalculator>
// type: 'spec'    → rendered by <SpecTable> row

export const SHARED_FORMULAS = {
  moisture: {
    id: 'moisture',
    name: 'Moisture Content',
    formulaHtml: '<span class="qc-frac"><span class="qc-num">W &minus; w</span><span class="qc-den">W</span></span> &times; 100',
    resultUnit: '%',
    variables: [
      { key: 'W', label: 'W', desc: 'Weight of sample taken (g)', unit: 'g' },
      { key: 'w', label: 'w', desc: 'Weight after loss on drying (g)', unit: 'g' },
    ],
    calcFn: 'calcMoisture',
    // no rule → no PASS/FAIL
  },

  sulphur: {
    id: 'sulphur',
    name: 'Sulphur Content',
    formulaHtml: '<span class="qc-frac"><span class="qc-num">0.03206 &times; N &times; 100 &times; BR</span><span class="qc-den">W</span></span>',
    resultUnit: '%',
    variables: [
      { key: 'N',  label: 'N',  desc: 'Normality of standard iodine solution', unit: '' },
      { key: 'BR', label: 'BR', desc: 'Burette reading of iodine solution (ml)', unit: 'ml' },
      { key: 'W',  label: 'W',  desc: 'Sample weight (g)', unit: 'g' },
    ],
    constants: [{ label: 'Factor', value: '0.03206', desc: 'Fixed conversion constant' }],
    calcFn: 'calcSulphur',
  },

  suspensibility: {
    id: 'suspensibility',
    name: 'Suspensibility',
    formulaHtml: '<span class="qc-frac"><span class="qc-num">1000 &times; (M &minus; m)</span><span class="qc-den">9 &times; M</span></span>',
    resultUnit: '%',
    variables: [
      { key: 'sulphurContent', label: 'Sulphur Content', desc: 'Sulphur content (%)', unit: '%' },
      { key: 'sampleWeight',   label: 'Sample Weight',   desc: 'Sample weight (g)', unit: 'g' },
      { key: 'N',  label: 'N',  desc: 'Normality of standard iodine solution', unit: '' },
      { key: 'BR', label: 'BR', desc: 'Burette reading (ml)', unit: 'ml' },
    ],
    intermediates: [
      { key: 'M', label: 'M', desc: 'Mass of pesticide in material (g)', formula: '(Sulphur Content × Sample Weight) / 100' },
      { key: 'm', label: 'm', desc: 'Mass of pesticide in suspension + sediment (g)', formula: '0.03206 × N × BR' },
    ],
    calcFn: 'calcSuspensibility',
  },

  wetSieve: {
    id: 'wetSieve',
    name: 'Wet Sieve',
    formulaHtml: '<span class="qc-frac"><span class="qc-num">M &minus; m</span><span class="qc-den">M</span></span> &times; 100',
    resultUnit: '%',
    variables: [
      { key: 'M', label: 'M', desc: 'Mass of material taken (g)', unit: 'g' },
      { key: 'm', label: 'm', desc: 'Mass of residue (g)', unit: 'g' },
    ],
    calcFn: 'calcSieve',
  },

  drySieve: {
    id: 'drySieve',
    name: 'Dry Sieve',
    formulaHtml: '<span class="qc-frac"><span class="qc-num">M &minus; m</span><span class="qc-den">M</span></span> &times; 100',
    resultUnit: '%',
    variables: [
      { key: 'M', label: 'M', desc: 'Mass of material taken (g)', unit: 'g' },
      { key: 'm', label: 'm', desc: 'Mass of residue (g)', unit: 'g' },
    ],
    calcFn: 'calcSieve',
  },

  bulkDensity: {
    id: 'bulkDensity',
    name: 'Bulk Density',
    formulaHtml: '<span class="qc-frac"><span class="qc-num">Mass</span><span class="qc-den">Volume</span></span>',
    resultUnit: 'g/cc',
    variables: [
      { key: 'mass',   label: 'Mass',   desc: 'Weight of sample in 100 ml (g)', unit: 'g' },
      { key: 'volume', label: 'Volume', desc: 'Measuring cylinder volume (ml)', unit: 'ml' },
    ],
    calcFn: 'calcBulkDensity',
  },

  purity: {
    id: 'purity',
    name: 'Purity',
    formulaHtml: '100 &minus; <span class="qc-frac"><span class="qc-num">M<sub>1</sub></span><span class="qc-den">M</span></span> &times; 100',
    resultUnit: '%',
    variables: [
      { key: 'M1', label: 'M₁', desc: 'Mass of CS₂-insoluble residue (g)', unit: 'g' },
      { key: 'M',  label: 'M',  desc: 'Mass of material taken for test (g)', unit: 'g' },
    ],
    calcFn: 'calcPurity',
  },

  meshSize: {
    id: 'meshSize',
    name: 'Mesh Size',
    formulaHtml: '100 &times; <span class="qc-left-paren">(</span>1 &minus; <span class="qc-frac"><span class="qc-num">m</span><span class="qc-den">M</span></span><span class="qc-right-paren">)</span>',
    resultUnit: '%',
    variables: [
      { key: 'm', label: 'm', desc: 'Coarse material retained on sieve (g)', unit: 'g' },
      { key: 'M', label: 'M', desc: 'Mass of material taken (g)', unit: 'g' },
    ],
    calcFn: 'calcMeshSize',
  },
}


// ── SECTION 1: RAW MATERIALS ─────────────────────────────────
export const RAW_MATERIALS = [
  {
    id: 'sulphurPowder',
    label: 'Sulphur Powder',
    type: 'formula-only',   // all tests are formula-based
    tests: [
      { ...SHARED_FORMULAS.purity,    id: 'sulphurPowder_purity'    },
      { ...SHARED_FORMULAS.meshSize,  id: 'sulphurPowder_meshSize'  },
    ],
  },

  {
    id: 'ligno',
    label: 'Ligno (Sodium Ligno Sulphonate)',
    type: 'spec',
    params: [
      {
        id: 'ligno_ph',
        name: 'pH',
        specification: '3 – 9',
        inputType: 'number',
        unit: '',
        rule: { type: 'range', min: 3, max: 9 },
      },
      {
        id: 'ligno_solubility',
        name: 'Solubility',
        specification: '100% soluble in water',
        inputType: 'dropdown',
        options: ['Clear Solution', 'Not Clear'],
        rule: { type: 'text', accepted: 'Clear Solution' },
      },
      {
        id: 'ligno_moisture',
        name: 'Moisture',
        specification: '0 – 5 %',
        inputType: 'number',
        unit: '%',
        rule: { type: 'range', min: 0, max: 5 },
      },
    ],
  },

  {
    id: 'chinaClay',
    label: 'China Clay',
    type: 'spec',
    params: [
      {
        id: 'clay_ph',
        name: 'pH',
        specification: '5 – 8',
        inputType: 'number',
        unit: '',
        rule: { type: 'range', min: 5, max: 8 },
      },
      {
        id: 'clay_sed10',
        name: 'Sedimentation after 10 min',
        specification: 'Max 5 ml',
        inputType: 'number',
        unit: 'ml',
        rule: { type: 'max', max: 5 },
      },
      {
        id: 'clay_sed30',
        name: 'Sedimentation after 30 min',
        specification: 'Max 10 ml',
        inputType: 'number',
        unit: 'ml',
        rule: { type: 'max', max: 10 },
      },
      {
        id: 'clay_moisture',
        name: 'Moisture',
        specification: '0 – 4 %',
        inputType: 'number',
        unit: '%',
        rule: { type: 'range', min: 0, max: 4 },
      },
    ],
  },

  {
    id: 'dnPowder',
    label: 'DN Powder / Liquid (Gujmol liquid)',
    type: 'spec',
    params: [
      {
        id: 'dn_ph',
        name: 'pH',
        specification: '5 – 8',
        inputType: 'number',
        unit: '',
        rule: { type: 'range', min: 5, max: 8 },
      },
      {
        id: 'dn_solubility',
        name: 'Solubility',
        specification: '100% soluble in water',
        inputType: 'dropdown',
        options: ['Clear Solution', 'Not Clear'],
        rule: { type: 'text', accepted: 'Clear Solution' },
      },
      {
        id: 'dn_moisture',
        name: 'Moisture',
        specification: '0 – 6 %',
        inputType: 'number',
        unit: '%',
        rule: { type: 'range', min: 0, max: 6 },
      },
      {
        id: 'dn_solid',
        name: 'Solid Content',
        specification: '45 ± 1 %',
        inputType: 'number',
        unit: '%',
        rule: { type: 'tolerance', target: 45, tol: 1 },
      },
    ],
  },

  {
    id: 'coal',
    label: 'Coal',
    type: 'spec',
    params: [
      {
        id: 'coal_moisture',
        name: 'Moisture Content',
        specification: 'Max 30 %',
        inputType: 'number',
        unit: '%',
        rule: { type: 'max', max: 30 },
      },
    ],
  },

  {
    id: 'microMedia',
    label: 'Micro Media',
    type: 'spec',
    params: [
      {
        id: 'mm_density',
        name: 'Density',
        specification: '4.40 ± 0.05 g/cc',
        inputType: 'number',
        unit: 'g/cc',
        rule: { type: 'tolerance', target: 4.40, tol: 0.05 },
      },
      {
        id: 'mm_diameter',
        name: 'Diameter',
        specification: '2.0 – 2.40 mm',
        inputType: 'number',
        unit: 'mm',
        rule: { type: 'range', min: 2.0, max: 2.40 },
      },
      {
        id: 'mm_finish',
        name: 'Finish',
        specification: 'Glossy Satin Smooth',
        inputType: 'dropdown',
        options: ['Complies', 'Does Not Comply'],
        rule: { type: 'text', accepted: 'Complies' },
      },
    ],
  },
]


// ── SECTION 2: IN-PROCESS ─────────────────────────────────────
export const IN_PROCESS = [
  {
    id: 'ip_moisture',
    label: 'Moisture Content',
    type: 'formula-only',
    tests: [{ ...SHARED_FORMULAS.moisture, id: 'ip_moisture_calc' }],
  },
  {
    id: 'ip_sulphur',
    label: 'Sulphur Content',
    type: 'formula-only',
    tests: [{ ...SHARED_FORMULAS.sulphur, id: 'ip_sulphur_calc' }],
  },
  {
    id: 'ip_suspensibility',
    label: 'Suspensibility',
    type: 'formula-only',
    tests: [{ ...SHARED_FORMULAS.suspensibility, id: 'ip_susp_calc' }],
  },
  {
    id: 'ip_wetSieve',
    label: 'Wet Sieve',
    type: 'formula-only',
    tests: [{ ...SHARED_FORMULAS.wetSieve, id: 'ip_wetsieve_calc' }],
  },
]


// ── SECTION 3: FINISHED GOODS ─────────────────────────────────
// Built as an array of products — add more products here later.
export const FINISHED_GOODS = [
  {
    id: 'sulphur80wdg',
    label: 'Sulphur 80% WDG',
    // Mix of formula-only tests (no rule) and spec params (with rule)
    tests: [
      // A) Sulphur Content — formula, no rule
      { ...SHARED_FORMULAS.sulphur,         id: 'fg_sulphur'  },
      // B) Suspensibility — formula, no rule
      { ...SHARED_FORMULAS.suspensibility,  id: 'fg_susp'     },
      // C) Moisture Content — formula, no rule
      { ...SHARED_FORMULAS.moisture,        id: 'fg_moisture' },
      // D) Bulk Density — formula, no rule
      { ...SHARED_FORMULAS.bulkDensity,     id: 'fg_bulk'     },
      // E) Wet Sieve — formula, no rule
      { ...SHARED_FORMULAS.wetSieve,        id: 'fg_wetSieve' },
      // F) Dry Sieve — formula, no rule
      { ...SHARED_FORMULAS.drySieve,        id: 'fg_drySieve' },
      // G) pH — spec, no rule
      {
        id: 'fg_ph',
        type: 'spec-single',
        name: 'pH',
        method: '1 g sample in 100 ml distilled water',
        specification: '—',
        inputType: 'number',
        unit: '',
        // no rule
      },
      // H) Wettability — spec, no rule
      {
        id: 'fg_wettability',
        type: 'spec-single',
        name: 'Wettability',
        method: '2 g material poured uniformly into 100 ml hard water',
        specification: '—',
        inputType: 'number',
        unit: 'sec',
        // no rule
      },
      // I) Persistent Foaming — two spec params WITH rules
      {
        id: 'fg_foam',
        type: 'spec-group',
        name: 'Persistent Foaming',
        params: [
          {
            id: 'fg_foam_start',
            name: 'At start',
            specification: 'Max 60 ml',
            inputType: 'number',
            unit: 'ml',
            rule: { type: 'max', max: 60 },
          },
          {
            id: 'fg_foam_1min',
            name: 'After 1.0 min',
            specification: 'Max 25 ml',
            inputType: 'number',
            unit: 'ml',
            rule: { type: 'max', max: 25 },
          },
        ],
      },
    ],
  },
  // Add more finished goods products here later — no UI changes needed
]
