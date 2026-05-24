import type { Metadata, Viewport } from 'next'
import { Syne } from 'next/font/google'
import '../styles/globals.css'

const syne = Syne({
  subsets: ['latin'],
  weight: ['400', '500', '600', '700', '800'],
  variable: '--font-syne',
})

export const metadata: Metadata = {
  title: 'AIMasterCrypto — Institutional AI Trading',
  description: 'Professional AI-powered crypto trading signals, real-time scanner, and market intelligence.',
  keywords: ['crypto', 'trading', 'AI signals', 'cryptocurrency', 'bitcoin', 'trading signals'],
  manifest: '/manifest.json',
  icons: { icon: '/favicon.ico' },
  openGraph: {
    title: 'AIMasterCrypto',
    description: 'Institutional-grade AI crypto trading platform',
    url: 'https://aimastercrypto.com',
    siteName: 'AIMasterCrypto',
    type: 'website',
  },
}

export const viewport: Viewport = {
  width: 'device-width',
  initialScale: 1,
  themeColor: '#020b14',
}

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en" className={syne.variable}>
      <body>{children}</body>
    </html>
  )
}
