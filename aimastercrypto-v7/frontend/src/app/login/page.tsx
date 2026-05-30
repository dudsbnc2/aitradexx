'use client'

import { useState, useEffect } from 'react'
import { useRouter, useSearchParams } from 'next/navigation'
import { Brain, LogIn, UserPlus, RefreshCw, Eye, EyeOff, X } from 'lucide-react'
import { login, register, getMe } from '@/lib/api'

export default function LoginPage() {
  const router = useRouter()
  const searchParams = useSearchParams()
  const redirect = searchParams.get('redirect') || '/'

  const [mode, setMode] = useState<'login' | 'register'>('login')
  const [email, setEmail] = useState('')
  const [username, setUsername] = useState('')
  const [password, setPassword] = useState('')
  const [showPass, setShowPass] = useState(false)
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState('')
  const [checking, setChecking] = useState(true)

  // V7: verificar via auth-manager em vez de localStorage
  useEffect(() => {
    import('@/lib/auth-manager').then(({ getAccessToken, initAuth }) => {
      const token = getAccessToken()
      if (token) {
        getMe().then(() => router.replace(redirect)).catch(() => setChecking(false))
      } else {
        // Tentar renovar via httpOnly cookie
        initAuth().then((renewed) => {
          if (renewed) {
            getMe().then(() => router.replace(redirect)).catch(() => setChecking(false))
          } else {
            setChecking(false)
          }
        })
      }
    })
  }, [redirect, router])

  const handleSubmit = async () => {
    if (!email || !password) { setError('Fill in all fields'); return }
    if (mode === 'register' && !username) { setError('Username is required'); return }
    setLoading(true)
    setError('')
    try {
      let data: any
      if (mode === 'login') {
        data = await login(email, password)
      } else {
        data = await register(email, username, password)
      }

      if (data.requires_verification) {
        router.push(`/verify-email?email=${encodeURIComponent(email)}`)
        return
      }
      router.replace(redirect)
    } catch (e: any) {
      setError(e?.response?.data?.detail || 'Authentication failed. Check your credentials.')
    } finally {
      setLoading(false)
    }
  }

  if (checking) {
    return (
      <div className="min-h-screen flex items-center justify-center" style={{ background: '#020b14' }}>
        <div className="w-10 h-10 rounded-full border-2 border-[#00d4ff]/30 border-t-[#00d4ff] animate-spin" />
      </div>
    )
  }

  return (
    <div className="min-h-screen flex items-center justify-center p-4" style={{ background: '#020b14' }}>
      {/* Ambient */}
      <div className="fixed inset-0 pointer-events-none">
        <div className="absolute top-1/4 left-1/3 w-96 h-96 rounded-full opacity-[0.04] blur-3xl"
          style={{ background: 'radial-gradient(circle, #00d4ff, transparent)' }} />
        <div className="absolute bottom-1/4 right-1/3 w-80 h-80 rounded-full opacity-[0.04] blur-3xl"
          style={{ background: 'radial-gradient(circle, #b366ff, transparent)' }} />
      </div>

      <div className="w-full max-w-md relative">
        {/* Logo */}
        <div className="text-center mb-8">
          <div className="inline-flex items-center justify-center w-14 h-14 rounded-2xl mb-4"
            style={{ background: 'linear-gradient(135deg, #00d4ff, #0066aa)' }}>
            <Brain size={28} className="text-white" />
          </div>
          <h1 className="text-2xl font-bold text-[#e8f4ff]">AIMasterCrypto</h1>
          <p className="text-xs font-mono text-[#3d5a73] mt-1 uppercase tracking-widest">Institutional AI Trading</p>
        </div>

        {/* Card */}
        <div style={{ background: '#0a1f35', border: '1px solid #1a3a5c', borderRadius: 16 }}>
          {/* Tabs */}
          <div className="flex gap-1 p-4 pb-0">
            {(['login', 'register'] as const).map((m) => (
              <button key={m} onClick={() => { setMode(m); setError('') }}
                className="flex-1 py-2.5 rounded-lg text-xs font-bold font-mono transition-all"
                style={mode === m ? {
                  background: '#00d4ff15', border: '1px solid #00d4ff40', color: '#00d4ff'
                } : {
                  background: 'transparent', border: '1px solid transparent', color: '#8ba3be'
                }}>
                {m === 'login' ? 'Sign In' : 'Create Account'}
              </button>
            ))}
          </div>

          <div className="p-6 space-y-4">
            <div>
              <label className="block text-[10px] font-mono uppercase tracking-widest text-[#8ba3be] mb-1.5">Email</label>
              <input
                type="email" value={email} onChange={(e) => setEmail(e.target.value)}
                placeholder="email@example.com"
                className="w-full rounded-lg px-4 py-3 text-sm font-mono text-[#e8f4ff] outline-none transition-colors"
                style={{ background: '#071524', border: '1px solid #1a3a5c' }}
                onFocus={(e) => e.target.style.borderColor = '#00d4ff'}
                onBlur={(e) => e.target.style.borderColor = '#1a3a5c'}
              />
            </div>

            {mode === 'register' && (
              <div>
                <label className="block text-[10px] font-mono uppercase tracking-widest text-[#8ba3be] mb-1.5">Username</label>
                <input
                  type="text" value={username} onChange={(e) => setUsername(e.target.value)}
                  placeholder="your_username"
                  className="w-full rounded-lg px-4 py-3 text-sm font-mono text-[#e8f4ff] outline-none transition-colors"
                  style={{ background: '#071524', border: '1px solid #1a3a5c' }}
                  onFocus={(e) => e.target.style.borderColor = '#00d4ff'}
                  onBlur={(e) => e.target.style.borderColor = '#1a3a5c'}
                />
              </div>
            )}

            <div>
              <label className="block text-[10px] font-mono uppercase tracking-widest text-[#8ba3be] mb-1.5">Password</label>
              <div className="relative">
                <input
                  type={showPass ? 'text' : 'password'} value={password}
                  onChange={(e) => setPassword(e.target.value)}
                  placeholder="••••••••"
                  onKeyDown={(e) => e.key === 'Enter' && handleSubmit()}
                  className="w-full rounded-lg px-4 py-3 pr-12 text-sm font-mono text-[#e8f4ff] outline-none transition-colors"
                  style={{ background: '#071524', border: '1px solid #1a3a5c' }}
                  onFocus={(e) => e.target.style.borderColor = '#00d4ff'}
                  onBlur={(e) => e.target.style.borderColor = '#1a3a5c'}
                />
                <button onClick={() => setShowPass(!showPass)}
                  className="absolute right-3 top-1/2 -translate-y-1/2 text-[#3d5a73] hover:text-[#8ba3be] transition-colors">
                  {showPass ? <EyeOff size={16} /> : <Eye size={16} />}
                </button>
              </div>
            </div>

            {error && (
              <div className="flex items-start gap-2 text-xs text-[#ff4466] font-mono rounded-lg p-3"
                style={{ background: '#ff446610', border: '1px solid #ff446620' }}>
                <X size={12} className="mt-0.5 shrink-0" />
                {error}
              </div>
            )}

            <button onClick={handleSubmit} disabled={loading}
              className="w-full py-3 rounded-lg font-bold text-sm transition-all disabled:opacity-40 flex items-center justify-center gap-2"
              style={{ background: 'linear-gradient(135deg, #00d4ff25, #0099bb20)', border: '1px solid #00d4ff50', color: '#00d4ff' }}>
              {loading ? <RefreshCw size={14} className="animate-spin" /> :
                mode === 'login' ? <LogIn size={14} /> : <UserPlus size={14} />}
              {loading ? 'Processing...' : mode === 'login' ? 'Sign In' : 'Create Account'}
            </button>

            {mode === 'register' && (
              <p className="text-[10px] text-[#3d5a73] font-mono text-center leading-relaxed">
                A verification code will be sent to your email. Your account will be activated after confirmation.
              </p>
            )}
          </div>
        </div>

        <p className="text-center text-[10px] font-mono text-[#1a3a5c] mt-6">
          AIMasterCrypto © 2025 · Not financial advice
        </p>
      </div>
    </div>
  )
}
