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
  export: [
    // Particle Size Range
    { id: 'upl_exp_ps_10',   group: 'Particle Size Range',                  parameter: 'Particle >10µm',           type: 'number',   rule: { type: 'max',   max: 20 },              specDisplay: '<20',          unit: '%'    },
    { id: 'upl_exp_ps_6',    group: 'Particle Size Range',                  parameter: 'Particle >6µm',            type: 'number',   rule: { type: 'max',   max: 35 },              specDisplay: '<35',          unit: '%'    },
    { id: 'upl_exp_ps_1',    group: 'Particle Size Range',                  parameter: 'Particle >1µm',            type: 'number',   rule: { type: 'min',   min: 75 },              specDisplay: '>75',          unit: '%'    },
    // Wet Sieve
    { id: 'upl_exp_ws_160',  group: 'Wet Sieve',                            parameter: '160 Micron',               type: 'number',   rule: { type: 'max',   max: 0.02 },            specDisplay: 'Max 0.02',     unit: '%'    },
    { id: 'upl_exp_ws_25',   group: 'Wet Sieve',                            parameter: '25 Micron',                type: 'number',   rule: { type: 'max',   max: 0.20 },            specDisplay: 'Max 0.20',     unit: '%'    },
    // Dynamic Foam
    { id: 'upl_exp_df_0',    group: 'Dynamic Foam',                         parameter: 'At 0 min',                 type: 'number',   rule: { type: 'max',   max: 300 },             specDisplay: '<300',         unit: 'ml'   },
    { id: 'upl_exp_df_1',    group: 'Dynamic Foam',                         parameter: 'At 1 min',                 type: 'number',   rule: { type: 'max',   max: 200 },             specDisplay: '<200',         unit: 'ml'   },
    { id: 'upl_exp_df_2',    group: 'Dynamic Foam',                         parameter: 'At 2 min',                 type: 'number',   rule: { type: 'max',   max: 150 },             specDisplay: '<150',         unit: 'ml'   },
    { id: 'upl_exp_df_5',    group: 'Dynamic Foam',                         parameter: 'At 5 min',                 type: 'number',   rule: { type: 'max',   max: 60 },              specDisplay: '<60',          unit: 'ml'   },
    // Wet Particle Size
    { id: 'upl_exp_wps',     group: 'Wet Particle Size (without ultrasound)', parameter: 'Median diameter',        type: 'number',   rule: { type: 'range', min: 2.20, max: 4.90 }, specDisplay: '2.20 – 4.90', unit: 'µm'   },
    // Alkalinity
    { id: 'upl_exp_alk',     group: 'Alkalinity',                           parameter: 'Caustic equivalent',       type: 'number',   rule: { type: 'max',   max: 0.6 },             specDisplay: 'Max 0.6',      unit: '% w/w' },
    // Dispersibility
    { id: 'upl_exp_disp',    group: 'Dispersibility',                       parameter: '≥150 g / 150 ml',         type: 'complies', rule: { type: 'text',  accepted: 'Complies' }, specDisplay: '≥150 g/150 ml', unit: ''    },
  ],

  // ── OMRI Grade ────────────────────────────────────────────
  omri: [
    // Particle Size Range
    { id: 'upl_omri_ps_10',      group: 'Particle Size Range', parameter: 'Particle >10µm',        type: 'number',   rule: { type: 'max',  max: 20 },    specDisplay: '<20',               unit: '%'  },
    { id: 'upl_omri_ps_6',       group: 'Particle Size Range', parameter: 'Particle >6µm',         type: 'number',   rule: { type: 'max',  max: 35 },    specDisplay: '<35',               unit: '%'  },
    { id: 'upl_omri_ps_1',       group: 'Particle Size Range', parameter: 'Particle >1µm',         type: 'number',   rule: { type: 'min',  min: 75 },    specDisplay: '>75',               unit: '%'  },
    // Dry Sieve
    { id: 'upl_omri_ds_500',     group: 'Dry Sieve',           parameter: '500 Micron',            type: 'number',   rule: { type: 'min',  min: 99 },    specDisplay: 'Min 99',            unit: '%'  },
    { id: 'upl_omri_ds_106',     group: 'Dry Sieve',           parameter: '106 Micron',            type: 'number',   rule: { type: 'max',  max: 11 },    specDisplay: 'Max 11',            unit: '%'  },
    // Dispersion
    { id: 'upl_omri_disp_self',  group: 'Dispersion',          parameter: '1% self dispersing',    type: 'complies', rule: { type: 'text', accepted: 'Complies' }, specDisplay: '100% self dispersing', unit: '' },
    { id: 'upl_omri_disp_1h',    group: 'Dispersion',          parameter: 'Stability 1 hour',      type: 'complies', rule: { type: 'text', accepted: 'Complies' }, specDisplay: '0.5 ml sedimentation', unit: '' },
    { id: 'upl_omri_disp_24h',   group: 'Dispersion',          parameter: 'Stability 24 hours',    type: 'complies', rule: { type: 'text', accepted: 'Complies' }, specDisplay: '1.0 ml',               unit: '' },
    // Wet Sieve
    { id: 'upl_omri_ws_160',     group: 'Wet Sieve',           parameter: '160 Micron',            type: 'number',   rule: { type: 'min',  min: 99.98 }, specDisplay: 'Min 99.98',         unit: '%'  },
    { id: 'upl_omri_ws_25',      group: 'Wet Sieve',           parameter: '25 Micron',             type: 'number',   rule: { type: 'min',  min: 99.50 }, specDisplay: 'Min 99.50',         unit: '%'  },
  ],
}
