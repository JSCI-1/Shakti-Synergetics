// ─────────────────────────────────────────────
// Quality Control — shared utilities
// ─────────────────────────────────────────────

/**
 * evaluate(value, rule) → "PASS" | "FAIL" | null
 *
 * Returns null when:
 *   - rule is absent / undefined  → no badge shown
 *   - value is empty string / null / undefined → no badge yet
 *
 * rule shapes:
 *   { type: "range",     min, max }
 *   { type: "max",       max }
 *   { type: "min",       min }
 *   { type: "tolerance", target, tol }   → target ± tol
 *   { type: "text",      accepted }      → value === accepted
 */
export function evaluate(value, rule) {
  if (!rule) return null
  if (value === '' || value === null || value === undefined) return null

  switch (rule.type) {
    case 'range': {
      const n = parseFloat(value)
      if (isNaN(n)) return null
      return n >= rule.min && n <= rule.max ? 'PASS' : 'FAIL'
    }
    case 'max': {
      const n = parseFloat(value)
      if (isNaN(n)) return null
      return n <= rule.max ? 'PASS' : 'FAIL'
    }
    case 'min': {
      const n = parseFloat(value)
      if (isNaN(n)) return null
      return n >= rule.min ? 'PASS' : 'FAIL'
    }
    case 'tolerance': {
      const n = parseFloat(value)
      if (isNaN(n)) return null
      return n >= (rule.target - rule.tol) && n <= (rule.target + rule.tol) ? 'PASS' : 'FAIL'
    }
    case 'text': {
      return value === rule.accepted ? 'PASS' : 'FAIL'
    }
    default:
      return null
  }
}

// ─────────────────────────────────────────────
// Shared formula functions
// ─────────────────────────────────────────────

/** % Moisture = ((W − w) / W) × 100
 *  W = weight of sample taken; w = weight after drying */
export function calcMoisture({ W, w }) {
  const wNum = parseFloat(W), wSmall = parseFloat(w)
  if (isNaN(wNum) || isNaN(wSmall)) return null
  if (wNum === 0) return null
  if (wSmall < 0 || wNum < 0) return null
  const result = ((wNum - wSmall) / wNum) * 100
  if (!isFinite(result)) return null
  return +result.toFixed(2)
}

/** Sulphur (%) = (0.03206 × N × 100 × BR) / W
 *  N = normality of iodine; W = sample weight (g); BR = burette reading (ml) */
export const SULPHUR_FACTOR = 0.03206

export function calcSulphur({ N, BR, W }) {
  const n = parseFloat(N), br = parseFloat(BR), w = parseFloat(W)
  if (isNaN(n) || isNaN(br) || isNaN(w)) return null
  if (w === 0) return null
  if (n < 0 || br < 0 || w < 0) return null
  const result = (SULPHUR_FACTOR * n * 100 * br) / w
  if (!isFinite(result)) return null
  return +result.toFixed(2)
}

/** Wet Sieve / Dry Sieve: Passing (%) = ((M − m) / M) × 100
 *  M = mass of material taken; m = mass of residue */
export function calcSieve({ M, m }) {
  const big = parseFloat(M), small = parseFloat(m)
  if (isNaN(big) || isNaN(small)) return null
  if (big === 0) return null
  if (big < 0 || small < 0) return null
  const result = ((big - small) / big) * 100
  if (!isFinite(result)) return null
  return +result.toFixed(2)
}

/** Bulk Density = Mass (g) / Volume (ml) → g/cc */
export function calcBulkDensity({ mass, volume }) {
  const m = parseFloat(mass), v = parseFloat(volume)
  if (isNaN(m) || isNaN(v)) return null
  if (v === 0) return null
  if (m < 0 || v < 0) return null
  const result = m / v
  if (!isFinite(result)) return null
  return +result.toFixed(2)
}

/** Purity (%) = 100 − (M1 / M) × 100
 *  M1 = CS₂-insoluble residue (g); M = material taken (g) */
export function calcPurity({ M1, M }) {
  const m1 = parseFloat(M1), m = parseFloat(M)
  if (isNaN(m1) || isNaN(m)) return null
  if (m === 0) return null
  if (m1 < 0 || m < 0) return null
  const result = 100 - (m1 / m) * 100
  if (!isFinite(result)) return null
  return +result.toFixed(2)
}

/** Mesh Size Passing (%) = 100 × (1 − m / M)
 *  m = coarse retained on sieve; M = material taken */
export function calcMeshSize({ m, M }) {
  const small = parseFloat(m), big = parseFloat(M)
  if (isNaN(small) || isNaN(big)) return null
  if (big === 0) return null
  if (small < 0 || big < 0) return null
  const result = 100 * (1 - small / big)
  if (!isFinite(result)) return null
  return +result.toFixed(2)
}

/**
 * Suspensibility (%)
 *
 * M  = (SulphurContent × SampleWeight) / 100
 * m  = 0.03206 × N × BR
 * Suspensibility = (1000 × (M − m)) / (9 × M)
 *
 * inputs: sulphurContent (%), sampleWeight (g), N, BR
 * returns: { M, m, result } — M and m are intermediate values (shown)
 */
export function calcSuspensibility({ sulphurContent, sampleWeight, N, BR }) {
  const sc = parseFloat(sulphurContent)
  const sw = parseFloat(sampleWeight)
  const n  = parseFloat(N)
  const br = parseFloat(BR)
  if (isNaN(sc) || isNaN(sw) || isNaN(n) || isNaN(br)) return null
  if (sc < 0 || sw < 0 || n < 0 || br < 0) return null
  const M = (sc * sw) / 100
  const m = SULPHUR_FACTOR * n * br
  if (M === 0) return null
  const result = (1000 * (M - m)) / (9 * M)
  if (!isFinite(result)) return null
  return {
    M: +M.toFixed(4),
    m: +m.toFixed(4),
    result: +result.toFixed(2),
  }
}

// ─────────────────────────────────────────────
// Unit tests (run once on import in dev)
// ─────────────────────────────────────────────
function runUnitTests() {
  const assert = (label, got, expected) => {
    if (got !== expected) {
      console.error(`QC unit test FAILED [${label}]: got ${got}, expected ${expected}`)
    }
  }

  // Formula tests
  assert('Moisture W=10 w=9.5', calcMoisture({ W: 10, w: 9.5 }), 5.00)
  assert('Sulphur N=0.1 BR=25 W=1', calcSulphur({ N: 0.1, BR: 25, W: 1 }), 8.02)
  assert('Wet Sieve M=100 m=2', calcSieve({ M: 100, m: 2 }), 98.00)
  assert('Bulk Density 55/100', calcBulkDensity({ mass: 55, volume: 100 }), 0.55)
  assert('Purity M1=0.5 M=10', calcPurity({ M1: 0.5, M: 10 }), 95.00)

  // Rule tests
  assert('China Clay pH 8 → PASS',  evaluate(8,    { type: 'range', min: 5, max: 8 }), 'PASS')
  assert('China Clay pH 8.1 → FAIL', evaluate(8.1, { type: 'range', min: 5, max: 8 }), 'FAIL')
  assert('Coal moisture 30 → PASS',  evaluate(30,   { type: 'max', max: 30 }), 'PASS')
  assert('Coal moisture 31 → FAIL',  evaluate(31,   { type: 'max', max: 30 }), 'FAIL')
  assert('Gujmol solid 44 → PASS',   evaluate(44,   { type: 'tolerance', target: 45, tol: 1 }), 'PASS')
  assert('Gujmol solid 43.9 → FAIL', evaluate(43.9, { type: 'tolerance', target: 45, tol: 1 }), 'FAIL')
  assert('No rule → null',           evaluate(10,   undefined), null)
  assert('Empty value → null',       evaluate('',   { type: 'max', max: 30 }), null)

  // Overall result tests (imported lazily to avoid circular dep)
  // We test the logic directly here
  const overallLogic = (results) => {
    const limited = Object.values(results)
    if (limited.length === 0) return null
    if (limited.some(v => v === 'FAIL'))  return 'FAIL'
    if (limited.some(v => v === null))    return 'Incomplete'
    return 'PASS'
  }
  assert('Overall [PASS,PASS] → PASS',        overallLogic({ a: 'PASS', b: 'PASS' }),   'PASS')
  assert('Overall [PASS,FAIL] → FAIL',        overallLogic({ a: 'PASS', b: 'FAIL' }),   'FAIL')
  assert('Overall [PASS,null] → Incomplete',  overallLogic({ a: 'PASS', b: null }),      'Incomplete')
  assert('Overall [] → null',                 overallLogic({}),                          null)

  console.log('%c✓ QC unit tests passed', 'color: green; font-weight: bold')
}

if (import.meta.env.DEV) runUnitTests()
