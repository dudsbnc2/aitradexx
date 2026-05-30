"""
AIMasterCrypto — Auth Seguro V7
================================
Substitui os endpoints de login e refresh.

Mudanças em relação ao V6:
  - Access token: 15 min (era 60 min)
  - Refresh token: httpOnly cookie (era localStorage)
  - Rotação de refresh token a cada renovação
  - Token blacklist por JTI

INTEGRAÇÃO:
  # No main.py ou app/__init__.py, adicionar ao lado do router de auth existente:
  from app.routers.auth_secure import router as auth_secure_router
  app.include_router(auth_secure_router, prefix="/api/v1/auth", tags=["auth"])

  # No config.py, garantir:
  ACCESS_TOKEN_EXPIRE_MINUTES: int = 15   # era 60 — reduzir!
  REFRESH_TOKEN_EXPIRE_DAYS: int = 30
"""

from datetime import datetime, timezone
from fastapi import APIRouter, Depends, HTTPException, Request, Response
from sqlalchemy.ext.asyncio import AsyncSession
from sqlalchemy import select

# Ajustar estes imports para os teus módulos actuais
from app.core.database import get_db, User
from app.core.auth import (
    decode_token,
    is_token_blacklisted,
    blacklist_token,
    create_access_token,
    create_refresh_token,
    verify_password,
)
from app.core.config import settings

# Usar o mesmo limiter que o teu auth.py existente
try:
    from app.core.limiter import limiter
    HAS_LIMITER = True
except ImportError:
    HAS_LIMITER = False

router = APIRouter()


def _make_token(user) -> tuple[str, str]:
    """Cria par access+refresh token para o user."""
    data = {"sub": user.email, "uid": user.id, "role": user.role, "username": user.username}
    access_token = create_access_token(data)
    refresh_token = create_refresh_token(data)
    return access_token, refresh_token


def _user_dict(user) -> dict:
    """Serializa User para resposta JSON."""
    return {
        "id": user.id,
        "email": user.email,
        "username": user.username,
        "role": user.role,
        "is_active": user.is_active,
        "email_verified": getattr(user, "email_verified", False),
    }

# ── Configuração do cookie ───────────────────────────────────────────────────

COOKIE_NAME = "aic_refresh"
COOKIE_MAX_AGE = 60 * 60 * 24 * 30   # 30 dias
COOKIE_PATH = "/"                      # path raiz — browser envia em todos os pedidos ao domínio


def _set_refresh_cookie(response: Response, refresh_token: str) -> None:
    """Definir o cookie httpOnly de forma consistente."""
    response.set_cookie(
        key=COOKIE_NAME,
        value=refresh_token,
        httponly=True,           # JS não consegue ler — protege contra XSS
        secure=True,             # HTTPS only
        samesite="lax",          # lax em vez de strict — necessário para Railway cross-service
        max_age=COOKIE_MAX_AGE,
        path=COOKIE_PATH,
    )


def _clear_refresh_cookie(response: Response) -> None:
    """Limpar o cookie de refresh (logout)."""
    response.delete_cookie(
        key=COOKIE_NAME,
        path=COOKIE_PATH,
        samesite="lax",
        secure=True,
    )


# ── Endpoints ────────────────────────────────────────────────────────────────

@router.post("/login-secure")
async def login_secure(
    req: Request,
    response: Response,
    db: AsyncSession = Depends(get_db),
):
    """
    Login seguro V7.

    - Access token retornado no body (15 min) — frontend guarda em memória
    - Refresh token colocado em httpOnly cookie (30 dias) — JS não consegue ler

    Body esperado: { "email": "...", "password": "..." }
    """
    body = await req.json()
    email = body.get("email", "").strip().lower()
    password = body.get("password", "")

    if not email or not password:
        raise HTTPException(400, "Email e password são obrigatórios")

    if db is None:
        raise HTTPException(503, "Base de dados não disponível")

    result = await db.execute(select(User).where(User.email == email))
    user = result.scalar_one_or_none()

    if not user or not verify_password(password, user.hashed_password):
        raise HTTPException(401, "Credenciais inválidas")

    if not user.is_active:
        raise HTTPException(403, "Conta inativa")

    access_token, refresh_token = _make_token(user)

    # Refresh em cookie httpOnly — inacessível a JS
    _set_refresh_cookie(response, refresh_token)

    return {
        "access_token": access_token,
        "token_type": "bearer",
        "user": _user_dict(user),
    }


@router.post("/refresh-cookie")
async def refresh_from_cookie(
    request: Request,
    response: Response,
    db: AsyncSession = Depends(get_db),
):
    """
    Renovação de access token via httpOnly cookie.

    O frontend chama este endpoint silenciosamente (credentials: 'include').
    O browser envia o cookie automaticamente — JS nunca vê o refresh token.

    Implementa rotação: o refresh token antigo é invalidado e um novo é emitido.
    """
    refresh_token = request.cookies.get(COOKIE_NAME)
    if not refresh_token:
        raise HTTPException(401, "Sem refresh token")

    try:
        payload = decode_token(refresh_token)
    except Exception:
        _clear_refresh_cookie(response)
        raise HTTPException(401, "Refresh token inválido ou expirado")

    if payload.get("type") != "refresh":
        _clear_refresh_cookie(response)
        raise HTTPException(401, "Tipo de token inválido")

    jti = payload.get("jti")
    if jti and await is_token_blacklisted(jti):
        _clear_refresh_cookie(response)
        raise HTTPException(401, "Token revogado — re-login necessário")

    email = payload.get("sub")
    if not email:
        raise HTTPException(401, "Token sem subject")

    if db is None:
        raise HTTPException(503, "Base de dados não disponível")

    result = await db.execute(select(User).where(User.email == email))
    user = result.scalar_one_or_none()

    if not user or not user.is_active:
        _clear_refresh_cookie(response)
        raise HTTPException(401, "Utilizador não encontrado ou inativo")

    # Invalidar o refresh token antigo (rotação)
    if jti:
        expires_at = datetime.fromtimestamp(payload["exp"], tz=timezone.utc)
        await blacklist_token(jti, expires_at)

    # Emitir novos tokens
    new_access, new_refresh = _make_token(user)
    _set_refresh_cookie(response, new_refresh)

    return {
        "access_token": new_access,
        "token_type": "bearer",
    }


@router.post("/logout-secure")
async def logout_secure(
    request: Request,
    response: Response,
    db: AsyncSession = Depends(get_db),
):
    """
    Logout: invalida o refresh token e limpa o cookie.
    O frontend deve limpar o access token da memória (clearAuth()).
    """
    refresh_token = request.cookies.get(COOKIE_NAME)

    if refresh_token:
        try:
            payload = decode_token(refresh_token)
            jti = payload.get("jti")
            if jti:
                expires_at = datetime.fromtimestamp(payload["exp"], tz=timezone.utc)
                await blacklist_token(jti, expires_at)
        except Exception:
            pass  # Token já inválido — limpar cookie na mesma

    _clear_refresh_cookie(response)
    return {"detail": "Logout efectuado com sucesso"}
