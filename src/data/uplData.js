// UPL party parameters for Sulphur 80% WDG
// Add new grades or parties here — no UI changes needed.
//
// row shape:
//   id          — unique string
//   group       — bold group heading in the table
//   parameter   — parameter name
//   type        — 'number' | 'complies'
//   rule        — same shape as qualityUtils evaluate()
//   specDisplay — human-readable spec text shown in the Specification column
//   unit        — unit string (shown in Parameter column), '' if none

export const UPL_GRADES = {

  // ── Export Grade ──────────────────────────────────────────
  // hideTests: WDG test IDs that the UPL table already covers (hidden from WDG cards)
  export: Object.assign([
    // Active Content / Suspension — read-only 'calc' rows mirroring the live
    // fg_sulphur / fg_susp formula-card results (cards stay visible for input).
    { id: 'upl_exp_sulphur', group: 'Active Content', parameter: 'Active Content of Sulphur % by mass', type: 'calc', sourceResult: 'fg_sulphur', rule: { type: 'min', min: 80.0 }, specDisplay: 'Min 80.00', unit: '%' },
    { id: 'upl_exp_susp',    group: 'Suspension',     parameter: 'Suspension as Sulphur (%w/w)',        type: 'calc', sourceResult: 'fg_susp',    rule: { type: 'min', min: 80.0 }, specDisplay: 'Min 80.00', unit: '%' },
    // Particle Size Range
    { id: 'upl_exp_ps_10',   group: 'Particle Size Range',                    parameter: 'Particle >10µm',         type: 'number',   rule: { type: 'max',   max: 20 },              specDisplay: '<20',           unit: '%'     },
    { id: 'upl_exp_ps_6',    group: 'Particle Size Range',                    parameter: 'Particle >6µm',          type: 'number',   rule: { type: 'max',   max: 35 },              specDisplay: '<35',           unit: '%'     },
    { id: 'upl_exp_ps_1',    group: 'Particle Size Range',                    parameter: 'Particle >1µm',          type: 'number',   rule: { type: 'min',   min: 75 },              specDisplay: '>75',           unit: '%'     },
    // Wet Sieve
    { id: 'upl_exp_ws_160',  group: 'Wet Sieve',                              parameter: '160 Micron',             type: 'number',   rule: { type: 'max',   max: 0.02 },            specDisplay: 'Max 0.02',      unit: '%'     },
    { id: 'upl_exp_ws_25',   group: 'Wet Sieve',                              parameter: '25 Micron',              type: 'number',   rule: { type: 'max',   max: 0.20 },            specDisplay: 'Max 0.20',      unit: '%'     },
    // Dynamic Foam
    { id: 'upl_exp_df_0',    group: 'Dynamic Foam',                           parameter: 'At 0 min',               type: 'number',   rule: { type: 'max',   max: 300 },             specDisplay: '<300',          unit: 'ml'    },
    { id: 'upl_exp_df_1',    group: 'Dynamic Foam',                           parameter: 'At 1 min',               type: 'number',   rule: { type: 'max',   max: 200 },             specDisplay: '<200',          unit: 'ml'    },
    { id: 'upl_exp_df_2',    group: 'Dynamic Foam',                           parameter: 'At 2 min',               type: 'number',   rule: { type: 'max',   max: 150 },             specDisplay: '<150',          unit: 'ml'    },
    { id: 'upl_exp_df_5',    group: 'Dynamic Foam',                           parameter: 'At 5 min',               type: 'number',   rule: { type: 'max',   max: 60 },              specDisplay: '<60',           unit: 'ml'    },
    // Wet Particle Size
    { id: 'upl_exp_wps',     group: 'Wet Particle Size (without ultrasound)', parameter: 'Median diameter',        type: 'number',   rule: { type: 'range', min: 2.20, max: 4.90 }, specDisplay: '2.20 – 4.90',  unit: 'µm'    },
    // Alkalinity
    { id: 'upl_exp_alk',     group: 'Alkalinity',                             parameter: 'Caustic equivalent',     type: 'number',   rule: { type: 'max',   max: 0.6 },             specDisplay: 'Max 0.6',       unit: '% w/w' },
    // Dispersibility
    { id: 'upl_exp_disp',    group: 'Dispersibility',                         parameter: '≥150 g / 150 ml',        type: 'complies', rule: { type: 'text',  accepted: 'Complies' }, specDisplay: '≥150 g/150 ml', unit: ''      },
    // Appearance — last row before Overall Result. Complies/Does not comply dropdown + Pass/Fail status.
    { id: 'upl_exp_appearance', group: 'Appearance',                          parameter: 'Appearance',             type: 'complies', rule: { type: 'text',  accepted: 'Complies' }, specDisplay: 'The material shall be in the form light to dark brown fine granules. It shall be free from extraneous impurities or additive', unit: '' },
    // Wet Sieve WDG formula card kept visible for Export (Dry Sieve is not an
    // Export parameter, so it stays hidden-by-absence). Only Wet Sieve shows.
  ], { hideTests: ['fg_drySieve'] }),

  // ── OMRI Grade ────────────────────────────────────────────
  omri: Object.assign([
    // Active Content / Suspension / Water by KF.
    //   Sulphur + Suspensibility are read-only 'calc' rows mirroring the live
    //   fg_sulphur / fg_susp formula-card results (cards stay visible for input).
    //   Water by KF is an operator-entered numeric observation.
    { id: 'upl_omri_sulphur',  group: 'Active Content',   parameter: 'Active Content of Sulphur % by mass', type: 'calc',   sourceResult: 'fg_sulphur', rule: { type: 'range', min: 82, max: 82.5 }, specDisplay: '82 – 82.5', unit: '%' },
    { id: 'upl_omri_susp',     group: 'Suspension',       parameter: 'Suspension as Sulphur (%w/w)',        type: 'calc',   sourceResult: 'fg_susp',    rule: { type: 'min',   min: 80 },           specDisplay: 'Min 80',    unit: '%' },
    { id: 'upl_omri_water_kf', group: 'Water by KF',      parameter: 'Water by KF (%w/w)',                  type: 'number', rule: { type: 'range', min: 1.5, max: 2.3 }, specDisplay: '1.5 – 2.3', unit: '%' },
    // pH + Wettability — chemist-entered observations with Pass/Fail. The shared
    // fg_ph / fg_wettability cards are hidden for OMRI (see hideTests below), so
    // their preparation-instruction fields do not show.
    { id: 'upl_omri_ph',          group: 'pH',          parameter: 'PH of 1.0% Aqu Sol',   type: 'number', rule: { type: 'range', min: 7.0, max: 9.0 }, specDisplay: '7.0 – 9.0', unit: '' },
    { id: 'upl_omri_wettability', group: 'Wettability', parameter: 'Wettability (in Second)', type: 'number', rule: { type: 'max', max: 20 },            specDisplay: 'Max 20',    unit: 'sec' },
    // Particle Size Range
    { id: 'upl_omri_ps_10',     group: 'Particle Size Range', parameter: 'Particle >10µm',       type: 'number',   rule: { type: 'max',  max: 20 },    specDisplay: '<20',                unit: '%'  },
    { id: 'upl_omri_ps_6',      group: 'Particle Size Range', parameter: 'Particle >6µm',        type: 'number',   rule: { type: 'max',  max: 35 },    specDisplay: '<35',                unit: '%'  },
    { id: 'upl_omri_ps_1',      group: 'Particle Size Range', parameter: 'Particle >1µm',        type: 'number',   rule: { type: 'min',  min: 75 },    specDisplay: '>75',                unit: '%'  },
    // Dry Sieve
    { id: 'upl_omri_ds_500',    group: 'Dry Sieve',           parameter: '500 Micron',           type: 'number',   rule: { type: 'min',  min: 99 },    specDisplay: 'Min 99',             unit: '%'  },
    { id: 'upl_omri_ds_106',    group: 'Dry Sieve',           parameter: '106 Micron',           type: 'number',   rule: { type: 'max',  max: 11 },    specDisplay: 'Max 11',             unit: '%'  },
    // Dispersion
    { id: 'upl_omri_disp_self', group: 'Dispersion',          parameter: '1% self dispersing',   type: 'complies', rule: { type: 'text', accepted: 'Complies' }, specDisplay: '100% self dispersing', unit: '' },
    { id: 'upl_omri_disp_1h',   group: 'Dispersion',          parameter: 'Stability 1 hour',     type: 'complies', rule: { type: 'text', accepted: 'Complies' }, specDisplay: '0.5 ml sedimentation', unit: '' },
    { id: 'upl_omri_disp_24h',  group: 'Dispersion',          parameter: 'Stability 24 hours',   type: 'complies', rule: { type: 'text', accepted: 'Complies' }, specDisplay: '1.0 ml',               unit: '' },
    // Wet Sieve
    { id: 'upl_omri_ws_160',    group: 'Wet Sieve',           parameter: '160 Micron',           type: 'number',   rule: { type: 'min',  min: 99.98 }, specDisplay: 'Min 99.98',          unit: '%'  },
    { id: 'upl_omri_ws_25',     group: 'Wet Sieve',           parameter: '25 Micron',            type: 'number',   rule: { type: 'min',  min: 99.50 }, specDisplay: 'Min 99.50',          unit: '%'  },
    // Appearance — last row before Overall Result. Complies/Does not comply dropdown + Pass/Fail status.
    { id: 'upl_omri_appearance', group: 'Appearance',         parameter: 'Appearance',           type: 'complies', rule: { type: 'text', accepted: 'Complies' }, specDisplay: 'The Material shall be in form of light brown to brown colour Spray Dried granules, free from extraneous visible matter and hard lumps', unit: '' },
    // Wet Sieve & Dry Sieve WDG formula cards are kept visible for OMRI.
    // pH + Wettability cards are hidden (moved into the table above, which also
    // removes their shared preparation-instruction fields for OMRI).
  ], { hideTests: ['fg_ph', 'fg_wettability'] }),
}


// ─────────────────────────────────────────────────────────────
// ADMA (Adma India Private Limited) — Finished Goods configuration
// ─────────────────────────────────────────────────────────────
// Grade key = 'adama' (matches the existing Grade dropdown <option value="adama">).
//
// Per the product decision, ADMA REUSES the existing Finished Goods formula/spec
// CARDS for data entry (Sulphur, Suspensibility, Wet Sieve, Persistent Foaming,
// pH, Wettability — rendered from FINISHED_GOODS[0].tests like every grade). This
// file adds ONLY the two ADMA-specific parameters that have no existing card —
// Appearance and Drop Test — rendered via the SAME table component used by the
// UPL Export/OMRI grades (row shape: { id, group, parameter, type, rule,
// specDisplay, unit }). No duplicate data-entry rows are created for the carded
// parameters.
//
// CONFIRMED ADMA acceptance limits (from the ADMA spec table supplied by the
// user) are carried directly on the ADMA table rows below (pH range 5.0–9.0,
// Wettability max 60s). Persistent Foaming reuses the existing shared card rules
// (start max 60 ml / after 1 min max 25 ml) unchanged.
//
// NOT RULED (await authoritative spec — render value only, NO Pass/Fail):
//   Active Content of Sulphur % By mass (80%)  → no tolerance defined for ADMA
//   Suspensibility % by mass (min)             → minimum not confirmed
//   Wet Sieve Test (max 1.0% RETENTION on 45µm) → the existing fg_wetSieve
//        formula (calcSieve) computes PASS-THROUGH %, not retention %, so the
//        1.0% max limit must NOT be applied to that card's result. Only the
//        label carries the spec text; Pass/Fail is left to the existing card.

// ADMA tests that are hidden as standalone FINISHED_GOODS cards for the adama
// grade ONLY (other grades keep every card unchanged):
//   fg_ph, fg_wettability → moved INTO the ADMA table as Observation rows
//     (also removes their shared "method" preparation instruction for ADMA).
//   fg_drySieve           → Dry Sieve is not an ADMA parameter → removed.
//   fg_moisture           → Moisture Content is not an ADMA parameter → removed.
//   fg_bulk               → Bulk Density is not an ADMA parameter → removed.
// The Sulphur card (fg_sulphur) stays VISIBLE so its formula inputs remain
// operational; its calculated result is mirrored into the ADMA table.
export const ADMA_HIDDEN_CARDS = ['fg_ph', 'fg_wettability', 'fg_drySieve', 'fg_moisture', 'fg_bulk']

// Per-grade display-name override for shared cards, ADMA only. Does not change
// the underlying test definition (other grades keep the original name).
export const ADMA_CARD_NAME_OVERRIDES = {
  fg_wetSieve: 'Wet Sieve (1.0% retention on 45 micron test sieve)',
}

// ADMA-only table rows, rendered via the shared UPL table component.
// Column layout: Parameter / Specification / Observation / Result.
// row.type:
//   'calc'     → read-only Observation sourced from a formula card's live result
//                (row.sourceResult names which captured result to show).
//   'number'   → operator-entered numeric Observation.
//   'complies' → Complies / Does not comply dropdown.
//   'droptest' → Found OK no leakage / Fail dropdown.
export const ADMA_EXTRA_PARAMS = [
  {
    id: 'adma_sulphur',
    group: 'Active Content',
    parameter: 'Active Content of Sulphur % by mass',
    type: 'calc',
    sourceResult: 'fg_sulphur',   // mirror the live Sulphur formula-card result
    // No ADMA tolerance confirmed → no rule → Result shows "—" (not fabricated).
    specDisplay: '80%',
    unit: '%',
  },
  {
    id: 'adma_ph',
    group: 'pH',
    parameter: 'pH',
    type: 'number',
    rule: { type: 'range', min: 5.0, max: 9.0 },
    specDisplay: '5.0 – 9.0',
    unit: '',
  },
  {
    id: 'adma_wettability',
    group: 'Wettability',
    parameter: 'Wettability (max)',
    type: 'number',
    rule: { type: 'max', max: 60 },
    specDisplay: '60 seconds',
    unit: '',
  },
  {
    id: 'adma_appearance',
    group: 'Appearance',
    parameter: 'Appearance',
    type: 'complies',
    rule: { type: 'text', accepted: 'Complies' },
    specDisplay: 'Yellow to Olive Brown fine free flowing micro Granules',
    unit: '',
  },
  {
    id: 'adma_drop_test',
    group: 'Drop Test of bags',
    parameter: 'Drop Test of bags',
    type: 'droptest',
    rule: { type: 'text', accepted: 'Found OK no leakage' },
    specDisplay: "From 6' height",
    unit: '',
  },
]


// ─────────────────────────────────────────────────────────────
// LOHIYA (Lohiya Chemical Ltd.) — Finished Goods configuration
// ─────────────────────────────────────────────────────────────
// Grade key = 'lohiya' (matches the existing Grade dropdown <option value="lohiya">).
// Structurally identical to ADMA (same eight-parameter table, same confirmed
// limits, same unruled parameters), but with its OWN row ids so Lohiya values
// persist in a separate per-grade bucket and never collide with ADMA. Applied
// ONLY when the active grade is 'lohiya' — ADMA and all other grades untouched.
//
// Hidden cards (Lohiya only): pH + Wettability (moved into the table, which also
// removes their shared preparation instruction for Lohiya), Dry Sieve, Moisture
// Content, and Bulk Density (not Lohiya parameters).
export const LOHIYA_HIDDEN_CARDS = ['fg_ph', 'fg_wettability', 'fg_drySieve', 'fg_moisture', 'fg_bulk']

// Wet Sieve label override (Lohiya only).
export const LOHIYA_CARD_NAME_OVERRIDES = {
  fg_wetSieve: 'Wet Sieve Test (max) — 1.0 % retention on 45 micron test sieve',
}

// Lohiya table rows. Same shapes/types as ADMA; unique ids (lohiya_*).
export const LOHIYA_EXTRA_PARAMS = [
  {
    id: 'lohiya_sulphur',
    group: 'Active Content',
    parameter: 'Active Content of Sulphur % By mass',
    type: 'calc',
    sourceResult: 'fg_sulphur',   // mirror the live Sulphur formula-card result
    // No confirmed Lohiya tolerance → no rule → Result shows "—" (not fabricated).
    specDisplay: '80%',
    unit: '%',
  },
  {
    id: 'lohiya_ph',
    group: 'pH',
    parameter: 'PH of 1.0 % Aqu Sol',
    type: 'number',
    rule: { type: 'range', min: 5.0, max: 9.0 },
    specDisplay: '5.0 – 9.0',
    unit: '',
  },
  {
    id: 'lohiya_wettability',
    group: 'Wettability',
    parameter: 'Wettability (max)',
    type: 'number',
    rule: { type: 'max', max: 60 },
    specDisplay: '60.0 seconds',
    unit: '',
  },
  {
    id: 'lohiya_appearance',
    group: 'Appearance',
    parameter: 'Appearance',
    type: 'complies',
    rule: { type: 'text', accepted: 'Complies' },
    specDisplay: 'Yellow to Olive Brown fine free flowing micro Granules',
    unit: '',
  },
  {
    id: 'lohiya_drop_test',
    group: 'Drop Test of bags',
    parameter: 'Drop Test of bags',
    type: 'droptest',
    rule: { type: 'text', accepted: 'Found OK no leakage' },
    specDisplay: "From 6' height",
    unit: '',
  },
]


// ─────────────────────────────────────────────────────────────
// BIOSTADT (Biostadt India Ltd.) — Finished Goods configuration
// ─────────────────────────────────────────────────────────────
// Grade key = 'biostadt' (matches the existing Grade dropdown
// <option value="biostadt">). Structurally identical to ADMA/Lohiya (same
// eight-parameter table, same confirmed limits, same unruled parameters), with
// its OWN row ids so Biostadt values persist in a separate per-grade bucket and
// never collide with ADMA or Lohiya. Applied ONLY when the active grade is
// 'biostadt' — every other grade untouched.
//
// Hidden cards (Biostadt only): pH + Wettability (moved into the table, which
// also removes their shared preparation instruction for Biostadt), Dry Sieve,
// Moisture Content, and Bulk Density (not Biostadt parameters).
export const BIOSTADT_HIDDEN_CARDS = ['fg_ph', 'fg_wettability', 'fg_drySieve', 'fg_moisture', 'fg_bulk']

// Wet Sieve label override (Biostadt only).
export const BIOSTADT_CARD_NAME_OVERRIDES = {
  fg_wetSieve: 'Wet Sieve Test (max) — 1.0 % retention on 45 micron test sieve',
}

// Biostadt table rows. Same shapes/types as ADMA/Lohiya; unique ids (biostadt_*).
export const BIOSTADT_EXTRA_PARAMS = [
  {
    id: 'biostadt_sulphur',
    group: 'Active Content',
    parameter: 'Active Content of Sulphur % By mass',
    type: 'calc',
    sourceResult: 'fg_sulphur',   // mirror the live Sulphur formula-card result
    // No confirmed Biostadt tolerance → no rule → Result shows "—" (not fabricated).
    specDisplay: '80%',
    unit: '%',
  },
  {
    id: 'biostadt_ph',
    group: 'pH',
    parameter: 'PH of 1.0 % Aqu Sol',
    type: 'number',
    rule: { type: 'range', min: 5.0, max: 9.0 },
    specDisplay: '5.0 – 9.0',
    unit: '',
  },
  {
    id: 'biostadt_wettability',
    group: 'Wettability',
    parameter: 'Wettability (max)',
    type: 'number',
    rule: { type: 'max', max: 60 },
    specDisplay: '60.0 seconds',
    unit: '',
  },
  {
    id: 'biostadt_appearance',
    group: 'Appearance',
    parameter: 'Appearance',
    type: 'complies',
    rule: { type: 'text', accepted: 'Complies' },
    specDisplay: 'Yellow to Olive Brown fine free flowing micro Granules',
    unit: '',
  },
  {
    id: 'biostadt_drop_test',
    group: 'Drop Test of bags',
    parameter: 'Drop Test of bags',
    type: 'droptest',
    rule: { type: 'text', accepted: 'Found OK no leakage' },
    specDisplay: "From 6' height",
    unit: '',
  },
]


// ─────────────────────────────────────────────────────────────
// SUMITOMO (Sumitomo Chemical India) — Finished Goods configuration
// ─────────────────────────────────────────────────────────────
// Grade key = 'sumitomo' (matches the existing Grade dropdown
// <option value="sumitomo">). Structurally identical to ADMA/Lohiya/Biostadt
// (same eight-parameter table, same confirmed limits, same unruled parameters),
// with its OWN row ids so Sumitomo values persist in a separate per-grade bucket
// and never collide with the other table grades. Applied ONLY when the active
// grade is 'sumitomo' — every other grade untouched.
//
// Hidden cards (Sumitomo only): pH + Wettability (moved into the table, which
// also removes their shared preparation instruction for Sumitomo), Dry Sieve,
// Moisture Content, and Bulk Density (not Sumitomo parameters).
export const SUMITOMO_HIDDEN_CARDS = ['fg_ph', 'fg_wettability', 'fg_drySieve', 'fg_moisture', 'fg_bulk']

// Wet Sieve label override (Sumitomo only).
export const SUMITOMO_CARD_NAME_OVERRIDES = {
  fg_wetSieve: 'Wet Sieve Test (max) — 1.0 % retention on 45 micron test sieve',
}

// Sumitomo table rows. Same shapes/types as ADMA/Lohiya/Biostadt; unique ids.
export const SUMITOMO_EXTRA_PARAMS = [
  {
    id: 'sumitomo_sulphur',
    group: 'Active Content',
    parameter: 'Active Content of Sulphur % By mass',
    type: 'calc',
    sourceResult: 'fg_sulphur',   // mirror the live Sulphur formula-card result
    // No confirmed Sumitomo tolerance → no rule → Result shows "—" (not fabricated).
    specDisplay: '80%',
    unit: '%',
  },
  {
    id: 'sumitomo_ph',
    group: 'pH',
    parameter: 'PH of 1.0 % Aqu Sol',
    type: 'number',
    rule: { type: 'range', min: 5.0, max: 9.0 },
    specDisplay: '5.0 – 9.0',
    unit: '',
  },
  {
    id: 'sumitomo_wettability',
    group: 'Wettability',
    parameter: 'Wettability (max)',
    type: 'number',
    rule: { type: 'max', max: 60 },
    specDisplay: '60.0 seconds',
    unit: '',
  },
  {
    id: 'sumitomo_appearance',
    group: 'Appearance',
    parameter: 'Appearance',
    type: 'complies',
    rule: { type: 'text', accepted: 'Complies' },
    specDisplay: 'Yellow to Olive Brown fine free flowing micro Granules',
    unit: '',
  },
  {
    id: 'sumitomo_drop_test',
    group: 'Drop Test of bags',
    parameter: 'Drop Test of bags',
    type: 'droptest',
    rule: { type: 'text', accepted: 'Found OK no leakage' },
    specDisplay: "From 6' height",
    unit: '',
  },
]


// ─────────────────────────────────────────────────────────────
// HEMANI INDUSTRIES UNIT - V — Finished Goods configuration
// ─────────────────────────────────────────────────────────────
// Grade key = 'hemani_v' (matches the existing Grade dropdown
// <option value="hemani_v">). Structurally identical to ADMA/Lohiya/Biostadt/
// Sumitomo (same eight-parameter table, same confirmed limits, same unruled
// parameters), with its OWN row ids so Hemani values persist in a separate
// per-grade bucket and never collide with the other table grades. Applied ONLY
// when the active grade is 'hemani_v' — every other grade untouched.
//
// Hidden cards (Hemani only): pH + Wettability (moved into the table, which also
// removes their shared preparation instruction for Hemani), Dry Sieve, Moisture
// Content, and Bulk Density (not Hemani parameters).
export const HEMANI_HIDDEN_CARDS = ['fg_ph', 'fg_wettability', 'fg_drySieve', 'fg_moisture', 'fg_bulk']

// Wet Sieve label override (Hemani only).
export const HEMANI_CARD_NAME_OVERRIDES = {
  fg_wetSieve: 'Wet Sieve Test (max) — 1.0 % retention on 45 micron test sieve',
}

// Hemani table rows. Same shapes/types as the other table grades; unique ids.
export const HEMANI_EXTRA_PARAMS = [
  {
    id: 'hemani_sulphur',
    group: 'Active Content',
    parameter: 'Active Content of Sulphur % By mass',
    type: 'calc',
    sourceResult: 'fg_sulphur',   // mirror the live Sulphur formula-card result
    // No confirmed Hemani tolerance → no rule → Result shows "—" (not fabricated).
    specDisplay: '80%',
    unit: '%',
  },
  {
    id: 'hemani_ph',
    group: 'pH',
    parameter: 'PH of 1.0 % Aqu Sol',
    type: 'number',
    rule: { type: 'range', min: 5.0, max: 9.0 },
    specDisplay: '5.0 – 9.0',
    unit: '',
  },
  {
    id: 'hemani_wettability',
    group: 'Wettability',
    parameter: 'Wettability (max)',
    type: 'number',
    rule: { type: 'max', max: 60 },
    specDisplay: '60.0 seconds',
    unit: '',
  },
  {
    id: 'hemani_appearance',
    group: 'Appearance',
    parameter: 'Appearance',
    type: 'complies',
    rule: { type: 'text', accepted: 'Complies' },
    specDisplay: 'Yellow to Olive Brown fine free flowing micro Granules',
    unit: '',
  },
  {
    id: 'hemani_drop_test',
    group: 'Drop Test of bags',
    parameter: 'Drop Test of bags',
    type: 'droptest',
    rule: { type: 'text', accepted: 'Found OK no leakage' },
    specDisplay: "From 6' height",
    unit: '',
  },
]


// ─────────────────────────────────────────────────────────────
// SANACA DUBAI — Finished Goods configuration
// ─────────────────────────────────────────────────────────────
// Grade key = 'sanaca' (new Grade dropdown <option value="sanaca">Sanaca Dubai).
// Similar to the other table grades but with extra rows and TWO confirmed rules
// the others lack:
//   • Sulphur    → 'calc' row mirroring fg_sulphur, RULE range 78.0–85.0
//                  (80.0% +5% / -2%, interpreted as percentage-point tolerance:
//                   80+5 = 85 upper, 80-2 = 78 lower, inclusive).
//   • Suspensibility → 'calc' row mirroring fg_susp, RULE min 80.0.
//   • Bulk Density → 'calc' row mirroring the fg_bulk formula-card result into
//                    the Observation column, spec text "Taped", UNRULED (no
//                    numeric acceptance criterion — result shows, NO Pass/Fail).
//   • Arsenic Content → dropdown ('arsenic'): "Not Detected" → Pass,
//                       "Detected" → Fail, empty → no status. Never prefilled.
// Hidden cards (Sanaca only): pH + Wettability (moved into the table, removing
// their prep instruction), Dry Sieve + Moisture. The Sulphur, Suspensibility,
// Bulk Density, Wet Sieve, and Persistent Foaming CARDS stay VISIBLE so their
// formula inputs remain operational; Sulphur/Suspensibility/Bulk Density results
// mirror into the table, Wet Sieve keeps its card + label override, Foaming
// keeps its two independent card readings.
export const SANACA_HIDDEN_CARDS = ['fg_ph', 'fg_wettability', 'fg_drySieve', 'fg_moisture']

// Wet Sieve label override (Sanaca only). Spec text only — the fg_wetSieve card
// formula/result/validation are unchanged (calcSieve computes pass-through %,
// not retention %, so the 1.0% "retention [Max]" limit is NOT auto-applied to
// the card result; shown as label text and left to the existing card logic).
export const SANACA_CARD_NAME_OVERRIDES = {
  fg_wetSieve: 'Wet Sieve Test — 1.0% retention on 45 µ test sieve [Max]',
}

// Sanaca table rows. Unique ids (sanaca_*).
export const SANACA_EXTRA_PARAMS = [
  {
    id: 'sanaca_appearance',
    group: 'Appearance',
    parameter: 'Appearance',
    type: 'complies',
    rule: { type: 'text', accepted: 'Complies' },
    specDisplay: 'Yellow to Olive Brown fine free flowing micro Granules',
    unit: '',
  },
  {
    id: 'sanaca_sulphur',
    group: 'Active Content',
    parameter: 'Active content of Sulphur % by mass',
    type: 'calc',
    sourceResult: 'fg_sulphur',   // mirror the live Sulphur formula-card result
    // 80.0% +5% / -2% → inclusive range 78.0 – 85.0 (percentage-point tolerance).
    rule: { type: 'range', min: 78.0, max: 85.0 },
    specDisplay: '80.0% + 5% & -2%',
    unit: '%',
  },
  {
    id: 'sanaca_ph',
    group: 'pH',
    parameter: 'PH of 1.0% Aqueous solution',
    type: 'number',
    rule: { type: 'range', min: 5.0, max: 9.0 },
    specDisplay: '5.0 – 9.0',
    unit: '',
  },
  {
    id: 'sanaca_wettability',
    group: 'Wettability',
    parameter: 'Wettability',
    type: 'number',
    rule: { type: 'max', max: 60 },
    specDisplay: '60.0 seconds [max.]',
    unit: '',
  },
  {
    id: 'sanaca_suspensibility',
    group: 'Suspensibility',
    parameter: 'Suspensibility % by mass',
    type: 'calc',
    sourceResult: 'fg_susp',   // mirror the live Suspensibility formula result
    rule: { type: 'min', min: 80.0 },
    specDisplay: '80.0% by mass [min]',
    unit: '%',
  },
  {
    id: 'sanaca_bulk_density',
    group: 'Bulk Density',
    parameter: 'Bulk Density',
    type: 'calc',
    sourceResult: 'fg_bulk',   // mirror the live Bulk Density formula-card result
    // Spec is a method ("Taped"), no numeric acceptance criterion → UNRULED:
    // the computed result shows in the Observation column with NO Pass/Fail.
    specDisplay: 'Taped',
    unit: 'g/cc',
  },
  {
    id: 'sanaca_arsenic',
    group: 'Arsenic Content',
    parameter: 'Arsenic Content',
    type: 'arsenic',
    // Dropdown: "Not Detected" → Pass, "Detected" → Fail. Empty → no status.
    rule: { type: 'text', accepted: 'Not Detected' },
    specDisplay: '—',
    unit: '',
  },
]


// ─────────────────────────────────────────────────────────────
// VILLA CROP — Finished Goods configuration
// ─────────────────────────────────────────────────────────────
// Grade key = 'villacrop' (new Grade dropdown <option value="villacrop">Villa Crop).
// Parameter set is identical to Sanaca Dubai (same ten rows, same tolerances),
// with its OWN row ids (villacrop_*) so values persist in a separate per-grade
// bucket. Applied ONLY when the active grade is 'villacrop'.
//   • Sulphur    → 'calc' row mirroring fg_sulphur, RULE range 78.0–85.0
//                  (80.0% +5% / -2% as percentage-point tolerance, inclusive).
//   • Suspensibility → 'calc' row mirroring fg_susp, RULE min 80.0.
//   • Bulk Density → 'calc' row mirroring fg_bulk, spec "Taped", UNRULED
//                    (result shows in Observation, NO Pass/Fail fabricated).
//   • Arsenic Content → dropdown ('arsenic'): Not Detected → Pass,
//                       Detected → Fail, empty → no status. Never prefilled.
// Hidden cards (Villa Crop only): pH + Wettability (moved into the table,
// removing their prep instruction), Dry Sieve + Moisture. The Sulphur,
// Suspensibility, Bulk Density, Wet Sieve, and Persistent Foaming CARDS stay
// VISIBLE so their formula inputs remain operational.
export const VILLACROP_HIDDEN_CARDS = ['fg_ph', 'fg_wettability', 'fg_drySieve', 'fg_moisture']

export const VILLACROP_CARD_NAME_OVERRIDES = {
  fg_wetSieve: 'Wet Sieve Test [Max] — 1.0% retention on 45 µ test sieve',
}

export const VILLACROP_EXTRA_PARAMS = [
  {
    id: 'villacrop_appearance',
    group: 'Appearance',
    parameter: 'Appearance',
    type: 'complies',
    rule: { type: 'text', accepted: 'Complies' },
    specDisplay: 'Yellow to Olive Brown fine free flowing micro Granules',
    unit: '',
  },
  {
    id: 'villacrop_sulphur',
    group: 'Active Content',
    parameter: 'Active content of Sulphur % by mass',
    type: 'calc',
    sourceResult: 'fg_sulphur',
    rule: { type: 'range', min: 78.0, max: 85.0 },
    specDisplay: '80.0% + 5% & -2%',
    unit: '%',
  },
  {
    id: 'villacrop_ph',
    group: 'pH',
    parameter: 'PH of 1.0% Aqueous solution',
    type: 'number',
    rule: { type: 'range', min: 5.0, max: 9.0 },
    specDisplay: '5.0 – 9.0',
    unit: '',
  },
  {
    id: 'villacrop_wettability',
    group: 'Wettability',
    parameter: 'Wettability [max.]',
    type: 'number',
    rule: { type: 'max', max: 60 },
    specDisplay: '60.0 seconds',
    unit: '',
  },
  {
    id: 'villacrop_suspensibility',
    group: 'Suspensibility',
    parameter: 'Suspensibility % by mass [min]',
    type: 'calc',
    sourceResult: 'fg_susp',
    rule: { type: 'min', min: 80.0 },
    specDisplay: '80.0% by mass',
    unit: '%',
  },
  {
    id: 'villacrop_bulk_density',
    group: 'Bulk Density',
    parameter: 'Bulk Density',
    type: 'calc',
    sourceResult: 'fg_bulk',
    // Spec is a method ("Taped"), no numeric criterion → UNRULED (Observation only).
    specDisplay: 'Taped',
    unit: 'g/cc',
  },
  {
    id: 'villacrop_arsenic',
    group: 'Arsenic Content',
    parameter: 'Arsenic Content',
    type: 'arsenic',
    rule: { type: 'text', accepted: 'Not Detected' },
    specDisplay: '—',
    unit: '',
  },
]


// ─────────────────────────────────────────────────────────────
// YELLOWSTONE — Finished Goods configuration
// ─────────────────────────────────────────────────────────────
// Grade key = 'yellowstone'. Parameter set identical to Villa Crop / Sanaca
// Dubai (ten rows, same tolerances), with its OWN row ids (yellowstone_*).
//   • Sulphur → 'calc' (fg_sulphur), RULE range 78.0–85.0 (80.0% +5%/-2%).
//   • Suspensibility → 'calc' (fg_susp), RULE min 80.0.
//   • Bulk Density → 'calc' (fg_bulk), spec "Taped", UNRULED (Observation only).
//   • Arsenic Content → dropdown ('arsenic'): Not Detected → Pass,
//                       Detected → Fail, empty → no status. Never prefilled.
// Hidden cards (Yellowstone only): pH + Wettability (moved into the table,
// removing their prep instruction), Dry Sieve + Moisture. Sulphur/Susp/Bulk/
// Wet Sieve/Foaming cards stay visible for their formula inputs.
export const YELLOWSTONE_HIDDEN_CARDS = ['fg_ph', 'fg_wettability', 'fg_drySieve', 'fg_moisture']

export const YELLOWSTONE_CARD_NAME_OVERRIDES = {
  fg_wetSieve: 'Wet Sieve Test — 1.0% retention on 45 µ test sieve [Max]',
}

export const YELLOWSTONE_EXTRA_PARAMS = [
  {
    id: 'yellowstone_appearance',
    group: 'Appearance',
    parameter: 'Appearance',
    type: 'complies',
    rule: { type: 'text', accepted: 'Complies' },
    specDisplay: 'Yellow to Olive Brown fine free flowing micro-Granules',
    unit: '',
  },
  {
    id: 'yellowstone_sulphur',
    group: 'Active Content',
    parameter: 'Active content of Sulphur % by mass',
    type: 'calc',
    sourceResult: 'fg_sulphur',
    rule: { type: 'range', min: 78.0, max: 85.0 },
    specDisplay: '80.0% + 5% & -2%',
    unit: '%',
  },
  {
    id: 'yellowstone_ph',
    group: 'pH',
    parameter: 'PH of 1.0% Aqueous solution',
    type: 'number',
    rule: { type: 'range', min: 5.0, max: 9.0 },
    specDisplay: '5.0 – 9.0',
    unit: '',
  },
  {
    id: 'yellowstone_wettability',
    group: 'Wettability',
    parameter: 'Wettability',
    type: 'number',
    rule: { type: 'max', max: 60 },
    specDisplay: '60.0 seconds [max.]',
    unit: '',
  },
  {
    id: 'yellowstone_suspensibility',
    group: 'Suspensibility',
    parameter: 'Suspensibility % by mass',
    type: 'calc',
    sourceResult: 'fg_susp',
    rule: { type: 'min', min: 80.0 },
    specDisplay: '80.0% by mass [min]',
    unit: '%',
  },
  {
    id: 'yellowstone_bulk_density',
    group: 'Bulk Density',
    parameter: 'Bulk Density',
    type: 'calc',
    sourceResult: 'fg_bulk',
    specDisplay: 'Taped',
    unit: 'g/cc',
  },
  {
    id: 'yellowstone_arsenic',
    group: 'Arsenic Content',
    parameter: 'Arsenic Content',
    type: 'arsenic',
    rule: { type: 'text', accepted: 'Not Detected' },
    specDisplay: '—',
    unit: '',
  },
]


// ─────────────────────────────────────────────────────────────
// IFFCO — Finished Goods configuration
// ─────────────────────────────────────────────────────────────
// Grade key = 'iffco'. Parameter set matches the ADMA family (nine params:
// Appearance, Sulphur, pH, Wettability, Persistent Foaming, Wet Sieve,
// Suspensibility, Drop Test — Foaming/Wet Sieve/Suspensibility stay as shared
// CARDS, the rest are table rows). Own row ids (iffco_*).
//   • Sulphur → 'calc' (fg_sulphur), spec "80%", UNRULED (no tolerance defined
//               for IFFCO → Observation shows, Result "—"; not fabricated).
//   • Suspensibility → shared fg_susp card stays visible, UNRULED (no confirmed
//               minimum in the reference → no Pass/Fail).
// Hidden cards (IFFCO only): pH + Wettability (moved into the table, removing
// their prep instruction), Dry Sieve + Moisture + Bulk Density.
export const IFFCO_HIDDEN_CARDS = ['fg_ph', 'fg_wettability', 'fg_drySieve', 'fg_moisture', 'fg_bulk']

export const IFFCO_CARD_NAME_OVERRIDES = {
  fg_wetSieve: 'Wet Sieve Test (max) — 1.0 % retention on 45 µ test sieve',
}

export const IFFCO_EXTRA_PARAMS = [
  {
    id: 'iffco_sulphur',
    group: 'Active Content',
    parameter: 'Active Content of Sulphur % By mass',
    type: 'calc',
    sourceResult: 'fg_sulphur',
    // No confirmed IFFCO tolerance → no rule → Result "—" (not fabricated).
    specDisplay: '80%',
    unit: '%',
  },
  {
    id: 'iffco_ph',
    group: 'pH',
    parameter: 'pH of 1.0 % Aqu Sol',
    type: 'number',
    rule: { type: 'range', min: 5.0, max: 9.0 },
    specDisplay: '5.0 – 9.0',
    unit: '',
  },
  {
    id: 'iffco_wettability',
    group: 'Wettability',
    parameter: 'Wettability (max)',
    type: 'number',
    rule: { type: 'max', max: 60 },
    specDisplay: '60.0 seconds',
    unit: '',
  },
  {
    id: 'iffco_appearance',
    group: 'Appearance',
    parameter: 'Appearance',
    type: 'complies',
    rule: { type: 'text', accepted: 'Complies' },
    specDisplay: 'Yellow to Olive Brown fine free flowing micro Granules',
    unit: '',
  },
  {
    id: 'iffco_drop_test',
    group: 'Drop Test of bags',
    parameter: 'Drop Test of bags',
    type: 'droptest',
    rule: { type: 'text', accepted: 'Found OK no leakage' },
    specDisplay: "From 6' height",
    unit: '',
  },
]


// ─────────────────────────────────────────────────────────────
// Table-grade registry — grade key → its table config.
// Lets the QualityCheck FG render/print/overall logic treat any
// "parameter-table" grade (ADMA, Lohiya, …) uniformly without per-grade
// branching. Grades NOT in this map (normal/export/omri/colour, plus the other
// company names) are completely unaffected.
export const TABLE_GRADES = {
  adama: {
    title: 'ADMA Parameters',
    rows: ADMA_EXTRA_PARAMS,
    hiddenCards: ADMA_HIDDEN_CARDS,
    nameOverrides: ADMA_CARD_NAME_OVERRIDES,
  },
  lohiya: {
    title: 'LOHIYA Parameters',
    rows: LOHIYA_EXTRA_PARAMS,
    hiddenCards: LOHIYA_HIDDEN_CARDS,
    nameOverrides: LOHIYA_CARD_NAME_OVERRIDES,
  },
  biostadt: {
    title: 'BIOSTADT Parameters',
    rows: BIOSTADT_EXTRA_PARAMS,
    hiddenCards: BIOSTADT_HIDDEN_CARDS,
    nameOverrides: BIOSTADT_CARD_NAME_OVERRIDES,
  },
  sumitomo: {
    title: 'SUMITOMO Parameters',
    rows: SUMITOMO_EXTRA_PARAMS,
    hiddenCards: SUMITOMO_HIDDEN_CARDS,
    nameOverrides: SUMITOMO_CARD_NAME_OVERRIDES,
  },
  hemani_v: {
    title: 'HEMANI INDUSTRIES UNIT - V Parameters',
    rows: HEMANI_EXTRA_PARAMS,
    hiddenCards: HEMANI_HIDDEN_CARDS,
    nameOverrides: HEMANI_CARD_NAME_OVERRIDES,
  },
  sanaca: {
    title: 'Sanaca Dubai Parameters',
    rows: SANACA_EXTRA_PARAMS,
    hiddenCards: SANACA_HIDDEN_CARDS,
    nameOverrides: SANACA_CARD_NAME_OVERRIDES,
  },
  villacrop: {
    title: 'Villa Crop Parameters',
    rows: VILLACROP_EXTRA_PARAMS,
    hiddenCards: VILLACROP_HIDDEN_CARDS,
    nameOverrides: VILLACROP_CARD_NAME_OVERRIDES,
  },
  yellowstone: {
    title: 'Yellowstone Parameters',
    rows: YELLOWSTONE_EXTRA_PARAMS,
    hiddenCards: YELLOWSTONE_HIDDEN_CARDS,
    nameOverrides: YELLOWSTONE_CARD_NAME_OVERRIDES,
  },
  iffco: {
    title: 'IFFCO Parameters',
    rows: IFFCO_EXTRA_PARAMS,
    hiddenCards: IFFCO_HIDDEN_CARDS,
    nameOverrides: IFFCO_CARD_NAME_OVERRIDES,
  },
}
