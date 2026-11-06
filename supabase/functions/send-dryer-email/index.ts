/**
 * send-dryer-email — Supabase Edge Function
 *
 * Two modes:
 *   1. Normal call  { date, dryer_type, operator, incharge, rows, ... }
 *      → build + send email immediately
 *      → on failure → write to email_queue for retry
 *
 *   2. Retry call   { _retry: true }
 *      → pick up pending rows from email_queue
 *      → resend each one (up to 3 attempts)
 *
 * Required Supabase secrets:
 *   GMAIL_SERVICE_ACCOUNT_KEYS_BASE64
 *   GMAIL_SENDER
 *   GMAIL_TO
 *   GMAIL_CC
 */

import { createClient } from 'https://esm.sh/@supabase/supabase-js@2'

// ── Constants ─────────────────────────────────────────────────────────────────

const TIME_SLOTS = [
  '08:00','09:00','10:00','11:00','12:00','13:00','14:00','15:00',
  '16:00','17:00','18:00','19:00','20:00','21:00','22:00','23:00',
  '00:00','01:00','02:00','03:00','04:00','05:00','06:00','07:00',
]

const HOURLY_COLS: { key: string; label: string }[] = [
  { key: 'temp_inlet',    label: 'Inlet °C'      },
  { key: 'temp_outlet',   label: 'Outlet °C'     },
  { key: 'temp_actual',   label: 'Actual °C'     },
  { key: 'temp_fbd1',     label: 'IFBD °C'       },
  { key: 'temp_fbd2',     label: 'FBD °C'        },
  { key: 'temp_chamber',  label: 'Chamber °C'    },
  { key: 'atomizer_freq', label: 'Atomizer Freq' },
  { key: 'feed_fc',       label: 'Feed F.C.'     },
  { key: 'c_pressure',    label: 'C.Pressure'    },
  { key: 'pressure',      label: 'Feed Pressure' },
  { key: 'pt_temp',       label: 'Pt. Temp'      },
  { key: 'batch_no',      label: 'Batch No.'     },
  { key: 'bags_per_hr',   label: 'Bags/Hr'       },
  { key: 'bag_size_wt',   label: 'Bag Size Wt'   },
  { key: 'kg_per_hr',     label: 'Kg/Hr'         },
  { key: 'colour',        label: 'Colour'        },
  { key: 'id_frequency',  label: 'ID Freq.'      },
  { key: 'remarks',       label: 'Remarks'       },
]

const RANGE_FIELDS = new Set([
  'temp_inlet','temp_outlet','temp_actual','temp_fbd1','temp_fbd2',
  'temp_chamber','atomizer_freq','feed_fc','c_pressure','pt_temp','id_frequency',
])

const MAX_RETRIES = 3

// ── Helpers ───────────────────────────────────────────────────────────────────

const env = (k: string) => (Deno.env.get(k) ?? '').trim()

const v = (val: unknown): string =>
  (val === undefined || val === null || val === '') ? '—' : String(val)

// Supabase admin client for email_queue access
function adminClient() {
  return createClient(
    env('SUPABASE_URL'),
    env('SUPABASE_SERVICE_ROLE_KEY'),
  )
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

// ── HTML Builder ──────────────────────────────────────────────────────────────

function buildHtml(payload: Record<string, unknown>): string {
  const date       = v(payload.date)
  const dryerType  = String(payload.dryer_type ?? '')
  const dryerLabel = dryerType === 'new' ? 'New Dryer' : 'Old Dryer'
  const operator   = v(payload.operator)
  const incharge   = v(payload.incharge)
  const rows       = Array.isArray(payload.rows) ? payload.rows : []

  // Blower readings
  const blowers = [
    { label: 'ID Blower',  dp: v(payload.id_blower_dp),  mr: v(payload.id_blower_mr)  },
    { label: 'FD Blower',  dp: v(payload.fd_blower_dp),  mr: v(payload.fd_blower_mr)  },
    { label: 'IFBD',       dp: v(payload.ifbd_dp),        mr: v(payload.ifbd_mr)        },
    { label: 'FBD %',      dp: v(payload.fbd_pct_dp),     mr: v(payload.fbd_pct_mr)     },
  ]

  // Production summary
  const finePowder   = v(payload.fine_powder)
  const crustPapadi  = v(payload.crust_papadi)
  const startup      = v(payload.startup)
  const packed       = v(payload.packed_production)
  const total        = v(payload.total_production)

  // Saved at
  const savedAt = new Date().toLocaleString('en-IN', { timeZone:'Asia/Kolkata', hour12:true })

  // ── Styles ──
  const S = {
    th:     `style="background:#b85c2c;color:#fff;padding:6px 8px;border:1px solid #c8773e;font-size:11px;white-space:nowrap;text-align:center;"`,
    td:     `style="padding:5px 7px;border:1px solid #ddd;font-size:11px;text-align:center;background:#fff;"`,
    tdAlt:  `style="padding:5px 7px;border:1px solid #ddd;font-size:11px;text-align:center;background:#fdf6ef;"`,
    tdWarn: `style="padding:5px 7px;border:1px solid #ddd;font-size:11px;text-align:center;background:#fff8e1;text-decoration:underline;text-decoration-color:#b85c00;font-weight:700;color:#b85c00;"`,
    thSm:   `style="background:#8d4a1e;color:#fff;padding:5px 8px;border:1px solid #c8773e;font-size:11px;text-align:center;"`,
    tdSm:   `style="padding:5px 8px;border:1px solid #ddd;font-size:11px;text-align:center;background:#fff;"`,
    label:  `style="padding:5px 8px;border:1px solid #ddd;font-size:11px;background:#fdf6ef;color:#555;font-weight:600;"`,
    value:  `style="padding:5px 8px;border:1px solid #ddd;font-size:11px;text-align:center;background:#fff;font-weight:700;"`,
  }

  // ── Hourly rows ──
  let hourlyRows = ''
  TIME_SLOTS.forEach((slot, idx) => {
    const row      = (rows[idx] && typeof rows[idx] === 'object') ? rows[idx] as Record<string,unknown> : {}
    const cautions = (row.__cautions && typeof row.__cautions === 'object') ? row.__cautions as Record<string,string> : {}
    const bg       = idx % 2 === 0 ? S.td : S.tdAlt
    let cells = `<td ${bg}><strong>${slot}</strong></td>`
    HOURLY_COLS.forEach(col => {
      const val       = v(row[col.key])
      const hasCaution = RANGE_FIELDS.has(col.key) && !!cautions[col.key]
      const note       = hasCaution ? (cautions[col.key] === 'high' ? ' ⚠ Exceeds' : ' ⚠ Below') : ''
      cells += hasCaution
        ? `<td ${S.tdWarn}>${val}${note}</td>`
        : `<td ${bg}>${val}</td>`
    })
    hourlyRows += `<tr>${cells}</tr>`
  })

  // ── Blower rows ──
  const blowerRows = blowers.map(b =>
    `<tr>
      <td ${S.label}>${b.label}</td>
      <td ${S.value}>${b.dp}</td>
      <td ${S.value}>${b.mr}</td>
    </tr>`
  ).join('')

  return `<!DOCTYPE html>
<html>
<head><meta charset="UTF-8">
<meta name="viewport" content="width=device-width,initial-scale=1">
</head>
<body style="margin:0;padding:0;background:#f0ebe4;font-family:Arial,sans-serif;">
<div style="max-width:960px;margin:20px auto;background:#fff;border-radius:6px;overflow:hidden;box-shadow:0 2px 10px rgba(0,0,0,0.15);">

  <!-- ── Header ── -->
  <div style="background:#b85c2c;padding:16px 24px;">
    <div style="color:#fff;font-size:18px;font-weight:900;letter-spacing:0.5px;">JAISHIL SULPHUR &amp; CHEMICAL INDUSTRIES</div>
    <div style="color:#ffe0cc;font-size:12px;margin-top:3px;">Dryer Log Sheet — ${dryerLabel}</div>
  </div>

  <!-- ── Meta bar ── -->
  <table style="width:100%;border-collapse:collapse;background:#fdf6ef;border-bottom:2px solid #d8c8b8;">
    <tr>
      <td style="padding:10px 20px;font-size:12px;border-right:1px solid #e0d0c0;">
        <span style="color:#888;">Date</span><br><strong>${date}</strong>
      </td>
      <td style="padding:10px 20px;font-size:12px;border-right:1px solid #e0d0c0;">
        <span style="color:#888;">Dryer</span><br><strong>${dryerLabel}</strong>
      </td>
      <td style="padding:10px 20px;font-size:12px;border-right:1px solid #e0d0c0;">
        <span style="color:#888;">Operator</span><br><strong>${operator}</strong>
      </td>
      <td style="padding:10px 20px;font-size:12px;">
        <span style="color:#888;">Incharge</span><br><strong>${incharge}</strong>
      </td>
    </tr>
  </table>

  <!-- ── Section: Hourly Log ── -->
  <div style="padding:16px 20px 8px;">
    <div style="font-size:13px;font-weight:700;color:#b85c2c;margin-bottom:8px;border-left:4px solid #b85c2c;padding-left:8px;">
      Hourly Log Table
    </div>
    <div style="overflow-x:auto;">
      <table style="border-collapse:collapse;min-width:900px;width:100%;">
        <thead>
          <tr>
            <th ${S.th}>Time</th>
            ${HOURLY_COLS.map(c => `<th ${S.th}>${c.label}</th>`).join('')}
          </tr>
        </thead>
        <tbody>${hourlyRows}</tbody>
      </table>
    </div>
    <div style="margin-top:6px;font-size:10px;color:#b85c00;">
      ⚠ Underlined values were outside the expected range and acknowledged by the operator.
    </div>
  </div>

  <!-- ── Section: Blower Readings ── -->
  <div style="padding:16px 20px 8px;">
    <div style="font-size:13px;font-weight:700;color:#b85c2c;margin-bottom:8px;border-left:4px solid #b85c2c;padding-left:8px;">
      Blower Readings
    </div>
    <table style="border-collapse:collapse;width:320px;">
      <thead>
        <tr>
          <th ${S.thSm}>Blower</th>
          <th ${S.thSm}>DP</th>
          <th ${S.thSm}>MR</th>
        </tr>
      </thead>
      <tbody>${blowerRows}</tbody>
    </table>
  </div>

  <!-- ── Section: Production Summary ── -->
  <div style="padding:16px 20px 8px;">
    <div style="font-size:13px;font-weight:700;color:#b85c2c;margin-bottom:8px;border-left:4px solid #b85c2c;padding-left:8px;">
      Production Summary
    </div>
    <table style="border-collapse:collapse;width:320px;">
      <tbody>
        <tr><td ${S.label}>Fine Powder</td><td ${S.value}>${finePowder} kg</td></tr>
        <tr><td ${S.label}>Crust / Papadi</td><td ${S.value}>${crustPapadi} kg</td></tr>
        <tr><td ${S.label}>Startup</td><td ${S.value}>${startup} kg</td></tr>
        <tr><td ${S.label}>Packed Production</td><td ${S.value}>${packed} kg</td></tr>
        <tr>
          <td style="padding:5px 8px;border:1px solid #ddd;font-size:12px;background:#b85c2c;color:#fff;font-weight:700;">Total Production</td>
          <td style="padding:5px 8px;border:1px solid #ddd;font-size:12px;background:#b85c2c;color:#fff;font-weight:700;text-align:center;">${total} kg</td>
        </tr>
      </tbody>
    </table>
  </div>

  <!-- ── Footer ── -->
  <div style="margin-top:16px;background:#f0e8df;padding:10px 20px;font-size:10px;color:#999;text-align:center;border-top:1px solid #e0d0c0;">
    Saved at: ${savedAt} IST &nbsp;|&nbsp;
    This is an automated email from Shakti Synergetics — Dryer Log System. Do not reply.
  </div>

</div>
</body>
</html>`
}

// ── Send via Gmail API ────────────────────────────────────────────────────────

async function sendEmail(payload: Record<string, unknown>): Promise<void> {
  const saB64  = env('GMAIL_SERVICE_ACCOUNT_KEYS_BASE64')
  const sender = env('GMAIL_SENDER')
  const toRaw  = env('GMAIL_TO')
  const ccRaw  = env('GMAIL_CC')

  if (!saB64 || !sender || !toRaw) throw new Error('Missing required email secrets')

  const saJson      = JSON.parse(atob(saB64)) as Record<string, string>
  const accessToken = await getAccessToken(saJson, sender)

  const dryerType  = String(payload.dryer_type ?? '')
  const dryerLabel = dryerType === 'new' ? 'New Dryer' : 'Old Dryer'
  const subject    = `Shakti Synergetics — Dryer Record | ${dryerLabel} | ${v(payload.date)} | Operator: ${v(payload.operator)} | Incharge: ${v(payload.incharge)}`
  const html       = buildHtml(payload)

  const toList = toRaw.split(',').map(s => s.trim()).filter(Boolean)
  const ccList = ccRaw ? ccRaw.split(',').map(s => s.trim()).filter(Boolean) : []

  const boundary = `----=_Part_${Date.now()}`
  const rawLines = [
    `From: Shakti Synergetics <${sender}>`,
    `To: ${toList.join(', ')}`,
    ...(ccList.length ? [`Cc: ${ccList.join(', ')}`] : []),
    `Subject: ${subject}`,
    'MIME-Version: 1.0',
    `Content-Type: multipart/alternative; boundary="${boundary}"`,
    '',
    `--${boundary}`,
    'Content-Type: text/html; charset=UTF-8',
    'Content-Transfer-Encoding: base64',
    '',
    btoa(unescape(encodeURIComponent(html))),
    '',
    `--${boundary}--`,
  ]
  const rawB64 = btoa(rawLines.join('\r\n'))
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
  console.log('[send-dryer-email] Sent. Message ID:', data.id)
}

// ── Write to retry queue ──────────────────────────────────────────────────────

async function queueForRetry(payload: Record<string, unknown>, errorMsg: string): Promise<void> {
  try {
    const sb = adminClient()
    const dryerLabel = payload.dryer_type === 'new' ? 'New Dryer' : 'Old Dryer'
    await sb.from('email_queue').insert({
      subject:       `[Dryer Log] ${dryerLabel} | ${v(payload.date)}`,
      payload,
      error:         errorMsg,
      next_retry_at: new Date(Date.now() + 5 * 60 * 1000).toISOString(), // 5 min
    })
    console.log('[send-dryer-email] Queued for retry.')
  } catch (e) {
    console.error('[send-dryer-email] Failed to queue for retry:', e)
  }
}

// ── Process retry queue ───────────────────────────────────────────────────────

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
        status:        'sent',
        last_tried_at: new Date().toISOString(),
        error:         null,
      }).eq('id', row.id)
      console.log(`[retry] Row ${row.id} sent successfully.`)
    } catch (e) {
      const msg        = e instanceof Error ? e.message : String(e)
      const newCount   = (row.retry_count ?? 0) + 1
      const isFinal    = newCount >= MAX_RETRIES
      const nextRetry  = new Date(Date.now() + 5 * 60 * 1000).toISOString()
      await sb.from('email_queue').update({
        status:        isFinal ? 'failed' : 'pending',
        retry_count:   newCount,
        last_tried_at: new Date().toISOString(),
        next_retry_at: nextRetry,
        error:         msg,
      }).eq('id', row.id)
      console.error(`[retry] Row ${row.id} failed (attempt ${newCount}): ${msg}`)
    }
  }
}

// ── Main handler ──────────────────────────────────────────────────────────────

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') {
    return new Response(null, {
      headers: {
        'Access-Control-Allow-Origin':  '*',
        'Access-Control-Allow-Methods': 'POST, OPTIONS',
        'Access-Control-Allow-Headers': 'Content-Type, Authorization',
      },
    })
  }

  try {
    const body = await req.json() as Record<string, unknown>

    // Retry mode — called by pg_cron every 5 minutes
    if (body._retry === true) {
      await processRetryQueue()
      return new Response(JSON.stringify({ ok: true, mode: 'retry' }), { status: 200 })
    }

    // Normal mode — called after Save Log Sheet
    try {
      await sendEmail(body)
      return new Response(JSON.stringify({ ok: true }), { status: 200 })
    } catch (e) {
      const msg = e instanceof Error ? e.message : String(e)
      console.error('[send-dryer-email] Send failed, queuing for retry:', msg)
      await queueForRetry(body, msg)
      // Still return 200 so the frontend save flow is never affected
      return new Response(JSON.stringify({ ok: false, queued: true, error: msg }), { status: 200 })
    }

  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e)
    console.error('[send-dryer-email] Unexpected error:', msg)
    return new Response(JSON.stringify({ error: msg }), { status: 500 })
  }
})
