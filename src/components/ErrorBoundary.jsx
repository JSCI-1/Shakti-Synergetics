import React from 'react'

/**
 * ErrorBoundary — wraps a section so a runtime crash shows a fallback
 * instead of blanking the whole page.
 *
 * Usage:
 *   <ErrorBoundary label="Batch Operator">
 *     <SlurryWrapper />
 *   </ErrorBoundary>
 */
export default class ErrorBoundary extends React.Component {
  constructor(props) {
    super(props)
    this.state = { hasError: false, error: null }
  }

  static getDerivedStateFromError(error) {
    return { hasError: true, error }
  }

  componentDidCatch(error, info) {
    // Log to console so devs can see it in F12
    console.error(`[ErrorBoundary] ${this.props.label || 'Section'} crashed:`, error, info)
  }

  render() {
    if (this.state.hasError) {
      return (
        <div style={{
          margin: '2rem auto',
          maxWidth: 480,
          padding: '2rem',
          border: '1px solid #f5c6cb',
          borderRadius: 8,
          background: '#fff8f8',
          textAlign: 'center',
          fontFamily: 'sans-serif',
        }}>
          <div style={{ fontSize: 32, marginBottom: 8 }}>⚠️</div>
          <div style={{ fontWeight: 600, marginBottom: 6, color: '#721c24' }}>
            {this.props.label
              ? `"${this.props.label}" could not load`
              : 'Something went wrong'}
          </div>
          <div style={{ color: '#555', marginBottom: 16, fontSize: 13 }}>
            Please reload the page. If the problem persists, try clearing your browser's
            site data for this page.
          </div>
          {this.state.error && (
            <details style={{ textAlign: 'left', marginBottom: 16 }}>
              <summary style={{ cursor: 'pointer', color: '#888', fontSize: 12 }}>
                Error details
              </summary>
              <pre style={{
                fontSize: 11, color: '#c0392b', marginTop: 8,
                whiteSpace: 'pre-wrap', wordBreak: 'break-all',
              }}>
                {this.state.error.message}
              </pre>
            </details>
          )}
          <button
            onClick={() => window.location.reload()}
            style={{
              padding: '8px 20px', borderRadius: 6, border: 'none',
              background: '#007bff', color: '#fff', cursor: 'pointer', fontSize: 14,
            }}
          >
            Reload page
          </button>
        </div>
      )
    }

    return this.props.children
  }
}
