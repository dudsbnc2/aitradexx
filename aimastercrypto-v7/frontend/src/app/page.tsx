'use client'

import { useEffect } from 'react'
import { useRouter } from 'next/navigation'
import { getAccessToken, initAuth } from '@/lib/auth-manager'

export default function HomePage() {
  const router = useRouter()

  useEffect(() => {
    const token = getAccessToken()
    if (token) {
      // já autenticado — ir para dashboard (ajusta o path se necessário)
      router.replace('/login?redirect=/')
    } else {
      initAuth().then((renewed) => {
        if (renewed) {
          router.replace('/login?redirect=/')
        } else {
          router.replace('/login')
        }
      })
    }
  }, [router])

  return (
    <div className="min-h-screen flex items-center justify-center" style={{ background: '#020b14' }}>
      <div className="w-10 h-10 rounded-full border-2 border-[#00d4ff]/30 border-t-[#00d4ff] animate-spin" />
    </div>
  )
}
