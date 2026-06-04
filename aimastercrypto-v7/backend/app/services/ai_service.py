"""
AI Provider Service — BYOK (Bring Your Own Key)
Usa as chaves do utilizador se disponíveis; cai para as chaves do servidor como trial.

Fallback chain: Groq → OpenRouter (gratuito) → Gemini → Anthropic → Rule Engine

OpenRouter suporta modelos gratuitos (sem custo):
  - meta-llama/llama-3.3-70b-instruct:free
  - mistralai/mistral-7b-instruct:free
  - deepseek/deepseek-r1:free
  - google/gemma-3-27b-it:free
  - microsoft/phi-4-reasoning:free
"""
import json
import logging
from typing import Optional
from app.core.clients import get_http_client
from app.core.config import settings
from app.services.ta_engine import rule_engine, compute_indicators

logger = logging.getLogger("tradeia.ai")

# Modelos gratuitos OpenRouter ordenados por qualidade de raciocínio financeiro
OPENROUTER_FREE_MODELS = [
    "meta-llama/llama-3.3-70b-instruct:free",
    "deepseek/deepseek-r1:free",
    "mistralai/mistral-7b-instruct:free",
]

# Limite de trial quando o user não tem chave própria (safety cap extra além do DB)
_TRIAL_HARD_LIMIT = 50


def build_prompt(pair: str, tf: str, ind: dict, mtf: Optional[dict] = None) -> str:
    mtf_str = ""
    if mtf:
        mtf_str = (
            f"\nMTF ({','.join(mtf['tfs'])}): {mtf['confluence']} — "
            f"bull {mtf['bull_tfs']}/{mtf['total_tfs']} bear {mtf['bear_tfs']}/{mtf['total_tfs']} "
            f"(score: {mtf.get('total_score', 0)})"
        )

    price   = ind["price"]
    atr_v   = ind["atr"]
    sl_long  = round(price - atr_v * 1.5, 6)
    sl_short = round(price + atr_v * 1.5, 6)
    tp_long  = round(price + atr_v * 3.0, 6)
    tp_short = round(price - atr_v * 3.0, 6)
    inv_long  = round(price - atr_v * 2.0, 6)
    inv_short = round(price + atr_v * 2.0, 6)
    ez_high_long  = round(price + atr_v * 0.3, 6)
    ez_low_short  = round(price - atr_v * 0.3, 6)

    bull_tp  = round(price + atr_v * 4.0, 6)
    base_tp  = round(price + atr_v * 2.5, 6)
    bear_tp  = round(price - atr_v * 1.5, 6)
    bull_inv = round(price - atr_v * 1.2, 6)
    base_inv = round(price - atr_v * 1.5, 6)
    bear_inv = round(price + atr_v * 1.0, 6)

    return f"""You are an elite quantitative crypto trader specialising in technical analysis.
Analyse {pair} on {tf} using live data:

Price: {price} | ATR(14): {atr_v} | Regime: {ind.get('atr_regime','NORMAL')}
EMA9: {ind['ema9']} | EMA21: {ind['ema21']} | EMA50: {ind['ema50']} → {ind['ema_signal']}
RSI(14): {ind['rsi']} | VWAP: {ind['vwap']} ({ind['vwap_signal']})
MACD: {ind['macd_line']} / Signal: {ind['macd_signal']} → {ind['macd_signal_dir']}
Volume: {ind['volume']} ({ind['vol_mult']}x avg) | Structure: {ind['structure']} | FVG: {ind['fvg']}{mtf_str}

Reference levels (1.5×ATR SL, 3×ATR TP — adjust based on your analysis):
LONG  → entry: {price}, entryZoneHigh: {ez_high_long}, SL: {sl_long}, TP: {tp_long}, invalidation: {inv_long}
SHORT → entry: {price}, entryZoneHigh: {ez_low_short}, SL: {sl_short}, TP: {tp_short}, invalidation: {inv_short}

Return ONLY a valid JSON object — no markdown, no preamble:
{{"bias":"LONG","confidence":72,"rating":"GOOD","entry":{price},"entryZoneHigh":{ez_high_long},"stopLoss":{sl_long},"takeProfit":{tp_long},"invalidation":{inv_long},"rr":"1:2.0","analysis":"2-3 sentences referencing actual values.","scenarios":[{{"name":"Bull Case","prob":55,"target":{bull_tp},"invalidation":{bull_inv},"description":"one sentence"}},{{"name":"Base Case","prob":30,"target":{base_tp},"invalidation":{base_inv},"description":"one sentence"}},{{"name":"Bear Case","prob":15,"target":{bear_tp},"invalidation":{bear_inv},"description":"one sentence"}}],"indicators":{{"ema":"{ind['ema_signal']}","rsi":{int(ind['rsi'])},"macd":"{ind['macd_signal_dir']}","volume":"{ind['volume']}","volMult":{ind['vol_mult']},"structure":"{ind['structure']}","vwap":"{ind['vwap_signal']}"}},"tags":["tag1","tag2","tag3"]}}

RULES: bias LONG/SHORT/WAIT. Adjust SL/TP from reference levels using key price levels if visible. probs sum to 100. LONG/SHORT only when ≥3 indicators align. Never return 0 for entry, stopLoss, or takeProfit."""


def parse_json(text: str) -> dict:
    text = text.replace("```json", "").replace("```", "").strip()
    s = text.find("{")
    e = text.rfind("}") + 1
    if s == -1:
        raise ValueError("No JSON in AI response")
    return json.loads(text[s:e])


def enrich_signal(s: dict, ind: dict) -> dict:
    p = ind["price"]
    atr_v = ind["atr"]
    bias = s.get("bias", "WAIT")
    if not s.get("invalidation"):
        s["invalidation"] = round(p - atr_v * 2, 6) if bias == "LONG" else round(p + atr_v * 2, 6)
    if not s.get("entryZoneHigh"):
        s["entryZoneHigh"] = round(p * 1.05, 6) if bias == "LONG" else round(p * 0.95, 6)
    if not s.get("rating"):
        conf = s.get("confidence", 50)
        s["rating"] = "TEXTBOOK" if conf >= 85 else "STRONG" if conf >= 75 else "GOOD" if conf >= 65 else "DEVELOPING"
    if not s.get("scenarios"):
        s["scenarios"] = [
            {"name": "Bull Case", "prob": 50, "target": s.get("takeProfit", p),
             "invalidation": s.get("invalidation", p), "description": "Bullish scenario."},
            {"name": "Base Case", "prob": 35, "target": round(p + atr_v, 6),
             "invalidation": round(p - atr_v, 6), "description": "Neutral scenario."},
            {"name": "Bear Case", "prob": 15, "target": s.get("stopLoss", p),
             "invalidation": round(p + atr_v, 6), "description": "Bearish scenario."},
        ]
    s.setdefault("indicators", {})["volMult"] = ind.get("vol_mult", 1.0)
    return s


# ── Chamadas individuais aos providers ────────────────────────────────────

async def call_groq(prompt: str, api_key: str) -> dict:
    c = get_http_client()
    r = await c.post(
        "https://api.groq.com/openai/v1/chat/completions",
        headers={"Authorization": f"Bearer {api_key}", "Content-Type": "application/json"},
        json={
            "model": "llama-3.3-70b-versatile",
            "max_tokens": 1000,
            "temperature": 0.35,
            "messages": [
                {"role": "system", "content": "Professional quantitative trader. Reply ONLY with valid JSON, no markdown."},
                {"role": "user", "content": prompt},
            ],
        },
    )
    r.raise_for_status()
    return parse_json(r.json()["choices"][0]["message"]["content"])


async def call_openrouter(prompt: str, api_key: str, model: str = None) -> dict:
    c = get_http_client()
    models_to_try = [model] if model else OPENROUTER_FREE_MODELS

    last_error = None
    for m in models_to_try:
        try:
            r = await c.post(
                "https://openrouter.ai/api/v1/chat/completions",
                headers={
                    "Authorization": f"Bearer {api_key}",
                    "Content-Type": "application/json",
                    "HTTP-Referer": "https://aimastercrypto.com",
                    "X-Title": "AIMasterCrypto",
                },
                json={
                    "model": m,
                    "max_tokens": 1000,
                    "temperature": 0.35,
                    "messages": [
                        {"role": "system", "content": "Professional quantitative trader. Reply ONLY with valid JSON, no markdown."},
                        {"role": "user", "content": prompt},
                    ],
                },
            )
            r.raise_for_status()
            data = r.json()
            content = data["choices"][0]["message"]["content"]
            result = parse_json(content)
            result["_openrouter_model"] = m
            logger.info(f"OpenRouter OK com modelo: {m}")
            return result
        except Exception as e:
            last_error = e
            logger.warning(f"OpenRouter modelo {m} falhou: {e}")
            continue

    raise Exception(f"Todos os modelos OpenRouter falharam. Último erro: {last_error}")


async def call_gemini(prompt: str, api_key: str) -> dict:
    url = f"https://generativelanguage.googleapis.com/v1beta/models/gemini-2.0-flash:generateContent?key={api_key}"
    c = get_http_client()
    r = await c.post(
        url,
        json={"contents": [{"parts": [{"text": prompt}]}],
              "generationConfig": {"maxOutputTokens": 1000, "temperature": 0.35}},
    )
    r.raise_for_status()
    return parse_json(r.json()["candidates"][0]["content"]["parts"][0]["text"])


async def call_anthropic(prompt: str, api_key: str) -> dict:
    c = get_http_client()
    r = await c.post(
        "https://api.anthropic.com/v1/messages",
        headers={"x-api-key": api_key,
                 "anthropic-version": "2023-06-01",
                 "Content-Type": "application/json"},
        json={"model": "claude-sonnet-4-20250514", "max_tokens": 1000,
              "messages": [{"role": "user", "content": prompt}]},
    )
    r.raise_for_status()
    return parse_json(r.json()["content"][0]["text"])


# ── Utilitário: desencripta chave Fernet ──────────────────────────────────

def _decrypt_key(encrypted: Optional[str]) -> Optional[str]:
    """Desencripta chave guardada na DB. Retorna None se falhar ou vazia."""
    if not encrypted:
        return None
    try:
        from cryptography.fernet import Fernet
        if not settings.ENCRYPTION_KEY:
            return None
        f = Fernet(settings.ENCRYPTION_KEY.encode())
        return f.decrypt(encrypted.encode()).decode()
    except Exception as e:
        logger.warning(f"_decrypt_key failed: {e}")
        return None


# ── Carrega chaves do user a partir do DB ─────────────────────────────────

async def _get_user_keys(user_id: Optional[int]) -> dict:
    """
    Retorna dict com as chaves desencriptadas do user e info de trial.
    Retorna chaves vazias se user_id for None ou DB indisponível.
    """
    empty = {
        "groq": None, "openrouter": None, "gemini": None, "anthropic": None,
        "preferred": None, "trial_used": 0, "trial_limit": _TRIAL_HARD_LIMIT,
        "has_own_key": False,
    }
    if not user_id:
        return empty
    try:
        from app.core.database import AsyncSessionLocal, User
        if AsyncSessionLocal is None:
            return empty
        async with AsyncSessionLocal() as session:
            user = await session.get(User, user_id)
            if not user:
                return empty
            groq_key       = _decrypt_key(user.ai_groq_key)
            openrouter_key = _decrypt_key(user.ai_openrouter_key)
            gemini_key     = _decrypt_key(user.ai_gemini_key)
            anthropic_key  = _decrypt_key(user.ai_anthropic_key)
            has_own = any([groq_key, openrouter_key, gemini_key, anthropic_key])
            return {
                "groq": groq_key,
                "openrouter": openrouter_key,
                "gemini": gemini_key,
                "anthropic": anthropic_key,
                "preferred": user.ai_preferred,
                "trial_used": user.ai_trial_used or 0,
                "trial_limit": user.ai_trial_limit or _TRIAL_HARD_LIMIT,
                "has_own_key": has_own,
            }
    except Exception as e:
        logger.warning(f"_get_user_keys failed: {e}")
        return empty


async def _increment_trial(user_id: int) -> None:
    """Incrementa contador de trial do user."""
    try:
        from app.core.database import AsyncSessionLocal, User
        if AsyncSessionLocal is None:
            return
        async with AsyncSessionLocal() as session:
            user = await session.get(User, user_id)
            if user:
                user.ai_trial_used = (user.ai_trial_used or 0) + 1
                await session.commit()
    except Exception as e:
        logger.warning(f"_increment_trial failed: {e}")


# ── Orquestrador principal ────────────────────────────────────────────────

async def get_ai_signal(
    pair: str,
    tf: str,
    ind: dict,
    mtf: Optional[dict] = None,
    user_id: Optional[int] = None,
) -> tuple[dict, str]:
    """
    Returns (signal_dict, source_name).

    Prioridade de chaves:
      1. Chave preferida do user (se definida e disponível)
      2. Restantes chaves do user (fallback entre elas)
      3. Chaves do servidor como trial (se dentro do limite)
      4. Rule engine (sem IA)

    O campo signal["_byok"] indica se foi usada chave própria do user.
    O campo signal["_trial_remaining"] indica chamadas de trial restantes.
    """
    prompt = build_prompt(pair, tf, ind, mtf)
    errors = []

    user_keys = await _get_user_keys(user_id)
    has_own   = user_keys["has_own_key"]
    preferred = user_keys.get("preferred")

    # ── Monta lista de providers a tentar, com as chaves correctas ────────
    # Cada entrada: (nome, chave, callable)
    candidates = []

    def _add(name: str, user_k: Optional[str], server_k: str, fn):
        """Adiciona provider: usa chave do user se existir, senão chave do servidor (se trial ok)."""
        if user_k:
            candidates.append((name, user_k, fn, "own"))
        elif server_k and not has_own:
            # Só usa chave do servidor se o user não tem NENHUMA chave própria
            candidates.append((name, server_k, fn, "trial"))

    # Define a ordem: preferred vai para a frente
    provider_order = ["groq", "openrouter", "gemini", "anthropic"]
    if preferred and preferred in provider_order:
        provider_order = [preferred] + [p for p in provider_order if p != preferred]

    for prov in provider_order:
        if prov == "groq":
            _add("groq",       user_keys["groq"],       settings.GROQ_API_KEY,
                 lambda prompt, k: call_groq(prompt, k))
        elif prov == "openrouter":
            _add("openrouter", user_keys["openrouter"],  settings.OPENROUTER_API_KEY,
                 lambda prompt, k: call_openrouter(prompt, k))
        elif prov == "gemini":
            _add("gemini",     user_keys["gemini"],      settings.GEMINI_API_KEY,
                 lambda prompt, k: call_gemini(prompt, k))
        elif prov == "anthropic":
            _add("anthropic",  user_keys["anthropic"],   settings.ANTHROPIC_API_KEY,
                 lambda prompt, k: call_anthropic(prompt, k))

    # ── Tenta cada provider na ordem ─────────────────────────────────────
    using_trial = False
    for name, key, fn, key_type in candidates:
        if key_type == "trial":
            # Verifica limite de trial
            if user_keys["trial_used"] >= user_keys["trial_limit"]:
                logger.info(f"Trial limit reached for user {user_id}: {user_keys['trial_used']}/{user_keys['trial_limit']}")
                break  # Não tenta mais providers do servidor
            using_trial = True

        try:
            s = await fn(prompt, key)
            if name == "openrouter":
                model_used = s.pop("_openrouter_model", "openrouter-free")
                short_name = model_used.split("/")[-1].replace(":free", "")
                source_name = f"openrouter-{short_name}"
            elif name == "groq":
                source_name = "groq-llama3.3-70b"
            elif name == "gemini":
                source_name = "gemini-2.0-flash"
            else:
                source_name = "claude-sonnet"

            result = enrich_signal(s, ind)
            result["_byok"] = key_type == "own"

            if using_trial and user_id:
                await _increment_trial(user_id)
                trial_remaining = max(0, user_keys["trial_limit"] - user_keys["trial_used"] - 1)
                result["_trial_remaining"] = trial_remaining
                result["_trial_total"] = user_keys["trial_limit"]
                if trial_remaining <= 10:
                    result["_trial_warning"] = True

            logger.info(f"AI signal OK: {name} key_type={key_type} user={user_id}")
            return result, source_name

        except Exception as e:
            errors.append(f"{name}: {e}")
            logger.warning(f"{name} failed (user={user_id}): {e}")
            continue

    # ── Fallback: Rule Engine ─────────────────────────────────────────────
    s = rule_engine(ind)
    if errors:
        s["ai_errors"] = errors
    s["_byok"] = False

    # Informa o user que esgotou o trial
    if user_id and not has_own and user_keys["trial_used"] >= user_keys["trial_limit"]:
        s["_trial_exhausted"] = True
        s["_trial_total"] = user_keys["trial_limit"]

    return s, "rule-engine"


async def get_market_summary(market_data: dict, user_id: Optional[int] = None) -> str:
    """Generate AI market commentary. Usa chaves do user se disponíveis."""
    prompt = f"""You are a professional crypto market analyst. In 2-3 sentences, summarise the current market conditions:

Market Cap: ${market_data.get('total_market_cap_usd', 0):,.0f}
24h Change: {market_data.get('market_cap_change_24h', 0)}%
BTC Dominance: {market_data.get('btc_dominance', 0)}%
Fear & Greed: {market_data.get('fear_greed', {}).get('value', 50)} ({market_data.get('fear_greed', {}).get('classification', 'Neutral')})
24h Volume: ${market_data.get('total_volume_24h', 0):,.0f}

Respond in 2-3 concise sentences. Be specific about conditions. No intro phrases like \"The market...\"."""

    user_keys = await _get_user_keys(user_id)
    c = get_http_client()

    # Tenta Groq
    groq_key = user_keys["groq"] or (settings.GROQ_API_KEY if not user_keys["has_own_key"] else None)
    if groq_key:
        try:
            r = await c.post(
                "https://api.groq.com/openai/v1/chat/completions",
                headers={"Authorization": f"Bearer {groq_key}"},
                json={"model": "llama-3.3-70b-versatile", "max_tokens": 200, "temperature": 0.3,
                      "messages": [{"role": "user", "content": prompt}]},
            )
            r.raise_for_status()
            return r.json()["choices"][0]["message"]["content"].strip()
        except Exception as e:
            logger.warning(f"Market summary Groq: {e}")

    # Fallback OpenRouter
    openrouter_key = user_keys["openrouter"] or (settings.OPENROUTER_API_KEY if not user_keys["has_own_key"] else None)
    if openrouter_key:
        try:
            r = await c.post(
                "https://openrouter.ai/api/v1/chat/completions",
                headers={
                    "Authorization": f"Bearer {openrouter_key}",
                    "HTTP-Referer": "https://aimastercrypto.com",
                    "X-Title": "AIMasterCrypto",
                },
                json={
                    "model": "meta-llama/llama-3.3-70b-instruct:free",
                    "max_tokens": 200,
                    "temperature": 0.3,
                    "messages": [{"role": "user", "content": prompt}],
                },
            )
            r.raise_for_status()
            return r.json()["choices"][0]["message"]["content"].strip()
        except Exception as e:
            logger.warning(f"Market summary OpenRouter: {e}")

    return "Dados de mercado actualizados. Consulta os indicadores para análise detalhada."


async def get_ai_health() -> dict:
    """Verifica estado de cada provider. Usado por /admin/ai-health."""
    results = {}

    results["groq"] = {
        "configured": bool(settings.GROQ_API_KEY),
        "status": "not_configured",
        "model": "llama-3.3-70b-versatile",
    }
    if settings.GROQ_API_KEY:
        try:
            c = get_http_client()
            r = await c.post(
                "https://api.groq.com/openai/v1/chat/completions",
                headers={"Authorization": f"Bearer {settings.GROQ_API_KEY}"},
                json={"model": "llama-3.3-70b-versatile", "max_tokens": 10, "temperature": 0,
                      "messages": [{"role": "user", "content": "Reply: OK"}]},
            )
            r.raise_for_status()
            results["groq"]["status"] = "ok"
        except Exception as e:
            results["groq"]["status"] = f"error: {str(e)[:80]}"

    results["openrouter"] = {
        "configured": bool(settings.OPENROUTER_API_KEY),
        "status": "not_configured",
        "model": OPENROUTER_FREE_MODELS[0],
        "free_models": OPENROUTER_FREE_MODELS,
    }
    if settings.OPENROUTER_API_KEY:
        try:
            c = get_http_client()
            r = await c.post(
                "https://openrouter.ai/api/v1/chat/completions",
                headers={
                    "Authorization": f"Bearer {settings.OPENROUTER_API_KEY}",
                    "HTTP-Referer": "https://aimastercrypto.com",
                    "X-Title": "AIMasterCrypto",
                },
                json={
                    "model": OPENROUTER_FREE_MODELS[0],
                    "max_tokens": 10,
                    "temperature": 0,
                    "messages": [{"role": "user", "content": "Reply: OK"}],
                },
            )
            r.raise_for_status()
            results["openrouter"]["status"] = "ok"
        except Exception as e:
            results["openrouter"]["status"] = f"error: {str(e)[:80]}"

    results["gemini"] = {
        "configured": bool(settings.GEMINI_API_KEY),
        "status": "not_configured",
        "model": "gemini-2.0-flash",
    }
    if settings.GEMINI_API_KEY:
        try:
            c = get_http_client()
            url = f"https://generativelanguage.googleapis.com/v1beta/models/gemini-2.0-flash:generateContent?key={settings.GEMINI_API_KEY}"
            r = await c.post(url, json={"contents": [{"parts": [{"text": "Reply: OK"}]}],
                                         "generationConfig": {"maxOutputTokens": 10}})
            r.raise_for_status()
            results["gemini"]["status"] = "ok"
        except Exception as e:
            results["gemini"]["status"] = f"error: {str(e)[:80]}"

    results["anthropic"] = {
        "configured": bool(settings.ANTHROPIC_API_KEY),
        "status": "not_configured",
        "model": "claude-sonnet-4-20250514",
    }
    if settings.ANTHROPIC_API_KEY:
        try:
            c = get_http_client()
            r = await c.post(
                "https://api.anthropic.com/v1/messages",
                headers={"x-api-key": settings.ANTHROPIC_API_KEY,
                         "anthropic-version": "2023-06-01",
                         "Content-Type": "application/json"},
                json={"model": "claude-sonnet-4-20250514", "max_tokens": 10,
                      "messages": [{"role": "user", "content": "Reply: OK"}]},
            )
            r.raise_for_status()
            results["anthropic"]["status"] = "ok"
        except Exception as e:
            results["anthropic"]["status"] = f"error: {str(e)[:80]}"

    results["rule_engine"] = {"configured": True, "status": "ok", "model": "rule-engine-v1"}

    active = [k for k, v in results.items() if v.get("status") == "ok"]
    results["_summary"] = {
        "active_providers": active,
        "total_active": len(active),
        "fallback_chain": [p for p in ["groq", "openrouter", "gemini", "anthropic", "rule_engine"] if p in active],
    }

    return results
