# Correções v7-fixed

## Bugs corrigidos

### 1. Registo dava 422 / Login falhava
- **Causa**: `login()` chamava `/v1/auth/login-secure` (endpoint seguro V7) mas o registo chamava `/auth/register` (endpoint clássico). Endpoints diferentes, comportamentos diferentes.
- **Fix**: Ambos agora usam `/auth/login` e `/auth/register` — consistentes.

### 2. Site acessível sem login
- **Causa**: `NEXT_PUBLIC_API_URL` não definido no Railway → frontend usava `window.location.origin` (URL do frontend) para chamadas API → as chamadas falhavam silenciosamente e o middleware não redirecionava.
- **Fix**: Definir `NEXT_PUBLIC_API_URL` no Railway (ver abaixo).

### 3. Registo bloqueado em produção sem DB
- **Causa**: Código tinha `if settings.ENV == "production": raise HTTPException(503)` quando `DATABASE_URL` não estava definido.
- **Fix**: Removido o bloqueio — fallback in-memory funciona em qualquer ambiente.

### 4. Gemini dava 404
- **Causa**: Modelo `gemini-1.5-flash` foi descontinuado.
- **Fix**: Atualizado para `gemini-2.0-flash`.

### 5. WebSocket URL errada
- **Causa**: WebSocket tentava ligar a `ws://localhost:8000` (origem do frontend).
- **Fix**: Usa `NEXT_PUBLIC_API_URL` se definido.

### 6. `Optional` não importado
- **Causa**: `auth.py` usava `Optional[str]` sem importar do `typing`.
- **Fix**: Adicionado `from typing import Optional`.

---

## Deploy no Railway

### Passo 1 — Backend (variáveis de ambiente)

No Railway → backend service → Variables:

| Variável | Valor |
|---|---|
| `SECRET_KEY` | `openssl rand -hex 32` |
| `DATABASE_URL` | Automático se adicionares PostgreSQL plugin |
| `ADMIN_EMAILS` | `teu@email.com` |
| `CORS_ORIGINS_RAW` | `https://SEU-FRONTEND.up.railway.app` |
| `ENV` | `production` |
| `GROQ_API_KEY` | Chave do groq.com (grátis) |
| `GEMINI_API_KEY` | Chave do aistudio.google.com (grátis) |

### Passo 2 — Frontend (variáveis de ambiente)

No Railway → frontend service → Variables:

| Variável | Valor |
|---|---|
| `NEXT_PUBLIC_API_URL` | `https://SEU-BACKEND.up.railway.app` |

### Passo 3 — PostgreSQL (recomendado)

No Railway → New Service → Database → PostgreSQL
→ A variável `DATABASE_URL` é adicionada automaticamente ao backend.

### Sem PostgreSQL (modo demo)
O sistema funciona **sem base de dados** usando memória RAM:
- Os utilizadores perdem-se quando o container reinicia
- Suficiente para testar / demo
- Para produção real, adicionar PostgreSQL

