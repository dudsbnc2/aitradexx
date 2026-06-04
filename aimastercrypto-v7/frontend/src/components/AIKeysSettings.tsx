"use client";
/**
 * AIKeysSettings — Painel para o user gerir as suas chaves de IA (BYOK)
 * Mostra estado de trial + formulário para adicionar/remover chaves por provider
 */
import { useState, useEffect, useCallback } from "react";
import { api } from "@/lib/api";

const PROVIDERS = [
  {
    id: "groq",
    label: "Groq",
    description: "Llama 3.3-70B — rápido e gratuito",
    placeholder: "gsk_...",
    link: "https://console.groq.com/keys",
    recommended: true,
  },
  {
    id: "openrouter",
    label: "OpenRouter",
    description: "Acesso a Llama, DeepSeek, Mistral e mais",
    placeholder: "sk-or-...",
    link: "https://openrouter.ai/keys",
    recommended: false,
  },
  {
    id: "gemini",
    label: "Google Gemini",
    description: "Gemini 2.0 Flash",
    placeholder: "AIza...",
    link: "https://aistudio.google.com/app/apikey",
    recommended: false,
  },
  {
    id: "anthropic",
    label: "Anthropic Claude",
    description: "Claude Sonnet — análise profunda",
    placeholder: "sk-ant-...",
    link: "https://console.anthropic.com/account/keys",
    recommended: false,
  },
];

interface TrialInfo {
  used: number;
  limit: number;
  remaining: number;
  exhausted: boolean;
}

interface AIKeysData {
  providers: Record<string, string | null>;
  preferred: string | null;
  has_own_key: boolean;
  trial: TrialInfo;
  server_keys_active: Record<string, boolean>;
}

export default function AIKeysSettings() {
  const [data, setData] = useState<AIKeysData | null>(null);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState<string | null>(null);
  const [deleting, setDeleting] = useState<string | null>(null);
  const [inputs, setInputs] = useState<Record<string, string>>({});
  const [showInput, setShowInput] = useState<Record<string, boolean>>({});
  const [feedback, setFeedback] = useState<{ provider: string; msg: string; ok: boolean } | null>(null);

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const res = await api.get("/api/user/ai-keys").then(r => r.data);
      setData(res);
    } catch {
      /* silencioso */
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => { load(); }, [load]);

  const toast = (provider: string, msg: string, ok: boolean) => {
    setFeedback({ provider, msg, ok });
    setTimeout(() => setFeedback(null), 3500);
  };

  const handleSave = async (providerId: string) => {
    const key = inputs[providerId]?.trim();
    if (!key) return;
    setSaving(providerId);
    try {
      await api.post("/api/user/ai-keys", { provider: providerId, api_key: key, set_as_preferred: !data?.has_own_key });
      setInputs((p) => ({ ...p, [providerId]: "" }));
      setShowInput((p) => ({ ...p, [providerId]: false }));
      toast(providerId, "Chave guardada com sucesso", true);
      await load();
    } catch {
      toast(providerId, "Erro ao guardar chave", false);
    } finally {
      setSaving(null);
    }
  };

  const handleDelete = async (providerId: string) => {
    if (!confirm(`Remover chave de ${providerId}?`)) return;
    setDeleting(providerId);
    try {
      await api.delete(`/api/user/ai-keys/${providerId}`);
      toast(providerId, "Chave removida", true);
      await load();
    } catch {
      toast(providerId, "Erro ao remover chave", false);
    } finally {
      setDeleting(null);
    }
  };

  const handleSetPreferred = async (providerId: string) => {
    try {
      await api.patch("/api/user/ai-keys/preferred", { provider: providerId });
      await load();
    } catch { /* silencioso */ }
  };

  if (loading) {
    return (
      <div className="flex items-center justify-center py-12">
        <div className="w-6 h-6 border-2 border-blue-500 border-t-transparent rounded-full animate-spin" />
      </div>
    );
  }

  if (!data) return null;

  const trial = data.trial;
  const trialPct = Math.round((trial.used / trial.limit) * 100);
  const trialColor = trial.exhausted ? "bg-red-500" : trialPct >= 80 ? "bg-yellow-500" : "bg-emerald-500";

  return (
    <div className="space-y-6">
      {/* ── Banner de trial ── */}
      <div className={`rounded-xl p-4 border ${
        trial.exhausted
          ? "bg-red-900/30 border-red-700"
          : data.has_own_key
          ? "bg-emerald-900/20 border-emerald-700"
          : "bg-blue-900/20 border-blue-700"
      }`}>
        {data.has_own_key ? (
          <div className="flex items-center gap-2 text-emerald-400">
            <span className="text-lg">✓</span>
            <div>
              <p className="font-semibold text-sm">A usar a tua própria chave de IA</p>
              <p className="text-xs text-emerald-500/80">Os teus créditos são usados directamente — sem limites impostos pela plataforma.</p>
            </div>
          </div>
        ) : trial.exhausted ? (
          <div>
            <p className="font-semibold text-red-400 text-sm">⚠ Trial esgotado ({trial.used}/{trial.limit} chamadas)</p>
            <p className="text-xs text-red-400/80 mt-1">Adiciona a tua própria chave de IA para continuar a usar sinais com IA. Enquanto não adicionares, os sinais usarão o motor de regras.</p>
          </div>
        ) : (
          <div>
            <div className="flex justify-between items-center mb-2">
              <p className="font-semibold text-blue-300 text-sm">Chamadas de trial: {trial.used} / {trial.limit}</p>
              <span className="text-xs text-blue-400">{trial.remaining} restantes</span>
            </div>
            <div className="w-full bg-gray-700 rounded-full h-1.5">
              <div className={`${trialColor} h-1.5 rounded-full transition-all`} style={{ width: `${trialPct}%` }} />
            </div>
            <p className="text-xs text-blue-400/70 mt-2">
              Adiciona a tua chave para uso ilimitado — deixas de gastar o trial da plataforma.
            </p>
          </div>
        )}
      </div>

      {/* ── Lista de providers ── */}
      <div className="space-y-3">
        {PROVIDERS.map((p) => {
          const masked = data.providers[p.id];
          const hasKey = !!masked;
          const isPreferred = data.preferred === p.id;
          const serverActive = data.server_keys_active[p.id];
          const isSaving = saving === p.id;
          const isDeleting = deleting === p.id;
          const showForm = showInput[p.id];
          const fb = feedback?.provider === p.id ? feedback : null;

          return (
            <div key={p.id} className={`rounded-xl border p-4 transition-all ${
              hasKey
                ? isPreferred
                  ? "border-emerald-600 bg-emerald-900/10"
                  : "border-gray-600 bg-gray-800/50"
                : "border-gray-700 bg-gray-800/30"
            }`}>
              <div className="flex items-start justify-between gap-3">
                <div className="flex-1 min-w-0">
                  <div className="flex items-center gap-2 flex-wrap">
                    <span className="font-semibold text-white text-sm">{p.label}</span>
                    {p.recommended && (
                      <span className="text-xs bg-emerald-800 text-emerald-300 px-1.5 py-0.5 rounded">Recomendado</span>
                    )}
                    {isPreferred && (
                      <span className="text-xs bg-blue-800 text-blue-300 px-1.5 py-0.5 rounded">★ Preferido</span>
                    )}
                    {!hasKey && serverActive && (
                      <span className="text-xs bg-gray-700 text-gray-400 px-1.5 py-0.5 rounded">trial ativo</span>
                    )}
                  </div>
                  <p className="text-xs text-gray-400 mt-0.5">{p.description}</p>
                  {hasKey && (
                    <p className="text-xs text-gray-500 font-mono mt-1 truncate">{masked}</p>
                  )}
                </div>

                <div className="flex items-center gap-2 shrink-0">
                  {hasKey && !isPreferred && (
                    <button
                      onClick={() => handleSetPreferred(p.id)}
                      className="text-xs text-blue-400 hover:text-blue-300 px-2 py-1 rounded border border-blue-800 hover:border-blue-600 transition-colors"
                    >
                      Preferir
                    </button>
                  )}
                  {hasKey && (
                    <button
                      onClick={() => handleDelete(p.id)}
                      disabled={isDeleting}
                      className="text-xs text-red-400 hover:text-red-300 px-2 py-1 rounded border border-red-900 hover:border-red-700 transition-colors disabled:opacity-50"
                    >
                      {isDeleting ? "..." : "Remover"}
                    </button>
                  )}
                  <button
                    onClick={() => setShowInput((prev) => ({ ...prev, [p.id]: !prev[p.id] }))}
                    className={`text-xs px-2 py-1 rounded border transition-colors ${
                      hasKey
                        ? "text-gray-400 border-gray-700 hover:border-gray-500"
                        : "text-blue-400 border-blue-800 hover:border-blue-600"
                    }`}
                  >
                    {hasKey ? "Substituir" : "Adicionar"}
                  </button>
                </div>
              </div>

              {/* Feedback inline */}
              {fb && (
                <p className={`text-xs mt-2 ${fb.ok ? "text-emerald-400" : "text-red-400"}`}>
                  {fb.ok ? "✓" : "✗"} {fb.msg}
                </p>
              )}

              {/* Formulário de input */}
              {showForm && (
                <div className="mt-3 flex gap-2">
                  <input
                    type="password"
                    value={inputs[p.id] || ""}
                    onChange={(e) => setInputs((prev) => ({ ...prev, [p.id]: e.target.value }))}
                    placeholder={p.placeholder}
                    className="flex-1 bg-gray-900 border border-gray-700 rounded-lg px-3 py-2 text-sm text-white placeholder-gray-600 focus:outline-none focus:border-blue-600"
                    onKeyDown={(e) => e.key === "Enter" && handleSave(p.id)}
                  />
                  <button
                    onClick={() => handleSave(p.id)}
                    disabled={isSaving || !inputs[p.id]?.trim()}
                    className="px-3 py-2 bg-blue-600 hover:bg-blue-700 disabled:bg-gray-700 rounded-lg text-sm font-medium text-white transition-colors"
                  >
                    {isSaving ? "..." : "Guardar"}
                  </button>
                </div>
              )}

              {/* Link para obter chave */}
              {showForm && (
                <a
                  href={p.link}
                  target="_blank"
                  rel="noopener noreferrer"
                  className="block text-xs text-blue-500 hover:text-blue-400 mt-2"
                >
                  Obter chave em {p.link.split("/")[2]} →
                </a>
              )}
            </div>
          );
        })}
      </div>

      {/* ── Nota de segurança ── */}
      <p className="text-xs text-gray-600 text-center">
        🔒 As chaves são encriptadas em repouso e nunca expostas em plain-text.
      </p>
    </div>
  );
}
