/**
 * activity-log.ts
 * Sistema de log de actividade em tempo real para o AutoTrader.
 * Usa um simples store em memória + event emitter leve (CustomEvent).
 */

export type ActivityLevel = 'info' | 'success' | 'warning' | 'error' | 'action'

export interface ActivityEntry {
  id:        string
  level:     ActivityLevel
  title:     string
  detail?:   string
  ts:        Date
  persist?:  boolean  // se true, fica na lista mesmo após o toast desaparecer
}

const MAX_ENTRIES = 50
let entries: ActivityEntry[] = []

function emit() {
  if (typeof window !== 'undefined') {
    window.dispatchEvent(new CustomEvent('activity-update', { detail: [...entries] }))
  }
}

export function logActivity(
  level: ActivityLevel,
  title: string,
  detail?: string,
  persist = true,
): ActivityEntry {
  const entry: ActivityEntry = {
    id:      crypto.randomUUID(),
    level,
    title,
    detail,
    ts:      new Date(),
    persist,
  }
  entries = [entry, ...entries].slice(0, MAX_ENTRIES)
  emit()
  return entry
}

export function clearActivity() {
  entries = []
  emit()
}

export function getActivity(): ActivityEntry[] {
  return [...entries]
}

// Shorthand helpers
export const logInfo    = (t: string, d?: string) => logActivity('info',    t, d)
export const logSuccess = (t: string, d?: string) => logActivity('success', t, d)
export const logWarning = (t: string, d?: string) => logActivity('warning', t, d)
export const logError   = (t: string, d?: string) => logActivity('error',   t, d)
export const logAction  = (t: string, d?: string) => logActivity('action',  t, d)
