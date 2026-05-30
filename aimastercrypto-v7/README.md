# AIMasterCrypto

**Institutional-grade AI crypto trading platform** — real-time signals, AI scanner, backtesting, and market intelligence. Deployed at [aimastercrypto.com](https://aimastercrypto.com).

---

## Architecture

```
aimastercrypto/
├── backend/                  # FastAPI (Python 3.11)
│   ├── app/
│   │   ├── core/             # config, database, auth, clients
│   │   ├── routers/          # signals, market, auth, admin, websocket
│   │   ├── services/         # ta_engine, data_fetcher, ai_service, signal_service
│   │   └── websockets/       # manager (real-time price broadcaster)
│   ├── Dockerfile
│   ├── railway.json
│   └── requirements.txt
├── frontend/                 # Next.js 14 + React + TailwindCSS
│   ├── src/
│   │   ├── app/              # Next.js app router
│   │   ├── components/       # Reusable UI components
│   │   ├── stores/           # Zustand state (market, signals, UI)
│   │   ├── lib/              # API client, formatters
│   │   ├── locales/          # EN / PT translations
│   │   └── styles/           # Global CSS design system
│   ├── Dockerfile
│   └── railway.json
├── nginx/                    # Production reverse proxy
│   └── nginx.conf
├── docker-compose.yml        # Full local stack
└── .env.example              # Environment template
```

---

## Features

- **AI Signal Engine** — Groq (Llama 3.3 70B) → Gemini 1.5 Flash → Claude → Rule Engine fallback chain
- **Multi-Timeframe Confluence** — automatic MTF analysis (1m → 1D)
- **AI Scanner** — parallel scan of 12+ pairs with quality scoring (A/B/C/D grades)
- **Backtesting** — walk-forward backtest with Sharpe ratio, max drawdown, profit factor
- **Real-time Prices** — WebSocket price feed via Hyperliquid + CoinCap fallback
- **Market Dashboard** — CoinGecko market data, Fear & Greed, trending coins
- **TradingView Charts** — embedded professional charts with indicators
- **Telegram Alerts** — automatic alerts for high-confidence signals
- **PT/EN Bilingual** — full Portuguese + English UI
- **Premium SaaS Structure** — JWT auth, role system (free/premium/admin), rate limiting

**Data Sources (all free):**
- Hyperliquid API (candles, orderbook)
- CoinGecko API (market data, trending)
- CryptoCompare API (candle fallback)
- DexScreener API (DEX pairs, trending memecoins)
- Alternative.me (Fear & Greed index)
- CryptoPanic API (news feed, optional)

---

## Quick Start (Local)

### Prerequisites
- Docker + Docker Compose
- Git
- At least one AI key: Groq (free), Gemini (free), or Anthropic

### 1. Clone the repo
```bash
git clone https://github.com/YOUR_USERNAME/aimastercrypto.git
cd aimastercrypto
```

### 2. Configure environment
```bash
cp .env.example .env
# Edit .env with your keys
nano .env
```

Minimum required:
```env
SECRET_KEY=<openssl rand -hex 32>
GROQ_API_KEY=<your-groq-key>    # free at console.groq.com
```

### 3. Start local stack
```bash
# Dev mode (backend + frontend + redis, no nginx)
docker compose up backend frontend redis

# OR: run backend only for development
cd backend
pip install -r requirements.txt
uvicorn app.main:app --reload --port 8000

# Run frontend separately
cd frontend
npm install
npm run dev
```

### 4. Access
- Frontend: http://localhost:3000
- Backend API: http://localhost:8000
- API Docs: http://localhost:8000/docs
- Health: http://localhost:8000/health

---

## Railway Deployment

Railway is the recommended deployment platform. You deploy **two separate services** (backend + frontend) plus add-ons (PostgreSQL + Redis).

### Step 1 — Push to GitHub

```bash
cd aimastercrypto
git init
git add .
git commit -m "Initial commit — AIMasterCrypto v1.0"

# Create repo at github.com → copy remote URL
git remote add origin https://github.com/YOUR_USERNAME/aimastercrypto.git
git branch -M main
git push -u origin main
```

### Step 2 — Create Railway project

1. Go to [railway.app](https://railway.app) → **New Project**
2. Choose **"Deploy from GitHub repo"** → select `aimastercrypto`

### Step 3 — Add PostgreSQL

In your Railway project:
1. Click **"+ Add Service"** → **Database** → **PostgreSQL**
2. Click the Postgres service → **Variables** → copy `DATABASE_URL`

### Step 4 — Add Redis

1. Click **"+ Add Service"** → **Database** → **Redis**
2. Copy the `REDIS_URL` variable

### Step 5 — Deploy Backend

1. In your Railway project, click **"+ Add Service"** → **GitHub Repo**
2. Select your repo, set **Root Directory** = `backend`
3. Railway auto-detects the `Dockerfile`
4. Go to **Variables** and add:

```
DATABASE_URL          = ${{Postgres.DATABASE_URL}}
REDIS_URL             = ${{Redis.REDIS_URL}}
SECRET_KEY            = <run: openssl rand -hex 32>
GROQ_API_KEY          = <your-key>
GEMINI_API_KEY        = <your-key>
ANTHROPIC_API_KEY     = <your-key>
CRYPTOCOMPARE_API_KEY = <your-key>  (optional)
CRYPTOPANIC_API_KEY   = <your-key>  (optional)
TELEGRAM_TOKEN        = <your-bot-token>
TELEGRAM_CHAT_ID      = <your-chat-id>
ALLOWED_ORIGINS       = https://aimastercrypto.com,https://YOUR-FRONTEND.railway.app
AUTO_SCAN_TF          = 1H
AUTO_SCAN_INTERVAL_MINS = 60
MIN_CONFIDENCE_ALERT  = 70
```

5. Under **Settings** → **Networking** → **Generate Domain** (e.g. `aimastercrypto-backend.railway.app`)

### Step 6 — Deploy Frontend

1. Add another service → **GitHub Repo** → Root Directory = `frontend`
2. Variables:

```
NEXT_PUBLIC_API_URL   = https://aimastercrypto-backend.railway.app
NEXT_PUBLIC_APP_URL   = https://aimastercrypto.com
```

3. Generate domain for frontend too

### Step 7 — Connect Custom Domain

#### In Railway:
1. Frontend service → **Settings** → **Custom Domains** → Add `aimastercrypto.com` and `www.aimastercrypto.com`
2. Railway shows you the DNS target (e.g. `aimastercrypto.up.railway.app`)

#### In your DNS provider (where you bought aimastercrypto.com):
Add these records:

| Type  | Name  | Value                              |
|-------|-------|------------------------------------|
| CNAME | @     | aimastercrypto.up.railway.app      |
| CNAME | www   | aimastercrypto.up.railway.app      |

> **Propagation** takes 1–48 hours. Check with: `dig aimastercrypto.com`

#### SSL:
Railway automatically provisions Let's Encrypt SSL for custom domains. No action needed.

---

## Environment Variables Reference

| Variable | Required | Description |
|----------|----------|-------------|
| `SECRET_KEY` | ✅ | JWT signing key — `openssl rand -hex 32` |
| `DATABASE_URL` | ✅ | PostgreSQL connection string |
| `REDIS_URL` | ✅ | Redis connection string |
| `GROQ_API_KEY` | ⭐ One AI key required | Free at console.groq.com |
| `GEMINI_API_KEY` | ⭐ | Free at aistudio.google.com |
| `ANTHROPIC_API_KEY` | ⭐ | console.anthropic.com |
| `CRYPTOCOMPARE_API_KEY` | Optional | Candle data fallback |
| `CRYPTOPANIC_API_KEY` | Optional | News feed |
| `TELEGRAM_TOKEN` | Optional | Alert bot token |
| `TELEGRAM_CHAT_ID` | Optional | Alert chat ID |
| `ALLOWED_ORIGINS` | ✅ Production | CORS origins |
| `AUTO_SCAN_TF` | Optional | Default: `1H` |
| `AUTO_SCAN_INTERVAL_MINS` | Optional | Default: `60` |
| `MIN_CONFIDENCE_ALERT` | Optional | Default: `70` |

---

## API Endpoints

### Signals
| Method | Path | Description |
|--------|------|-------------|
| POST | `/api/signals/analyze` | Get AI signal for a pair |
| POST | `/api/signals/scan` | Scan multiple pairs |
| POST | `/api/signals/backtest` | Run strategy backtest |
| GET | `/api/signals/indicators/{pair}/{tf}` | Raw TA indicators |

### Market
| Method | Path | Description |
|--------|------|-------------|
| GET | `/api/market/overview` | Global market data + AI summary |
| GET | `/api/market/trending` | Trending coins (CoinGecko) |
| GET | `/api/market/coins` | Market data for top coins |
| GET | `/api/market/fear-greed` | Fear & Greed index |
| GET | `/api/market/dex/trending` | DexScreener trending pairs |
| GET | `/api/market/news` | CryptoPanic news |
| GET | `/api/market/price/{pair}` | Current price |

### Auth
| Method | Path | Description |
|--------|------|-------------|
| POST | `/api/auth/register` | Create account |
| POST | `/api/auth/login` | Login → JWT |
| POST | `/api/auth/refresh` | Refresh access token |
| GET | `/api/auth/me` | Current user profile |

### WebSocket
| Path | Description |
|------|-------------|
| `ws://host/ws/prices` | Live price feed (push every 5s) |
| `ws://host/ws/scanner` | Live scanner signal feed |

---

## Migrating from TradeIA v6

Your original `main.py` functionality is fully preserved and enhanced:

| TradeIA v6 | AIMasterCrypto v1 |
|------------|-------------------|
| `POST /signal` | `POST /api/signals/analyze` |
| `POST /scan` | `POST /api/signals/scan` |
| `POST /backtest` | `POST /api/signals/backtest` |
| `GET /health` | `GET /health` |
| `GET /stats` | `GET /api/admin/stats` |
| PostgreSQL pool | Async SQLAlchemy + asyncpg |
| Groq → Gemini → Anthropic chain | Same chain, modularized |
| Rule engine fallback | Same engine, `services/ta_engine.py` |
| Telegram alerts | Same logic, `services/signal_service.py` |
| Auto-scan scheduler | Same scheduler, now broadcasts to WebSocket |

---

## Scaling

For high traffic:

```bash
# Scale backend workers
CMD ["uvicorn", "app.main:app", "--workers", "4"]

# Railway: upgrade to Pro plan → scale replicas
# Redis: upgrade to persistent Redis for pub/sub across instances
```

Future features designed into the architecture:
- Copy trading → add `trades` table + broker API service
- Auto trading → extend `signal_service.py` with execution layer
- AI portfolio → new router + portfolio service
- Mobile app → same API, just build React Native client

---

## Tech Stack

**Backend:** FastAPI · SQLAlchemy (async) · PostgreSQL · Redis · APScheduler · python-telegram-bot · python-jose

**Frontend:** Next.js 14 · React 18 · TailwindCSS · Zustand · Framer Motion · SWR · Axios

**AI:** Groq (Llama 3.3 70B) · Google Gemini 1.5 Flash · Anthropic Claude · Custom Rule Engine

**Data:** Hyperliquid · CoinGecko · CryptoCompare · DexScreener · Alternative.me · CryptoPanic

**Infrastructure:** Docker · Railway · Nginx · Let's Encrypt SSL

---

## License

MIT — built for [aimastercrypto.com](https://aimastercrypto.com)
