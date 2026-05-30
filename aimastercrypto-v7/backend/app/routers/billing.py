"""
AIMasterCrypto — Billing V7 (Stripe)
=====================================
Router de pagamentos com Stripe Checkout.

SETUP:
  1. pip install stripe
  2. Adicionar ao .env:
       STRIPE_SECRET_KEY=sk_live_...
       STRIPE_WEBHOOK_SECRET=whsec_...
       STRIPE_PRICE_PRO_MONTHLY=price_...
       STRIPE_PRICE_ELITE_MONTHLY=price_...
       FRONTEND_URL=https://aimastercrypto.com

  3. No main.py:
       from app.routers.billing import router as billing_router
       app.include_router(billing_router, prefix="/api/v1")

  4. Configurar webhook no Stripe Dashboard:
       Endpoint: https://aimastercrypto.com/api/v1/billing/webhook
       Eventos: checkout.session.completed, customer.subscription.deleted

PLANOS SUPORTADOS:
  - pro_monthly     → role "premium"
  - elite_monthly   → role "elite"
"""

import logging
from fastapi import APIRouter, Depends, HTTPException, Request
from sqlalchemy.ext.asyncio import AsyncSession
from sqlalchemy import select

try:
    import stripe
    STRIPE_AVAILABLE = True
except ImportError:
    STRIPE_AVAILABLE = False
    stripe = None  # type: ignore

from app.core.database import get_db, User
from app.core.config import settings
from app.core.auth import get_current_user_async

logger = logging.getLogger("tradeia.billing")
router = APIRouter(prefix="/billing", tags=["billing"])

# Mapeamento plano → role
PLAN_ROLES = {
    "pro_monthly": "premium",
    "elite_monthly": "elite",
}


def _get_stripe():
    """Valida que Stripe está configurado antes de usar."""
    if not STRIPE_AVAILABLE:
        raise HTTPException(503, "Stripe não instalado — pip install stripe")
    if not settings.STRIPE_SECRET_KEY:
        raise HTTPException(503, "STRIPE_SECRET_KEY não configurado")
    stripe.api_key = settings.STRIPE_SECRET_KEY
    return stripe


# ── Endpoints ────────────────────────────────────────────────────────────────

@router.post("/create-checkout")
async def create_checkout(
    request: Request,
    current_user: dict = Depends(get_current_user_async),
    db: AsyncSession = Depends(get_db),
):
    """
    Cria uma sessão Stripe Checkout.

    Body: { "plan": "pro_monthly" | "elite_monthly" }
    Retorna: { "checkout_url": "https://checkout.stripe.com/..." }
    """
    s = _get_stripe()

    body = await request.json()
    plan = body.get("plan", "")

    if plan not in PLAN_ROLES:
        raise HTTPException(400, f"Plano inválido: {plan}. Use: {list(PLAN_ROLES.keys())}")

    price_map = {
        "pro_monthly": getattr(settings, "STRIPE_PRICE_PRO_MONTHLY", ""),
        "elite_monthly": getattr(settings, "STRIPE_PRICE_ELITE_MONTHLY", ""),
    }
    price_id = price_map.get(plan, "")

    if not price_id:
        raise HTTPException(503, f"Price ID não configurado para o plano '{plan}'")

    user_email = current_user.get("sub", "")
    user_id = current_user.get("uid", "")
    frontend_url = getattr(settings, "FRONTEND_URL", "https://aimastercrypto.com")

    try:
        session = s.checkout.Session.create(
            mode="subscription",
            line_items=[{"price": price_id, "quantity": 1}],
            success_url=f"{frontend_url}/success?session_id={{CHECKOUT_SESSION_ID}}",
            cancel_url=f"{frontend_url}/pricing?cancelled=1",
            customer_email=user_email,
            metadata={
                "user_id": str(user_id),
                "plan": plan,
            },
            subscription_data={
                "metadata": {
                    "user_id": str(user_id),
                    "plan": plan,
                }
            },
        )
    except Exception as e:
        logger.error(f"Stripe checkout error: {e}")
        raise HTTPException(500, f"Erro ao criar sessão de pagamento: {e}")

    logger.info(f"Checkout criado para user_id={user_id} plan={plan}")
    return {"checkout_url": session.url}


@router.post("/create-portal")
async def create_billing_portal(
    current_user: dict = Depends(get_current_user_async),
    db: AsyncSession = Depends(get_db),
):
    """
    Abre o portal de gestão de subscrição do Stripe (cancelar, mudar plano, etc.).
    Requer que o utilizador já tenha um stripe_customer_id guardado.
    """
    s = _get_stripe()

    user_id = current_user.get("uid")
    if db is None:
        raise HTTPException(503, "DB não disponível")

    result = await db.execute(select(User).where(User.id == user_id))
    user = result.scalar_one_or_none()

    if not user:
        raise HTTPException(404, "Utilizador não encontrado")

    customer_id = getattr(user, "stripe_customer_id", None)
    if not customer_id:
        raise HTTPException(400, "Sem subscrição Stripe associada")

    frontend_url = getattr(settings, "FRONTEND_URL", "https://aimastercrypto.com")

    try:
        portal = s.billing_portal.Session.create(
            customer=customer_id,
            return_url=f"{frontend_url}/dashboard",
        )
    except Exception as e:
        logger.error(f"Stripe portal error: {e}")
        raise HTTPException(500, f"Erro ao abrir portal: {e}")

    return {"portal_url": portal.url}


@router.get("/status")
async def billing_status(
    current_user: dict = Depends(get_current_user_async),
    db: AsyncSession = Depends(get_db),
):
    """Retorna o estado atual da subscrição do utilizador."""
    if db is None:
        raise HTTPException(503, "DB não disponível")

    user_id = current_user.get("uid")
    result = await db.execute(select(User).where(User.id == user_id))
    user = result.scalar_one_or_none()

    if not user:
        raise HTTPException(404, "Utilizador não encontrado")

    return {
        "role": user.role,
        "is_premium": user.role in ("premium", "elite"),
        "is_elite": user.role == "elite",
        "stripe_customer_id": getattr(user, "stripe_customer_id", None),
    }


# ── Webhook ──────────────────────────────────────────────────────────────────

@router.post("/webhook")
async def stripe_webhook(
    request: Request,
    db: AsyncSession = Depends(get_db),
):
    """
    Webhook do Stripe — recebe eventos e actualiza a DB.

    Eventos tratados:
      - checkout.session.completed  → activar subscrição
      - customer.subscription.deleted → desactivar subscrição
    """
    s = _get_stripe()

    payload = await request.body()
    sig_header = request.headers.get("stripe-signature", "")
    webhook_secret = getattr(settings, "STRIPE_WEBHOOK_SECRET", "")

    if not webhook_secret:
        logger.warning("STRIPE_WEBHOOK_SECRET não configurado — a aceitar sem verificar assinatura")
        try:
            import json
            event = {"type": "unknown", "data": {"object": json.loads(payload)}}
        except Exception:
            raise HTTPException(400, "Payload inválido")
    else:
        try:
            event = s.Webhook.construct_event(payload, sig_header, webhook_secret)
        except s.error.SignatureVerificationError:
            raise HTTPException(400, "Assinatura Stripe inválida")
        except Exception as e:
            raise HTTPException(400, f"Webhook error: {e}")

    event_type = event.get("type", "")
    obj = event["data"]["object"]

    logger.info(f"Stripe webhook: {event_type}")

    if event_type == "checkout.session.completed":
        await _handle_checkout_completed(obj, db)

    elif event_type == "customer.subscription.deleted":
        await _handle_subscription_deleted(obj, db)

    elif event_type == "invoice.payment_failed":
        # Opcional: notificar o utilizador
        customer_id = obj.get("customer")
        logger.warning(f"Pagamento falhado para customer={customer_id}")

    return {"received": True}


async def _handle_checkout_completed(session: dict, db: AsyncSession) -> None:
    """Activar subscrição após checkout completo."""
    if db is None:
        logger.error("DB não disponível — não foi possível activar subscrição")
        return

    user_id_str = session.get("metadata", {}).get("user_id")
    plan = session.get("metadata", {}).get("plan", "")
    customer_id = session.get("customer")

    if not user_id_str:
        logger.error("checkout.session.completed sem user_id no metadata")
        return

    try:
        user_id = int(user_id_str)
    except ValueError:
        logger.error(f"user_id inválido: {user_id_str}")
        return

    result = await db.execute(select(User).where(User.id == user_id))
    user = result.scalar_one_or_none()

    if not user:
        logger.error(f"User {user_id} não encontrado")
        return

    new_role = PLAN_ROLES.get(plan, "premium")
    user.role = new_role

    # Guardar stripe_customer_id se o campo existir no modelo
    if customer_id and hasattr(user, "stripe_customer_id"):
        user.stripe_customer_id = customer_id

    await db.commit()
    logger.info(f"User {user_id} activado: role={new_role}, plan={plan}")


async def _handle_subscription_deleted(subscription: dict, db: AsyncSession) -> None:
    """Desactivar subscrição quando cancelada no Stripe."""
    if db is None:
        return

    customer_id = subscription.get("customer")
    if not customer_id:
        return

    if not hasattr(User, "stripe_customer_id"):
        logger.warning("User model não tem campo stripe_customer_id — não foi possível encontrar utilizador")
        return

    result = await db.execute(
        select(User).where(User.stripe_customer_id == customer_id)
    )
    user = result.scalar_one_or_none()

    if not user:
        logger.warning(f"User com customer_id={customer_id} não encontrado")
        return

    user.role = "free"
    await db.commit()
    logger.info(f"User {user.id} downgraded para free (subscrição cancelada)")
