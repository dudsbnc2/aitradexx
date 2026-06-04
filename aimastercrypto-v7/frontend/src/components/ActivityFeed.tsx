'use client'

/**
 * ActivityFeed.tsx
 * Painel lateral/inferior de logs em tempo real.
 * Recebe eventos do activity-log store via CustomEvent.
 */

import { useTranslations } from 'next-intl'
import { useState, useEffect, useRef } from 'react'
import { motion, AnimatePresence } from 'framer-motion'
import { Activity, X, ChevronDown, ChevronUp, Trash2, CheckCircle, AlertTriangle, Info, Zap, Radio } from 'lucide-react'
import { type ActivityEntry, type ActivityLevel, getActivity, clearActivity } from '@/lib/activity-log'

const LEVEL_CONFIG: Record<ActivityLevel, { color: string; bg: string; border: string; icon: React.ReactNode }> = {
  success: { color: '#00ff88', bg: '#00ff88/8',  border: '#00ff88/25', icon: <CheckCircle size={11} /> },
  error:   { color: '#ff4466', bg: '#ff4466/8',  border: '#ff4466/25', icon: <AlertTriangle size={11} /> },
  warning: { color: '#ffcc00', bg: '#ffcc00/8',  border: '#ffcc00/25', icon: <AlertTriangle size={11} /> },
  info:    { color: '#8ba3be', bg: '#1a3a5c/30', border: '#1a3a5c',    icon: <Info size={11} /> },
  action:  { color: '#00d4ff', bg: '#00d4ff/8',  border: '#00d4ff/25', icon: <Radio size={11} /> },
}

function formatTime(d: Date): string {
  return d.toLocaleTimeString('pt-PT', { hour: '2-digit', minute: '2-digit', second: '2-digit' })
}

interface Props {
  maxVisible?: number
  collapsed?: boolean
}

export default function ActivityFeed({ maxVisible = 8, collapsed: initCollapsed = false }: Props) {
  const t = useTranslations()
  const [entries, setEntries] = useState<ActivityEntry[]>(getActivity())
  const [collapsed, setCollapsed] = useState(initCollapsed)
  const listRef = useRef<HTMLDivElement>(null)

  useEffect(() => {
    function onUpdate(e: Event) {
      setEntries((e as CustomEvent<ActivityEntry[]>).detail)
    }
    window.addEventListener('activity-update', onUpdate)
    return () => window.removeEventListener('activity-update', onUpdate)
  }, [])

  // Scroll to top on new entry
  useEffect(() => {
    if (!collapsed && listRef.current) {
      listRef.current.scrollTop = 0
    }
  }, [entries.length, collapsed])

  const visible = entries.slice(0, maxVisible)
  const unread  = entries.filter(e => e.level === 'error' || e.level === 'action').length

  return (
    <div className="glass-card border border-[#1a3a5c] rounded-xl overflow-hidden">
      {/* Header */}
      <button
        onClick={() => setCollapsed(c => !c)}
        className="w-full flex items-center justify-between px-4 py-3 hover:bg-[#0c1f35]/50 transition-all"
      >
        <div className="flex items-center gap-2">
          <Activity size={13} className="text-[#00d4ff]" />
          {t('autotrader.activity_title')}
          {entries.length > 0 && (
            <span className="px-1.5 py-0.5 rounded text-[9px] font-bold font-mono bg-[#00d4ff]/10 text-[#00d4ff] border border-[#00d4ff]/20">
              {entries.length}
            </span>
          )}
          {unread > 0 && !collapsed && (
            <span className="w-2 h-2 rounded-full bg-[#ff4466] animate-pulse" />
          )}
          {/* Last entry preview when collapsed */}
          {collapsed && entries[0] && (
            <span className="text-[10px] font-mono text-[#3d5a73] ml-2 truncate max-w-[200px]">
              {entries[0].title}
            </span>
          )}
        </div>
        <div className="flex items-center gap-2">
          {!collapsed && entries.length > 0 && (
            <button
              onClick={e => { e.stopPropagation(); clearActivity() }}
              className="p-1 rounded hover:bg-[#ff4466]/10 text-[#3d5a73] hover:text-[#ff4466] transition-all"
              title="Limpar logs"
            >
              <Trash2 size={11} />
            </button>
          )}
          {collapsed ? <ChevronDown size={13} className="text-[#3d5a73]" /> : <ChevronUp size={13} className="text-[#3d5a73]" />}
        </div>
      </button>

      {/* Log list */}
      <AnimatePresence>
        {!collapsed && (
          <motion.div
            initial={{ height: 0, opacity: 0 }}
            animate={{ height: 'auto', opacity: 1 }}
            exit={{ height: 0, opacity: 0 }}
            transition={{ duration: 0.2 }}
          >
            <div
              ref={listRef}
              className="overflow-y-auto max-h-52 divide-y divide-[#1a3a5c]/30"
            >
              {entries.length === 0 ? (
                <div className="px-4 py-6 text-center text-xs font-mono text-[#3d5a73]">
                  Sem actividade ainda
                </div>
              ) : (
                <AnimatePresence initial={false}>
                  {visible.map(entry => {
                    const cfg = LEVEL_CONFIG[entry.level]
                    return (
                      <motion.div
                        key={entry.id}
                        initial={{ opacity: 0, x: -8 }}
                        animate={{ opacity: 1, x: 0 }}
                        exit={{ opacity: 0 }}
                        transition={{ duration: 0.15 }}
                        className="flex items-start gap-2.5 px-4 py-2.5"
                      >
                        {/* Icon */}
                        <div className="flex-shrink-0 mt-0.5" style={{ color: cfg.color }}>
                          {cfg.icon}
                        </div>
                        {/* Content */}
                        <div className="flex-1 min-w-0">
                          <div className="flex items-baseline justify-between gap-2">
                            <span className="text-xs font-mono font-medium truncate" style={{ color: cfg.color }}>
                              {entry.title}
                            </span>
                            <span className="text-[9px] font-mono text-[#3d5a73] flex-shrink-0">
                              {formatTime(entry.ts)}
                            </span>
                          </div>
                          {entry.detail && (
                            <div className="text-[10px] font-mono text-[#3d5a73] mt-0.5 leading-relaxed break-all">
                              {entry.detail}
                            </div>
                          )}
                        </div>
                      </motion.div>
                    )
                  })}
                </AnimatePresence>
              )}
              {entries.length > maxVisible && (
                <div className="px-4 py-2 text-[10px] font-mono text-[#3d5a73] text-center border-t border-[#1a3a5c]/30">
                  + {entries.length - maxVisible} entradas anteriores
                </div>
              )}
            </div>
          </motion.div>
        )}
      </AnimatePresence>
    </div>
  )
}
