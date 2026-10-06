import { useState } from 'react'
import { supabase } from '../supabaseClient.js'
import './LoginPage.css'

// Normalise to E.164 with +91 prefix
function toE164(raw) {
  const digits = raw.replace(/\D/g, '')
  if (digits.length === 10) return `+91${digits}`
  if (digits.startsWith('91') && digits.length === 12) return `+${digits}`
  return `+91${digits}`
}

export default function LoginPage({ onLogin }) {
  const [step,    setStep]    = useState('phone') // 'phone' | 'otp'
  const [phone,   setPhone]   = useState('')
  const [otp,     setOtp]     = useState('')
  const [loading, setLoading] = useState(false)
  const [error,   setError]   = useState('')
  const [info,    setInfo]    = useState('')

  // ── Step 1: send OTP via Supabase Auth (hooks into your SMS provider) ──
  async function handleSendOTP(e) {
    e.preventDefault()
    setError('')
    const fullPhone = toE164(phone)
    setLoading(true)
    const { error: err } = await supabase.auth.signInWithOtp({ phone: fullPhone })
    setLoading(false)
    if (err) { setError(err.message); return }
    setInfo(`OTP sent to ${fullPhone} via WhatsApp`)
    setStep('otp')
  }

  // ── Step 2: verify OTP, then load the app_users profile ──
  async function handleVerifyOTP(e) {
    e.preventDefault()
    setError('')
    const fullPhone = toE164(phone)
    setLoading(true)

    // Verify with Supabase Auth
    const { error: verifyErr } = await supabase.auth.verifyOtp({
      phone: fullPhone,
      token: otp.trim(),
      type:  'sms',
    })
    if (verifyErr) { setLoading(false); setError(verifyErr.message); return }

    // Load profile from app_users
    // The phone is stored as '+91 XXXXXXXXXX' (with a space) in your table
    // Try both formats to be safe
    const { data: profile, error: profileErr } = await supabase
      .from('app_users')
      .select('id, name, role, sections, is_active')
      .or(`phone.eq.${fullPhone},phone.eq.${fullPhone.replace('+91', '+91 ')}`)
      .eq('is_active', true)
      .limit(1)
      .single()

    setLoading(false)

    if (profileErr || !profile) {
      setError('This number is not registered. Contact admin.')
      await supabase.auth.signOut()
      return
    }

    // Persist session in localStorage so App.jsx can restore it on reload
    localStorage.setItem('jsci_user', JSON.stringify(profile))
    onLogin(profile)
  }

  function handleBack() {
    setStep('phone'); setOtp(''); setError(''); setInfo('')
  }

  return (
    <div className="login-bg">
      <div className="login-card">

        <div className="login-header">
          <div className="login-logo"></div>
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
                placeholder="9876543210"
                value={phone}
                onChange={e => setPhone(e.target.value)}
                maxLength={10}
                autoFocus
                inputMode="numeric"
              />
            </div>
            {error && <div className="login-error">{error}</div>}
            <button type="submit" className="login-btn"
              disabled={loading || phone.replace(/\D/g,'').length < 10}>
              {loading ? 'Sending…' : 'Send OTP via WhatsApp'}
            </button>
            <p className="login-note">
              You will receive a 6-digit OTP on WhatsApp.
              Only registered numbers can log in.
            </p>
          </form>
        ) : (
          <form onSubmit={handleVerifyOTP} className="login-form">
            {info && <div className="login-info">{info}</div>}
            <label className="login-label">
              Enter OTP / <span className="login-label-hi">OTP दर्ज करें</span>
            </label>
            <input
              className="login-input login-otp-input"
              type="number"
              placeholder="6-digit code"
              value={otp}
              onChange={e => setOtp(e.target.value)}
              autoFocus
              inputMode="numeric"
            />
            {error && <div className="login-error">{error}</div>}
            <button type="submit" className="login-btn"
              disabled={loading || otp.trim().length < 6}>
              {loading ? 'Verifying…' : 'Verify OTP / सत्यापित करें'}
            </button>
            <button type="button" className="login-back-btn" onClick={handleBack}>
              ← Change number / नंबर बदलें
            </button>
          </form>
        )}

      </div>
    </div>
  )
}
