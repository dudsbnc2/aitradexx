'use client'

/**
 * ToastNotification.tsx
 * Toasts animados no canto superior direito.
 * Integrado com o activity-log store — aparece automaticamente
 * quando é adicionada uma entrada de nível success/error/warning/action.
 */

import { useState, useEffect } from 'react'
import { motion, AnimatePresence } from 'framer-motion'
import { CheckCircle, AlertTriangle, Info, X, Zap, Radio } from 'lucide-react'
import { type ActivityEntry, type ActivityLevel, getActivity } from '@/lib/activity-log'

const CONFIG: Record<ActivityLevel, { color: string; bg: string; border: string; icon: React.ReactNode; duration: number }> = {
  success: { color: '#00ff88', bg: 'bg-[#020b14]/95 border-[#00ff88]/30', border: '#00ff88', icon: <CheckCircle size={16} />, duration: 4000 },
  error:   { color: '#ff4466', bg: 'bg-[#020b14]/95 border-[#ff4466]/30', border: '#ff4466', icon: <AlertTriangle size={16} />, duration: 6000 },
  warning: { color: '#ffcc00', bg: 'bg-[#020b14]/95 border-[#ffcc00]/30', border: '#ffcc00', icon: <AlertTriangle size={16} />, duration: 5000 },
  action:  { color: '#00d4ff', bg: 'bg-[#020b14]/95 border-[#00d4ff]/30', border: '#00d4ff', icon: <Radio size={16} />,        duration: 4000 },
  info:    { color: '#8ba3be', bg: 'bg-[#020b14]/95 border-[#1a3a5c]',    border: '#1a3a5c', icon: <Info size={16} />,          duration: 3000 },
}

interface ToastItem extends ActivityEntry {
  visible: boolean
}

export default function ToastNotification() {
  const [toasts, setToasts] = useState<ToastItem[]>([])
  const [seen, setSeen] = useState<Set<string>>(new Set())

  useEffect(() => {
    function onUpdate(e: Event) {
      const entries = (e as CustomEvent<ActivityEntry[]>).detail
      if (!entries.length) return

      const newest = entries[0]
      if (seen.has(newest.id)) return
      // Only show toasts for these levels
      if (!['success', 'error', 'warning', 'action'].includes(newest.level)) return

      setSeen(prev => new Set(prev).add(newest.id))
      const item: ToastItem = { ...newest, visible: true }
      setToasts(prev => [item, ...prev].slice(0, 5))

      // Auto-remove
      const cfg = CONFIG[newest.level]
      setTimeout(() => {
        setToasts(prev => prev.map(t => t.id === newest.id ? { ...t, visible: false } : t))
        setTimeout(() => setToasts(prev => prev.filter(t => t.id !== newest.id)), 400)
      }, cfg.duration)
    }
    window.addEventListener('activity-update', onUpdate)
    return () => window.removeEventListener('activity-update', onUpdate)
  }, [seen])

  function dismiss(id: string) {
    setToasts(prev => prev.map(t => t.id === id ? { ...t, visible: false } : t))
    setTimeout(() => setToasts(prev => prev.filter(t => t.id !== id)), 400)
  }

  return (
    <div className="fixed top-4 right-4 z-[9999] flex flex-col gap-2 pointer-events-none" style={{ maxWidth: 360 }}>
      <AnimatePresence>
        {toasts.filter(t => t.visible).map(toast => {
          const cfg = CONFIG[toast.level]
          return (
            <motion.div
              key={toast.id}
              initial={{ opacity: 0, x: 60, scale: 0.95 }}
              animate={{ opacity: 1, x: 0,  scale: 1 }}
              exit={{ opacity: 0, x: 60, scale: 0.9 }}
              transition={{ type: 'spring', stiffness: 400, damping: 30 }}
              className={`pointer-events-auto flex items-start gap-3 px-4 py-3 rounded-xl border backdrop-blur-xl shadow-xl ${cfg.bg}`}
              style={{ borderLeft: `3px solid ${cfg.color}` }}
            >
              <div style={{ color: cfg.color }} className="flex-shrink-0 mt-0.5">{cfg.icon}</div>
              <div className="flex-1 min-w-0">
                <div className="text-sm font-bold font-mono" style={{ color: cfg.color }}>
                  {toast.title}
                </div>
                {toast.detail && (
                  <div className="text-xs font-mono text-[#8ba3be] mt-0.5 leading-relaxed break-words">
                    {toast.detail}
                  </div>
                )}
              </div>
              <button onClick={() => dismiss(toast.id)}
                className="flex-shrink-0 text-[#3d5a73] hover:text-[#8ba3be] transition-colors mt-0.5">
                <X size={13} />
              </button>
            </motion.div>
          )
        })}
      </AnimatePresence>
    </div>
  )
}
