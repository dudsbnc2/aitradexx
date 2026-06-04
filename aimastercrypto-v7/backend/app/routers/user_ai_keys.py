"""
Router: /api/user/ai-keys
Permite ao utilizador guardar, ver (mascaradas) e apagar as suas chaves de IA.
As chaves são encriptadas em repouso com Fernet (mesma chave usada para exchange secrets).
"""
import logging
from typing import Optional
from fastapi import APIRouter, Depends, HTTPException
from pydantic import BaseModel
from app.core.auth import require_verified
from app.core.config import settings

logger = logging.getLogger("tradeia.user_ai_keys")
router = APIRouter(prefix="/api/user/ai-keys", tags=["user-ai-keys"])

VALID_PROVIDERS = {"groq", "openrouter", "gemini", "anthropic"}


# ── Helpers Fernet ────────────────────────────────────────────────────────

def _encrypt(value: str) -> str:
    from cryptography.fernet import Fernet
    if not settings.ENCRYPTION_KEY:
        raise HTTPException(500, "ENCRYPTION_KEY não configurada no servidor")
    f = Fernet(settings.ENCRYPTION_KEY.encode())
    return f.encrypt(value.encode()).decode()


def _mask(encrypted: Optional[str]) -> Optional[str]:
    """Devolve os últimos 4 chars da chave original (para o user confirmar que foi guardada)."""
    if not encrypted:
        return None
    try:
        from cryptography.fernet import Fernet
        if not settings.ENCRYPTION_KEY:
            return "****"
        f = Fernet(settings.ENCRYPTION_KEY.encode())
        plain = f.decrypt(encrypted.encode()).decode()
        if len(plain) <= 8:
            return "****"
        return "•" * (len(plain) - 4) + plain[-4:]
    except Exception:
        return "****"


# ── Schemas ───────────────────────────────────────────────────────────────

class SaveKeyRequest(BaseModel):
    provider: str     # groq | openrouter | gemini | anthropic
    api_key: str
    set_as_preferred: bool = False


class SetPreferredRequest(BaseModel):
    provider: Optional[str] = None   # None = limpar preferência


class SetTrialLimitRequest(BaseModel):
    """Apenas admin pode usar este endpoint (ver admin_ops.py)."""
    user_id: int
    limit: int


# ── Endpoints ─────────────────────────────────────────────────────────────

@router.get("")
async def get_ai_keys(current_user=Depends(require_verified)):
    """Devolve as chaves do user mascaradas + estado de trial."""
    uid = current_user.get("uid")
    try:
        from app.core.database import AsyncSessionLocal, User
        if AsyncSessionLocal is None:
            raise HTTPException(503, "Base de dados não disponível")
        async with AsyncSessionLocal() as session:
            user = await session.get(User, uid)
            if not user:
                raise HTTPException(404, "Utilizador não encontrado")

            providers_configured = {
                "groq":       _mask(user.ai_groq_key),
                "openrouter": _mask(user.ai_openrouter_key),
                "gemini":     _mask(user.ai_gemini_key),
                "anthropic":  _mask(user.ai_anthropic_key),
            }
            has_own = any(v is not None for v in providers_configured.values())
            trial_used  = user.ai_trial_used or 0
            trial_limit = user.ai_trial_limit or 50

            return {
                "providers": providers_configured,
                "preferred": user.ai_preferred,
                "has_own_key": has_own,
                "trial": {
                    "used":      trial_used,
                    "limit":     trial_limit,
                    "remaining": max(0, trial_limit - trial_used),
                    "exhausted": trial_used >= trial_limit,
                },
                "server_keys_active": {
                    "groq":       bool(settings.GROQ_API_KEY),
                    "openrouter": bool(settings.OPENROUTER_API_KEY),
                    "gemini":     bool(settings.GEMINI_API_KEY),
                    "anthropic":  bool(settings.ANTHROPIC_API_KEY),
                },
            }
    except HTTPException:
        raise
    except Exception as e:
        logger.error(f"get_ai_keys uid={uid}: {e}")
        raise HTTPException(500, "Erro ao carregar chaves")


@router.post("")
async def save_ai_key(req: SaveKeyRequest, current_user=Depends(require_verified)):
    """Guarda ou actualiza a chave de um provider."""
    uid = current_user.get("uid")

    if req.provider not in VALID_PROVIDERS:
        raise HTTPException(400, f"Provider inválido. Use: {', '.join(VALID_PROVIDERS)}")
    if not req.api_key or len(req.api_key.strip()) < 10:
        raise HTTPException(400, "Chave inválida (muito curta)")

    encrypted = _encrypt(req.api_key.strip())

    try:
        from app.core.database import AsyncSessionLocal, User
        if AsyncSessionLocal is None:
            raise HTTPException(503, "Base de dados não disponível")
        async with AsyncSessionLocal() as session:
            user = await session.get(User, uid)
            if not user:
                raise HTTPException(404, "Utilizador não encontrado")

            col_map = {
                "groq":       "ai_groq_key",
                "openrouter": "ai_openrouter_key",
                "gemini":     "ai_gemini_key",
                "anthropic":  "ai_anthropic_key",
            }
            setattr(user, col_map[req.provider], encrypted)

            if req.set_as_preferred:
                user.ai_preferred = req.provider

            await session.commit()
            logger.info(f"AI key saved: uid={uid} provider={req.provider}")
            return {"ok": True, "provider": req.provider, "preferred": user.ai_preferred}
    except HTTPException:
        raise
    except Exception as e:
        logger.error(f"save_ai_key uid={uid}: {e}")
        raise HTTPException(500, "Erro ao guardar chave")


@router.delete("/{provider}")
async def delete_ai_key(provider: str, current_user=Depends(require_verified)):
    """Remove a chave de um provider específico."""
    uid = current_user.get("uid")

    if provider not in VALID_PROVIDERS:
        raise HTTPException(400, f"Provider inválido. Use: {', '.join(VALID_PROVIDERS)}")

    try:
        from app.core.database import AsyncSessionLocal, User
        if AsyncSessionLocal is None:
            raise HTTPException(503, "Base de dados não disponível")
        async with AsyncSessionLocal() as session:
            user = await session.get(User, uid)
            if not user:
                raise HTTPException(404, "Utilizador não encontrado")

            col_map = {
                "groq":       "ai_groq_key",
                "openrouter": "ai_openrouter_key",
                "gemini":     "ai_gemini_key",
                "anthropic":  "ai_anthropic_key",
            }
            setattr(user, col_map[provider], None)

            # Se era o preferred, limpa
            if user.ai_preferred == provider:
                user.ai_preferred = None

            await session.commit()
            logger.info(f"AI key deleted: uid={uid} provider={provider}")
            return {"ok": True, "provider": provider}
    except HTTPException:
        raise
    except Exception as e:
        logger.error(f"delete_ai_key uid={uid}: {e}")
        raise HTTPException(500, "Erro ao apagar chave")


@router.patch("/preferred")
async def set_preferred_provider(req: SetPreferredRequest, current_user=Depends(require_verified)):
    """Define qual o provider preferido (será tentado primeiro)."""
    uid = current_user.get("uid")

    if req.provider and req.provider not in VALID_PROVIDERS:
        raise HTTPException(400, f"Provider inválido. Use: {', '.join(VALID_PROVIDERS)}")

    try:
        from app.core.database import AsyncSessionLocal, User
        if AsyncSessionLocal is None:
            raise HTTPException(503, "Base de dados não disponível")
        async with AsyncSessionLocal() as session:
            user = await session.get(User, uid)
            if not user:
                raise HTTPException(404, "Utilizador não encontrado")
            user.ai_preferred = req.provider
            await session.commit()
            return {"ok": True, "preferred": req.provider}
    except HTTPException:
        raise
    except Exception as e:
        logger.error(f"set_preferred uid={uid}: {e}")
        raise HTTPException(500, "Erro ao actualizar preferência")
