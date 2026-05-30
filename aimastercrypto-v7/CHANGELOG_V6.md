# AIMasterCrypto v6 — Changelog de Melhorias

## Resumo

Esta versão implementa as **PRIORIDADES 1 e 2** da análise técnica:
segurança, performance, escalabilidade e monetização de base.

---

## 🔴 PRIORIDADE 1 — Segurança (Crítico)

### ✅ WebSocket Auth obrigatória
**Ficheiro:** `backend/app/routers/ws.py`

- `/ws/scanner` agora requer JWT válido via query param `?token=...`
- `/ws/alerts` requer JWT — canal pessoal por user ID
- `/ws/prices` é público mas com connection limits
- Role check: scanner só para `premium | admin | superadmin`
- Fechamento limpo com códigos WS corretos (`1008 Policy Violation`)

### ✅ Rate Limit por User ID (não só IP)
**Ficheiro:** `backend/app/core/security_middleware.py`

- `rate_limit_key()` extrai o UID do JWT
- Fallback para IP se não autenticado
- Resiste a VPN / IP spoofing
- Aplicado em todos os routers de signals

### ✅ WebSocket Connection Limiter
**Ficheiro:** `backend/app/core/security_middleware.py`

- `WebSocketLimiter`: max 10 conexões por IP, 500 no total
- Singleton `ws_limiter` partilhado por todos os WS endpoints
- `/health` expõe stats de conexões

### ✅ Token Blacklist (logout real)
**Ficheiros:** `backend/app/core/auth.py`, `backend/app/routers/auth.py`

- `create_access_token()` e `create_refresh_token()` agora incluem `jti` (JWT ID único)
- `blacklist_token(jti, expires_at)` armazena em Redis com TTL automático
- `is_token_blacklisted(jti)` verifica antes de autorizar
- `POST /api/auth/logout` revoga access + refresh token
- DB model `RefreshTokenBlacklist` para persistência

### ✅ Security Headers Middleware
**Ficheiro:** `backend/app/core/security_middleware.py`

Headers adicionados em todas as respostas:
```
X-Frame-Options: DENY
X-Content-Type-Options: nosniff
X-XSS-Protection: 1; mode=block
Strict-Transport-Security: max-age=31536000 (só em production)
Referrer-Policy: strict-origin-when-cross-origin
Permissions-Policy: camera=(), microphone=(), geolocation=()
Content-Security-Policy: (configurável)
```
Remove `Server` e `X-Powered-By` do response.

### ✅ Structured Logging (loguru JSON)
**Ficheiro:** `backend/app/core/logging_config.py`

- Em `production`: JSON por linha (compatível com Railway / Datadog / Grafana)
- Em `development`: output colorido legível
- Intercepts todos os loggers stdlib (uvicorn, sqlalchemy, etc.)
- `audit_log()` para eventos de segurança estruturados
- Zero breaking changes — setup via `setup_logging()` no startup

---

## 🟡 PRIORIDADE 2 — Crescimento e Monetização

### ✅ Redis Cache Layer
**Ficheiro:** `backend/app/core/cache.py`

Decorator `@cache_response(ttl=X, key_prefix="Y")` aplicado a:

| Endpoint | TTL |
|---|---|
| `/market/overview` | 30s |
| `/market/fear-greed` | 5min |
| `/market/trending` | 2min |
| `/market/news` | 2min |
| `/market/price/{pair}` | 5s |
| `/signals/indicators` | 30s |
| `/signals/performance` | 60s |

Cache inteligente:
- Keys hierárquicas: `cache:{prefix}:{hash_args}`
- Bypass automático se Redis down (sem crash)
- `invalidate_prefix()` para limpar cache por namespace
- TTL presets prontos para todos os tipos

### ✅ API Versioning
**Ficheiro:** `backend/app/main.py`

- Todos os routers servidos em `/api/v1/` (novo)
- `/api/` mantido para backwards compatibility
- Preparado para `/api/v2/` no futuro

### ✅ Novos Modelos DB
**Ficheiro:** `backend/app/core/database.py`

**`RefreshTokenBlacklist`** — tokens revogados
```
id, jti (indexed), user_id, revoked_at, expires_at
```

**`AdminAuditLog`** — auditoria persistente no DB
```
id, admin_id, admin_email, action, target_type, target_id,
detail (JSON), ip_address, ok, created_at (indexed)
```

**`Subscription`** — gestão de planos
```
id, user_id, plan (free|pro|elite|institutional),
status (active|cancelled|trialing|past_due),
stripe_customer_id, stripe_subscription_id,
payment_provider (stripe|crypto|manual),
current_period_start/end, trial_ends_at,
referred_by, created_at
```

**`ReferralLink`** — sistema de afiliados
```
id, user_id, code (unique), clicks, conversions,
commission_total, created_at
```

### ✅ Admin — Novos Endpoints
**Ficheiro:** `backend/app/routers/admin.py`

- `GET /api/admin/audit-log` — consultar log de auditoria DB (filtros: action, admin_email)
- `GET /api/admin/ws-stats` — conexões WebSocket em tempo real
- `GET /api/admin/subscriptions` — listar subscrições (filtro por plan)
- `POST /api/admin/subscriptions/update` — atribuir plano manualmente (com audit log)

### ✅ Logout Endpoint
**Ficheiro:** `backend/app/routers/auth.py`

`POST /api/auth/logout`
- Revoga access token (Redis)
- Revoga refresh token (Redis + DB)
- Regista evento de auditoria

---

## 📁 Ficheiros Novos

| Ficheiro | Descrição |
|---|---|
| `backend/app/core/logging_config.py` | Structured logging (loguru) |
| `backend/app/core/cache.py` | Redis cache decorator |
| `backend/app/core/security_middleware.py` | Security headers + rate limit key + WS limiter |

## 📝 Ficheiros Modificados

| Ficheiro | O que mudou |
|---|---|
| `backend/app/main.py` | Novo startup, versioning, security middleware |
| `backend/app/core/auth.py` | JTI nos tokens, blacklist, async variant |
| `backend/app/core/database.py` | 4 novos modelos |
| `backend/app/routers/ws.py` | Auth + connection limits + alerts channel |
| `backend/app/routers/market.py` | Cache em todos os endpoints |
| `backend/app/routers/signals.py` | Rate limit por user ID + cache |
| `backend/app/routers/auth.py` | Endpoint /logout |
| `backend/app/routers/admin.py` | Audit log DB + subscriptions + ws-stats |
| `backend/requirements.txt` | +loguru |
| `.env.example` | Stripe vars + documentação melhorada |

---

## ⚠️ Breaking Changes

1. **WebSocket scanner**: passa a exigir `?token=<JWT>` — actualizar frontend
2. **Routers duplicados** em `/api/` e `/api/v1/` — migrar para `/api/v1/` gradualmente
3. **Logout** requer chamar `POST /auth/logout` para invalidar tokens — actualizar frontend

---

## 🚀 Próximos Passos (v7)

- [ ] Celery + Redis Queue para scanner async
- [ ] Onboarding wizard (frontend)
- [ ] Stripe webhook para pagamentos
- [ ] Push notifications (browser + Telegram)
- [ ] Paper trading engine
- [ ] Gamificação (XP, streaks, badges)
