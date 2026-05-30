# 🚀 AIMasterCrypto — Deploy em aimastercrypto.com

## Pré-requisitos no servidor (VPS/Dedicated)
- Ubuntu 22.04+
- Docker + Docker Compose instalados
- Domínio `aimastercrypto.com` apontado para o IP do servidor (DNS A record)

---

## 1. Instalar Docker (se não tiver)
```bash
curl -fsSL https://get.docker.com | sh
sudo usermod -aG docker $USER
newgrp docker
```

## 2. Fazer upload do projeto
```bash
# No teu PC, comprime e envia
zip -r aimastercrypto.zip aimastercrypto-updated/
scp aimastercrypto.zip user@SEU_IP:/home/user/

# No servidor
unzip aimastercrypto.zip
cd aimastercrypto-updated
```

## 3. Configurar variáveis de ambiente
```bash
cp .env.example .env
nano .env
```

**Preenche obrigatoriamente:**
- `POSTGRES_PASSWORD` → password forte
- `SECRET_KEY` → corre `openssl rand -hex 32` e copia
- `SMTP_USER` + `SMTP_PASSWORD` → Gmail + App Password (ver abaixo)
- `ADMIN_EMAILS` → o teu email

### Como configurar Gmail SMTP:
1. Vai a myaccount.google.com → Segurança → Verificação em 2 passos → Ativa
2. Pesquisa "App Passwords" → cria uma para "Mail"
3. Copia a senha de 16 letras → coloca em `SMTP_PASSWORD`

## 4. SSL com Let's Encrypt (primeira vez)
```bash
# Instala certbot
sudo apt install certbot -y

# Gera certificado (substitui SEU_EMAIL)
sudo certbot certonly --standalone \
  -d aimastercrypto.com \
  -d www.aimastercrypto.com \
  --email SEU_EMAIL \
  --agree-tos --non-interactive

# Os certificados ficam em /etc/letsencrypt/live/aimastercrypto.com/
```

## 5. Montar volumes SSL no docker-compose
O `nginx.conf` já está configurado para `/etc/letsencrypt`.
Os volumes no `docker-compose.yml` montam `certbot-certs:/etc/letsencrypt`.

```bash
# Copia os certs para o volume Docker
sudo cp -rL /etc/letsencrypt ./nginx/letsencrypt
```

**Alternativa mais simples:** monta directamente o path do sistema:
Edita `docker-compose.yml`, no serviço `nginx`, troca:
```yaml
      - certbot-certs:/etc/letsencrypt:ro
```
por:
```yaml
      - /etc/letsencrypt:/etc/letsencrypt:ro
```

## 6. Build e arrancar
```bash
# Build completo
docker compose build

# Arrancar tudo
docker compose up -d

# Ver logs
docker compose logs -f
```

## 7. Verificar
```bash
# Status dos containers
docker compose ps

# Testar API
curl https://aimastercrypto.com/health

# Testar frontend
curl -I https://aimastercrypto.com
```

## 8. Renovação automática SSL
```bash
# Adiciona ao crontab
(crontab -l 2>/dev/null; echo "0 3 * * * certbot renew --quiet && docker compose restart nginx") | crontab -
```

---

## Conta Admin
A conta `eduardohcorreia@hotmail.com` tem role `admin` automaticamente.
- Acede ao painel admin em: `https://aimastercrypto.com/admin`
- Login normal em: `https://aimastercrypto.com/login`

## URLs importantes
| URL | Descrição |
|-----|-----------|
| `https://aimastercrypto.com` | App principal |
| `https://aimastercrypto.com/login` | Login |
| `https://aimastercrypto.com/verify-email` | Verificação OTP |
| `https://aimastercrypto.com/admin` | Painel admin |
| `https://aimastercrypto.com/health` | Health check API |
| `https://aimastercrypto.com/api/docs` | Swagger API docs |

## Comandos úteis
```bash
# Ver logs do backend
docker compose logs backend -f

# Reiniciar um serviço
docker compose restart backend

# Parar tudo
docker compose down

# Actualizar após código novo
docker compose build && docker compose up -d

# Ver DB
docker compose exec db psql -U aimuser -d aimastercrypto
```

---

## Fluxo de segurança implementado

1. **Sem conta** → bloqueado, redireccionado para `/login`
2. **Com conta mas email não verificado** → redireccionado para `/verify-email`
3. **User normal** → acede a tudo EXCEPTO Backtest e Admin panel
4. **Admin** → acede a tudo incluindo Backtest e `/admin`
5. **Backtest** → invisível no menu para users normais + protegido no backend
6. **OTP** → código de 6 dígitos, expira em 10 min, máx 5 tentativas, máx 3 reenvios
7. **JWT** → tokens na cookie + localStorage, middleware Next.js verifica cookie
