import React, { useState, useEffect, useRef } from 'react'
import { supabase } from '../supabaseClient.js'
import './LoginPage.css'

const RESEND_SECONDS = 30

// Format: 9876543210 → 98765 43210
function formatPhone(digits) {
  if (digits.length <= 5) return digits
  return digits.slice(0, 5) + ' ' + digits.slice(5)
}

export default function LoginPage({ onLogin }) {
  const [step,    setStep]    = useState('phone')
  const [company, setCompany] = useState('')
  const [phone,   setPhone]   = useState('')
  const [otp,     setOtp]     = useState('')
  const [loading, setLoading] = useState(false)
  const [error,   setError]   = useState('')
  const [resend,  setResend]  = useState(0)
  const timerRef = useRef(null)

  useEffect(() => {
    if (resend <= 0) { clearInterval(timerRef.current); return }
    timerRef.current = setInterval(() => setResend(s => s - 1), 1000)
    return () => clearInterval(timerRef.current)
  }, [resend])

  const phoneDigits = phone.replace(/\D/g, '')
  const fullPhone   = '+91' + phoneDigits

  async function sendOtp() {
    setError('')
    setLoading(true)
    const { error: err } = await supabase.auth.signInWithOtp({ phone: fullPhone })
    setLoading(false)
    if (err) { setError(err.message); return false }
    setResend(RESEND_SECONDS)
    return true
  }

  async function handleSendOTP(e) {
    e.preventDefault()
    const ok = await sendOtp()
    if (ok) setStep('otp')
  }

  async function handleResend(e) {
    e.preventDefault()
    setOtp('')
    await sendOtp()
  }

  async function handleVerifyOTP(e) {
    e.preventDefault()
    setError('')
    setLoading(true)

    const { error: verifyErr } = await supabase.auth.verifyOtp({
      phone: fullPhone, token: otp.trim(), type: 'sms',
    })

    if (verifyErr) {
      setLoading(false)
      const msg = verifyErr.message?.toLowerCase() || ''
      if (msg.includes('expired'))
        setError('OTP expired. Please resend. / OTP समाप्त हो गया।')
      else if (msg.includes('invalid') || msg.includes('incorrect') || msg.includes('wrong'))
        setError('Incorrect OTP. Please try again. / गलत OTP।')
      else
        setError(verifyErr.message)
      return
    }

    const { data: profile, error: profileErr } = await supabase
      .from('app_users')
      .select('id, name, role, sections, is_active')
      .eq('phone', fullPhone)
      .maybeSingle()

    setLoading(false)

    if (profileErr || !profile) {
      setError('This number is not registered. Contact admin. / यह नंबर पंजीकृत नहीं है।')
      await supabase.auth.signOut()
      return
    }
    if (!profile.is_active) {
      setError('Your account is inactive. Contact admin. / खाता निष्क्रिय है।')
      await supabase.auth.signOut()
      return
    }

    localStorage.setItem('jsci_user', JSON.stringify(profile))
    localStorage.setItem('draft_uid', profile.id)
    onLogin(profile)
  }

  function handleBack() {
    setStep('phone'); setOtp(''); setError('')
    clearInterval(timerRef.current); setResend(0)
  }

  return (
    <div className="login-bg">
      <div className="login-card">

        <div className="login-header">
          <div className="login-logo">
            <img src="/logo.png" alt="Jaishil Logo" className="login-logo-img" />
          </div>
          <h2 className="login-title">
            Sign in / <span className="login-title-hi">लॉगिन</span>
          </h2>
          <p className="login-brand">JSCI — Shakti Synergetics</p>
          <p className="login-subtitle">Nashik · Plot D-73, Ambad</p>
        </div>

        {step === 'phone' ? (

          <form onSubmit={handleSendOTP} className="login-form">
            <label className="login-label">
              Mobile Number / <span className="login-label-hi">मोबाइल नंबर</span>
            </label>
            <div className="login-phone-row">
              <span className="login-prefix">+91</span>
              <input
                className="login-input"
                type="tel"
                placeholder="98765 43210"
                value={phone}
                onChange={e => setPhone(e.target.value.replace(/\D/g, '').slice(0, 10))}
                maxLength={10}
                autoFocus
                inputMode="numeric"
                autoComplete="tel-national"
              />
            </div>

            {error && <div className="login-error">{error}</div>}

            <button
              type="submit"
              className="login-btn login-btn-wa"
              disabled={loading || phoneDigits.length < 10}
            >
              {loading ? (
                <span className="login-btn-inner">
                  <span className="login-spinner" /> Sending…
                </span>
              ) : (
                <span className="login-btn-inner">
                  <svg className="login-wa-icon" viewBox="0 0 24 24" fill="currentColor">
                    <path d="M17.472 14.382c-.297-.149-1.758-.867-2.03-.967-.273-.099-.471-.148-.67.15-.197.297-.767.966-.94 1.164-.173.199-.347.223-.644.075-.297-.15-1.255-.463-2.39-1.475-.883-.788-1.48-1.761-1.653-2.059-.173-.297-.018-.458.13-.606.134-.133.298-.347.446-.52.149-.174.198-.298.298-.497.099-.198.05-.371-.025-.52-.075-.149-.669-1.612-.916-2.207-.242-.579-.487-.5-.669-.51-.173-.008-.371-.01-.57-.01-.198 0-.52.074-.792.372-.272.297-1.04 1.016-1.04 2.479 0 1.462 1.065 2.875 1.213 3.074.149.198 2.096 3.2 5.077 4.487.709.306 1.262.489 1.694.625.712.227 1.36.195 1.871.118.571-.085 1.758-.719 2.006-1.413.248-.694.248-1.289.173-1.413-.074-.124-.272-.198-.57-.347z"/>
                    <path d="M12 0C5.373 0 0 5.373 0 12c0 2.123.553 4.112 1.522 5.836L.057 23.273a.75.75 0 0 0 .92.92l5.437-1.465A11.953 11.953 0 0 0 12 24c6.627 0 12-5.373 12-12S18.627 0 12 0zm0 22c-1.907 0-3.693-.512-5.228-1.404l-.374-.22-3.878 1.046 1.046-3.878-.22-.374A9.953 9.953 0 0 1 2 12C2 6.477 6.477 2 12 2s10 4.477 10 10-4.477 10-10 10z"/>
                  </svg>
                  Send OTP on WhatsApp
                </span>
              )}
            </button>

            <p className="login-note">
              6-digit OTP will be sent to your WhatsApp.<br />
              <span className="login-note-hi">केवल पंजीकृत नंबर लॉगिन कर सकते हैं।</span>
            </p>
          </form>

        ) : (

          <form onSubmit={handleVerifyOTP} className="login-form">

            {/* WhatsApp sent banner */}
            <div className="login-wa-banner">
              <svg className="login-wa-banner-icon" viewBox="0 0 24 24" fill="currentColor">
                <path d="M17.472 14.382c-.297-.149-1.758-.867-2.03-.967-.273-.099-.471-.148-.67.15-.197.297-.767.966-.94 1.164-.173.199-.347.223-.644.075-.297-.15-1.255-.463-2.39-1.475-.883-.788-1.48-1.761-1.653-2.059-.173-.297-.018-.458.13-.606.134-.133.298-.347.446-.52.149-.174.198-.298.298-.497.099-.198.05-.371-.025-.52-.075-.149-.669-1.612-.916-2.207-.242-.579-.487-.5-.669-.51-.173-.008-.371-.01-.57-.01-.198 0-.52.074-.792.372-.272.297-1.04 1.016-1.04 2.479 0 1.462 1.065 2.875 1.213 3.074.149.198 2.096 3.2 5.077 4.487.709.306 1.262.489 1.694.625.712.227 1.36.195 1.871.118.571-.085 1.758-.719 2.006-1.413.248-.694.248-1.289.173-1.413-.074-.124-.272-.198-.57-.347z"/>
                <path d="M12 0C5.373 0 0 5.373 0 12c0 2.123.553 4.112 1.522 5.836L.057 23.273a.75.75 0 0 0 .92.92l5.437-1.465A11.953 11.953 0 0 0 12 24c6.627 0 12-5.373 12-12S18.627 0 12 0zm0 22c-1.907 0-3.693-.512-5.228-1.404l-.374-.22-3.878 1.046 1.046-3.878-.22-.374A9.953 9.953 0 0 1 2 12C2 6.477 6.477 2 12 2s10 4.477 10 10-4.477 10-10 10z"/>
              </svg>
              <div className="login-wa-banner-text">
                <span className="login-wa-banner-title">OTP sent on WhatsApp</span>
                <span className="login-wa-banner-phone">+91 {formatPhone(phoneDigits)}</span>
              </div>
              <span className="login-wa-banner-check">✓</span>
            </div>

            <label className="login-label">
              Enter OTP / <span className="login-label-hi">OTP दर्ज करें</span>
            </label>
            <input
              className="login-input login-otp-input"
              type="text"
              inputMode="numeric"
              placeholder="_ _ _ _ _ _"
              value={otp}
              onChange={e => setOtp(e.target.value.replace(/\D/g, '').slice(0, 6))}
              maxLength={6}
              autoFocus
              autoComplete="one-time-code"
            />

            {error && <div className="login-error">{error}</div>}

            <button
              type="submit"
              className="login-btn"
              disabled={loading || otp.trim().length < 6}
            >
              {loading ? (
                <span className="login-btn-inner">
                  <span className="login-spinner" /> Verifying…
                </span>
              ) : 'Verify OTP / सत्यापित करें'}
            </button>

            <div className="login-resend-row">
              {resend > 0 ? (
                <span className="login-resend-timer">
                  Resend in <strong>{resend}s</strong>
                </span>
              ) : (
                <button type="button" className="login-link-btn" onClick={handleResend} disabled={loading}>
                  Resend OTP
                </button>
              )}
              <span className="login-resend-sep">·</span>
              <button type="button" className="login-link-btn" onClick={handleBack}>
                Change number
              </button>
            </div>

          </form>
        )}

      </div>
    </div>
  )
}
