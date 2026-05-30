/**
 * AIMasterCrypto — RegimeWidget V7
 * ===================================
 * Widget compacto do regime de mercado para usar no header ou dashboard.
 *
 * USO:
 *   import RegimeWidget from '@/components/RegimeWidget'
 *
 *   // No header do dashboard ou no topo de um scan:
 *   <RegimeWidget regime={currentRegime} animated />
 *
 *   // Versão mini (sem descrição):
 *   <RegimeWidget regime="TREND_UP" size="sm" />
 *
 *   // Com nota adicional do quant engine:
 *   <RegimeWidget regime={signal.quant?.regime} note={signal.quant?.regime_note} />
 */

import React from 'react'

// ── Tipos ─────────────────────────────────────────────────────────────────────

type RegimeType = 'TREND_UP' | 'TREND_DOWN' | 'RANGE' | 'CHOPPY' | 'VOLATILE' | string

interface RegimeWidgetProps {
  regime?: RegimeType | null
  note?: string
  size?: 'sm' | 'md' | 'lg'
  animated?: boolean
  showDesc?: boolean
  className?: string
}

// ── Config ───────────────────────────────────────────────────────────────────

const REGIMES: Record<string, {
  color: string
  bg: string
  border: string
  label: string
  desc: string
  icon: string
}> = {
  TREND_UP: {
    color: '#00ff88',
    bg: '#00ff8810',
    border: '#00ff8830',
    label: 'Trend ↑',
    desc: 'Momentum bullish forte — favorável a LONG',
    icon: '↗',
  },
  TREND_DOWN: {
    color: '#ff4466',
    bg: '#ff446610',
    border: '#ff446630',
    label: 'Trend ↓',
    desc: 'Momentum bearish forte — favorável a SHORT',
    icon: '↙',
  },
  RANGE: {
    color: '#ffcc00',
    bg: '#ffcc0010',
    border: '#ffcc0030',
    label: 'Range',
    desc: 'Mercado lateralizado — preferir reversão a breakout',
    icon: '↔',
  },
  CHOPPY: {
    color: '#ff8833',
    bg: '#ff883310',
    border: '#ff883330',
    label: 'Choppy',
    desc: 'Alta incerteza — evitar entradas, risco de whipsaw',
    icon: '~',
  },
  VOLATILE: {
    color: '#b366ff',
    bg: '#b366ff10',
    border: '#b366ff30',
    label: 'Volátil',
    desc: 'Volatilidade extrema — stops mais largos necessários',
    icon: '⚡',
  },
}

const SIZE_CONFIG = {
  sm: {
    container: 'px-2 py-1 gap-1.5',
    dot: 'w-1.5 h-1.5',
    label: 'text-[9px]',
    desc: 'hidden',
    icon: 'text-[9px]',
  },
  md: {
    container: 'px-3 py-1.5 gap-2',
    dot: 'w-2 h-2',
    label: 'text-xs',
    desc: 'text-[9px]',
    icon: 'text-xs',
  },
  lg: {
    container: 'px-4 py-2.5 gap-3',
    dot: 'w-2.5 h-2.5',
    label: 'text-sm',
    desc: 'text-xs',
    icon: 'text-sm',
  },
}

// ── Componente ────────────────────────────────────────────────────────────────

export default function RegimeWidget({
  regime,
  note,
  size = 'md',
  animated = true,
  showDesc = true,
  className = '',
}: RegimeWidgetProps) {
  if (!regime) return null

  const config = REGIMES[regime]
  if (!config) return null

  const sz = SIZE_CONFIG[size]
  const description = note || config.desc

  return (
    <div
      className={`
        inline-flex items-center rounded-lg border
        ${sz.container}
        ${className}
      `}
      style={{
        borderColor: config.border,
        background: config.bg,
      }}
    >
      {/* Indicador animado */}
      <div
        className={`
          ${sz.dot} rounded-full shrink-0
          ${animated ? 'animate-pulse' : ''}
        `}
        style={{ background: config.color }}
      />

      {/* Ícone */}
      <span
        className={`${sz.icon} font-bold font-mono shrink-0`}
        style={{ color: config.color }}
      >
        {config.icon}
      </span>

      {/* Label */}
      <span
        className={`${sz.label} font-bold font-mono shrink-0`}
        style={{ color: config.color }}
      >
        {config.label}
      </span>

      {/* Descrição (opcional) */}
      {showDesc && size !== 'sm' && (
        <span className={`${sz.desc} font-mono text-[#3d5a73] leading-tight`}>
          {description}
        </span>
      )}
    </div>
  )
}

// ── Variante: lista de todos os regimes (legenda) ──────────────────────────────

export function RegimeLegend({ className = '' }: { className?: string }) {
  return (
    <div className={`flex flex-wrap gap-2 ${className}`}>
      {Object.keys(REGIMES).map((regime) => (
        <RegimeWidget
          key={regime}
          regime={regime}
          size="sm"
          animated={false}
          showDesc={false}
        />
      ))}
    </div>
  )
}

// ── Variante: badge inline para tabelas ─────────────────────────────────────────

export function RegimeBadge({ regime }: { regime?: string | null }) {
  if (!regime) return <span className="text-[#3d5a73] font-mono text-[9px]">—</span>
  const config = REGIMES[regime]
  if (!config) return <span className="text-[#3d5a73] font-mono text-[9px]">{regime}</span>

  return (
    <span
      className="text-[9px] font-mono font-bold px-1.5 py-0.5 rounded"
      style={{
        color: config.color,
        background: config.bg,
      }}
    >
      {config.label}
    </span>
  )
}
