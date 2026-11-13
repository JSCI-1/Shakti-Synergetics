/**
 * useSharedDraft — share an in-progress form between operators via Supabase.
 *
 * Table: operator_shared_draft (migration 058), one JSON blob per (section, date).
 *
 * Every sync cycle (debounced after local edits, every 15 s, and when the tab
 * becomes visible) does:
 *   1. read the shared blob
 *   2. 3-way merge  base (last agreed) / local (this browser) / remote
 *        - a value THIS operator changed since the last sync wins
 *        - otherwise the other operator's value is taken
 *   3. apply the merged result to local state, and upsert it if it differs
 *      from what is stored
 * When the shared row disappears (someone saved the permanent record, which
 * deletes it) after this browser had seen it, `onRemoteCleared` resets the form
 * so the same card is not saved twice.
 *
 * Keys 'id' and 'expanded' are local-owned: never synced, never compared.
 */

import { useEffect, useRef } from 'react'
import { supabase, supabaseReady } from '../supabaseClient'

const TABLE = 'operator_shared_draft'
const POLL_MS = 15000
const DEBOUNCE_MS = 1200
const SUPPRESS_MS = 8000
const LOCAL_KEYS = new Set(['id', 'expanded'])

const isObj = v => v !== null && typeof v === 'object' && !Array.isArray(v)
const isBlank = v => v === undefined || v === null || v === '' || v === false

/** Canonical string: sorted keys, local-owned keys omitted. */
export function canon(v) {
  return JSON.stringify(v, (k, val) => {
    if (LOCAL_KEYS.has(k)) return undefined
    if (isObj(val)) {
      const out = {}
      Object.keys(val).sort().forEach(key => { out[key] = val[key] })
      return out
    }
    return val
  })
}

const same = (a, b) => canon(a) === canon(b)

function mergeLeaf(base, local, remote) {
  if (same(local, remote)) return local
  if (base === undefined) return isBlank(local) ? remote : local
  return same(local, base) ? remote : local
}

/** 3-way merge of JSON values. Arrays are matched by index. */
export function merge3(base, local, remote) {
  if (isObj(local) && isObj(remote)) {
    const b = isObj(base) ? base : {}
    const out = {}
    new Set([...Object.keys(local), ...Object.keys(remote)]).forEach(k => {
      const v = LOCAL_KEYS.has(k)
        ? (local[k] !== undefined ? local[k] : remote[k])
        : merge3(b[k], local[k], remote[k])
      if (v !== undefined) out[k] = v
    })
    return out
  }
  if (Array.isArray(local) && Array.isArray(remote)) {
    const b = Array.isArray(base) ? base : null
    let n = Math.max(local.length, remote.length)
    if (b) {
      const lc = local.length !== b.length
      const rc = remote.length !== b.length
      if (lc && !rc) n = local.length
      else if (rc && !lc) n = remote.length
    }
    const out = []
    for (let i = 0; i < n; i++) {
      const v = merge3(b ? b[i] : undefined, local[i], remote[i])
      if (v !== undefined) out.push(v)
    }
    return out
  }
  return mergeLeaf(base, local, remote)
}

/** True when the logged-in profile (localStorage 'jsci_user') is an admin. */
export function isAdminUser() {
  try {
    return JSON.parse(localStorage.getItem('jsci_user') || '{}')?.role === 'admin'
  } catch {
    return false
  }
}

/** Latest saved row of `table` for `column = date` (null when none / on error). */
export async function fetchLatestSaved(table, column, date) {
  if (!supabaseReady || !supabase || !date) return null
  try {
    const res = await supabase
      .from(table)
      .select('*')
      .eq(column, date)
      .order('created_at', { ascending: false })
      .limit(1)
    if (res.error || !res.data || res.data.length === 0) return null
    return res.data[0]
  } catch {
    return null
  }
}

/** Delete the shared working draft (call after the permanent record is saved). */
export async function deleteSharedDraft(section, date) {
  if (!supabaseReady || !supabase || !date) return
  try {
    const res = await supabase.from(TABLE).delete().eq('section', section).eq('log_date', date)
    if (res.error) console.warn('shared draft delete failed:', res.error.message)
  } catch { /* non-fatal */ }
}

/**
 * @param {object}   o
 * @param {string}   o.section         'batch_job_card' | 'slurry_mills' | 'slurry_motor'
 * @param {string}   o.date            yyyy-mm-dd (nothing syncs while empty)
 * @param {object}   o.blob            current local blob (plain JSON)
 * @param {Function} o.hasData         (blob) => bool — skip first upload while empty
 * @param {Function} o.apply           (mergedBlob) => void — write merged blob to local state
 * @param {Function} o.onRemoteCleared () => void — shared row was deleted by someone else
 * @returns {{ suppress: Function }}   suppress() — call right before a permanent save
 */
export function useSharedDraft({ section, date, blob, hasData, apply, onRemoteCleared, loadSaved }) {
  const latest = useRef({})
  latest.current = { blob, hasData, apply, onRemoteCleared, loadSaved }

  const base = useRef(undefined)         // last agreed blob
  const seenRemote = useRef(false)
  const savedTried = useRef(false)       // looked up the saved record for this date
  const savedPending = useRef(false)     // saved record just applied; take baseline next sync
  const savedBaseline = useRef(null)     // canon() of the form as loaded from the saved record
  const inFlight = useRef(false)
  const suppressUntil = useRef(0)
  const syncRef = useRef(null)

  syncRef.current = async () => {
    if (!supabaseReady || !supabase || !date) return
    if (Date.now() < suppressUntil.current) return
    if (inFlight.current) return
    inFlight.current = true
    try {
      const res = await supabase
        .from(TABLE)
        .select('data')
        .eq('section', section)
        .eq('log_date', date)
        .maybeSingle()
      if (res.error) return
      if (Date.now() < suppressUntil.current) return

      const { blob: local, hasData: has, apply: doApply, onRemoteCleared: cleared } = latest.current
      const remote = res.data && isObj(res.data.data) && Object.keys(res.data.data).length > 0
        ? res.data.data
        : null

      if (!remote) {
        if (seenRemote.current) {
          // Someone saved the permanent record — drop our stale copy.
          seenRemote.current = false
          base.current = undefined
          cleared()
          return
        }
        // Nothing shared for this date. If the form is empty, show the SAVED
        // record for that date instead (e.g. admin picks a past date).
        if (savedPending.current) {
          // The saved record has been applied; remember how the form looks so
          // it is not re-uploaded as a "draft". Only later edits are shared.
          savedPending.current = false
          savedBaseline.current = canon(local)
          return
        }
        if (!has(local) && !savedTried.current && latest.current.loadSaved && isAdminUser()) {
          savedTried.current = true
          const saved = await latest.current.loadSaved(date)
          if (saved) {
            base.current = saved
            savedPending.current = true
            doApply(saved)
            return
          }
        }
        if (!has(local)) return
        if (savedBaseline.current !== null && canon(local) === savedBaseline.current) return
        const up = await supabase.from(TABLE).upsert(
          { section, log_date: date, data: local, updated_at: new Date().toISOString() },
          { onConflict: 'section,log_date' }
        )
        if (!up.error) { seenRemote.current = true; base.current = local }
        return
      }

      seenRemote.current = true
      const merged = merge3(base.current, local, remote)
      base.current = merged
      if (!same(merged, local)) doApply(merged)
      if (!same(merged, remote)) {
        await supabase.from(TABLE).upsert(
          { section, log_date: date, data: merged, updated_at: new Date().toISOString() },
          { onConflict: 'section,log_date' }
        )
      }
    } catch {
      /* non-fatal — local draft still holds the data */
    } finally {
      inFlight.current = false
    }
  }

  // New section/date → forget sync state, sync now, then poll.
  useEffect(() => {
    base.current = undefined
    seenRemote.current = false
    savedTried.current = false
    savedPending.current = false
    savedBaseline.current = null
    if (!supabaseReady || !supabase || !date) return undefined
    syncRef.current()
    const id = setInterval(() => syncRef.current(), POLL_MS)
    const onVisible = () => { if (document.visibilityState === 'visible') syncRef.current() }
    document.addEventListener('visibilitychange', onVisible)
    return () => {
      clearInterval(id)
      document.removeEventListener('visibilitychange', onVisible)
    }
  }, [section, date])

  // Local edit → debounced sync (pushes our change, pulls theirs).
  const blobKey = canon(blob)
  useEffect(() => {
    if (!supabaseReady || !supabase || !date) return undefined
    const t = setTimeout(() => syncRef.current(), DEBOUNCE_MS)
    return () => clearTimeout(t)
  }, [blobKey, date])

  return {
    suppress() {
      suppressUntil.current = Date.now() + SUPPRESS_MS
      seenRemote.current = false
      base.current = undefined
    },
  }
}
