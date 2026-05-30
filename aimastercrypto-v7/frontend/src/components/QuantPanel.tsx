/**
 * AIMasterCrypto — QuantPanel V7
 * ================================
 * Painel de análise quantitativa para o SignalCard.
 * Mostra edge score, probabilidades, expected value e regime.
 */

import React from 'react'

// ── Tipos ────────────────────────────────────────────────────────────────────

interface QuantData {
  regime: string
  regime_note?: string
  edge_score: number
  tp_probability: number
  sl_probability: number
  expected_rr: number
  quant_bias: string
  quant_confidence: number
  entry_probability?: number
}

interface QuantPanelProps {
  quant: QuantData
  className?: string
}

// ── Helpers seguros ───────────────────────────────────────────────────────────

function safeFixed(n: number | undefined | null, digits = 1): string {
  if (n === undefined || n === null || isNaN(n as number)) return '—'
  return (n as number).toFixed(digits)
}

function safeNum(n: number | undefined | null, fallback = 0): number {
  if (n === undefined || n === null || isNaN(n as number)) return fallback
  return n as number
}

// ── Configuração de regimes ───────────────────────────────────────────────────

const REGIME_CONFIG: Record<string, { color: string; label: string; desc: string }> = {
  TREND_UP:   { color: '#00ff88', label: 'Trend ↑', desc: 'Momentum bullish confirmado' },
  TREND_DOWN: { color: '#ff4466', label: 'Trend ↓', desc: 'Momentum bearish confirmado' },
  RANGE:      { color: '#ffcc00', label: 'Range',   desc: 'Mercado lateralizado' },
  CHOPPY:     { color: '#ff8833', label: 'Choppy',  desc: 'Alta incerteza — cuidado' },
  VOLATILE:   { color: '#b366ff', label: 'Volátil', desc: 'Volatilidade extrema' },
}

// ── Sub-componentes ───────────────────────────────────────────────────────────

function ProbBar({
  label,
  value,
  color,
  width = 'w-16',
}: {
  label: string
  value: number | undefined | null
  color: string
  width?: string
}) {
  const v = safeNum(value, 0)
  return (
    <div className="flex items-center gap-3">
      <span className={`text-[9px] font-mono text-[#3d5a73] ${width} shrink-0`}>
        {label}
      </span>
      <div className="flex-1 h-1.5 bg-[#0c1f35] rounded-full overflow-hidden">
        <div
          className="h-full rounded-full transition-all duration-700"
          style={{ width: `${Math.min(v, 100)}%`, background: color }}
        />
      </div>
      <span
        className="text-xs font-bold font-mono w-10 text-right shrink-0"
        style={{ color }}
      >
        {safeFixed(v, 1)}%
      </span>
    </div>
  )
}

function EdgeBar({ score }: { score: number | undefined | null }) {
  const s = safeNum(score, 0)
  const color =
    s >= 75 ? '#00ff88'
    : s >= 55 ? '#00d4ff'
    : s >= 35 ? '#ffcc00'
    : '#ff4466'

  const label =
    s >= 75 ? 'Forte'
    : s >= 55 ? 'Moderado'
    : s >= 35 ? 'Fraco'
    : 'Sem edge'

  return (
    <div>
      <div className="flex items-center justify-between mb-1">
        <span className="text-[9px] font-mono text-[#3d5a73]">EDGE SCORE</span>
        <span className="text-[9px] font-mono" style={{ color }}>
          {label}
        </span>
      </div>
      <div className="flex items-center gap-2">
        <div className="flex-1 h-2 bg-[#0c1f35] rounded-full overflow-hidden">
          <div
            className="h-full rounded-full transition-all duration-700"
            style={{ width: `${s}%`, background: color }}
          />
        </div>
        <span className="text-sm font-bold font-mono" style={{ color }}>
          {safeFixed(s, 0)}
        </span>
        <span className="text-[9px] font-mono text-[#3d5a73]">/100</span>
      </div>
    </div>
  )
}

function ExpectedValue({ ev }: { ev: number | undefined | null }) {
  const v = safeNum(ev, 0)
  const positive = v > 0
  const color = positive ? '#00ff88' : '#ff4466'
  const sign = v > 0 ? '+' : ''

  return (
    <div>
      <div className="text-[9px] font-mono text-[#3d5a73] mb-1">VALOR ESPERADO</div>
      <div className="flex items-baseline gap-1">
        <span className="text-xl font-bold font-mono" style={{ color }}>
          {sign}{safeFixed(v, 2)}
        </span>
        <span className="text-[9px] font-mono text-[#3d5a73]">R</span>
      </div>
      <div className="text-[8px] font-mono mt-0.5" style={{ color: `${color}80` }}>
        {positive
          ? `Por cada 1R arriscado, expectativa de ganho é ${safeFixed(v, 2)}R`
          : 'Edge negativo — setup não recomendado'}
      </div>
    </div>
  )
}

// ── Componente principal ──────────────────────────────────────────────────────

export default function QuantPanel({ quant, className = '' }: QuantPanelProps) {
  if (!quant) return null

  const regime = REGIME_CONFIG[quant.regime] ?? {
    color: '#8ba3be',
    label: quant.regime ?? '—',
    desc: '',
  }

  const showWaitWarning = quant.quant_bias === 'WAIT'

  return (
    <div className={`border-t border-[#1a3a5c] ${className}`}>
      {/* Header */}
      <div className="px-4 pt-3 pb-2">
        <div className="flex items-center gap-2 mb-1">
          <div
            className="w-2 h-2 rounded-full animate-pulse"
            style={{ background: regime.color }}
          />
          <span className="text-[9px] font-mono uppercase tracking-widest text-[#3d5a73]">
            Análise Quantitativa
          </span>
          <span
            className="ml-auto text-[9px] font-mono px-2 py-0.5 rounded border"
            style={{
              color: regime.color,
              borderColor: `${regime.color}40`,
              background: `${regime.color}10`,
            }}
          >
            {regime.label}
          </span>
        </div>
        {quant.regime_note && (
          <p className="text-[8px] font-mono text-[#3d5a73] leading-relaxed">
            {quant.regime_note}
          </p>
        )}
      </div>

      {/* Warning se WAIT */}
      {showWaitWarning && (
        <div className="mx-4 mb-3 px-3 py-2 rounded-lg bg-[#ff883310] border border-[#ff883330]">
          <span className="text-[10px] font-mono text-[#ff8833]">
            ⚠ Motor quant sem edge suficiente — setup não recomendado
          </span>
        </div>
      )}

      {/* Grid principal */}
      <div className="px-4 pb-3 space-y-4">

        <EdgeBar score={quant.edge_score} />

        <div className="grid grid-cols-2 gap-4">
          <ExpectedValue ev={quant.expected_rr} />

          <div>
            <div className="text-[9px] font-mono text-[#3d5a73] mb-1">CONFIANÇA QUANT</div>
            <div className="flex items-baseline gap-1">
              <span className="text-xl font-bold font-mono text-[#00d4ff]">
                {safeFixed(quant.quant_confidence, 0)}
              </span>
              <span className="text-[9px] font-mono text-[#3d5a73]">%</span>
            </div>
            <div className="text-[8px] font-mono mt-0.5 text-[#3d5a73]">
              Calibrado por indicadores
            </div>
          </div>
        </div>

        <div className="space-y-2">
          <ProbBar label="P(TP HIT)" value={quant.tp_probability} color="#00ff88" />
          <ProbBar label="P(SL HIT)" value={quant.sl_probability} color="#ff4466" />
          {quant.entry_probability !== undefined && (
            <ProbBar label="P(ENTRY)" value={quant.entry_probability} color="#00d4ff" />
          )}
        </div>

        <p className="text-[8px] font-mono text-[#2a4a63] leading-relaxed border-t border-[#1a3a5c] pt-2">
          Probabilidades estimadas com base em alinhamento de indicadores e regime de mercado.
          Não garantem resultados futuros.
        </p>
      </div>
    </div>
  )
}
