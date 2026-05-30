'use client'

import { useState, useEffect, useRef, Suspense } from 'react'
import { useRouter, useSearchParams } from 'next/navigation'
import { Brain, RefreshCw, CheckCircle, X, Mail } from 'lucide-react'
import { verifyEmail, resendCode } from '@/lib/api'

function VerifyEmailPageInner() {
  const router = useRouter()
  const searchParams = useSearchParams()
  const email = searchParams.get('email') || ''

  const [code, setCode] = useState(['', '', '', '', '', ''])
  const [loading, setLoading] = useState(false)
  const [resending, setResending] = useState(false)
  const [error, setError] = useState('')
  const [success, setSuccess] = useState(false)
  const [countdown, setCountdown] = useState(60)
  const [canResend, setCanResend] = useState(false)
  const inputRefs = useRef<(HTMLInputElement | null)[]>([])

  useEffect(() => {
    if (countdown > 0) {
      const t = setTimeout(() => setCountdown(c => c - 1), 1000)
      return () => clearTimeout(t)
    } else {
      setCanResend(true)
    }
  }, [countdown])

  const handleChange = (index: number, value: string) => {
    if (!/^\d*$/.test(value)) return
    const newCode = [...code]
    newCode[index] = value.slice(-1)
    setCode(newCode)
    if (value && index < 5) inputRefs.current[index + 1]?.focus()
    if (newCode.every(d => d !== '')) handleVerify(newCode.join(''))
  }

  const handleKeyDown = (index: number, e: React.KeyboardEvent) => {
    if (e.key === 'Backspace' && !code[index] && index > 0) {
      inputRefs.current[index - 1]?.focus()
    }
  }

  const handlePaste = (e: React.ClipboardEvent) => {
    const pasted = e.clipboardData.getData('text').replace(/\D/g, '').slice(0, 6)
    if (pasted.length === 6) {
      setCode(pasted.split(''))
      handleVerify(pasted)
    }
  }

  const handleVerify = async (fullCode: string) => {
    if (fullCode.length !== 6) return
    setLoading(true)
    setError('')
    try {
      await verifyEmail(email, fullCode)
      setSuccess(true)
      setTimeout(() => router.replace('/'), 1500)
    } catch (e: any) {
      setError(e?.response?.data?.detail || 'Invalid code. Try again.')
      setCode(['', '', '', '', '', ''])
      inputRefs.current[0]?.focus()
    } finally {
      setLoading(false)
    }
  }

  const handleResend = async () => {
    setResending(true)
    setError('')
    try {
      await resendCode(email)
      setCountdown(60)
      setCanResend(false)
      setCode(['', '', '', '', '', ''])
      inputRefs.current[0]?.focus()
    } catch (e: any) {
      setError(e?.response?.data?.detail || 'Failed to resend. Try again later.')
    } finally {
      setResending(false)
    }
  }

  if (success) {
    return (
      <div className="min-h-screen flex items-center justify-center" style={{ background: '#020b14' }}>
        <div className="text-center">
          <div className="w-20 h-20 rounded-full flex items-center justify-center mx-auto mb-6"
            style={{ background: '#00ff8820', border: '2px solid #00ff8840' }}>
            <CheckCircle size={40} className="text-[#00ff88]" />
          </div>
          <h2 className="text-xl font-bold text-[#e8f4ff] mb-2">Email Verified!</h2>
          <p className="text-sm text-[#8ba3be] font-mono">Redirecting to dashboard...</p>
        </div>
      </div>
    )
  }

  return (
    <div className="min-h-screen flex items-center justify-center p-4" style={{ background: '#020b14' }}>
      <div className="fixed inset-0 pointer-events-none">
        <div className="absolute top-1/3 left-1/3 w-80 h-80 rounded-full opacity-[0.04] blur-3xl"
          style={{ background: 'radial-gradient(circle, #00d4ff, transparent)' }} />
      </div>

      <div className="w-full max-w-md relative">
        {/* Logo */}
        <div className="text-center mb-8">
          <div className="inline-flex items-center justify-center w-14 h-14 rounded-2xl mb-4"
            style={{ background: 'linear-gradient(135deg, #00d4ff, #0066aa)' }}>
            <Brain size={28} className="text-white" />
          </div>
          <h1 className="text-2xl font-bold text-[#e8f4ff]">Verify your email</h1>
          <p className="text-sm text-[#8ba3be] mt-2">We sent a 6-digit code to</p>
          <p className="text-sm font-mono text-[#00d4ff] mt-1">{email}</p>
        </div>

        <div style={{ background: '#0a1f35', border: '1px solid #1a3a5c', borderRadius: 16 }} className="p-6">
          {/* Mail icon */}
          <div className="flex justify-center mb-6">
            <div className="w-16 h-16 rounded-2xl flex items-center justify-center"
              style={{ background: '#00d4ff08', border: '1px solid #00d4ff20' }}>
              <Mail size={28} className="text-[#00d4ff]" />
            </div>
          </div>

          <p className="text-xs font-mono text-[#8ba3be] text-center mb-6">
            Enter the 6-digit verification code. It expires in 10 minutes.
          </p>

          {/* OTP Input */}
          <div className="flex gap-2 justify-center mb-6" onPaste={handlePaste}>
            {code.map((digit, i) => (
              <input
                key={i}
                ref={(el) => { inputRefs.current[i] = el }}
                type="text" inputMode="numeric" maxLength={1}
                value={digit}
                onChange={(e) => handleChange(i, e.target.value)}
                onKeyDown={(e) => handleKeyDown(i, e)}
                className="w-12 h-14 text-center text-2xl font-bold font-mono rounded-xl outline-none transition-all"
                style={{
                  background: '#071524',
                  border: `2px solid ${digit ? '#00d4ff' : '#1a3a5c'}`,
                  color: digit ? '#00d4ff' : '#e8f4ff',
                  boxShadow: digit ? '0 0 12px #00d4ff20' : 'none',
                }}
              />
            ))}
          </div>

          {error && (
            <div className="flex items-center gap-2 text-xs text-[#ff4466] font-mono rounded-lg p-3 mb-4"
              style={{ background: '#ff446610', border: '1px solid #ff446620' }}>
              <X size={12} className="shrink-0" />
              {error}
            </div>
          )}

          {loading && (
            <div className="flex items-center justify-center gap-2 py-2 mb-4">
              <RefreshCw size={14} className="animate-spin text-[#00d4ff]" />
              <span className="text-xs font-mono text-[#8ba3be]">Verifying...</span>
            </div>
          )}

          {/* Resend */}
          <div className="text-center">
            {canResend ? (
              <button onClick={handleResend} disabled={resending}
                className="text-xs font-mono text-[#00d4ff] hover:text-[#00d4ff]/70 transition-colors disabled:opacity-40 flex items-center gap-1.5 mx-auto">
                {resending && <RefreshCw size={12} className="animate-spin" />}
                Resend code
              </button>
            ) : (
              <span className="text-xs font-mono text-[#3d5a73]">
                Resend in <span className="text-[#8ba3be]">{countdown}s</span>
              </span>
            )}
          </div>
        </div>

        <div className="mt-6 text-center">
          <a href="/login" className="text-xs font-mono text-[#3d5a73] hover:text-[#8ba3be] transition-colors">
            ← Back to login
          </a>
        </div>
      </div>
    </div>
  )
}

export default function VerifyEmailPage() {
  return (
    <Suspense fallback={<div className="min-h-screen flex items-center justify-center" style={{ background: '#020b14' }}><div className="w-10 h-10 rounded-full border-2 border-[#00d4ff]/30 border-t-[#00d4ff] animate-spin" /></div>}>
      <VerifyEmailPageInner />
    </Suspense>
  )
}
