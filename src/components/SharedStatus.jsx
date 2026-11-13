import React from 'react'

/**
 * SharedStatus — one-line live-sharing indicator for a form that uses
 * useSharedDraft. Shows whether this browser's values are reaching the other
 * operators and the admin.
 *
 * Props:
 *   date      yyyy-mm-dd the form is keyed by ('' → nothing is shared yet)
 *   syncInfo  { at: Date|null, error: string } from useSharedDraft()
 */
export default function SharedStatus({ date, syncInfo }) {
  const info = syncInfo || { at: null, error: '' }
  let content
  if (!date) {
    content = (
      <span style={{ color: '#b42318', fontWeight: 600 }}>
        ⚠ Select the Date to share this form with other operators and the admin /
        {' '}अन्य ऑपरेटर और एडमिन के साथ साझा करने के लिए तारीख चुनें
      </span>
    )
  } else if (info.error) {
    content = (
      <span style={{ color: '#b42318', fontWeight: 600 }}>
        ⚠ Not shared — {info.error}
      </span>
    )
  } else if (info.at) {
    content = (
      <span style={{ color: '#027a48' }}>
        ✓ Shared live for {date.split('-').reverse().join('/')} · last sync{' '}
        {info.at.toLocaleTimeString('en-IN', {
          hour: '2-digit', minute: '2-digit', second: '2-digit', hour12: true,
        })}
      </span>
    )
  } else {
    content = <span style={{ color: '#667085' }}>Connecting… / कनेक्ट हो रहा है…</span>
  }
  return (
    <div style={{ margin: '6px 0 10px', fontSize: 12 }} role="status" aria-live="polite">
      {content}
    </div>
  )
}
