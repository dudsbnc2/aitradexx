# AIMasterCrypto V7 — Guia de Integração

## Estrutura dos ficheiros produzidos

```
aimastercrypto-v7/
├── backend/
│   └── app/
│       ├── core/
│       │   └── task_manager.py          ✅ Task manager com retry e observabilidade
│       ├── routers/
│       │   ├── auth_secure.py           ✅ Login seguro + refresh httpOnly cookie
│       │   ├── billing.py               ✅ Stripe Checkout + Webhook
│       │   └── admin_ops.py             ✅ Dashboard operacional + Signal analytics
│       ├── services/
│       │   ├── quant_engine.py          ✅ Motor quantitativo probabilístico
│       │   └── signal_staleness.py      ✅ Confidence decay (sinal envelhece)
│       └── websockets/
│           └── throttler.py             ✅ Rate limit WebSocket por conexão
└── frontend/
    ├── lib/
    │   ├── auth-manager.ts              ✅ Token em memória + refresh via cookie
    │   └── api-interceptor.ts           ✅ Axios interceptor com auto-renovação
    └── components/
        ├── QuantPanel.tsx               ✅ Painel quant no SignalCard
        └── RegimeWidget.tsx             ✅ Badge de regime de mercado
```

---

## Semana 1 — Segurança (CRÍTICO)

### 1. Registar os novos endpoints de auth

No teu `main.py`:

```python
from app.routers.auth_secure import router as auth_secure_router
app.include_router(auth_secure_router, prefix="/api/v1/auth", tags=["auth"])
```

### 2. Reduzir duração do access token

No teu `config.py`:

```python
ACCESS_TOKEN_EXPIRE_MINUTES: int = 15   # era 60 — obrigatório reduzir
REFRESH_TOKEN_EXPIRE_DAYS: int = 30
```

### 3. Garantir que `_make_token` gera token de refresh

O `auth_secure.py` assume que `_make_token(user)` retorna `(access_token, refresh_token)`.
Verifica o teu `security.py` — se só retorna um token, adicionar suporte a refresh token com
campo `"type": "refresh"` e um `jti` (UUID) no payload JWT.

### 4. Frontend — substituir localStorage

No `page.tsx`, `AuthModal.handleSubmit`:

```typescript
// ❌ REMOVER:
localStorage.setItem('access_token', data.access_token)
localStorage.setItem('refresh_token', data.refresh_token)

// ✅ SUBSTITUIR:
import { setAccessToken } from '@/lib/auth-manager'
setAccessToken(data.access_token)
```

No `app/layout.tsx`:

```typescript
'use client'
import { useEffect } from 'react'
import { initAuth } from '@/lib/auth-manager'
import { useAuthExpiredRedirect } from '@/lib/api-interceptor'

export default function RootLayout({ children }) {
  useAuthExpiredRedirect('/login')

  useEffect(() => {
    initAuth()  // Tenta renovar token via cookie httpOnly no arranque
  }, [])

  return <html>{children}</html>
}
```

No teu `api.ts` (onde crias a instância axios):

```typescript
import { setupApiInterceptors } from '@/lib/api-interceptor'
const api = axios.create({ baseURL: '/api/v1' })
setupApiInterceptors(api)  // Adicionar esta linha
export default api
```

---

## Semana 2 — Motor Quantitativo

### 5. Integrar quant_engine no signal_service.py

```python
from app.services.quant_engine import quant_signal, quant_to_dict

async def run_signal(pair, timeframe, use_mtf=True, use_ai=True, user_id=None):
    candles = await fetch_candles(pair, timeframe)
    ind = compute_indicators(candles)

    # Quant corre sempre — independente de AI
    quant = quant_signal(ind, price=ind['price'], atr_val=ind['atr'])

    # AI enriquece com narrativa
    if use_ai:
        signal, source = await get_ai_signal(pair, timeframe, ind, mtf)
        signal["source"] = source
    else:
        signal = rule_engine(ind)

    # SEMPRE adicionar dados quant ao sinal
    signal["quant"] = quant_to_dict(quant)

    # Override: se quant diz WAIT e confiança é baixa, forçar WAIT
    if quant.bias == 'WAIT' and signal.get('confidence', 0) < 65:
        signal['bias'] = 'WAIT'
        signal['analysis'] = (
            signal.get('analysis', '') +
            f" [Quant override: regime {quant.regime}, edge {quant.edge_score}/100]"
        )

    return signal
```

### 6. Adicionar staleness ao histórico de sinais

```python
from app.services.signal_staleness import apply_staleness_to_history

@router.get("/signals/history")
async def get_signal_history(...):
    signals = [s.__dict__ for s in db_signals]
    signals = apply_staleness_to_history(signals)  # Adicionar esta linha
    return signals
```

### 7. Adicionar QuantPanel ao SignalCard

```tsx
import QuantPanel from '@/components/QuantPanel'
import RegimeWidget from '@/components/RegimeWidget'

// No JSX do SignalCard, após o AI analysis section:
{signal.quant && (
  <>
    <RegimeWidget
      regime={signal.quant.regime}
      note={signal.quant.regime_note}
      className="mb-2"
    />
    <QuantPanel quant={signal.quant} />
  </>
)}
```

---

## Semana 3 — Robustez

### 8. Migrar para task_manager

No `main.py`, substituir `asyncio.create_task` pelo task_manager:

```python
from app.core.task_manager import task_manager

@asynccontextmanager
async def lifespan(app: FastAPI):
    init_engine()
    await create_tables()

    # Em vez de: asyncio.create_task(price_broadcaster(ALL_PAIRS))
    task_manager.spawn("price_broadcaster", price_broadcaster(ALL_PAIRS), retry=5)

    yield

    await task_manager.shutdown()
    # ... resto do cleanup
```

Para outcome checks em `signal_service.py`:

```python
from app.core.task_manager import task_manager

# Em vez de: asyncio.create_task(_delayed())
task_manager.spawn_delayed(
    name=f"outcome_check_{signal_id}",
    coro_factory=_check_outcome,
    delay_seconds=delay_minutes * 60,
    signal_id=signal_id,
    pair=pair,
    timeframe=timeframe,
    bias=bias,
    entry=entry,
    stop_loss=stop_loss,
    take_profit=take_profit,
)
```

### 9. WebSocket rate limiting

No teu `ws.py`:

```python
from app.websockets.throttler import ws_throttler

@router.websocket("/ws")
async def websocket_endpoint(websocket: WebSocket, ...):
    conn_id = str(id(websocket))
    ws_throttler.register(conn_id)
    try:
        while True:
            data = await websocket.receive_text()

            if not ws_throttler.allow(conn_id):
                await websocket.send_json({
                    "type": "error",
                    "code": "RATE_LIMITED",
                    "detail": "Demasiadas mensagens — aguarda um momento"
                })
                continue

            # processar data normalmente...
    finally:
        ws_throttler.remove(conn_id)
```

### 10. Adicionar endpoints de admin

No `main.py` ou onde registas routers:

```python
from app.routers.admin_ops import router as admin_ops_router
app.include_router(admin_ops_router, prefix="/api/v1/admin", tags=["admin-ops"])
```

Endpoints disponíveis:
- `GET /api/v1/admin/operations` — tasks, WS, Redis em tempo real
- `GET /api/v1/admin/signals/analytics?days=30` — win rate por timeframe e par
- `GET /api/v1/admin/health` — health check completo

---

## Semana 4 — Stripe

### 11. Instalar e configurar Stripe

```bash
pip install stripe
```

No `.env`:
```
STRIPE_SECRET_KEY=sk_live_...
STRIPE_WEBHOOK_SECRET=whsec_...
STRIPE_PRICE_PRO_MONTHLY=price_...
STRIPE_PRICE_ELITE_MONTHLY=price_...
FRONTEND_URL=https://aimastercrypto.com
```

No `config.py`:
```python
STRIPE_SECRET_KEY: str = ""
STRIPE_WEBHOOK_SECRET: str = ""
STRIPE_PRICE_PRO_MONTHLY: str = ""
STRIPE_PRICE_ELITE_MONTHLY: str = ""
FRONTEND_URL: str = "https://aimastercrypto.com"
```

Registar o router:
```python
from app.routers.billing import router as billing_router
app.include_router(billing_router, prefix="/api/v1")
```

Configurar webhook no Stripe Dashboard:
- URL: `https://aimastercrypto.com/api/v1/billing/webhook`
- Eventos: `checkout.session.completed`, `customer.subscription.deleted`, `invoice.payment_failed`

Adicionar `stripe_customer_id` ao modelo User (migration necessária):
```python
stripe_customer_id: Optional[str] = Column(String, nullable=True, unique=True)
```

---

## Validação rápida

Após integrar semana 1, testar:

```bash
# 1. Login seguro
curl -X POST /api/v1/auth/login-secure \
  -H "Content-Type: application/json" \
  -d '{"email":"test@test.com","password":"..."}' \
  -c cookies.txt -v
# Deve ver: Set-Cookie: aic_refresh=...; HttpOnly

# 2. Refresh via cookie
curl -X POST /api/v1/auth/refresh-cookie \
  -b cookies.txt -v
# Deve retornar novo access_token

# 3. Logout
curl -X POST /api/v1/auth/logout-secure \
  -b cookies.txt -v
# Deve limpar o cookie
```

Após integrar semana 2:

```bash
# Verificar que sinal tem campo quant
curl /api/v1/signals/BTCUSDT/1H -H "Authorization: Bearer ..."
# Deve ter: signal.quant.regime, signal.quant.edge_score, etc.
```
