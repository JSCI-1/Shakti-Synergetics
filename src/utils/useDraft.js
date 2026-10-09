/**
 * useDraft — persist a form state as a draft in localStorage.
 *
 * Usage:
 *   const [form, setForm, clearDraft] = useDraft('draft:user1:qc:fg', emptyForm())
 *
 * - Restores the saved draft on mount (if one exists, is valid JSON, and matches DRAFT_VERSION).
 * - Auto-saves 600 ms after every state change (debounced).
 * - All reads/writes are wrapped in try/catch; storage failures are silent.
 * - Drafts are stored as { v: DRAFT_VERSION, d: <state> }. Any draft without a matching
 *   version is discarded and the key is removed — prevents crashes from stale formats.
 *
 * @param {string}         key          localStorage key
 * @param {any|() => any}  initialValue Value or factory used when no draft exists
 * @returns {[any, Function, Function]}  [state, setState, clearDraft]
 */

import { useState, useEffect, useRef, useCallback } from 'react'

// Bump this whenever the stored shape changes in a breaking way.
export const DRAFT_VERSION = 2

const DRAFT_DEBOUNCE_MS = 600

// ── internal helpers ────────────────────────────────────────

function readDraft(key) {
  try {
    const raw = localStorage.getItem(key)
    if (raw === null) return undefined

    const parsed = JSON.parse(raw)

    // Support old unversioned drafts (plain object / array) — discard them.
    if (parsed === null || typeof parsed !== 'object' || Array.isArray(parsed)) {
      localStorage.removeItem(key)
      return undefined
    }

    // Version check — discard drafts from older formats.
    if (parsed.v !== DRAFT_VERSION) {
      localStorage.removeItem(key)
      return undefined
    }

    return parsed.d
  } catch {
    // JSON.parse failed or localStorage unavailable
    try { localStorage.removeItem(key) } catch { /* silent */ }
    return undefined
  }
}

function writeDraft(key, value) {
  try {
    localStorage.setItem(key, JSON.stringify({ v: DRAFT_VERSION, d: value }))
  } catch {
    // Quota exceeded or private mode — silently ignore
  }
}

function removeDraft(key) {
  try {
    localStorage.removeItem(key)
  } catch { /* silent */ }
}

function resolve(v) {
  return typeof v === 'function' ? v() : v
}

// ── main hook ───────────────────────────────────────────────

export function useDraft(key, initialValue) {
  // Keep a stable ref to the factory/value so clearDraft always resets correctly
  const initRef = useRef(initialValue)

  const [state, setState] = useState(() => {
    const saved = readDraft(key)
    if (saved !== undefined) return saved
    return resolve(initRef.current)
  })

  // Re-load draft when key changes (e.g. user switches)
  const prevKeyRef = useRef(key)
  useEffect(() => {
    if (key === prevKeyRef.current) return
    prevKeyRef.current = key
    const saved = readDraft(key)
    setState(saved !== undefined ? saved : resolve(initRef.current))
  }, [key])

  // Keep keyRef current for the debounced writer
  const keyRef = useRef(key)
  useEffect(() => { keyRef.current = key }, [key])

  // Debounced auto-save — 600 ms after last state change
  const timerRef = useRef(null)
  useEffect(() => {
    clearTimeout(timerRef.current)
    timerRef.current = setTimeout(() => {
      writeDraft(keyRef.current, state)
    }, DRAFT_DEBOUNCE_MS)
    return () => clearTimeout(timerRef.current)
  }, [state])

  // clearDraft: remove from storage and reset to initial value
  const clearDraft = useCallback(() => {
    removeDraft(keyRef.current)
    setState(resolve(initRef.current))
  }, [])

  return [state, setState, clearDraft]
}

// ── utilities ───────────────────────────────────────────────

/**
 * clearAllDraftsForUser(userId)
 * Called on logout — removes every draft key belonging to this user.
 */
export function clearAllDraftsForUser(userId) {
  try {
    const prefix = `draft:${userId}:`
    const toRemove = []
    for (let i = 0; i < localStorage.length; i++) {
      const k = localStorage.key(i)
      if (k && k.startsWith(prefix)) toRemove.push(k)
    }
    toRemove.forEach(k => localStorage.removeItem(k))
  } catch { /* silent */ }
}

/**
 * clearDraftKey(key) — remove a single draft key directly.
 */
export function clearDraftKey(key) {
  removeDraft(key)
}

/**
 * useUserId()
 * Returns the current logged-in user's ID from localStorage.
 * Falls back to 'guest' if not set.
 */
export function useUserId() {
  try {
    return localStorage.getItem('draft_uid') || 'guest'
  } catch {
    return 'guest'
  }
}
