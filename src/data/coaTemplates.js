// ═══════════════════════════════════════════════════════════════════════════
// COA TEMPLATES — per-party Certificate of Analysis configuration
// ---------------------------------------------------------------------------
// One config per party, keyed by `party_key` (the SAME grade keys the existing
// Finished Goods Grade dropdown already uses, so COA reuses the parameter/spec
// arrays already authored in uplData.js for the 11 parties that have them).
//
// The 15 parties, in the exact required order (COA_PARTIES below). FOUR of them
// — FARMALINX, HAYCHEM, McDONALD, PRATASHA — have NO existing parameter/spec
// config anywhere in the repo. Their heading / material name / parameters /
// specs live only in the supplied reference images and are therefore NOT filled
// in here. They are marked `needsTranscription: true` with empty `parameters`
// so the UI shows a clear "template not yet transcribed" message instead of
// inventing values. Do NOT fabricate their specs — transcribe from the images.
//
// Config shape per party:
//   {
//     key, name, materialName,
//     parameters: [ { id, group, parameter, type, rule, specDisplay, unit } ],
//     layout: 'single' | 'multi',           // table shape in the reference
//     headerFields:   [ { id, label } ],     // editable certificate header fields
//     dispatchFields: [ { id, label } ],     // dispatch / vehicle / qty / packing
//     signatureBlocks:[ { id, label, role } ],// role = min role allowed to edit
//     remarksDefault, conformityDefault, footerDefault,
//     pagination: { orientation: 'portrait' | 'landscape', pageSize: 'A4' },
//     needsTranscription?: true
//   }
//
// `type`/`rule`/`specDisplay`/`unit` match the SpecTable/evaluate() contract
// already used by Finished Goods, so COA result cells reuse the same evaluator.
// ═══════════════════════════════════════════════════════════════════════════

import {
  UPL_GRADES,
  TABLE_GRADES,
} from './uplData.js'

// The required party order (COA party selector uses exactly this list/order).
export const COA_PARTIES = [
  { key: 'lohiya',      name: 'LOHIYA CHEMICAL LTD.' },
  { key: 'sumitomo',    name: 'SUMITOMO CHEMICAL INDIA' },
  { key: 'farmalinx',   name: 'FARMALINX' },
  { key: 'haychem',     name: 'HAYCHEM' },
  { key: 'mcdonald',    name: 'McDONALD' },
  { key: 'pratasha',    name: 'PRATASHA' },
  { key: 'sanaca',      name: 'SANACA DUBAI' },
  { key: 'villacrop',   name: 'VILLA CROP' },
  { key: 'yellowstone', name: 'CropSure' },
  { key: 'export',      name: 'UPL EXPORT' },
  { key: 'omri',        name: 'UPL OMRI' },
  { key: 'adama',       name: 'ADAMA INDIA P LTD.' },
  { key: 'biostadt',    name: 'BIOSTADT INDIA LTD.' },
  { key: 'iffco',       name: 'IFFCO' },
  { key: 'hemani_v',    name: 'HEMANI INDUSTRIES UNIT- V' },
  { key: 'normal',      name: 'NORMAL GRADE' },
  { key: 'colour',      name: 'COLOUR GRADE' },
]

// Default certificate-level fields common to most single-batch party formats.
// Individual parties can override by supplying their own arrays below.
const DEFAULT_HEADER_FIELDS = [
  { id: 'certificate_no',   label: 'Certificate No.' },
  { id: 'certificate_date', label: 'Certificate Date', type: 'date' },
  { id: 'customer_name',    label: 'Customer Name' },
  { id: 'customer_address', label: 'Customer Address' },
]

const DEFAULT_DISPATCH_FIELDS = [
  { id: 'dispatch_date', label: 'Dispatch Date', type: 'date' },
  { id: 'vehicle_no',    label: 'Vehicle No.' },
  { id: 'quantity',      label: 'Quantity' },
  { id: 'packing',       label: 'Packing' },
  // Auto-filled from the batch's saved FG record; expiry = mfg + 2 years.
  { id: 'mfg_date',      label: 'Manufacturing Date', type: 'date', auto: true },
  { id: 'expiry_date',   label: 'Expiry / Best Before', type: 'date', auto: true },
]

// Signature blocks. `role` is the MINIMUM role allowed to edit that block in the
// UI; it is mirrored by RLS server-side (is_qc_user + a role check). 'any' = any
// QC user; 'admin' = approver/authorised signatory only.
const DEFAULT_SIGNATURES = [
  { id: 'prepared_by', label: 'Prepared By',            role: 'any' },
  { id: 'approved_by', label: 'Approved By (Signatory)', role: 'admin' },
]

const DEFAULT_PAGINATION_SINGLE = { orientation: 'portrait',  pageSize: 'A4' }
const DEFAULT_PAGINATION_MULTI  = { orientation: 'landscape', pageSize: 'A4' }

// Pull the already-authored parameter rows for a grade key from the existing
// Finished Goods config. UPL Export/OMRI live in UPL_GRADES; the named parties
// live in TABLE_GRADES[key].rows. Returns [] when the key has no existing config.
function existingParams(key) {
  if (key === 'export') return Array.isArray(UPL_GRADES.export) ? [...UPL_GRADES.export] : []
  if (key === 'omri')   return Array.isArray(UPL_GRADES.omri)   ? [...UPL_GRADES.omri]   : []
  const t = TABLE_GRADES[key]
  return t && Array.isArray(t.rows) ? [...t.rows] : []
}

// Build a party config that reuses existing parameter rows.
function party(key, name, opts = {}) {
  const parameters = opts.parameters || existingParams(key)
  const layout = opts.layout || 'single'
  return {
    key,
    name,
    materialName: opts.materialName || '',   // '' → UI shows the loaded product name
    parameters,
    layout,
    headerFields:    opts.headerFields    || DEFAULT_HEADER_FIELDS,
    dispatchFields:  opts.dispatchFields  || DEFAULT_DISPATCH_FIELDS,
    signatureBlocks: opts.signatureBlocks || DEFAULT_SIGNATURES,
    remarksDefault:    opts.remarksDefault    || '',
    conformityDefault: opts.conformityDefault || '',
    footerDefault:     opts.footerDefault     || '',
    pagination: opts.pagination || (layout === 'multi' ? DEFAULT_PAGINATION_MULTI : DEFAULT_PAGINATION_SINGLE),
    needsTranscription: !!opts.needsTranscription,
    // OMRI/Export/Adama/Biostadt/IFFCO/Yellowstone layout flags.
    hideRemarks:        !!opts.hideRemarks,
    hideConformity:     !!opts.hideConformity,
    hideBatchMeta:      !!opts.hideBatchMeta,
    editableParameters: !!opts.editableParameters,
    hideFinalize:       !!opts.hideFinalize,
    finalRows:          opts.finalRows || [],
    footerLabels:       opts.footerLabels || [],
    footerCompany:      opts.footerCompany || '',
    coaStyle:           opts.coaStyle || '',
  }
}

// A placeholder party whose template is only in the reference images (not in the
// repo). Empty parameters + needsTranscription so the UI refuses to invent data.
function placeholderParty(key, name) {
  return party(key, name, { parameters: [], needsTranscription: true })
}

// ── The 15 configs, in required order ────────────────────────────────────────
export const COA_TEMPLATES = {
  // 1–2, 7–15 reuse existing authored parameter/spec arrays.
  // ── LOHIYA — multi-batch layout matching the reference image ──────────────
  lohiya: party('lohiya', 'LOHIYA CHEMICAL LTD.', {
    layout: 'multi',
    headerFields: [
      { id: 'party_name',    label: 'Name of Party',    defaultValue: 'LOHIYA CHEMICAL LTD.' },
      { id: 'dispatch_date', label: 'Date of Dispatch', type: 'date' },
      { id: 'material',      label: 'Material' },
      { id: 'vehicle_no',    label: 'Vehicle No.' },
      { id: 'quantity',      label: 'Quantity' },
    ],
    dispatchFields: [],
    signatureBlocks: [
      { id: 'qc_incharge', label: 'QC INCHARGE',  role: 'any' },
      { id: 'qc_chemist',  label: 'Q.C. CHEMIST', role: 'any' },
    ],
    hideRemarks:        true,
    hideConformity:     true,
    hideBatchMeta:      true,
    editableParameters: true,
    hideFinalize:       true,
    finalRows: [
      { id: 'mfg_date', label: 'Manufacturing Date', type: 'date' },
      { id: 'exp_date', label: 'Exp Date',            type: 'date' },
      { id: 'qty',      label: 'QTY' },
    ],
  }),
  // ── SUMITOMO — multi-batch layout matching the reference image ─────────────
  sumitomo: party('sumitomo', 'SUMITOMO CHEMICAL INDIA', {
    layout: 'multi',
    headerFields: [
      { id: 'party_name',    label: 'Name of Party',    defaultValue: 'SUMITOMO CHEMICAL INDIA' },
      { id: 'dispatch_date', label: 'Date of Dispatch', type: 'date' },
      { id: 'material',      label: 'Material' },
      { id: 'vehicle_no',    label: 'Vehicle No.' },
      { id: 'quantity',      label: 'Quantity' },
    ],
    dispatchFields: [],
    signatureBlocks: [
      { id: 'qc_incharge', label: 'QC INCHARGE',  role: 'any' },
      { id: 'qc_chemist',  label: 'Q.C. CHEMIST', role: 'any' },
    ],
    hideRemarks:        true,
    hideConformity:     true,
    hideBatchMeta:      true,
    editableParameters: true,
    hideFinalize:       true,
    finalRows: [
      { id: 'mfg_date', label: 'Manufacturing Date', type: 'date' },
      { id: 'exp_date', label: 'Exp Date',            type: 'date' },
      { id: 'qty',      label: 'QTY' },
    ],
  }),

  // 3–6 — NOT in the repo. Transcribe from the reference images.
  // ── FARMALINX — same layout as Yellowstone/McDonald/Sanaca/Haychem ─────────
  farmalinx: party('farmalinx', 'FARMALINX', {
    layout: 'multi',
    headerFields: [
      { id: 'party_name',    label: 'Name of Party',       defaultValue: 'FARMALINX' },
      { id: 'material',      label: 'Material' },
      { id: 'batch_no',      label: 'Batch No.' },
      { id: 'mfg_date',      label: 'Manufacturing Date',  type: 'date', auto: true },
      { id: 'expiry_date',   label: 'Expiry Date',         type: 'date', auto: true },
      { id: 'quantity',      label: 'Quantity' },
    ],
    dispatchFields: [],
    signatureBlocks: [
      { id: 'signatory_left_name',  label: 'Name of the signatory\nAssistant manager (Quality)', role: 'any' },
      { id: 'signatory_right_name', label: 'Name of the signatory\nChemist (Quality)',            role: 'any' },
    ],
    hideRemarks:        false,
    hideConformity:     true,
    hideBatchMeta:      true,
    editableParameters: true,
    hideFinalize:       true,
    remarksDefault:     'Batch conforms to the specifications and is passed.',
    finalRows: [],
    coaStyle: 'yellowstone',
    parameters: [
      { id: 'farmalinx_appearance',   group: 'Appearance',         parameter: 'Appearance',                             type: 'complies', rule: { type: 'text', accepted: 'Complies' }, specDisplay: 'Yellow to Olive Brown fine free flowing micro Granules', unit: '' },
      { id: 'farmalinx_sulphur',      group: 'Active Content',     parameter: 'Active content of sulphur % by mass',    type: 'calc',     sourceResult: 'fg_sulphur', rule: { type: 'range', min: 78.0, max: 85.0 }, specDisplay: '80.0% + 5% & -2%',       unit: '' },
      { id: 'farmalinx_ph',           group: 'pH',                 parameter: 'PH of 1.0% Aqueous solution',            type: 'number',   sourceKey: 'fg_ph',         rule: { type: 'range', min: 5.0, max: 9.0 },  specDisplay: '5.0- 9.0',               unit: '' },
      { id: 'farmalinx_wettability',  group: 'Wettability',        parameter: 'Wettability [max.]',                     type: 'number',   sourceKey: 'fg_wettability', rule: { type: 'max', max: 60 },              specDisplay: '60.0 seconds',            unit: '' },
      { id: 'farmalinx_foam_start',   group: 'Persistent Foaming', parameter: 'Persistent Foaming (at start)',          type: 'number',   sourceKey: 'fg_foam_start', rule: { type: 'max', max: 60 },              specDisplay: '60ml after 1.0 minute',   unit: '' },
      { id: 'farmalinx_foam_1min',    group: 'Persistent Foaming', parameter: 'Persistent Foaming (after 1.0 minute)',  type: 'number',   sourceKey: 'fg_foam_1min',  rule: { type: 'max', max: 25 },              specDisplay: '25 ml after 1.0 minute',  unit: '' },
      { id: 'farmalinx_wet_sieve',    group: 'Wet Sieve',          parameter: 'Wet Sieve Test [Max]',                   type: 'number',   sourceKey: 'fg_wetSieve_log',                                             specDisplay: '1.0% retention on 45 µ test sieve', unit: '' },
      { id: 'farmalinx_susp',         group: 'Suspensibility',     parameter: 'Suspensibility % by mass [min]',         type: 'calc',     sourceResult: 'fg_susp',    rule: { type: 'min', min: 80.0 },            specDisplay: '80.0% by mass',           unit: '' },
      { id: 'farmalinx_bulk_density', group: 'Bulk Density',       parameter: 'Bulk Density',                           type: 'calc',     sourceResult: 'fg_bulk',                                                  specDisplay: 'Taped',                   unit: '' },
      { id: 'farmalinx_arsenic',      group: 'Arsenic Content',    parameter: 'Arsenic Content.',                       type: 'arsenic',  rule: { type: 'text', accepted: 'Not Detected' },                         specDisplay: '',                        unit: '' },
    ],
  }),
  // ── HAYCHEM — same layout as Yellowstone/McDonald/Sanaca ──────────────────
  haychem: party('haychem', 'HAYCHEM', {
    layout: 'multi',
    headerFields: [
      { id: 'party_name',    label: 'Name of Party',       defaultValue: 'HAYCHEM' },
      { id: 'material',      label: 'Material' },
      { id: 'batch_no',      label: 'Batch No.' },
      { id: 'mfg_date',      label: 'Manufacturing Date',  type: 'date', auto: true },
      { id: 'expiry_date',   label: 'Expiry Date',         type: 'date', auto: true },
      { id: 'quantity',      label: 'Quantity' },
    ],
    dispatchFields: [],
    signatureBlocks: [
      { id: 'signatory_left_name',  label: 'Name of the signatory\nAssistant manager (Quality)', role: 'any' },
      { id: 'signatory_right_name', label: 'Name of the signatory\nChemist (Quality)',            role: 'any' },
    ],
    hideRemarks:        false,
    hideConformity:     true,
    hideBatchMeta:      true,
    editableParameters: true,
    hideFinalize:       true,
    remarksDefault:     'Batch conforms to the specifications and is passed.',
    finalRows: [],
    coaStyle: 'yellowstone',
    parameters: [
      { id: 'haychem_appearance',   group: 'Appearance',         parameter: 'Appearance',                              type: 'complies', rule: { type: 'text', accepted: 'Complies' }, specDisplay: 'Yellow to Olive Brown fine free flowing micro-Granules', unit: '' },
      { id: 'haychem_sulphur',      group: 'Active Content',     parameter: 'Active content of Sulphur % by mass',     type: 'calc',     sourceResult: 'fg_sulphur', rule: { type: 'range', min: 78.0, max: 85.0 }, specDisplay: '80.0% + 5% & -2%',        unit: '' },
      { id: 'haychem_ph',           group: 'pH',                 parameter: 'PH of 1.0% Aqueous solution',             type: 'number',   sourceKey: 'fg_ph',         rule: { type: 'range', min: 5.0, max: 9.0 },  specDisplay: '5.0- 9.0',                unit: '' },
      { id: 'haychem_wettability',  group: 'Wettability',        parameter: 'Wettability',                             type: 'number',   sourceKey: 'fg_wettability', rule: { type: 'max', max: 60 },              specDisplay: '60.0 seconds [max.]',     unit: '' },
      { id: 'haychem_foam_start',   group: 'Persistent Foaming', parameter: 'Persistent Foaming (at start)',           type: 'number',   sourceKey: 'fg_foam_start', rule: { type: 'max', max: 60 },              specDisplay: '60 ml at start',          unit: '' },
      { id: 'haychem_foam_1min',    group: 'Persistent Foaming', parameter: 'Persistent Foaming (after 1.0 minute)',   type: 'number',   sourceKey: 'fg_foam_1min',  rule: { type: 'max', max: 25 },              specDisplay: '25 ml after 1.0 minute',  unit: '' },
      { id: 'haychem_wet_sieve',    group: 'Wet Sieve',          parameter: 'Wet Sieve Test',                          type: 'number',   sourceKey: 'fg_wetSieve_log',                                              specDisplay: '1.0% retention on 45 µ test sieve [Max]', unit: '' },
      { id: 'haychem_susp',         group: 'Suspensibility',     parameter: 'Suspensibility % by mass',                type: 'calc',     sourceResult: 'fg_susp',    rule: { type: 'min', min: 80.0 },            specDisplay: '80.0% by mass [min]',     unit: '' },
      { id: 'haychem_bulk_density', group: 'Bulk Density',       parameter: 'Bulk Density',                            type: 'calc',     sourceResult: 'fg_bulk',                                                   specDisplay: 'Taped',                   unit: '' },
      { id: 'haychem_arsenic',      group: 'Arsenic Content',    parameter: 'Arsenic Content.',                        type: 'arsenic',  rule: { type: 'text', accepted: 'Not Detected' },                          specDisplay: '',                        unit: '' },
    ],
  }),
  // ── McDONALD — same layout as Yellowstone/Villa Crop/Sanaca ───────────────
  mcdonald: party('mcdonald', 'McDONALD', {
    layout: 'multi',
    headerFields: [
      { id: 'party_name',    label: 'Name of Party',       defaultValue: 'McDONALD' },
      { id: 'material',      label: 'Material' },
      { id: 'batch_no',      label: 'Batch No.' },
      { id: 'mfg_date',      label: 'Manufacturing Date',  type: 'date', auto: true },
      { id: 'expiry_date',   label: 'Expiry Date',         type: 'date', auto: true },
      { id: 'quantity',      label: 'Quantity' },
    ],
    dispatchFields: [],
    signatureBlocks: [
      { id: 'signatory_left_name',  label: 'Name of the signatory\nAssistant manager (Quality)', role: 'any' },
      { id: 'signatory_right_name', label: 'Name of the signatory\nChemist (Quality)',            role: 'any' },
    ],
    hideRemarks:        false,
    hideConformity:     true,
    hideBatchMeta:      true,
    editableParameters: true,
    hideFinalize:       true,
    remarksDefault:     'Batch conforms to the specifications and is passed.',
    finalRows: [],
    coaStyle: 'yellowstone',
    parameters: [
      { id: 'mcdonald_appearance',   group: 'Appearance',        parameter: 'Appearance',                              type: 'complies', rule: { type: 'text', accepted: 'Complies' }, specDisplay: 'Yellow to Olive Brown fine free flowing micro Granules', unit: '' },
      { id: 'mcdonald_sulphur',      group: 'Active Content',    parameter: 'Active content of sulphur % by mass',     type: 'calc',     sourceResult: 'fg_sulphur', rule: { type: 'range', min: 78.0, max: 85.0 }, specDisplay: '80.0% + 5% & -2%', unit: '' },
      { id: 'mcdonald_ph',           group: 'pH',                parameter: 'PH of 1.0% Aqueous solution',             type: 'number',   sourceKey: 'fg_ph',         rule: { type: 'range', min: 5.0, max: 9.0 },   specDisplay: '5.0- 9.0',         unit: '' },
      { id: 'mcdonald_wettability',  group: 'Wettability',       parameter: 'Wettability',                             type: 'number',   sourceKey: 'fg_wettability', rule: { type: 'max', max: 60 },               specDisplay: '60.0 seconds [max.]', unit: '' },
      { id: 'mcdonald_foam_start',   group: 'Persistent Foaming', parameter: 'Persistent Foaming (at start)',          type: 'number',   sourceKey: 'fg_foam_start', rule: { type: 'max', max: 60 },               specDisplay: '60ml at start',    unit: '' },
      { id: 'mcdonald_foam_1min',    group: 'Persistent Foaming', parameter: 'Persistent Foaming (after 1.0 minute)', type: 'number',   sourceKey: 'fg_foam_1min',  rule: { type: 'max', max: 25 },               specDisplay: '25 ml after 1.0 minute', unit: '' },
      { id: 'mcdonald_wet_sieve',    group: 'Wet Sieve',         parameter: 'Wet Sieve Test',                          type: 'number',   sourceKey: 'fg_wetSieve_log',                                               specDisplay: '1.0% retention on 45 µ test sieve [Max]', unit: '' },
      { id: 'mcdonald_susp',         group: 'Suspensibility',    parameter: 'Suspensibility % by mass',                type: 'calc',     sourceResult: 'fg_susp',    rule: { type: 'min', min: 80.0 },             specDisplay: '80.0% by mass [min]', unit: '' },
      { id: 'mcdonald_bulk_density', group: 'Bulk Density',      parameter: 'Bulk Density',                            type: 'calc',     sourceResult: 'fg_bulk',                                                    specDisplay: 'Taped',            unit: '' },
      { id: 'mcdonald_arsenic',      group: 'Arsenic Content',   parameter: 'Arsenic Content.',                        type: 'arsenic',  rule: { type: 'text', accepted: 'Not Detected' },                           specDisplay: '',                 unit: '' },
    ],
  }),
  // ── PRATASHA — same layout as Yellowstone/McDonald/Sanaca ─────────────────
  pratasha: party('pratasha', 'PRATASHA', {
    layout: 'multi',
    headerFields: [
      { id: 'party_name',    label: 'Name of Party',       defaultValue: 'PRATASHA' },
      { id: 'material',      label: 'Material' },
      { id: 'batch_no',      label: 'Batch No.' },
      { id: 'mfg_date',      label: 'Manufacturing Date',  type: 'date', auto: true },
      { id: 'expiry_date',   label: 'Expiry Date',         type: 'date', auto: true },
      { id: 'quantity',      label: 'Quantity' },
    ],
    dispatchFields: [],
    signatureBlocks: [
      { id: 'signatory_left_name',  label: 'Name of the signatory\nAssistant manager (Quality)', role: 'any' },
      { id: 'signatory_right_name', label: 'Name of the signatory\nChemist (Quality)',            role: 'any' },
    ],
    hideRemarks:        false,
    hideConformity:     true,
    hideBatchMeta:      true,
    editableParameters: true,
    hideFinalize:       true,
    remarksDefault:     'Batch conforms to the specifications and is passed.',
    finalRows: [],
    coaStyle: 'yellowstone',
    parameters: [
      { id: 'pratasha_appearance',   group: 'Appearance',         parameter: 'Appearance',                             type: 'complies', rule: { type: 'text', accepted: 'Complies' }, specDisplay: 'Yellow to Olive Brown fine free flowing micro-Granules', unit: '' },
      { id: 'pratasha_sulphur',      group: 'Active Content',     parameter: 'Active content of Sulphur % by mass',    type: 'calc',     sourceResult: 'fg_sulphur', rule: { type: 'range', min: 78.0, max: 85.0 }, specDisplay: '80.0% + 5% & -2%',              unit: '' },
      { id: 'pratasha_ph',           group: 'pH',                 parameter: 'PH of 1.0% Aqueous solution',            type: 'number',   sourceKey: 'fg_ph',         rule: { type: 'range', min: 5.0, max: 9.0 },  specDisplay: '5.0- 9.0',                      unit: '' },
      { id: 'pratasha_wettability',  group: 'Wettability',        parameter: 'Wettability',                            type: 'number',   sourceKey: 'fg_wettability', rule: { type: 'max', max: 60 },              specDisplay: '60.0 seconds [max.]',           unit: '' },
      { id: 'pratasha_foam_start',   group: 'Persistent Foaming', parameter: 'Persistent Foaming (at start)',          type: 'number',   sourceKey: 'fg_foam_start', rule: { type: 'max', max: 60 },              specDisplay: '60 ml (max) at start',          unit: '' },
      { id: 'pratasha_foam_1min',    group: 'Persistent Foaming', parameter: 'Persistent Foaming (after 1.0 minute)',  type: 'number',   sourceKey: 'fg_foam_1min',  rule: { type: 'max', max: 25 },              specDisplay: '25 ml after 1.0 minute',        unit: '' },
      { id: 'pratasha_wet_sieve',    group: 'Wet Sieve',          parameter: 'Wet Sieve Test',                         type: 'number',   sourceKey: 'fg_wetSieve_log',                                             specDisplay: '1.0% retention on 45 µ test sieve [Max]', unit: '' },
      { id: 'pratasha_susp',         group: 'Suspensibility',     parameter: 'Suspensibility % by mass',               type: 'calc',     sourceResult: 'fg_susp',    rule: { type: 'min', min: 80.0 },            specDisplay: '80.0% by mass [min]',           unit: '' },
      { id: 'pratasha_bulk_density', group: 'Bulk Density',       parameter: 'Bulk Density',                           type: 'calc',     sourceResult: 'fg_bulk',                                                  specDisplay: 'Taped',                         unit: '' },
      { id: 'pratasha_arsenic',      group: 'Arsenic Content',    parameter: 'Arsenic Content.',                       type: 'arsenic',  rule: { type: 'text', accepted: 'Not Detected' },                         specDisplay: '',                              unit: '' },
    ],
  }),

  // ── SANACA DUBAI — same layout as Yellowstone/Villa Crop ──────────────────
  sanaca: party('sanaca', 'SANACA DUBAI', {
    layout: 'multi',
    headerFields: [
      { id: 'party_name',    label: 'Name of Party',       defaultValue: 'SANACA DUBAI' },
      { id: 'material',      label: 'Material' },
      { id: 'batch_no',      label: 'Batch No.' },
      { id: 'mfg_date',      label: 'Manufacturing Date',  type: 'date', auto: true },
      { id: 'expiry_date',   label: 'Expiry Date',         type: 'date', auto: true },
      { id: 'quantity',      label: 'Quantity' },
    ],
    dispatchFields: [],
    signatureBlocks: [
      { id: 'signatory_left_name',  label: 'Name of the signatory\nAssistant manager (Quality)', role: 'any' },
      { id: 'signatory_right_name', label: 'Name of the signatory\nChemist (Quality)',            role: 'any' },
    ],
    hideRemarks:        false,
    hideConformity:     true,
    hideBatchMeta:      true,
    editableParameters: true,
    hideFinalize:       true,
    remarksDefault:     'Batch conforms to the specifications and is passed.',
    finalRows: [],
    coaStyle: 'yellowstone',
  }),
  // ── VILLA CROP — same layout as Yellowstone ────────────────────────────────
  villacrop: party('villacrop', 'VILLA CROP', {
    layout: 'multi',
    headerFields: [
      { id: 'party_name',    label: 'Name of Party',       defaultValue: 'VILLA CROP' },
      { id: 'material',      label: 'Material' },
      { id: 'batch_no',      label: 'Batch No.' },
      { id: 'mfg_date',      label: 'Manufacturing Date',  type: 'date', auto: true },
      { id: 'expiry_date',   label: 'Expiry Date',         type: 'date', auto: true },
      { id: 'quantity',      label: 'Quantity' },
    ],
    dispatchFields: [],
    signatureBlocks: [
      { id: 'signatory_left_name',  label: 'Name of the signatory\nAssistant manager (Quality)', role: 'any' },
      { id: 'signatory_right_name', label: 'Name of the signatory\nChemist (Quality)',            role: 'any' },
    ],
    hideRemarks:        false,
    hideConformity:     true,
    hideBatchMeta:      true,
    editableParameters: true,
    hideFinalize:       true,
    remarksDefault:     'Batch conforms to the specifications and is passed.',
    finalRows: [],
    coaStyle: 'yellowstone',
  }),

  // ── CROPSURE (formerly Yellowstone) — multi-batch layout ─────────────────
  yellowstone: party('yellowstone', 'CropSure', {
    layout: 'multi',
    headerFields: [
      { id: 'party_name',    label: 'Name of Party',       defaultValue: 'CROPSURE' },
      { id: 'material',      label: 'Material' },
      { id: 'batch_no',      label: 'Batch No.' },
      { id: 'mfg_date',      label: 'Manufacturing Date',  type: 'date', auto: true },
      { id: 'expiry_date',   label: 'Expiry Date',         type: 'date', auto: true },
      { id: 'quantity',      label: 'Quantity' },
    ],
    dispatchFields: [],
    signatureBlocks: [
      { id: 'signatory_left_name',  label: 'Name of the signatory\nAssistant manager (Quality)', role: 'any' },
      { id: 'signatory_right_name', label: 'Name of the signatory\nChemist (Quality)',            role: 'any' },
    ],
    hideRemarks:        false,
    hideConformity:     true,
    hideBatchMeta:      true,
    editableParameters: true,
    hideFinalize:       true,
    remarksDefault:     'Batch conforms to the specifications and is passed.',
    finalRows: [],
    coaStyle: 'yellowstone',
  }),

  // ── UPL EXPORT — custom layout matching the reference image ───────────────
  // Multi-batch (one column per batch). Header: CERTIFICATE OF ANALYSIS title,
  // party name, dispatch date, material, vehicle, quantity. No cert no/date,
  // no customer address/name, no packing. No batch/product/grade/dryer info cards.
  // Parameters are fully editable. Final rows: Manufacturing Date + QTY.
  // Remarks + Conformity removed. Footer: QC Incharge / General Manager /
  // Q.C. Chemist. Extra labels: AUTHORISED SIGNATORY (left) / CHECKED BY (right).
  export: party('export', 'UPL EXPORT', {
    layout: 'multi',
    headerFields: [
      { id: 'party_name',    label: 'Name of Party',    defaultValue: 'UPL EXPORT' },
      { id: 'dispatch_date', label: 'Date of Dispatch', type: 'date' },
      { id: 'material',      label: 'Material' },
      { id: 'vehicle_no',    label: 'Vehicle No.' },
      { id: 'quantity',      label: 'Quantity' },
    ],
    dispatchFields: [],
    signatureBlocks: [
      { id: 'qc_incharge',     label: 'QC Incharge',     role: 'any'  },
      { id: 'general_manager', label: 'General Manager', role: 'admin' },
      { id: 'qc_chemist',      label: 'Q.C. CHEMIST',    role: 'any'  },
    ],
    hideRemarks:        true,
    hideConformity:     true,
    hideBatchMeta:      true,
    editableParameters: true,
    hideFinalize:       true,
    finalRows: [
      { id: 'mfg_date', label: 'Manufacturing Date', type: 'date' },
      { id: 'qty',      label: 'QTY' },
    ],
  }),

  // ── UPL OMRI — custom layout per the task spec ─────────────────────────────
  // Header is display-only (CERTIFICATE OF ANALYSIS + party + dispatch date +
  // material + vehicle + quantity). No certificate number/date, no customer
  // address/name, no packing, no batch/product/grade/dryer info cards.
  // Parameters are fully editable (add/delete/reorder/edit name+spec+unit).
  // Final rows append Manufacturing Date / Exp Date / QTY per batch column.
  // Remarks + Conformity are removed. Footer = QC Incharge / General Manager /
  // Q.C. Chemist (left / centre / right).
  omri: party('omri', 'UPL OMRI', {
    headerFields: [
      // Auto-filled from the template name; still editable by the operator.
      { id: 'party_name', label: 'Name of Party', defaultValue: 'UPL OMRI' },
      { id: 'dispatch_date', label: 'Date of Dispatch', type: 'date' },
      { id: 'material', label: 'Material' },
      { id: 'vehicle_no', label: 'Vehicle No.' },
      { id: 'quantity', label: 'Quantity' },
    ],
    dispatchFields: [],

    // Three-column footer: left / centre / right.
    signatureBlocks: [
      { id: 'qc_incharge',      label: 'QC Incharge',      role: 'any' },
      { id: 'general_manager',  label: 'General Manager',  role: 'admin' },
      { id: 'qc_chemist',       label: 'Q.C. Chemist',      role: 'any' },
    ],

    // Flags that scope behaviour to OMRI only (other parties are unaffected).
    hideRemarks:       true,
    hideConformity:    true,
    hideBatchMeta:     true,   // remove the Batch/Product/Grade/Dryer info cards
    editableParameters: true,  // inline editing of parameter rows
    hideFinalize:       true,  // no finalize button for OMRI
    finalRows: [
      { id: 'mfg_date', label: 'Manufacturing Date', type: 'date' },
      { id: 'exp_date', label: 'Exp Date',            type: 'date' },
      { id: 'qty',      label: 'QTY' },
    ],
  }),

  // ── ADAMA — multi-batch layout matching the reference image ───────────────
  adama: party('adama', 'ADAMA INDIA P LTD.', {
    layout: 'multi',
    headerFields: [
      { id: 'party_name',    label: 'Name of Party',    defaultValue: 'ADAMA INDIA P LTD.' },
      { id: 'dispatch_date', label: 'Date of Dispatch', type: 'date' },
      { id: 'material',      label: 'Material' },
      { id: 'vehicle_no',    label: 'Vehicle No.' },
      { id: 'quantity',      label: 'Quantity' },
    ],
    dispatchFields: [],
    signatureBlocks: [
      { id: 'qc_incharge', label: 'QC INCHARGE',   role: 'any'  },
      { id: 'qc_chemist',  label: 'Q.C. CHEMIST',  role: 'any'  },
    ],
    // Footer: two signatures, no company label.
    hideRemarks:        true,
    hideConformity:     true,
    hideBatchMeta:      true,
    editableParameters: true,
    hideFinalize:       true,
    finalRows: [
      { id: 'mfg_date', label: 'Manufacturing Date', type: 'date' },
      { id: 'exp_date', label: 'Exp Date',            type: 'date' },
      { id: 'qty',      label: 'QTY' },
    ],
  }),

  // ── BIOSTADT — multi-batch layout matching the reference image ─────────────
  biostadt: party('biostadt', 'BIOSTADT INDIA LTD.', {
    layout: 'multi',
    headerFields: [
      { id: 'party_name',    label: 'Name of Party',    defaultValue: 'BIOSTADT INDIA LTD.' },
      { id: 'dispatch_date', label: 'Date of Dispatch', type: 'date' },
      { id: 'material',      label: 'Material' },
      { id: 'vehicle_no',    label: 'Vehicle No.' },
      { id: 'quantity',      label: 'Quantity' },
    ],
    dispatchFields: [],
    signatureBlocks: [
      { id: 'qc_incharge', label: 'QC INCHARGE',  role: 'any' },
      { id: 'qc_chemist',  label: 'Q.C. CHEMIST', role: 'any' },
    ],
    hideRemarks:        true,
    hideConformity:     true,
    hideBatchMeta:      true,
    editableParameters: true,
    hideFinalize:       true,
    finalRows: [
      { id: 'mfg_date', label: 'Manufacturing Date', type: 'date' },
      { id: 'exp_date', label: 'Exp Date',            type: 'date' },
      { id: 'qty',      label: 'QTY' },
    ],
  }),
  // ── IFFCO — multi-batch layout matching the reference image ───────────────
  iffco: party('iffco', 'IFFCO', {
    layout: 'multi',
    headerFields: [
      { id: 'party_name',    label: 'Name of Party',    defaultValue: 'IFFCO' },
      { id: 'dispatch_date', label: 'Date of Dispatch', type: 'date' },
      { id: 'material',      label: 'Material' },
      { id: 'vehicle_no',    label: 'Vehicle No.' },
      { id: 'quantity',      label: 'Quantity' },
    ],
    dispatchFields: [],
    signatureBlocks: [
      { id: 'qc_incharge', label: 'QC INCHARGE',  role: 'any' },
      { id: 'qc_chemist',  label: 'Q.C. CHEMIST', role: 'any' },
    ],
    hideRemarks:        true,
    hideConformity:     true,
    hideBatchMeta:      true,
    editableParameters: true,
    hideFinalize:       true,
    finalRows: [
      { id: 'mfg_date', label: 'Manufacturing Date', type: 'date' },
      { id: 'exp_date', label: 'Exp Date',            type: 'date' },
      { id: 'qty',      label: 'QTY' },
    ],
  }),
  // ── HEMANI — multi-batch layout matching the reference image ──────────────
  hemani_v: party('hemani_v', 'HEMANI INDUSTRIES UNIT- V', {
    layout: 'multi',
    headerFields: [
      { id: 'party_name',    label: 'Name of Party',    defaultValue: 'HEMANI INDUSTRIES UNIT- V' },
      { id: 'dispatch_date', label: 'Date of Dispatch', type: 'date' },
      { id: 'material',      label: 'Material' },
      { id: 'vehicle_no',    label: 'Vehicle No.' },
      { id: 'quantity',      label: 'Quantity' },
    ],
    dispatchFields: [],
    signatureBlocks: [
      { id: 'qc_incharge', label: 'QC INCHARGE',  role: 'any' },
      { id: 'qc_chemist',  label: 'Q.C. CHEMIST', role: 'any' },
    ],
    hideRemarks:        true,
    hideConformity:     true,
    hideBatchMeta:      true,
    editableParameters: true,
    hideFinalize:       true,
    finalRows: [
      { id: 'mfg_date', label: 'Manufacturing Date', type: 'date' },
      { id: 'exp_date', label: 'Exp Date',            type: 'date' },
      { id: 'qty',      label: 'QTY' },
    ],
  }),

  // ── NORMAL GRADE ────────────────────────────────────────────────────────────
  normal: party('normal', 'NORMAL GRADE', {
    layout: 'multi',
    headerFields: [
      { id: 'party_name',    label: 'Name of Party',    defaultValue: 'NORMAL GRADE' },
      { id: 'dispatch_date', label: 'Date of Dispatch', type: 'date' },
      { id: 'material',      label: 'Material' },
      { id: 'vehicle_no',    label: 'Vehicle No.' },
      { id: 'quantity',      label: 'Quantity' },
    ],
    dispatchFields: [],
    signatureBlocks: [
      { id: 'qc_incharge', label: 'QC INCHARGE',  role: 'any' },
      { id: 'qc_chemist',  label: 'Q.C. CHEMIST', role: 'any' },
    ],
    hideRemarks:        true,
    hideConformity:     true,
    hideBatchMeta:      true,
    editableParameters: true,
    hideFinalize:       true,
    finalRows: [
      { id: 'mfg_date', label: 'Manufacturing Date', type: 'date' },
      { id: 'exp_date', label: 'Exp Date',            type: 'date' },
      { id: 'qty',      label: 'QTY' },
    ],
    parameters: [
      { id: 'normal_sulphur',      group: 'Active Content',  parameter: 'Active Content of Sulphur % By mass',  type: 'calc',   sourceResult: 'fg_sulphur', rule: { type: 'min', min: 80.0 },              specDisplay: 'Min 80%',        unit: '%' },
      { id: 'normal_susp',         group: 'Suspension',      parameter: 'Suspensibility % by mass',             type: 'calc',   sourceResult: 'fg_susp',    rule: { type: 'min', min: 60.0 },              specDisplay: 'Min 60%',        unit: '%' },
      { id: 'normal_moisture',     group: 'Moisture',        parameter: 'Moisture Content (%)',                  type: 'number', sourceKey: 'fg_moisture',   rule: { type: 'max', max: 5.0 },               specDisplay: 'Max 5%',         unit: '%' },
      { id: 'normal_bulk',         group: 'Bulk Density',    parameter: 'Bulk Density',                         type: 'calc',   sourceResult: 'fg_bulk',                                                       specDisplay: 'Taped',          unit: 'g/cc' },
      { id: 'normal_wet_sieve',    group: 'Wet Sieve',       parameter: 'Wet Sieve Test',                       type: 'number', sourceKey: 'fg_wetSieve_log', rule: { type: 'max', max: 2.0 },              specDisplay: 'Max 2%',         unit: '%' },
      { id: 'normal_dry_sieve',    group: 'Dry Sieve',       parameter: 'Dry Sieve Test',                       type: 'number', sourceKey: 'fg_drySieve_log',                                                  specDisplay: '',               unit: '%' },
      { id: 'normal_ph',           group: 'pH',              parameter: 'PH of 1.0% Aqu Sol',                   type: 'number', sourceKey: 'fg_ph',                                                            specDisplay: '—',              unit: '' },
      { id: 'normal_wettability',  group: 'Wettability',     parameter: 'Wettability (in Sec)',                  type: 'number', sourceKey: 'fg_wettability', rule: { type: 'max', max: 60 },               specDisplay: 'Max 60 sec',     unit: 'sec' },
      { id: 'normal_foam_start',   group: 'Persistent Foam', parameter: 'Persistent Foaming (at start)',        type: 'number', sourceKey: 'fg_foam_start', rule: { type: 'max', max: 60 },                specDisplay: 'Max 60 ml',      unit: 'ml' },
      { id: 'normal_foam_1min',    group: 'Persistent Foam', parameter: 'Persistent Foaming (after 1 min)',     type: 'number', sourceKey: 'fg_foam_1min',  rule: { type: 'max', max: 25 },                specDisplay: 'Max 25 ml',      unit: 'ml' },
    ],
  }),

  // ── COLOUR GRADE ───────────────────────────────────────────────────────────
  colour: party('colour', 'COLOUR GRADE', {
    layout: 'multi',
    headerFields: [
      { id: 'party_name',    label: 'Name of Party',    defaultValue: 'COLOUR GRADE' },
      { id: 'dispatch_date', label: 'Date of Dispatch', type: 'date' },
      { id: 'material',      label: 'Material' },
      { id: 'vehicle_no',    label: 'Vehicle No.' },
      { id: 'quantity',      label: 'Quantity' },
    ],
    dispatchFields: [],
    signatureBlocks: [
      { id: 'qc_incharge', label: 'QC INCHARGE',  role: 'any' },
      { id: 'qc_chemist',  label: 'Q.C. CHEMIST', role: 'any' },
    ],
    hideRemarks:        true,
    hideConformity:     true,
    hideBatchMeta:      true,
    editableParameters: true,
    hideFinalize:       true,
    finalRows: [
      { id: 'mfg_date', label: 'Manufacturing Date', type: 'date' },
      { id: 'exp_date', label: 'Exp Date',            type: 'date' },
      { id: 'qty',      label: 'QTY' },
    ],
    parameters: [
      { id: 'colour_sulphur',      group: 'Active Content',  parameter: 'Active Content of Sulphur % By mass',  type: 'calc',   sourceResult: 'fg_sulphur', rule: { type: 'min', min: 80.0 },              specDisplay: 'Min 80%',        unit: '%' },
      { id: 'colour_susp',         group: 'Suspension',      parameter: 'Suspensibility % by mass',             type: 'calc',   sourceResult: 'fg_susp',    rule: { type: 'min', min: 60.0 },              specDisplay: 'Min 60%',        unit: '%' },
      { id: 'colour_moisture',     group: 'Moisture',        parameter: 'Moisture Content (%)',                  type: 'number', sourceKey: 'fg_moisture',   rule: { type: 'max', max: 5.0 },               specDisplay: 'Max 5%',         unit: '%' },
      { id: 'colour_bulk',         group: 'Bulk Density',    parameter: 'Bulk Density',                         type: 'calc',   sourceResult: 'fg_bulk',                                                       specDisplay: 'Taped',          unit: 'g/cc' },
      { id: 'colour_wet_sieve',    group: 'Wet Sieve',       parameter: 'Wet Sieve Test',                       type: 'number', sourceKey: 'fg_wetSieve_log', rule: { type: 'max', max: 2.0 },              specDisplay: 'Max 2%',         unit: '%' },
      { id: 'colour_dry_sieve',    group: 'Dry Sieve',       parameter: 'Dry Sieve Test',                       type: 'number', sourceKey: 'fg_drySieve_log',                                                  specDisplay: '',               unit: '%' },
      { id: 'colour_ph',           group: 'pH',              parameter: 'PH of 1.0% Aqu Sol',                   type: 'number', sourceKey: 'fg_ph',                                                            specDisplay: '—',              unit: '' },
      { id: 'colour_wettability',  group: 'Wettability',     parameter: 'Wettability (in Sec)',                  type: 'number', sourceKey: 'fg_wettability', rule: { type: 'max', max: 60 },               specDisplay: 'Max 60 sec',     unit: 'sec' },
      { id: 'colour_foam_start',   group: 'Persistent Foam', parameter: 'Persistent Foaming (at start)',        type: 'number', sourceKey: 'fg_foam_start', rule: { type: 'max', max: 60 },                specDisplay: 'Max 60 ml',      unit: 'ml' },
      { id: 'colour_foam_1min',    group: 'Persistent Foam', parameter: 'Persistent Foaming (after 1 min)',     type: 'number', sourceKey: 'fg_foam_1min',  rule: { type: 'max', max: 25 },                specDisplay: 'Max 25 ml',      unit: 'ml' },
    ],
  }),
}

// Resolve a party config by key (safe: returns undefined for unknown keys).
export function getCoaTemplate(key) {
  return COA_TEMPLATES[key]
}

// Spec snapshot captured at draft creation: { [paramId]: { parameter, specDisplay, unit } }.
// Stored on coa_draft.spec_snapshot so an issued certificate reproduces its
// specs even if the template later changes.
export function buildSpecSnapshot(template) {
  const snap = {}
  if (!template || !Array.isArray(template.parameters)) return snap
  for (const p of template.parameters) {
    snap[p.id] = {
      parameter: p.parameter,
      group: p.group || '',
      specDisplay: p.specDisplay || '',
      unit: p.unit || '',
    }
  }
  return snap
}
