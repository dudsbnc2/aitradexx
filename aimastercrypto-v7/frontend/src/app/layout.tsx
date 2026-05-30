'use client'

import type { Metadata, Viewport } from 'next'
import { Syne } from 'next/font/google'
import { useEffect } from 'react'
import '../styles/globals.css'
import { initAuth } from '@/lib/auth-manager'
import { useAuthExpiredRedirect } from '@/lib/api-interceptor'

const syne = Syne({
  subsets: ['latin'],
  weight: ['400', '500', '600', '700', '800'],
  variable: '--font-syne',
})

// Metadata não pode estar num client component — movido para metadata.ts separado
// Ver: https://nextjs.org/docs/app/api-reference/functions/generate-metadata

function AuthInitializer() {
  // Hook para redirecionar para /login quando access token expira
  useAuthExpiredRedirect('/login')

  useEffect(() => {
    // Tentar renovar access token via httpOnly cookie ao carregar a app
    initAuth()
  }, [])

  return null
}

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en" className={syne.variable}>
      <body>
        <AuthInitializer />
        {children}
      </body>
    </html>
  )
}
