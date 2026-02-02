# Quick Deployment Reference

## 🚀 Deploy to VPS (GitHub Actions)

### 1. Setup VPS (One-time)
```bash
scp scripts/setup-vps.sh root@YOUR_VPS_IP:/tmp/
ssh root@YOUR_VPS_IP 'chmod +x /tmp/setup-vps.sh && /tmp/setup-vps.sh'
```

### 2. Generate SSH Keys
```bash
ssh-keygen -t ed25519 -f ~/.ssh/github_actions_solana -C "github-actions"
ssh-copy-id -i ~/.ssh/github_actions_solana.pub deployer@YOUR_VPS_IP
```

### 3. Add GitHub Secrets
Go to: Repository → Settings → Secrets → Actions

| Secret | Value |
|--------|-------|
| VPS_HOST | `your-vps-ip` or `domain.com` |
| VPS_USER | `deployer` |
| VPS_SSH_KEY | Contents of `~/.ssh/github_actions_solana` |

### 4. Configure VPS Environment
```bash
ssh deployer@YOUR_VPS_IP
cat > ~/solana-tracker/.env << 'EOF'
HELIUS_API_KEY=your_key
HELIUS_WEBHOOK_URL=https://your-domain.com/webhook
TELEGRAM_BOT_TOKEN=your_token
TELEGRAM_CHAT_ID=your_id
PUSHOVER_USER_KEY=your_key
PUSHOVER_APP_TOKEN=your_token
TARGET_TOKEN_MINT=your_token_mint
TRACKED_WALLETS=wallet1,wallet2
EOF
```

### 5. Deploy
```bash
git push origin main  # Automatic deployment via GitHub Actions
```

---

## 🔧 Manual Deployment

```bash
export VPS_USER=deployer
export VPS_HOST=your-vps-ip
chmod +x scripts/deploy.sh
./scripts/deploy.sh
```

---

## 📊 Common Commands

### View Logs
```bash
ssh deployer@YOUR_VPS_IP 'cd ~/solana-tracker && docker-compose logs -f'
```

### Check Status
```bash
ssh deployer@YOUR_VPS_IP 'cd ~/solana-tracker && docker-compose ps'
```

### Restart Services
```bash
ssh deployer@YOUR_VPS_IP 'cd ~/solana-tracker && docker-compose restart'
```

### Check Health
```bash
curl http://YOUR_VPS_IP/health
```

### View App Logs Only
```bash
ssh deployer@YOUR_VPS_IP 'cd ~/solana-tracker && docker-compose logs -f app'
```

### View Nginx Logs
```bash
ssh deployer@YOUR_VPS_IP 'tail -f ~/solana-tracker/nginx-logs/solana-tracker-access.log'
```

---

## 🔒 SSL Setup (Let's Encrypt)

### 1. Stop Nginx
```bash
ssh deployer@YOUR_VPS_IP 'cd ~/solana-tracker && docker-compose stop nginx'
```

### 2. Get Certificate
```bash
ssh root@YOUR_VPS_IP
certbot certonly --standalone -d your-domain.com
```

### 3. Update nginx config (see DEPLOYMENT.md)

### 4. Restart
```bash
ssh deployer@YOUR_VPS_IP 'cd ~/solana-tracker && docker-compose up -d'
```

---

## 🐛 Troubleshooting

### Container won't start
```bash
ssh deployer@YOUR_VPS_IP 'cd ~/solana-tracker && docker-compose logs app'
```

### 502 Bad Gateway
```bash
ssh deployer@YOUR_VPS_IP 'cd ~/solana-tracker && docker-compose restart'
```

### Webhook not working
1. Check health: `curl http://YOUR_VPS_IP/health`
2. View logs: `docker-compose logs -f app`
3. Test webhook: `curl -X POST http://YOUR_VPS_IP/test/notifications`

### Update environment
```bash
ssh deployer@YOUR_VPS_IP 'nano ~/solana-tracker/.env'
ssh deployer@YOUR_VPS_IP 'cd ~/solana-tracker && docker-compose restart'
```

---

## 📦 Local Development

### Start
```bash
docker-compose up -d
```

### Stop
```bash
docker-compose down
```

### View Logs
```bash
docker-compose logs -f
```

### Rebuild
```bash
docker-compose up -d --build
```

---

## 🔗 Useful Endpoints

| Endpoint | Purpose |
|----------|---------|
| `/health` | Health check |
| `/webhook` | Helius webhook receiver |
| `/stats/swaps` | Current swap count |
| `/stats/price` | Cached token price |
| `/test/notifications` | Test Telegram/Pushover |
| `/admin/webhooks` | List all webhooks |
| `/admin/webhook/setup` | Create/update webhook |

---

## 📚 Documentation

- [README.md](README.md) - Overview and features
- [DEPLOYMENT.md](DEPLOYMENT.md) - Complete deployment guide
- [WEBHOOKS.md](WEBHOOKS.md) - Webhook configuration
- [API.md](API.md) - Full API reference
- [IMPLEMENTATION.md](IMPLEMENTATION.md) - Technical details
- [DOCKER.md](DOCKER.md) - Docker guide

---

## ⚡ Quick Checks

**Is everything running?**
```bash
ssh deployer@YOUR_VPS_IP 'cd ~/solana-tracker && docker-compose ps'
```

**Any errors?**
```bash
ssh deployer@YOUR_VPS_IP 'cd ~/solana-tracker && docker-compose logs --tail=50'
```

**Test notifications:**
```bash
curl -X POST http://YOUR_VPS_IP/test/notifications
```

**View resource usage:**
```bash
ssh deployer@YOUR_VPS_IP 'docker stats --no-stream'
```
