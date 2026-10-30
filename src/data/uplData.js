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
  // Parameter order matches the reference COA layout exactly.
  export: Object.assign([
    { id: 'upl_exp_appearance', group: 'Appearance',             parameter: 'Appearance',                                                               type: 'complies', rule: { type: 'text', accepted: 'Complies' }, specDisplay: 'The material shall be in the form light to dark brown fine granules. It shall be free from extraneous impurities or additive.', unit: '' },
    { id: 'upl_exp_sulphur',    group: 'Active Content',          parameter: 'Active Content of Sulphur % By mass',                                      type: 'calc',     sourceResult: 'fg_sulphur', rule: { type: 'min', min: 80.0 }, specDisplay: '80.00 Min.', unit: '' },
    { id: 'upl_exp_susp',       group: 'Suspension',              parameter: 'Suspension as Sulfur (%w/w)',                                              type: 'calc',     sourceResult: 'fg_susp',    rule: { type: 'min', min: 80.0 }, specDisplay: '80.00 Min.', unit: '' },
    { id: 'upl_exp_ws_160',     group: 'Wet Sieve',               parameter: 'Wet sieve retain through 160µm (% W/W)',                                   type: 'number',   rule: { type: 'max', max: 0.02 },             specDisplay: '0.020 Max.',  unit: '' },
    { id: 'upl_exp_ws_25',      group: 'Wet Sieve',               parameter: 'Wet sieve retain through 25µm (% W/W)',                                    type: 'number',   rule: { type: 'max', max: 0.20 },             specDisplay: '0.20 Max.',   unit: '' },
    { id: 'upl_exp_wps',        group: 'Wet Particle Size',       parameter: 'Wet particle size without Ultrasound median diameter (µm)',                 type: 'number',   rule: { type: 'range', min: 2.20, max: 4.90 }, specDisplay: '2.20 To 4.90', unit: '' },
    { id: 'upl_exp_ps_10',      group: 'Particle Size Range',     parameter: 'Particles >10µm (%V/V)',                                                   type: 'number',   rule: { type: 'max', max: 20 },               specDisplay: '< 20',        unit: '' },
    { id: 'upl_exp_ps_6',       group: 'Particle Size Range',     parameter: 'Particles >6µm (%V/V)',                                                    type: 'number',   rule: { type: 'max', max: 35 },               specDisplay: '< 35',        unit: '' },
    { id: 'upl_exp_ps_1',       group: 'Particle Size Range',     parameter: 'Particles >1µm (%V/V)',                                                    type: 'number',   rule: { type: 'min', min: 75 },               specDisplay: '> 75',        unit: '' },
    { id: 'upl_exp_alk',        group: 'Alkalinity',              parameter: 'Alkalinity caustic equivalent (% W/W)',                                    type: 'number',   rule: { type: 'max', max: 0.6 },              specDisplay: '0.6 Max',     unit: '' },
    { id: 'upl_exp_df_0',       group: 'Dynamic Foam',            parameter: 'Dynamic foam at 0min (in ml)',                                             type: 'number',   rule: { type: 'max', max: 300 },              specDisplay: '<300',        unit: '' },
    { id: 'upl_exp_df_1',       group: 'Dynamic Foam',            parameter: 'Dynamic foam at 1min (in ml)',                                             type: 'number',   rule: { type: 'max', max: 200 },              specDisplay: '<200',        unit: '' },
    { id: 'upl_exp_df_2',       group: 'Dynamic Foam',            parameter: 'Dynamic foam at 2min (in ml)',                                             type: 'number',   rule: { type: 'max', max: 150 },              specDisplay: '<150',        unit: '' },
    { id: 'upl_exp_df_5',       group: 'Dynamic Foam',            parameter: 'Dynamic foam at 5min (in ml)',                                             type: 'number',   rule: { type: 'max', max: 60 },               specDisplay: '<60',         unit: '' },
    { id: 'upl_exp_disp',       group: 'Dispersibility',          parameter: 'Dispersibility',                                                           type: 'complies', rule: { type: 'text', accepted: 'Complies' }, specDisplay: '>= 150 g / 150 ml', unit: '' },
    // Moisture: FG saves the latest recorded reading as `fg_moisture` in the
    // quality_control_records values JSON. sourceKey maps the COA row id to that key.
    { id: 'upl_exp_moisture',   group: 'Moisture',                parameter: 'Moisture (% W/W)',                                                         type: 'number',   sourceKey: 'fg_moisture', rule: { type: 'range', min: 1.5, max: 2.2 }, specDisplay: '1.5 to 2.2', unit: '' },
  ], { hideTests: ['fg_drySieve'] }),

  // ── OMRI Grade ────────────────────────────────────────────
  // Parameter order matches the reference COA layout exactly.
  omri: Object.assign([
    { id: 'upl_omri_appearance',  group: 'Appearance',          parameter: 'Appearance',                                                          type: 'complies', rule: { type: 'text', accepted: 'Complies' }, specDisplay: 'The Material shall be in form of light brown to brown colour Spray Dried granules, free from extraneous visible matter and hard lumps', unit: '' },
    { id: 'upl_omri_sulphur',     group: 'Active Content',      parameter: 'Active Content of Sulphur % By mass',                                 type: 'calc',     sourceResult: 'fg_sulphur', rule: { type: 'range', min: 80, max: 82.5 }, specDisplay: '80 to 82.5', unit: '%' },
    { id: 'upl_omri_susp',        group: 'Suspension',          parameter: 'Suspension as Sulfur (%w/w)',                                         type: 'calc',     sourceResult: 'fg_susp',    rule: { type: 'min', min: 80 },              specDisplay: 'Minimum 80',  unit: '%' },
    { id: 'upl_omri_ws_160',      group: 'Wet Sieve',           parameter: 'Wet sieve (Passing through 160 microns IS test Sieve, %w/w)',         type: 'number',   rule: { type: 'min', min: 99.98 }, specDisplay: 'Min 99.98', unit: '%' },
    { id: 'upl_omri_ws_25',       group: 'Wet Sieve',           parameter: 'Wet sieve(Passing through 25 microns IS test Sieve, %w/w)',           type: 'number',   rule: { type: 'min', min: 99.50 }, specDisplay: 'Min 99.5',  unit: '%' },
    { id: 'upl_omri_ps_10',       group: 'Particle Size Range', parameter: 'Particles >10µm (%V/V)',                                              type: 'number',   rule: { type: 'max', max: 20 },    specDisplay: '< 20',      unit: '%' },
    { id: 'upl_omri_ps_6',        group: 'Particle Size Range', parameter: 'Particles >6µm (%V/V)',                                               type: 'number',   rule: { type: 'max', max: 35 },    specDisplay: '< 35',      unit: '%' },
    { id: 'upl_omri_ps_1',        group: 'Particle Size Range', parameter: 'Particles >1µm (%V/V)',                                               type: 'number',   rule: { type: 'min', min: 75 },    specDisplay: '> 75',      unit: '%' },
    { id: 'upl_omri_foam',        group: 'Persistent Foam',     parameter: 'Persistent foam after 1min (in ml)',                                  type: 'number',   sourceKey: 'fg_foam_1min', rule: { type: 'max', max: 60 },    specDisplay: 'Max 60',    unit: 'ml' },
    { id: 'upl_omri_ph',          group: 'pH',                  parameter: 'PH of 1.0% Aqu Sol',                                                  type: 'number',   sourceKey: 'fg_ph', rule: { type: 'range', min: 7.0, max: 9.0 }, specDisplay: '7.0 – 9.0', unit: '' },
    { id: 'upl_omri_water_kf',    group: 'Water by KF',         parameter: 'Water by KF (%w/w)',                                                   type: 'number',   rule: { type: 'range', min: 1.5, max: 2.3 }, specDisplay: '1.5 to 2.3', unit: '%' },
    { id: 'upl_omri_wettability', group: 'Wettability',         parameter: 'Wettability (in Second)',                                             type: 'number',   sourceKey: 'fg_wettability', rule: { type: 'max', max: 20 },    specDisplay: 'Max 20',    unit: 'sec' },
    { id: 'upl_omri_ds_500',      group: 'Dry Sieve',           parameter: 'Dry Sieve Test, passing through 500 micron Test sieve (%w/w)',        type: 'number',   rule: { type: 'min', min: 99 },    specDisplay: 'Min 99',    unit: '%' },
    { id: 'upl_omri_ds_106',      group: 'Dry Sieve',           parameter: 'Dry Sieve Test, passing through 106 micron Test sieve (%w/w)',        type: 'number',   rule: { type: 'max', max: 11.5 },  specDisplay: 'Max 11.5',  unit: '%' },
    { id: 'upl_omri_disp_self',   group: 'Dispersion',          parameter: 'Dispersion (1% in 100 ml H\u2082O)',                                  type: 'complies', rule: { type: 'text', accepted: 'Complies' }, specDisplay: '100% self-dispersing', unit: '' },
    { id: 'upl_omri_disp_1h',     group: 'Dispersion',          parameter: 'Dispersion Stability 1 hours',                                        type: 'complies', rule: { type: 'text', accepted: 'Complies' }, specDisplay: '0.5ml sedimentation', unit: '' },
    { id: 'upl_omri_disp_24h',    group: 'Dispersion',          parameter: 'Dispersion Stability 24 hours',                                       type: 'complies', rule: { type: 'text', accepted: 'Complies' }, specDisplay: '1.0 ml',              unit: '' },
    // pH + Wettability cards are hidden (moved into the table above).
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
// Row order matches the reference COA image exactly.
export const ADMA_EXTRA_PARAMS = [
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
    id: 'adma_sulphur',
    group: 'Active Content',
    parameter: 'Active Content of Sulphur % By mass',
    type: 'calc',
    sourceResult: 'fg_sulphur',
    specDisplay: '80%',
    unit: '',
  },
  {
    id: 'adma_ph',
    group: 'pH',
    parameter: 'PH of 1.0 % Aqu Sol',
    type: 'number',
    sourceKey: 'fg_ph',
    rule: { type: 'range', min: 5.0, max: 9.0 },
    specDisplay: '5.0 – 9.0',
    unit: '',
  },
  {
    id: 'adma_wettability',
    group: 'Wettability',
    parameter: 'Wettability (max)',
    type: 'number',
    sourceKey: 'fg_wettability',
    rule: { type: 'max', max: 60 },
    specDisplay: '60.0 seconds',
    unit: '',
  },
  {
    id: 'adma_foam_start',
    group: 'Persistent Foaming',
    parameter: 'Persistent Foaming (at start)',
    type: 'number',
    sourceKey: 'fg_foam_start',
    rule: { type: 'max', max: 60 },
    specDisplay: '60 ml. at Start',
    unit: '',
  },
  {
    id: 'adma_foam_1min',
    group: 'Persistent Foaming',
    parameter: 'Persistent Foaming (after 1.0 minute)',
    type: 'number',
    sourceKey: 'fg_foam_1min',
    rule: { type: 'max', max: 25 },
    specDisplay: '25 ml. after 1.0 minute',
    unit: '',
  },
  {
    id: 'adma_wet_sieve',
    group: 'Wet Sieve',
    parameter: 'Wet Sieve Test (max)',
    type: 'calc',
    sourceResult: 'fg_wetSieve',
    specDisplay: '1.0% retention on 45 µ test sieve',
    unit: '',
  },
  {
    id: 'adma_susp',
    group: 'Suspensibility',
    parameter: 'Suspensibility % by mass (min)',
    type: 'calc',
    sourceResult: 'fg_susp',
    specDisplay: '–',
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

// Lohiya table rows — reordered to match reference COA, sourceKeys added.
export const LOHIYA_EXTRA_PARAMS = [
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
    id: 'lohiya_sulphur',
    group: 'Active Content',
    parameter: 'Active Content of Sulphur % By mass',
    type: 'calc',
    sourceResult: 'fg_sulphur',
    specDisplay: '80%',
    unit: '',
  },
  {
    id: 'lohiya_ph',
    group: 'pH',
    parameter: 'PH of 1.0 % Aqu Sol',
    type: 'number',
    sourceKey: 'fg_ph',
    rule: { type: 'range', min: 5.0, max: 9.0 },
    specDisplay: '5.0 – 9.0',
    unit: '',
  },
  {
    id: 'lohiya_wettability',
    group: 'Wettability',
    parameter: 'Wettability (max)',
    type: 'number',
    sourceKey: 'fg_wettability',
    rule: { type: 'max', max: 60 },
    specDisplay: '60.0 seconds',
    unit: '',
  },
  {
    id: 'lohiya_foam_start',
    group: 'Persistent Foaming',
    parameter: 'Persistent Foaming (at start)',
    type: 'number',
    sourceKey: 'fg_foam_start',
    rule: { type: 'max', max: 60 },
    specDisplay: '60 ml. at Start',
    unit: '',
  },
  {
    id: 'lohiya_foam_1min',
    group: 'Persistent Foaming',
    parameter: 'Persistent Foaming (after 1.0 minute)',
    type: 'number',
    sourceKey: 'fg_foam_1min',
    rule: { type: 'max', max: 25 },
    specDisplay: '25 ml. after 1.0 minute',
    unit: '',
  },
  {
    id: 'lohiya_wet_sieve',
    group: 'Wet Sieve',
    parameter: 'Wet Sieve Test (max)',
    type: 'calc',
    sourceResult: 'fg_wetSieve',
    specDisplay: '1.0 % retention on 45 u test sieve',
    unit: '',
  },
  {
    id: 'lohiya_susp',
    group: 'Suspensibility',
    parameter: 'Suspensibility % by mass (min)',
    type: 'calc',
    sourceResult: 'fg_susp',
    specDisplay: '–',
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

// Biostadt table rows — reordered to match reference COA image, sourceKeys
// added for correct fetch, unique ids (biostadt_*).
export const BIOSTADT_EXTRA_PARAMS = [
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
    id: 'biostadt_sulphur',
    group: 'Active Content',
    parameter: 'Active Content of Sulphur % By mass',
    type: 'calc',
    sourceResult: 'fg_sulphur',
    specDisplay: '80%',
    unit: '',
  },
  {
    id: 'biostadt_ph',
    group: 'pH',
    parameter: 'PH of 1.0 % Aqu Sol',
    type: 'number',
    sourceKey: 'fg_ph',
    rule: { type: 'range', min: 5.0, max: 9.0 },
    specDisplay: '5.0 – 9.0',
    unit: '',
  },
  {
    id: 'biostadt_wettability',
    group: 'Wettability',
    parameter: 'Wettability (max)',
    type: 'number',
    sourceKey: 'fg_wettability',
    rule: { type: 'max', max: 60 },
    specDisplay: '60.0 seconds',
    unit: '',
  },
  {
    id: 'biostadt_foam_start',
    group: 'Persistent Foaming',
    parameter: 'Persistent Foaming (at start)',
    type: 'number',
    sourceKey: 'fg_foam_start',
    rule: { type: 'max', max: 60 },
    specDisplay: '60 ml. at Start',
    unit: '',
  },
  {
    id: 'biostadt_foam_1min',
    group: 'Persistent Foaming',
    parameter: 'Persistent Foaming (after 1.0 minute)',
    type: 'number',
    sourceKey: 'fg_foam_1min',
    rule: { type: 'max', max: 25 },
    specDisplay: '25 ml. after 1.0 minute',
    unit: '',
  },
  {
    id: 'biostadt_wet_sieve',
    group: 'Wet Sieve',
    parameter: 'Wet Sieve Test (max)',
    type: 'calc',
    sourceResult: 'fg_wetSieve',
    specDisplay: '1.0 % retention on 45 u test sieve',
    unit: '',
  },
  {
    id: 'biostadt_susp',
    group: 'Suspensibility',
    parameter: 'Suspensibility % by mass (min)',
    type: 'calc',
    sourceResult: 'fg_susp',
    specDisplay: '–',
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

// Sumitomo table rows — reordered to match reference COA, sourceKeys added.
export const SUMITOMO_EXTRA_PARAMS = [
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
    id: 'sumitomo_sulphur',
    group: 'Active Content',
    parameter: 'Active Content of Sulphur % By mass',
    type: 'calc',
    sourceResult: 'fg_sulphur',
    specDisplay: '80%',
    unit: '',
  },
  {
    id: 'sumitomo_ph',
    group: 'pH',
    parameter: 'PH of 1.0 % Aqu Sol',
    type: 'number',
    sourceKey: 'fg_ph',
    rule: { type: 'range', min: 5.0, max: 9.0 },
    specDisplay: '5.0 – 9.0',
    unit: '',
  },
  {
    id: 'sumitomo_wettability',
    group: 'Wettability',
    parameter: 'Wettability (max)',
    type: 'number',
    sourceKey: 'fg_wettability',
    rule: { type: 'max', max: 60 },
    specDisplay: '60.0 seconds',
    unit: '',
  },
  {
    id: 'sumitomo_foam_start',
    group: 'Persistent Foaming',
    parameter: 'Persistent Foaming (at start)',
    type: 'number',
    sourceKey: 'fg_foam_start',
    rule: { type: 'max', max: 60 },
    specDisplay: '60 ml. at Start',
    unit: '',
  },
  {
    id: 'sumitomo_foam_1min',
    group: 'Persistent Foaming',
    parameter: 'Persistent Foaming (after 1.0 minute)',
    type: 'number',
    sourceKey: 'fg_foam_1min',
    rule: { type: 'max', max: 25 },
    specDisplay: '25 ml. after 1.0 minute',
    unit: '',
  },
  {
    id: 'sumitomo_wet_sieve',
    group: 'Wet Sieve',
    parameter: 'Wet Sieve Test (max)',
    type: 'calc',
    sourceResult: 'fg_wetSieve',
    specDisplay: '1.0% retention on 45 u test sieve',
    unit: '',
  },
  {
    id: 'sumitomo_susp',
    group: 'Suspensibility',
    parameter: 'Suspensibility % by mass (min)',
    type: 'calc',
    sourceResult: 'fg_susp',
    specDisplay: '–',
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

// Hemani table rows — reordered to match reference COA, sourceKeys added.
export const HEMANI_EXTRA_PARAMS = [
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
    id: 'hemani_sulphur',
    group: 'Active Content',
    parameter: 'Active Content of Sulphur % By mass',
    type: 'calc',
    sourceResult: 'fg_sulphur',
    specDisplay: '80%',
    unit: '',
  },
  {
    id: 'hemani_ph',
    group: 'pH',
    parameter: 'PH of 1.0 % Aqu Sol',
    type: 'number',
    sourceKey: 'fg_ph',
    rule: { type: 'range', min: 5.0, max: 9.0 },
    specDisplay: '5.0 – 9.0',
    unit: '',
  },
  {
    id: 'hemani_wettability',
    group: 'Wettability',
    parameter: 'Wettability (max)',
    type: 'number',
    sourceKey: 'fg_wettability',
    rule: { type: 'max', max: 60 },
    specDisplay: '60.0 seconds',
    unit: '',
  },
  {
    id: 'hemani_foam_start',
    group: 'Persistent Foaming',
    parameter: 'Persistent Foaming (at start)',
    type: 'number',
    sourceKey: 'fg_foam_start',
    rule: { type: 'max', max: 60 },
    specDisplay: '60 ml. at Start',
    unit: '',
  },
  {
    id: 'hemani_foam_1min',
    group: 'Persistent Foaming',
    parameter: 'Persistent Foaming (after 1.0 minute)',
    type: 'number',
    sourceKey: 'fg_foam_1min',
    rule: { type: 'max', max: 25 },
    specDisplay: '25 ml. after 1.0 minute',
    unit: '',
  },
  {
    id: 'hemani_wet_sieve',
    group: 'Wet Sieve',
    parameter: 'Wet Sieve Test (max)',
    type: 'calc',
    sourceResult: 'fg_wetSieve',
    specDisplay: '1.0 % retention on 45 u test sieve',
    unit: '',
  },
  {
    id: 'hemani_susp',
    group: 'Suspensibility',
    parameter: 'Suspensibility % by mass (min)',
    type: 'calc',
    sourceResult: 'fg_susp',
    specDisplay: '–',
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
export const SANACA_HIDDEN_CARDS = ['fg_ph', 'fg_wettability', 'fg_drySieve', 'fg_moisture', 'fg_foam']

// Wet Sieve label override (Sanaca only). Spec text only — the fg_wetSieve card
// formula/result/validation are unchanged (calcSieve computes pass-through %,
// not retention %, so the 1.0% "retention [Max]" limit is NOT auto-applied to
// the card result; shown as label text and left to the existing card logic).
export const SANACA_CARD_NAME_OVERRIDES = {
  fg_wetSieve: 'Wet Sieve Test — 1.0% retention on 45 µ test sieve [Max]',
}

// Sanaca table rows — reordered to match reference COA, sourceKeys added.
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
    sourceResult: 'fg_sulphur',
    rule: { type: 'range', min: 78.0, max: 85.0 },
    specDisplay: '80.0% + 5% & -2%',
    unit: '',
  },
  {
    id: 'sanaca_ph',
    group: 'pH',
    parameter: 'PH of 1.0% Aqueous solution',
    type: 'number',
    sourceKey: 'fg_ph',
    rule: { type: 'range', min: 5.0, max: 9.0 },
    specDisplay: '5.0- 9.0',
    unit: '',
  },
  {
    id: 'sanaca_wettability',
    group: 'Wettability',
    parameter: 'Wettability',
    type: 'number',
    sourceKey: 'fg_wettability',
    rule: { type: 'max', max: 60 },
    specDisplay: '60.0 seconds [max.]',
    unit: '',
  },
  {
    id: 'sanaca_foam_start',
    group: 'Persistent Foaming',
    parameter: 'Persistent Foaming (at start)',
    type: 'number',
    sourceKey: 'fg_foam_start',
    rule: { type: 'max', max: 60 },
    specDisplay: '60 ml Max. at Start',
    unit: '',
  },
  {
    id: 'sanaca_foam_1min',
    group: 'Persistent Foaming',
    parameter: 'Persistent Foaming (after 1.0 minute)',
    type: 'number',
    sourceKey: 'fg_foam_1min',
    rule: { type: 'max', max: 25 },
    specDisplay: '25 ml Max. after 1.0 minute',
    unit: '',
  },
  {
    id: 'sanaca_wet_sieve',
    group: 'Wet Sieve',
    parameter: 'Wet Sieve Test',
    type: 'calc',
    sourceResult: 'fg_wetSieve',
    specDisplay: '1.0% retention on 45 µ test sieve [Max]',
    unit: '',
  },
  {
    id: 'sanaca_suspensibility',
    group: 'Suspensibility',
    parameter: 'Suspensibility % by mass',
    type: 'calc',
    sourceResult: 'fg_susp',
    rule: { type: 'min', min: 80.0 },
    specDisplay: '80.0% by mass [min]',
    unit: '',
  },
  {
    id: 'sanaca_bulk_density',
    group: 'Bulk Density',
    parameter: 'Bulk Density',
    type: 'calc',
    sourceResult: 'fg_bulk',
    specDisplay: 'Taped',
    unit: '',
  },
  {
    id: 'sanaca_arsenic',
    group: 'Arsenic Content',
    parameter: 'Arsenic Content.',
    type: 'arsenic',
    rule: { type: 'text', accepted: 'Not Detected' },
    specDisplay: '',
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
export const VILLACROP_HIDDEN_CARDS = ['fg_ph', 'fg_wettability', 'fg_drySieve', 'fg_moisture', 'fg_foam']

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
    unit: '',
  },
  {
    id: 'villacrop_ph',
    group: 'pH',
    parameter: 'PH of 1.0% Aqueous solution',
    type: 'number',
    sourceKey: 'fg_ph',
    rule: { type: 'range', min: 5.0, max: 9.0 },
    specDisplay: '5.0- 9.0',
    unit: '',
  },
  {
    id: 'villacrop_wettability',
    group: 'Wettability',
    parameter: 'Wettability [max.]',
    type: 'number',
    sourceKey: 'fg_wettability',
    rule: { type: 'max', max: 60 },
    specDisplay: '60.0 seconds',
    unit: '',
  },
  {
    id: 'villacrop_foam_start',
    group: 'Persistent Foaming',
    parameter: 'Persistent Foaming (at start)',
    type: 'number',
    sourceKey: 'fg_foam_start',
    rule: { type: 'max', max: 60 },
    specDisplay: '60 ml at start',
    unit: '',
  },
  {
    id: 'villacrop_foam_1min',
    group: 'Persistent Foaming',
    parameter: 'Persistent Foaming (after 1.0 minute)',
    type: 'number',
    sourceKey: 'fg_foam_1min',
    rule: { type: 'max', max: 25 },
    specDisplay: '25 ml after 1.0 minute',
    unit: '',
  },
  {
    id: 'villacrop_wet_sieve',
    group: 'Wet Sieve',
    parameter: 'Wet Sieve Test [Max]',
    type: 'calc',
    sourceResult: 'fg_wetSieve',
    specDisplay: '1.0% retention on 45 µ test sieve',
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
    unit: '',
  },
  {
    id: 'villacrop_bulk_density',
    group: 'Bulk Density',
    parameter: 'Bulk Density',
    type: 'calc',
    sourceResult: 'fg_bulk',
    specDisplay: 'Taped',
    unit: '',
  },
  {
    id: 'villacrop_arsenic',
    group: 'Arsenic Content',
    parameter: 'Arsenic Content.',
    type: 'arsenic',
    rule: { type: 'text', accepted: 'Not Detected' },
    specDisplay: '',
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
export const YELLOWSTONE_HIDDEN_CARDS = ['fg_ph', 'fg_wettability', 'fg_drySieve', 'fg_moisture', 'fg_foam']

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
    unit: '',
  },
  {
    id: 'yellowstone_ph',
    group: 'pH',
    parameter: 'PH of 1.0% Aqueous solution',
    type: 'number',
    sourceKey: 'fg_ph',
    rule: { type: 'range', min: 5.0, max: 9.0 },
    specDisplay: '5.0- 9.0',
    unit: '',
  },
  {
    id: 'yellowstone_wettability',
    group: 'Wettability',
    parameter: 'Wettability',
    type: 'number',
    sourceKey: 'fg_wettability',
    rule: { type: 'max', max: 60 },
    specDisplay: '60.0 seconds [max.]',
    unit: '',
  },
  {
    id: 'yellowstone_foam_start',
    group: 'Persistent Foaming',
    parameter: 'Persistent Foaming (at start)',
    type: 'number',
    sourceKey: 'fg_foam_start',
    rule: { type: 'max', max: 60 },
    specDisplay: '60 ml (max) at start',
    unit: '',
  },
  {
    id: 'yellowstone_foam_1min',
    group: 'Persistent Foaming',
    parameter: 'Persistent Foaming (after 1.0 minute)',
    type: 'number',
    sourceKey: 'fg_foam_1min',
    rule: { type: 'max', max: 25 },
    specDisplay: '25 ml ( max) after 1.0 minute',
    unit: '',
  },
  {
    id: 'yellowstone_wet_sieve',
    group: 'Wet Sieve',
    parameter: 'Wet Sieve Test',
    type: 'calc',
    sourceResult: 'fg_wetSieve',
    specDisplay: '1.0% retention on 45 µ test sieve [Max]',
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
    unit: '',
  },
  {
    id: 'yellowstone_bulk_density',
    group: 'Bulk Density',
    parameter: 'Bulk Density',
    type: 'calc',
    sourceResult: 'fg_bulk',
    specDisplay: 'Taped',
    unit: '',
  },
  {
    id: 'yellowstone_arsenic',
    group: 'Arsenic Content',
    parameter: 'Arsenic Content.',
    type: 'arsenic',
    rule: { type: 'text', accepted: 'Not Detected' },
    specDisplay: '',
    unit: '',
  },
]


// ─────────────────────────────────────────────────────────────
// PRATASHA — Finished Goods configuration
// ─────────────────────────────────────────────────────────────
// Grade key = 'pratasha'. Parameter set identical to Yellowstone (ten rows,
// same tolerances), with its OWN row ids (pratasha_*).
//   • Sulphur → 'calc' (fg_sulphur), RULE range 78.0–85.0 (80.0% +5%/-2%).
//   • Suspensibility → 'calc' (fg_susp), RULE min 80.0.
//   • Bulk Density → 'calc' (fg_bulk), spec "Taped", UNRULED (Observation only).
//   • Arsenic Content → dropdown ('arsenic'): Not Detected → Pass,
//                       Detected → Fail, empty → no status. Never prefilled.
// Hidden cards (Pratasha only): pH + Wettability (moved into the table),
// Dry Sieve + Moisture. Sulphur/Susp/Bulk/Wet Sieve/Foaming cards stay visible.
export const PRATASHA_HIDDEN_CARDS = ['fg_ph', 'fg_wettability', 'fg_drySieve', 'fg_moisture', 'fg_foam']

export const PRATASHA_CARD_NAME_OVERRIDES = {
  fg_wetSieve: 'Wet Sieve Test — 1.0% retention on 45 µ test sieve [Max]',
}

export const PRATASHA_EXTRA_PARAMS = [
  {
    id: 'pratasha_appearance',
    group: 'Appearance',
    parameter: 'Appearance',
    type: 'complies',
    rule: { type: 'text', accepted: 'Complies' },
    specDisplay: 'Yellow to Olive Brown fine free flowing micro-Granules',
    unit: '',
  },
  {
    id: 'pratasha_sulphur',
    group: 'Active Content',
    parameter: 'Active content of Sulphur % by mass',
    type: 'calc',
    sourceResult: 'fg_sulphur',
    rule: { type: 'range', min: 78.0, max: 85.0 },
    specDisplay: '80.0% + 5% & -2%',
    unit: '',
  },
  {
    id: 'pratasha_ph',
    group: 'pH',
    parameter: 'PH of 1.0% Aqueous solution',
    type: 'number',
    sourceKey: 'fg_ph',
    rule: { type: 'range', min: 5.0, max: 9.0 },
    specDisplay: '5.0- 9.0',
    unit: '',
  },
  {
    id: 'pratasha_wettability',
    group: 'Wettability',
    parameter: 'Wettability',
    type: 'number',
    sourceKey: 'fg_wettability',
    rule: { type: 'max', max: 60 },
    specDisplay: '60.0 seconds [max.]',
    unit: '',
  },
  {
    id: 'pratasha_foam_start',
    group: 'Persistent Foaming',
    parameter: 'Persistent Foaming (at start)',
    type: 'number',
    sourceKey: 'fg_foam_start',
    rule: { type: 'max', max: 60 },
    specDisplay: '60 ml (max) at start',
    unit: '',
  },
  {
    id: 'pratasha_foam_1min',
    group: 'Persistent Foaming',
    parameter: 'Persistent Foaming (after 1.0 minute)',
    type: 'number',
    sourceKey: 'fg_foam_1min',
    rule: { type: 'max', max: 25 },
    specDisplay: '25 ml ( max) after 1.0 minute',
    unit: '',
  },
  {
    id: 'pratasha_wet_sieve',
    group: 'Wet Sieve',
    parameter: 'Wet Sieve Test',
    type: 'calc',
    sourceResult: 'fg_wetSieve',
    specDisplay: '1.0% retention on 45 µ test sieve [Max]',
    unit: '',
  },
  {
    id: 'pratasha_suspensibility',
    group: 'Suspensibility',
    parameter: 'Suspensibility % by mass',
    type: 'calc',
    sourceResult: 'fg_susp',
    rule: { type: 'min', min: 80.0 },
    specDisplay: '80.0% by mass [min]',
    unit: '',
  },
  {
    id: 'pratasha_bulk_density',
    group: 'Bulk Density',
    parameter: 'Bulk Density',
    type: 'calc',
    sourceResult: 'fg_bulk',
    specDisplay: 'Taped',
    unit: '',
  },
  {
    id: 'pratasha_arsenic',
    group: 'Arsenic Content',
    parameter: 'Arsenic Content.',
    type: 'arsenic',
    rule: { type: 'text', accepted: 'Not Detected' },
    specDisplay: '',
    unit: '',
  },
]

// ─────────────────────────────────────────────────────────────
// HAYCHEM — Finished Goods configuration
// ─────────────────────────────────────────────────────────────
// Grade key = 'haychem'. Same parameter set as CropSure/Yellowstone.
export const HAYCHEM_HIDDEN_CARDS = ['fg_ph', 'fg_wettability', 'fg_drySieve', 'fg_moisture', 'fg_foam']

export const HAYCHEM_CARD_NAME_OVERRIDES = {
  fg_wetSieve: 'Wet Sieve Test — 1.0% retention on 45 µ test sieve [Max]',
}

export const HAYCHEM_EXTRA_PARAMS = [
  { id: 'haychem_appearance',    group: 'Appearance',         parameter: 'Appearance',                              type: 'complies', rule: { type: 'text', accepted: 'Complies' }, specDisplay: 'Yellow to Olive Brown fine free flowing micro-Granules', unit: '' },
  { id: 'haychem_sulphur',       group: 'Active Content',     parameter: 'Active content of Sulphur % by mass',     type: 'calc',     sourceResult: 'fg_sulphur', rule: { type: 'range', min: 78.0, max: 85.0 }, specDisplay: '80.0% + 5% & -2%', unit: '' },
  { id: 'haychem_ph',            group: 'pH',                 parameter: 'PH of 1.0% Aqueous solution',             type: 'number',   sourceKey: 'fg_ph',         rule: { type: 'range', min: 5.0, max: 9.0 },  specDisplay: '5.0- 9.0',         unit: '' },
  { id: 'haychem_wettability',   group: 'Wettability',        parameter: 'Wettability',                             type: 'number',   sourceKey: 'fg_wettability', rule: { type: 'max', max: 60 },              specDisplay: '60.0 seconds [max.]', unit: '' },
  { id: 'haychem_foam_start',    group: 'Persistent Foaming', parameter: 'Persistent Foaming (at start)',           type: 'number',   sourceKey: 'fg_foam_start', rule: { type: 'max', max: 60 },              specDisplay: '60 ml (max) at start', unit: '' },
  { id: 'haychem_foam_1min',     group: 'Persistent Foaming', parameter: 'Persistent Foaming (after 1.0 minute)',  type: 'number',   sourceKey: 'fg_foam_1min',  rule: { type: 'max', max: 25 },              specDisplay: '25 ml ( max) after 1.0 minute', unit: '' },
  { id: 'haychem_wet_sieve',     group: 'Wet Sieve',          parameter: 'Wet Sieve Test',                         type: 'calc',     sourceResult: 'fg_wetSieve',  specDisplay: '1.0% retention on 45 µ test sieve [Max]', unit: '' },
  { id: 'haychem_suspensibility',group: 'Suspensibility',     parameter: 'Suspensibility % by mass',               type: 'calc',     sourceResult: 'fg_susp',    rule: { type: 'min', min: 80.0 },            specDisplay: '80.0% by mass [min]', unit: '' },
  { id: 'haychem_bulk_density',  group: 'Bulk Density',       parameter: 'Bulk Density',                           type: 'calc',     sourceResult: 'fg_bulk',    specDisplay: 'Taped',                         unit: '' },
  { id: 'haychem_arsenic',       group: 'Arsenic Content',    parameter: 'Arsenic Content.',                       type: 'arsenic',  rule: { type: 'text', accepted: 'Not Detected' }, specDisplay: '',       unit: '' },
]

// ─────────────────────────────────────────────────────────────
// FARMALINX — Finished Goods configuration
// ─────────────────────────────────────────────────────────────
// Grade key = 'farmalinx'. Same parameter set as CropSure/Yellowstone.
export const FARMALINX_HIDDEN_CARDS = ['fg_ph', 'fg_wettability', 'fg_drySieve', 'fg_moisture', 'fg_foam']

export const FARMALINX_CARD_NAME_OVERRIDES = {
  fg_wetSieve: 'Wet Sieve Test — 1.0% retention on 45 µ test sieve [Max]',
}

export const FARMALINX_EXTRA_PARAMS = [
  { id: 'farmalinx_appearance',    group: 'Appearance',         parameter: 'Appearance',                             type: 'complies', rule: { type: 'text', accepted: 'Complies' }, specDisplay: 'Yellow to Olive Brown fine free flowing micro-Granules', unit: '' },
  { id: 'farmalinx_sulphur',       group: 'Active Content',     parameter: 'Active content of Sulphur % by mass',    type: 'calc',     sourceResult: 'fg_sulphur', rule: { type: 'range', min: 78.0, max: 85.0 }, specDisplay: '80.0% + 5% & -2%', unit: '' },
  { id: 'farmalinx_ph',            group: 'pH',                 parameter: 'PH of 1.0% Aqueous solution',            type: 'number',   sourceKey: 'fg_ph',         rule: { type: 'range', min: 5.0, max: 9.0 },  specDisplay: '5.0- 9.0',         unit: '' },
  { id: 'farmalinx_wettability',   group: 'Wettability',        parameter: 'Wettability',                            type: 'number',   sourceKey: 'fg_wettability', rule: { type: 'max', max: 60 },              specDisplay: '60.0 seconds [max.]', unit: '' },
  { id: 'farmalinx_foam_start',    group: 'Persistent Foaming', parameter: 'Persistent Foaming (at start)',          type: 'number',   sourceKey: 'fg_foam_start', rule: { type: 'max', max: 60 },              specDisplay: '60 ml (max) at start', unit: '' },
  { id: 'farmalinx_foam_1min',     group: 'Persistent Foaming', parameter: 'Persistent Foaming (after 1.0 minute)', type: 'number',   sourceKey: 'fg_foam_1min',  rule: { type: 'max', max: 25 },              specDisplay: '25 ml ( max) after 1.0 minute', unit: '' },
  { id: 'farmalinx_wet_sieve',     group: 'Wet Sieve',          parameter: 'Wet Sieve Test',                         type: 'calc',     sourceResult: 'fg_wetSieve',  specDisplay: '1.0% retention on 45 µ test sieve [Max]', unit: '' },
  { id: 'farmalinx_suspensibility',group: 'Suspensibility',     parameter: 'Suspensibility % by mass',               type: 'calc',     sourceResult: 'fg_susp',    rule: { type: 'min', min: 80.0 },            specDisplay: '80.0% by mass [min]', unit: '' },
  { id: 'farmalinx_bulk_density',  group: 'Bulk Density',       parameter: 'Bulk Density',                           type: 'calc',     sourceResult: 'fg_bulk',    specDisplay: 'Taped',                         unit: '' },
  { id: 'farmalinx_arsenic',       group: 'Arsenic Content',    parameter: 'Arsenic Content.',                       type: 'arsenic',  rule: { type: 'text', accepted: 'Not Detected' }, specDisplay: '',       unit: '' },
]

// ─────────────────────────────────────────────────────────────
// McDONALD — Finished Goods configuration
// ─────────────────────────────────────────────────────────────
// Grade key = 'mcdonald'. Same parameter set as CropSure/Yellowstone.
export const MCDONALD_HIDDEN_CARDS = ['fg_ph', 'fg_wettability', 'fg_drySieve', 'fg_moisture', 'fg_foam']

export const MCDONALD_CARD_NAME_OVERRIDES = {
  fg_wetSieve: 'Wet Sieve Test — 1.0% retention on 45 µ test sieve [Max]',
}

export const MCDONALD_EXTRA_PARAMS = [
  { id: 'mcdonald_appearance',    group: 'Appearance',         parameter: 'Appearance',                             type: 'complies', rule: { type: 'text', accepted: 'Complies' }, specDisplay: 'Yellow to Olive Brown fine free flowing micro-Granules', unit: '' },
  { id: 'mcdonald_sulphur',       group: 'Active Content',     parameter: 'Active content of Sulphur % by mass',    type: 'calc',     sourceResult: 'fg_sulphur', rule: { type: 'range', min: 78.0, max: 85.0 }, specDisplay: '80.0% + 5% & -2%', unit: '' },
  { id: 'mcdonald_ph',            group: 'pH',                 parameter: 'PH of 1.0% Aqueous solution',            type: 'number',   sourceKey: 'fg_ph',         rule: { type: 'range', min: 5.0, max: 9.0 },  specDisplay: '5.0- 9.0',         unit: '' },
  { id: 'mcdonald_wettability',   group: 'Wettability',        parameter: 'Wettability',                            type: 'number',   sourceKey: 'fg_wettability', rule: { type: 'max', max: 60 },              specDisplay: '60.0 seconds [max.]', unit: '' },
  { id: 'mcdonald_foam_start',    group: 'Persistent Foaming', parameter: 'Persistent Foaming (at start)',          type: 'number',   sourceKey: 'fg_foam_start', rule: { type: 'max', max: 60 },              specDisplay: '60 ml (max) at start', unit: '' },
  { id: 'mcdonald_foam_1min',     group: 'Persistent Foaming', parameter: 'Persistent Foaming (after 1.0 minute)', type: 'number',   sourceKey: 'fg_foam_1min',  rule: { type: 'max', max: 25 },              specDisplay: '25 ml ( max) after 1.0 minute', unit: '' },
  { id: 'mcdonald_wet_sieve',     group: 'Wet Sieve',          parameter: 'Wet Sieve Test',                         type: 'calc',     sourceResult: 'fg_wetSieve',  specDisplay: '1.0% retention on 45 µ test sieve [Max]', unit: '' },
  { id: 'mcdonald_suspensibility',group: 'Suspensibility',     parameter: 'Suspensibility % by mass',               type: 'calc',     sourceResult: 'fg_susp',    rule: { type: 'min', min: 80.0 },            specDisplay: '80.0% by mass [min]', unit: '' },
  { id: 'mcdonald_bulk_density',  group: 'Bulk Density',       parameter: 'Bulk Density',                           type: 'calc',     sourceResult: 'fg_bulk',    specDisplay: 'Taped',                         unit: '' },
  { id: 'mcdonald_arsenic',       group: 'Arsenic Content',    parameter: 'Arsenic Content.',                       type: 'arsenic',  rule: { type: 'text', accepted: 'Not Detected' }, specDisplay: '',       unit: '' },
]

// ─────────────────────────────────────────────────────────────
// NORMAL — Finished Goods configuration (extra params table)
// ─────────────────────────────────────────────────────────────
// Grade key = 'normal'. Keeps ALL existing shared cards (no hidden cards) and
// adds the CropSure parameter table alongside them.
export const NORMAL_HIDDEN_CARDS = ['fg_foam']

export const NORMAL_CARD_NAME_OVERRIDES = {
  fg_wetSieve: 'Wet Sieve Test — 1.0% retention on 45 µ test sieve [Max]',
}

export const NORMAL_EXTRA_PARAMS = [
  { id: 'normal_appearance',    group: 'Appearance',         parameter: 'Appearance',                             type: 'complies', rule: { type: 'text', accepted: 'Complies' }, specDisplay: 'Yellow to Olive Brown fine free flowing micro-Granules', unit: '' },
  { id: 'normal_sulphur',       group: 'Active Content',     parameter: 'Active content of Sulphur % by mass',    type: 'calc',     sourceResult: 'fg_sulphur', rule: { type: 'range', min: 78.0, max: 85.0 }, specDisplay: '80.0% + 5% & -2%', unit: '' },
  { id: 'normal_ph',            group: 'pH',                 parameter: 'PH of 1.0% Aqueous solution',            type: 'number',   sourceKey: 'fg_ph',         rule: { type: 'range', min: 5.0, max: 9.0 },  specDisplay: '5.0- 9.0',         unit: '' },
  { id: 'normal_wettability',   group: 'Wettability',        parameter: 'Wettability',                            type: 'number',   sourceKey: 'fg_wettability', rule: { type: 'max', max: 60 },              specDisplay: '60.0 seconds [max.]', unit: '' },
  { id: 'normal_foam_start',    group: 'Persistent Foaming', parameter: 'Persistent Foaming (at start)',          type: 'number',   sourceKey: 'fg_foam_start', rule: { type: 'max', max: 60 },              specDisplay: '60 ml (max) at start', unit: '' },
  { id: 'normal_foam_1min',     group: 'Persistent Foaming', parameter: 'Persistent Foaming (after 1.0 minute)', type: 'number',   sourceKey: 'fg_foam_1min',  rule: { type: 'max', max: 25 },              specDisplay: '25 ml ( max) after 1.0 minute', unit: '' },
  { id: 'normal_wet_sieve',     group: 'Wet Sieve',          parameter: 'Wet Sieve Test',                         type: 'calc',     sourceResult: 'fg_wetSieve',  specDisplay: '1.0% retention on 45 µ test sieve [Max]', unit: '' },
  { id: 'normal_suspensibility',group: 'Suspensibility',     parameter: 'Suspensibility % by mass',               type: 'calc',     sourceResult: 'fg_susp',    rule: { type: 'min', min: 80.0 },            specDisplay: '80.0% by mass [min]', unit: '' },
  { id: 'normal_bulk_density',  group: 'Bulk Density',       parameter: 'Bulk Density',                           type: 'calc',     sourceResult: 'fg_bulk',    specDisplay: 'Taped',                         unit: '' },
  { id: 'normal_arsenic',       group: 'Arsenic Content',    parameter: 'Arsenic Content.',                       type: 'arsenic',  rule: { type: 'text', accepted: 'Not Detected' }, specDisplay: '',       unit: '' },
]

// ─────────────────────────────────────────────────────────────
// COLOUR — Finished Goods configuration (extra params table)
// ─────────────────────────────────────────────────────────────
// Grade key = 'colour'. Keeps ALL existing shared cards (no hidden cards) and
// adds the CropSure parameter table alongside them.
export const COLOUR_HIDDEN_CARDS = ['fg_foam']

export const COLOUR_CARD_NAME_OVERRIDES = {
  fg_wetSieve: 'Wet Sieve Test — 1.0% retention on 45 µ test sieve [Max]',
}

export const COLOUR_EXTRA_PARAMS = [
  { id: 'colour_appearance',    group: 'Appearance',         parameter: 'Appearance',                             type: 'complies', rule: { type: 'text', accepted: 'Complies' }, specDisplay: 'Yellow to Olive Brown fine free flowing micro-Granules', unit: '' },
  { id: 'colour_sulphur',       group: 'Active Content',     parameter: 'Active content of Sulphur % by mass',    type: 'calc',     sourceResult: 'fg_sulphur', rule: { type: 'range', min: 78.0, max: 85.0 }, specDisplay: '80.0% + 5% & -2%', unit: '' },
  { id: 'colour_ph',            group: 'pH',                 parameter: 'PH of 1.0% Aqueous solution',            type: 'number',   sourceKey: 'fg_ph',         rule: { type: 'range', min: 5.0, max: 9.0 },  specDisplay: '5.0- 9.0',         unit: '' },
  { id: 'colour_wettability',   group: 'Wettability',        parameter: 'Wettability',                            type: 'number',   sourceKey: 'fg_wettability', rule: { type: 'max', max: 60 },              specDisplay: '60.0 seconds [max.]', unit: '' },
  { id: 'colour_foam_start',    group: 'Persistent Foaming', parameter: 'Persistent Foaming (at start)',          type: 'number',   sourceKey: 'fg_foam_start', rule: { type: 'max', max: 60 },              specDisplay: '60 ml (max) at start', unit: '' },
  { id: 'colour_foam_1min',     group: 'Persistent Foaming', parameter: 'Persistent Foaming (after 1.0 minute)', type: 'number',   sourceKey: 'fg_foam_1min',  rule: { type: 'max', max: 25 },              specDisplay: '25 ml ( max) after 1.0 minute', unit: '' },
  { id: 'colour_wet_sieve',     group: 'Wet Sieve',          parameter: 'Wet Sieve Test',                         type: 'calc',     sourceResult: 'fg_wetSieve',  specDisplay: '1.0% retention on 45 µ test sieve [Max]', unit: '' },
  { id: 'colour_suspensibility',group: 'Suspensibility',     parameter: 'Suspensibility % by mass',               type: 'calc',     sourceResult: 'fg_susp',    rule: { type: 'min', min: 80.0 },            specDisplay: '80.0% by mass [min]', unit: '' },
  { id: 'colour_bulk_density',  group: 'Bulk Density',       parameter: 'Bulk Density',                           type: 'calc',     sourceResult: 'fg_bulk',    specDisplay: 'Taped',                         unit: '' },
  { id: 'colour_arsenic',       group: 'Arsenic Content',    parameter: 'Arsenic Content.',                       type: 'arsenic',  rule: { type: 'text', accepted: 'Not Detected' }, specDisplay: '',       unit: '' },
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
    id: 'iffco_appearance',
    group: 'Appearance',
    parameter: 'Appearance',
    type: 'complies',
    rule: { type: 'text', accepted: 'Complies' },
    specDisplay: 'Yellow to Olive Brown fine free flowing micro Granules',
    unit: '',
  },
  {
    id: 'iffco_sulphur',
    group: 'Active Content',
    parameter: 'Active Content of Sulphur % By mass',
    type: 'calc',
    sourceResult: 'fg_sulphur',
    specDisplay: '80%',
    unit: '',
  },
  {
    id: 'iffco_ph',
    group: 'pH',
    parameter: 'PH of 1.0 % Aqu Sol',
    type: 'number',
    sourceKey: 'fg_ph',
    rule: { type: 'range', min: 5.0, max: 9.0 },
    specDisplay: '5.0 – 9.0',
    unit: '',
  },
  {
    id: 'iffco_wettability',
    group: 'Wettability',
    parameter: 'Wettability (max)',
    type: 'number',
    sourceKey: 'fg_wettability',
    rule: { type: 'max', max: 60 },
    specDisplay: '60.0 seconds',
    unit: '',
  },
  {
    id: 'iffco_foam_start',
    group: 'Persistent Foaming',
    parameter: 'Persistent Foaming (at start)',
    type: 'number',
    sourceKey: 'fg_foam_start',
    rule: { type: 'max', max: 60 },
    specDisplay: '60 ml. at Start',
    unit: '',
  },
  {
    id: 'iffco_foam_1min',
    group: 'Persistent Foaming',
    parameter: 'Persistent Foaming (after 1.0 minute)',
    type: 'number',
    sourceKey: 'fg_foam_1min',
    rule: { type: 'max', max: 25 },
    specDisplay: '25 ml. after 1.0 minute',
    unit: '',
  },
  {
    id: 'iffco_wet_sieve',
    group: 'Wet Sieve',
    parameter: 'Wet Sieve Test (max)',
    type: 'calc',
    sourceResult: 'fg_wetSieve',
    specDisplay: '1.0 % retention on 45 u test sieve',
    unit: '',
  },
  {
    id: 'iffco_susp',
    group: 'Suspensibility',
    parameter: 'Suspensibility % by mass (min)',
    type: 'calc',
    sourceResult: 'fg_susp',
    specDisplay: '–',
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
  pratasha: {
    title: 'Pratasha Parameters',
    rows: PRATASHA_EXTRA_PARAMS,
    hiddenCards: PRATASHA_HIDDEN_CARDS,
    nameOverrides: PRATASHA_CARD_NAME_OVERRIDES,
  },
  haychem: {
    title: 'Haychem Parameters',
    rows: HAYCHEM_EXTRA_PARAMS,
    hiddenCards: HAYCHEM_HIDDEN_CARDS,
    nameOverrides: HAYCHEM_CARD_NAME_OVERRIDES,
  },
  farmalinx: {
    title: 'Farmalinx Parameters',
    rows: FARMALINX_EXTRA_PARAMS,
    hiddenCards: FARMALINX_HIDDEN_CARDS,
    nameOverrides: FARMALINX_CARD_NAME_OVERRIDES,
  },
  mcdonald: {
    title: 'McDonald Parameters',
    rows: MCDONALD_EXTRA_PARAMS,
    hiddenCards: MCDONALD_HIDDEN_CARDS,
    nameOverrides: MCDONALD_CARD_NAME_OVERRIDES,
  },
  normal: {
    title: 'Normal Grade Parameters',
    rows: NORMAL_EXTRA_PARAMS,
    hiddenCards: NORMAL_HIDDEN_CARDS,
    nameOverrides: NORMAL_CARD_NAME_OVERRIDES,
  },
  colour: {
    title: 'Colour Grade Parameters',
    rows: COLOUR_EXTRA_PARAMS,
    hiddenCards: COLOUR_HIDDEN_CARDS,
    nameOverrides: COLOUR_CARD_NAME_OVERRIDES,
  },
  iffco: {
    title: 'IFFCO Parameters',
    rows: IFFCO_EXTRA_PARAMS,
    hiddenCards: IFFCO_HIDDEN_CARDS,
    nameOverrides: IFFCO_CARD_NAME_OVERRIDES,
  },
}
