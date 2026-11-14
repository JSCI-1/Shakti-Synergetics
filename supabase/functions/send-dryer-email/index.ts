/**
 * send-dryer-email — Supabase Edge Function
 *
 * Two modes:
 *   1. Normal call  { date, dryer_type, operator, incharge, rows, ... }
 *      → build a CSV report (hourly log + blower + production + calibration)
 *      → send a short email with the CSV attached
 *      → on failure → write to email_queue for retry
 *   2. Retry call   { _retry: true }
 *      → pick up pending rows from email_queue, resend (up to 3 attempts)
 *
 * Required Supabase secrets:
 *   GMAIL_SERVICE_ACCOUNT_KEYS_BASE64, GMAIL_SENDER, GMAIL_TO, GMAIL_CC
 */

import { createClient } from 'https://esm.sh/@supabase/supabase-js@2'

// ── Constants ─────────────────────────────────────────────────────────────────

const TIME_SLOTS = [
  '08:00','09:00','10:00','11:00','12:00','13:00','14:00','15:00',
  '16:00','17:00','18:00','19:00','20:00','21:00','22:00','23:00',
  '00:00','01:00','02:00','03:00','04:00','05:00','06:00','07:00',
]

// 22-column hourly table (Time + these 21). Order matches the website table.
const HOURLY_COLS: { key: string; label: string }[] = [
  { key: 'temp_inlet',    label: 'Inlet' },
  { key: 'temp_outlet',   label: 'Outlet' },
  { key: 'temp_actual',   label: 'Actual' },
  { key: 'temp_fbd1',     label: 'IFBD' },
  { key: 'temp_fbd2',     label: 'FBD' },
  { key: 'temp_chamber',  label: 'Chamber' },
  { key: 'atomizer_freq', label: 'Atomizer Freq' },
  { key: 'feed_fc',       label: 'Feed F.C.' },
  { key: 'c_pressure',    label: 'C.Pressure' },
  { key: 'pressure',      label: 'Feed Pressure' },
  { key: 'pt_temp',       label: 'Pt. Temp' },
  { key: 'batch_no',      label: 'Batch No.' },
  { key: 'bags_per_hr',   label: 'Bags/Hr (25)' },
  { key: 'bag_size_wt',   label: 'Bag Size Wt (25)' },
  { key: 'bags_per_hr_50', label: 'Bags/Hr (50/1000)' },
  { key: 'bag_size_wt_50', label: 'Bag Size Wt (50/1000)' },
  { key: 'kg_per_hr',     label: 'Kg/Hr' },
  { key: 'colour',        label: 'Colour' },
  { key: 'id_frequency',  label: 'I.D. Frequency' },
  { key: 'remarks',       label: 'Remarks' },
  { key: 'operator_name', label: 'Operator Name' },
  // maintenance + timestamp handled specially (objects / display string)
]

const RANGE_FIELDS = new Set([
  'temp_inlet','temp_outlet','temp_actual','temp_fbd1','temp_fbd2',
  'temp_chamber','atomizer_freq','feed_fc','c_pressure','pt_temp','id_frequency',
])

const CAL_SENSORS = [
  { key: 'inlet',   label: 'Inlet'   },
  { key: 'outlet',  label: 'Outlet'  },
  { key: 'ifbd',    label: 'IFBD'    },
  { key: 'fbd',     label: 'FBD'     },
  { key: 'chamber', label: 'Chamber' },
]

const MAINT_LABELS: Record<string, string> = {
  shifter_screen: 'Shifter-Screen Cleaning',
  atomizer_water: 'Running the Atomizer on Water',
}

const MAX_RETRIES = 3

// ── Helpers ───────────────────────────────────────────────────────────────────

const env = (k: string) => (Deno.env.get(k) ?? '').trim()

const v = (val: unknown): string =>
  (val === undefined || val === null || val === '') ? '' : String(val)

function adminClient() {
  return createClient(env('SUPABASE_URL'), env('SUPABASE_SERVICE_ROLE_KEY'))
}

// CSV field escaper — wraps in quotes if it contains comma, quote or newline.
function csv(val: unknown): string {
  const s = v(val)
  if (s === '') return ''
  if (/[",\n\r]/.test(s)) return `"${s.replace(/"/g, '""')}"`
  return s
}

// Render the maintenance object into a readable cell.
function renderMaint(m: unknown): string {
  if (!m || typeof m !== 'object') return ''
  const obj = m as Record<string, string>
  const parts: string[] = []
  for (const key of Object.keys(MAINT_LABELS)) {
    if (obj[key]) {
      // obj[key] is an ISO timestamp; show label + HH:MM IST
      let t = ''
      try {
        t = new Date(obj[key]).toLocaleTimeString('en-IN', {
          timeZone: 'Asia/Kolkata', hour: '2-digit', minute: '2-digit', hour12: true,
        })
      } catch { /* ignore */ }
      parts.push(t ? `${MAINT_LABELS[key]} - ${t}` : MAINT_LABELS[key])
    }
  }
  return parts.join(' | ')
}

// ── Build the CSV report ──────────────────────────────────────────────────────

function buildCsv(payload: Record<string, unknown>): string {
  const date       = v(payload.date)
  const dryerType  = String(payload.dryer_type ?? '')
  const dryerLabel = dryerType === 'new' ? 'New Dryer' : 'Old Dryer'
  const operator   = v(payload.operator)
  const incharge   = v(payload.incharge)
  const rows       = Array.isArray(payload.rows) ? payload.rows : []

  const lines: string[] = []

  // ── Title + meta ──
  lines.push('JAISHIL SULPHUR & CHEMICAL INDUSTRIES - DRYER LOG')
  lines.push('')
  lines.push(['Date', csv(date), '', 'Dryer', csv(dryerLabel), '', 'Operator', csv(operator), '', 'Incharge', csv(incharge)].join(','))
  lines.push('')

  // ── Hourly log table (22 columns) ──
  lines.push('HOURLY LOG TABLE')
  const header = ['Time', ...HOURLY_COLS.map(c => c.label), 'Maintenance', 'Timestamp']
  lines.push(header.map(csv).join(','))

  TIME_SLOTS.forEach((slot, idx) => {
    const row      = (rows[idx] && typeof rows[idx] === 'object') ? rows[idx] as Record<string, unknown> : {}
    const cautions = (row.__cautions && typeof row.__cautions === 'object') ? row.__cautions as Record<string, string> : {}
    const cells: string[] = [csv(slot)]
    HOURLY_COLS.forEach(col => {
      let val = v(row[col.key])
      if (RANGE_FIELDS.has(col.key) && cautions[col.key] && val !== '') {
        val = `${val} (${cautions[col.key] === 'high' ? 'EXCEEDS LIMIT' : 'BELOW LIMIT'})`
      }
      cells.push(csv(val))
    })
    cells.push(csv(renderMaint(row.maintenance)))
    cells.push(csv(row.timestamp))
    lines.push(cells.join(','))
  })

  // Totals of the hourly table (all 24 hours) — one row per total, right after
  // the table: "<field name>,<value>". Total No. of Bags(50) / (1000) appear
  // only when that bag size was entered in some hour.
  const totalRows: [string, string][] = [
    ['Total No. of Bags(25)', v(payload.bags_per_hr_total)],
    ['Total No. of Bags', v(payload.bags_per_hr_50_total)],
  ]
  if (v(payload.bags_50_wt_total) !== '')   totalRows.push(['Total No. of Bags(50)', v(payload.bags_50_wt_total)])
  if (v(payload.bags_1000_wt_total) !== '') totalRows.push(['Total No. of Bags(1000)', v(payload.bags_1000_wt_total)])
  totalRows.push(['Total Kg./Hour Production / कुल किग्रा/घंटा', v(payload.kg_per_hr_total)])
  if (totalRows.some(([, val]) => val !== '')) {
    lines.push('')
    lines.push(csv('TOTALS (ALL 24 HOURS)'))
    totalRows.forEach(([name, val]) => lines.push([csv(name), csv(val)].join(',')))
  }

  lines.push('')
  lines.push('')

  // ── Side-by-side summary tables: Blower | Production | Calibration ──
  const blowers = [
    { label: 'ID Blower', dp: v(payload.id_blower_dp), mr: v(payload.id_blower_mr) },
    { label: 'FD Blower', dp: v(payload.fd_blower_dp), mr: v(payload.fd_blower_mr) },
    { label: 'IFBD',      dp: v(payload.ifbd_dp),       mr: v(payload.ifbd_mr)      },
    { label: 'FBD %',     dp: v(payload.fbd_pct_dp),    mr: v(payload.fbd_pct_mr)   },
  ]
  // Production summary mirrors the website: per part No. of Bags, Quantity (kg)
  // and Total (kg). Older submissions carry the total only (bags/qty blank).
  const prod = [
    { label: 'Fine Powder',       bags: v(payload.fine_powder_bags),       qty: v(payload.fine_powder_qty),       total: v(payload.fine_powder) },
    { label: 'Crust / Papadi',    bags: v(payload.crust_papadi_bags),      qty: v(payload.crust_papadi_qty),      total: v(payload.crust_papadi) },
    { label: 'Startup',           bags: v(payload.startup_bags),           qty: v(payload.startup_qty),           total: v(payload.startup) },
    { label: 'Packed Production', bags: v(payload.packed_production_bags), qty: v(payload.packed_production_qty), total: v(payload.packed_production) },
    { label: 'Total Production',  bags: '', qty: '', total: v(payload.total_production) },
  ]
  const cal = CAL_SENSORS.map(s => ({
    label: s.label,
    temp:  v(payload[`cal_${s.key}_temp`]),
    sens:  v(payload[`cal_${s.key}_sensor`]),
  }))
  const calDue = v(payload.calibration_due)

  // Section header row (blank column between each block)
  lines.push(['BLOWER READINGS', '', '', '', 'PRODUCTION SUMMARY', '', '', '', '', 'CALIBRATION'].map(csv).join(','))
  // Column header row
  lines.push(['Blower', 'DP', 'MR', '', 'Item', 'No. of Bags', 'Quantity (kg)', 'Total (kg)', '', 'Sensor', 'Temp', 'Value'].map(csv).join(','))

  // Build up to the tallest block (6 rows: 5 sensors + cal due; prod has 5; blower 4)
  const maxLen = 6
  for (let i = 0; i < maxLen; i++) {
    const b = blowers[i]
    const p = prod[i]
    const c = cal[i]
    const row: string[] = []
    // Blower (3 cols)
    row.push(csv(b ? b.label : ''), csv(b ? b.dp : ''), csv(b ? b.mr : ''))
    row.push('') // gap
    // Production (4 cols)
    row.push(csv(p ? p.label : ''), csv(p ? p.bags : ''), csv(p ? p.qty : ''), csv(p ? p.total : ''))
    row.push('') // gap
    // Calibration (3 cols) — rows 0..4 are sensors, row 5 is Cal Due
    if (c) {
      row.push(csv(c.label), csv(c.temp), csv(c.sens))
    } else if (i === 5) {
      row.push(csv('Cal. Due'), csv(calDue), '')
    } else {
      row.push('', '', '')
    }
    lines.push(row.join(','))
  }

  lines.push('')
  const savedAt = new Date().toLocaleString('en-IN', { timeZone: 'Asia/Kolkata', hour12: true })
  lines.push(`Saved at,${csv(savedAt)} IST`)

  // Leading UTF-8 BOM: without it Excel opens the file as ANSI and garbles Hindi.
  return '\uFEFF' + lines.join('\r\n')
}

// ── Google OAuth ──────────────────────────────────────────────────────────────

async function getAccessToken(saJson: Record<string, string>, subject: string): Promise<string> {
  const now = Math.floor(Date.now() / 1000)
  const b64url = (obj: unknown) =>
    btoa(JSON.stringify(obj)).replace(/\+/g,'-').replace(/\//g,'_').replace(/=+$/,'')

  const sigInput = `${b64url({ alg:'RS256', typ:'JWT' })}.${b64url({
    iss: saJson.client_email,
    sub: subject,
    scope: 'https://www.googleapis.com/auth/gmail.send',
    aud: 'https://oauth2.googleapis.com/token',
    iat: now, exp: now + 3600,
  })}`

  const pemBody = saJson.private_key
    .replace(/-----BEGIN PRIVATE KEY-----/,'')
    .replace(/-----END PRIVATE KEY-----/,'')
    .replace(/\s+/g,'')
  const der = Uint8Array.from(atob(pemBody), c => c.charCodeAt(0))
  const key = await crypto.subtle.importKey(
    'pkcs8', der.buffer,
    { name:'RSASSA-PKCS1-v1_5', hash:'SHA-256' },
    false, ['sign'],
  )
  const sig = await crypto.subtle.sign('RSASSA-PKCS1-v1_5', key, new TextEncoder().encode(sigInput))
  const jwt = `${sigInput}.${btoa(String.fromCharCode(...new Uint8Array(sig))).replace(/\+/g,'-').replace(/\//g,'_').replace(/=+$/,'')}`

  const res  = await fetch('https://oauth2.googleapis.com/token', {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams({ grant_type:'urn:ietf:params:oauth:grant-type:jwt-bearer', assertion: jwt }),
  })
  const data = await res.json() as { access_token?: string; error?: string }
  if (!data.access_token) throw new Error(`OAuth failed: ${data.error ?? JSON.stringify(data)}`)
  return data.access_token
}

// ── UTF-8 safe base64 ───────────────────────────────────────────────────────
function utf8ToB64(str: string): string {
  const bytes = new TextEncoder().encode(str)
  let binary = ''
  for (let i = 0; i < bytes.length; i++) binary += String.fromCharCode(bytes[i])
  return btoa(binary)
}

// ── Send via Gmail API (with CSV attachment) ────────────────────────────────

async function sendEmail(payload: Record<string, unknown>): Promise<void> {
  const saB64  = env('GMAIL_SERVICE_ACCOUNT_KEYS_BASE64')
  const sender = env('GMAIL_SENDER')
  const toRaw  = env('GMAIL_TO')
  const ccRaw  = env('GMAIL_CC')

  if (!saB64 || !sender || !toRaw) throw new Error('Missing required email secrets')

  // Empty-form guard: skip when the WHOLE form has no hourly data.
  const guardRows = Array.isArray(payload.rows) ? payload.rows : []
  const hasAnyData = guardRows.some(r => {
    if (!r || typeof r !== 'object') return false
    const row = r as Record<string, unknown>
    return HOURLY_COLS.some(col => {
      const val = row[col.key]
      return val !== undefined && val !== null && String(val).trim() !== ''
    })
  })
  if (!hasAnyData) {
    console.log('[send-dryer-email] Skipped — form has no hourly data (empty payload).')
    return
  }

  const saJson      = JSON.parse(atob(saB64)) as Record<string, string>
  const accessToken = await getAccessToken(saJson, sender)

  const dryerType  = String(payload.dryer_type ?? '')
  const dryerLabel = dryerType === 'new' ? 'New Dryer' : 'Old Dryer'
  const date       = v(payload.date)
  const operator   = v(payload.operator) || '—'
  const incharge   = v(payload.incharge) || '—'
  const subject    = `Shakti Synergetics — Dryer Record | ${dryerLabel} | ${date}`

  const csvContent = buildCsv(payload)
  const csvFileName = `Dryer_Log_${dryerLabel.replace(/\s+/g, '')}_${date || 'report'}.csv`

  // Short HTML body
  const bodyHtml = `<!DOCTYPE html><html><head><meta charset="UTF-8"></head>
<body style="font-family:Arial,sans-serif;color:#222;font-size:14px;line-height:1.6;">
  <p><strong>Dryer Log Sheet — ${dryerLabel}</strong></p>
  <table style="border-collapse:collapse;font-size:13px;">
    <tr><td style="padding:2px 12px 2px 0;color:#888;">Date</td><td style="font-weight:600;">${date}</td></tr>
    <tr><td style="padding:2px 12px 2px 0;color:#888;">Operator</td><td style="font-weight:600;">${operator}</td></tr>
    <tr><td style="padding:2px 12px 2px 0;color:#888;">Incharge</td><td style="font-weight:600;">${incharge}</td></tr>
  </table>
  <p>The full dryer log report (hourly readings, blower readings, production summary and calibration) is attached as a spreadsheet (CSV) file.</p>
  <p style="color:#999;font-size:11px;">Automated email from Shakti Synergetics — Dryer Log System. Do not reply.</p>
</body></html>`

  const toList = toRaw.split(',').map(s => s.trim()).filter(Boolean)
  const ccList = ccRaw ? ccRaw.split(',').map(s => s.trim()).filter(Boolean) : []

  // RFC 2047 encode subject for unicode safety.
  const encodedSubject = `=?UTF-8?B?${utf8ToB64(subject)}?=`

  // Build a multipart/mixed message: HTML body + CSV attachment.
  const boundary = `----=_Part_${Date.now()}`
  const csvB64 = utf8ToB64(csvContent)

  const rawLines = [
    `From: Shakti Synergetics <${sender}>`,
    `To: ${toList.join(', ')}`,
    ...(ccList.length ? [`Cc: ${ccList.join(', ')}`] : []),
    `Subject: ${encodedSubject}`,
    'MIME-Version: 1.0',
    `Content-Type: multipart/mixed; boundary="${boundary}"`,
    '',
    `--${boundary}`,
    'Content-Type: text/html; charset=UTF-8',
    'Content-Transfer-Encoding: base64',
    '',
    utf8ToB64(bodyHtml),
    '',
    `--${boundary}`,
    `Content-Type: text/csv; charset=UTF-8; name="${csvFileName}"`,
    'Content-Transfer-Encoding: base64',
    `Content-Disposition: attachment; filename="${csvFileName}"`,
    '',
    csvB64,
    '',
    `--${boundary}--`,
  ]

  const rawB64 = utf8ToB64(rawLines.join('\r\n'))
    .replace(/\+/g,'-').replace(/\//g,'_').replace(/=+$/,'')

  const res  = await fetch(
    `https://gmail.googleapis.com/gmail/v1/users/${encodeURIComponent(sender)}/messages/send`,
    {
      method: 'POST',
      headers: { Authorization: `Bearer ${accessToken}`, 'Content-Type': 'application/json' },
      body: JSON.stringify({ raw: rawB64 }),
    },
  )
  const data = await res.json() as { id?: string; error?: unknown }
  if (!res.ok) throw new Error(`Gmail API error: ${JSON.stringify(data)}`)
  console.log('[send-dryer-email] Sent with CSV attachment. Message ID:', data.id)
}

// ── Retry queue ─────────────────────────────────────────────────────────────

// Dedup key for an entry = dryer_type|date. One email per entry, ever.
function dedupKey(payload: Record<string, unknown>): string {
  return `${String(payload.dryer_type ?? '')}|${v(payload.date)}`
}

async function queueForRetry(payload: Record<string, unknown>, errorMsg: string): Promise<void> {
  try {
    const sb = adminClient()
    const dryerLabel = payload.dryer_type === 'new' ? 'New Dryer' : 'Old Dryer'
    // Upsert on dedup_key so a failed send that was already claimed just updates
    // the error instead of creating a second row.
    await sb.from('email_queue').upsert({
      dedup_key:     dedupKey(payload),
      subject:       `[Dryer Log] ${dryerLabel} | ${v(payload.date)}`,
      payload,
      status:        'pending',
      error:         errorMsg,
      next_retry_at: new Date(Date.now() + 5 * 60 * 1000).toISOString(),
    }, { onConflict: 'dedup_key' })
    console.log('[send-dryer-email] Queued for retry.')
  } catch (e) {
    console.error('[send-dryer-email] Failed to queue for retry:', e)
  }
}

async function processRetryQueue(): Promise<void> {
  const sb = adminClient()
  const { data: rows, error } = await sb
    .from('email_queue')
    .select('*')
    .eq('status', 'pending')
    .lte('next_retry_at', new Date().toISOString())
    .lt('retry_count', MAX_RETRIES)
    .order('created_at', { ascending: true })
    .limit(10)

  if (error) { console.error('[retry] Failed to fetch queue:', error.message); return }
  if (!rows || rows.length === 0) { console.log('[retry] No pending emails.'); return }

  console.log(`[retry] Processing ${rows.length} pending email(s).`)

  for (const row of rows) {
    try {
      await sendEmail(row.payload as Record<string, unknown>)
      await sb.from('email_queue').update({
        status: 'sent', last_tried_at: new Date().toISOString(), error: null,
      }).eq('id', row.id)
      console.log(`[retry] Row ${row.id} sent successfully.`)
    } catch (e) {
      const msg       = e instanceof Error ? e.message : String(e)
      const newCount  = (row.retry_count ?? 0) + 1
      const isFinal   = newCount >= MAX_RETRIES
      await sb.from('email_queue').update({
        status:        isFinal ? 'failed' : 'pending',
        retry_count:   newCount,
        last_tried_at: new Date().toISOString(),
        next_retry_at: new Date(Date.now() + 5 * 60 * 1000).toISOString(),
        error:         msg,
      }).eq('id', row.id)
      console.error(`[retry] Row ${row.id} failed (attempt ${newCount}): ${msg}`)
    }
  }
}

// ── Main handler ──────────────────────────────────────────────────────────────

const CORS = {
  'Access-Control-Allow-Origin':  '*',
  'Access-Control-Allow-Methods': 'POST, OPTIONS',
  'Access-Control-Allow-Headers': 'Content-Type, Authorization, apikey, x-client-info',
}

const json = (obj: unknown, status = 200) =>
  new Response(JSON.stringify(obj), { status, headers: { ...CORS, 'Content-Type': 'application/json' } })

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') return new Response(null, { headers: CORS })

  try {
    const body = await req.json() as Record<string, unknown>

    if (body._retry === true) {
      await processRetryQueue()
      return json({ ok: true, mode: 'retry' })
    }

    // ── Dedup claim (Idea 4) ──────────────────────────────────────────────
    // Try to claim this entry's dedup_key by inserting a row. The unique index
    // on dedup_key means a second attempt for the SAME entry is rejected, so
    // we never send a duplicate — even across the cron retry path.
    const key = dedupKey(body)
    const sb  = adminClient()
    let claimId: number | null = null
    try {
      const { data, error } = await sb.from('email_queue').insert({
        dedup_key:     key,
        subject:       `[Dryer Log] ${body.dryer_type === 'new' ? 'New Dryer' : 'Old Dryer'} | ${v(body.date)}`,
        payload:       body,
        status:        'pending',
        next_retry_at: new Date().toISOString(),
      }).select('id').single()

      if (error) {
        // 23505 = unique violation → already claimed/sent for this entry → skip.
        if (error.code === '23505') {
          console.log('[send-dryer-email] Duplicate entry — email already handled for', key)
          return json({ ok: true, duplicate: true })
        }
        throw error
      }
      claimId = data?.id ?? null
    } catch (e) {
      // If the claim write itself fails (DB down), fall through to a plain send
      // so an email still goes out; dedup is best-effort in that rare case.
      console.warn('[send-dryer-email] Dedup claim failed, sending without claim:', e)
    }

    try {
      await sendEmail(body)
      // Mark the claimed row as sent.
      if (claimId !== null) {
        await sb.from('email_queue').update({
          status: 'sent', last_tried_at: new Date().toISOString(), error: null,
        }).eq('id', claimId)
      }
      return json({ ok: true })
    } catch (e) {
      const msg = e instanceof Error ? e.message : String(e)
      console.error('[send-dryer-email] Send failed, leaving row pending for retry:', msg)
      // Leave the claimed row pending (cron will retry it). If there was no
      // claim, queueForRetry upserts one.
      if (claimId !== null) {
        await sb.from('email_queue').update({
          status: 'pending', error: msg,
          next_retry_at: new Date(Date.now() + 5 * 60 * 1000).toISOString(),
        }).eq('id', claimId)
      } else {
        await queueForRetry(body, msg)
      }
      return json({ ok: false, queued: true, error: msg })
    }
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e)
    console.error('[send-dryer-email] Unexpected error:', msg)
    return json({ error: msg }, 500)
  }
})
