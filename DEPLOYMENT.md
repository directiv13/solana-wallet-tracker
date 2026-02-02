# Deployment Guide

This guide covers deploying the Solana Wallet Tracker to a Linux VPS using GitHub Actions and Nginx.

## Prerequisites

- Linux VPS (Ubuntu 20.04+ recommended)
- Domain name (optional, but recommended for SSL)
- GitHub repository
- SSH access to your VPS

## Table of Contents

1. [VPS Setup](#vps-setup)
2. [GitHub Actions Setup](#github-actions-setup)
3. [Environment Configuration](#environment-configuration)
4. [SSL/HTTPS Setup](#sslhttps-setup)
5. [Manual Deployment](#manual-deployment)
6. [Monitoring](#monitoring)
7. [Troubleshooting](#troubleshooting)

---

## VPS Setup

### 1. Initial Server Setup

SSH into your VPS and run the setup script:

```bash
# Copy setup script to VPS
scp scripts/setup-vps.sh root@YOUR_VPS_IP:/tmp/

# SSH into VPS
ssh root@YOUR_VPS_IP

# Run setup script
chmod +x /tmp/setup-vps.sh
/tmp/setup-vps.sh
```

This script will:
- Update system packages
- Install Docker and Docker Compose
- Create a deployment user (`deployer`)
- Setup deployment directory

### 2. Generate SSH Keys for GitHub Actions

On your **local machine**, generate an SSH key pair:

```bash
ssh-keygen -t ed25519 -C "github-actions" -f ~/.ssh/github_actions_solana_tracker
```

Add the public key to your VPS:

```bash
ssh-copy-id -i ~/.ssh/github_actions_solana_tracker.pub deployer@YOUR_VPS_IP

# Or manually:
cat ~/.ssh/github_actions_solana_tracker.pub | ssh deployer@YOUR_VPS_IP "cat >> ~/.ssh/authorized_keys"
```

Test the connection:

```bash
ssh -i ~/.ssh/github_actions_solana_tracker deployer@YOUR_VPS_IP
```

### 3. Configure Environment Variables

Create `.env` file on your VPS:

```bash
ssh deployer@YOUR_VPS_IP

# Create .env file
cat > ~/solana-tracker/.env << 'EOF'
# Server Configuration
PORT=3000
NODE_ENV=production

# Redis Configuration
REDIS_HOST=redis
REDIS_PORT=6379
REDIS_PASSWORD=
REDIS_DB=0

# Telegram Configuration
TELEGRAM_BOT_TOKEN=your_bot_token
TELEGRAM_CHAT_ID=your_chat_id

# Pushover Configuration
PUSHOVER_USER_KEY=your_user_key
PUSHOVER_APP_TOKEN=your_app_token

# Solana Configuration
TARGET_TOKEN_MINT=your_token_mint
TRACKED_WALLETS=wallet1,wallet2,wallet3

# Helius Configuration
HELIUS_API_KEY=your_helius_api_key
HELIUS_WEBHOOK_URL=https://your-domain.com/webhook

# Thresholds
PRICE_THRESHOLD_USD=300
SWAP_COUNT_THRESHOLD=10
SWAP_TIME_WINDOW_SECONDS=3600

# API Configuration
DEX_SCREENER_API_URL=https://api.dexscreener.com/latest/dex/tokens
PRICE_CACHE_TTL_SECONDS=60

# Nginx Configuration
NGINX_PORT=80
EOF

# Secure the file
chmod 600 ~/solana-tracker/.env
```

---

## GitHub Actions Setup

### 1. Add GitHub Secrets

Go to your GitHub repository → Settings → Secrets and variables → Actions

Add the following secrets:

| Secret Name | Value |
|-------------|-------|
| `VPS_HOST` | Your VPS IP address or domain |
| `VPS_USER` | `deployer` (or your deployment user) |
| `VPS_SSH_KEY` | Contents of `~/.ssh/github_actions_solana_tracker` (private key) |

To get the private key content:

```bash
cat ~/.ssh/github_actions_solana_tracker
```

Copy the entire output (including `-----BEGIN` and `-----END` lines).

### 2. Trigger Deployment

The GitHub Actions workflow will automatically deploy when you:
- Push to `main` or `production` branch
- Manually trigger via GitHub Actions UI

To manually trigger:
1. Go to GitHub → Actions → Deploy to VPS
2. Click "Run workflow"
3. Select branch and click "Run workflow"

---

## Environment Configuration

### Nginx Configuration

The Nginx configuration includes:

- **Reverse proxy** to Node.js app
- **Rate limiting** for webhook endpoint
- **Security headers**
- **Access logging**
- **IP whitelisting** for admin endpoints (optional)

To enable IP whitelisting for admin endpoints:

```bash
ssh deployer@YOUR_VPS_IP
nano ~/solana-tracker/nginx/nginx.conf
```

Uncomment and configure:

```nginx
location /admin {
    allow YOUR_IP_ADDRESS;
    deny all;
    # ... rest of config
}
```

Then restart Nginx:

```bash
cd ~/solana-tracker
docker-compose restart nginx
```

### Port Configuration

By default:
- Nginx listens on port **80**
- Application runs on port **3000** (internal)
- Redis runs on port **6379** (internal)

To change the Nginx port, update `.env`:

```env
NGINX_PORT=8080
```

---

## SSL/HTTPS Setup

### Using Certbot (Let's Encrypt)

#### 1. Install Certbot on VPS

```bash
ssh root@YOUR_VPS_IP

apt-get install certbot python3-certbot-nginx -y
```

#### 2. Stop Nginx container temporarily

```bash
ssh deployer@YOUR_VPS_IP
cd ~/solana-tracker
docker-compose stop nginx
```

#### 3. Obtain SSL certificate

```bash
sudo certbot certonly --standalone -d your-domain.com -d www.your-domain.com
```

#### 4. Create SSL Nginx configuration

```bash
ssh deployer@YOUR_VPS_IP

cat > ~/solana-tracker/nginx/nginx-ssl.conf << 'EOF'
# Redirect HTTP to HTTPS
server {
    listen 80;
    server_name your-domain.com www.your-domain.com;
    return 301 https://$server_name$request_uri;
}

upstream solana_tracker {
    server app:3000;
}

server {
    listen 443 ssl http2;
    server_name your-domain.com www.your-domain.com;

    # SSL Configuration
    ssl_certificate /etc/letsencrypt/live/your-domain.com/fullchain.pem;
    ssl_certificate_key /etc/letsencrypt/live/your-domain.com/privkey.pem;
    ssl_protocols TLSv1.2 TLSv1.3;
    ssl_ciphers HIGH:!aNULL:!MD5;
    ssl_prefer_server_ciphers on;

    # Security headers
    add_header Strict-Transport-Security "max-age=31536000; includeSubDomains" always;
    add_header X-Frame-Options "SAMEORIGIN" always;
    add_header X-Content-Type-Options "nosniff" always;
    add_header X-XSS-Protection "1; mode=block" always;

    client_max_body_size 10M;

    # Logging
    access_log /var/log/nginx/solana-tracker-access.log;
    error_log /var/log/nginx/solana-tracker-error.log;

    # Health check
    location /health {
        proxy_pass http://solana_tracker;
        proxy_set_header Host $host;
        proxy_set_header X-Real-IP $remote_addr;
        proxy_set_header X-Forwarded-For $proxy_add_x_forwarded_for;
        proxy_set_header X-Forwarded-Proto $scheme;
        access_log off;
    }

    # Webhook endpoint
    location /webhook {
        proxy_pass http://solana_tracker;
        proxy_set_header Host $host;
        proxy_set_header X-Real-IP $remote_addr;
        proxy_set_header X-Forwarded-For $proxy_add_x_forwarded_for;
        proxy_set_header X-Forwarded-Proto $scheme;
        limit_req zone=webhook_limit burst=20 nodelay;
    }

    # Admin endpoints
    location /admin {
        proxy_pass http://solana_tracker;
        proxy_set_header Host $host;
        proxy_set_header X-Real-IP $remote_addr;
        proxy_set_header X-Forwarded-For $proxy_add_x_forwarded_for;
        proxy_set_header X-Forwarded-Proto $scheme;
    }

    # Stats endpoints
    location /stats {
        proxy_pass http://solana_tracker;
        proxy_set_header Host $host;
        proxy_set_header X-Real-IP $remote_addr;
        proxy_set_header X-Forwarded-For $proxy_add_x_forwarded_for;
        proxy_set_header X-Forwarded-Proto $scheme;
    }

    # Test endpoints
    location /test {
        proxy_pass http://solana_tracker;
        proxy_set_header Host $host;
        proxy_set_header X-Real-IP $remote_addr;
        proxy_set_header X-Forwarded-For $proxy_add_x_forwarded_for;
        proxy_set_header X-Forwarded-Proto $scheme;
    }

    location / {
        return 404;
    }
}

limit_req_zone $binary_remote_addr zone=webhook_limit:10m rate=100r/m;
EOF
```

#### 5. Update docker-compose to mount SSL certificates

```bash
nano ~/solana-tracker/docker-compose.yml
```

Add volume mounts to nginx service:

```yaml
nginx:
  image: nginx:alpine
  volumes:
    - ./nginx/nginx-ssl.conf:/etc/nginx/conf.d/default.conf:ro
    - /etc/letsencrypt:/etc/letsencrypt:ro
    - nginx-logs:/var/log/nginx
  ports:
    - "80:80"
    - "443:443"
```

#### 6. Restart services

```bash
cd ~/solana-tracker
docker-compose up -d
```

#### 7. Setup auto-renewal

```bash
sudo crontab -e

# Add this line:
0 3 * * * certbot renew --quiet --post-hook "docker restart solana-tracker-nginx"
```

---

## Manual Deployment

If you prefer to deploy manually without GitHub Actions:

### 1. Make deploy script executable

```bash
chmod +x scripts/deploy.sh
```

### 2. Configure deployment variables

```bash
export VPS_USER=deployer
export VPS_HOST=your-vps-ip
```

### 3. Run deployment

```bash
./scripts/deploy.sh
```

---

## Monitoring

### View Logs

```bash
# All services
ssh deployer@YOUR_VPS_IP 'cd ~/solana-tracker && docker-compose logs -f'

# Specific service
ssh deployer@YOUR_VPS_IP 'cd ~/solana-tracker && docker-compose logs -f app'

# Nginx access logs
ssh deployer@YOUR_VPS_IP 'tail -f ~/solana-tracker/nginx-logs/solana-tracker-access.log'
```

### Check Service Status

```bash
ssh deployer@YOUR_VPS_IP 'cd ~/solana-tracker && docker-compose ps'
```

### Check Resource Usage

```bash
ssh deployer@YOUR_VPS_IP 'docker stats'
```

### Health Check

```bash
curl http://your-domain.com/health
# or with SSL
curl https://your-domain.com/health
```

---

## Troubleshooting

### Container won't start

```bash
# Check logs
ssh deployer@YOUR_VPS_IP 'cd ~/solana-tracker && docker-compose logs app'

# Check if port is already in use
ssh deployer@YOUR_VPS_IP 'netstat -tulpn | grep 3000'
```

### Nginx 502 Bad Gateway

```bash
# Check if app container is running
ssh deployer@YOUR_VPS_IP 'docker ps | grep solana-tracker-app'

# Check app logs
ssh deployer@YOUR_VPS_IP 'cd ~/solana-tracker && docker-compose logs app'

# Restart services
ssh deployer@YOUR_VPS_IP 'cd ~/solana-tracker && docker-compose restart'
```

### Redis connection issues

```bash
# Check Redis container
ssh deployer@YOUR_VPS_IP 'cd ~/solana-tracker && docker-compose logs redis'

# Test Redis connection
ssh deployer@YOUR_VPS_IP 'docker exec solana-tracker-redis redis-cli ping'
```

### Deployment fails in GitHub Actions

1. Check GitHub Actions logs
2. Verify SSH key is correct
3. Test SSH connection manually:

```bash
ssh -i ~/.ssh/github_actions_solana_tracker deployer@YOUR_VPS_IP
```

4. Ensure deployment directory exists:

```bash
ssh deployer@YOUR_VPS_IP 'ls -la ~/solana-tracker'
```

### Update Helius webhook URL

After deployment with SSL:

```bash
# Update .env with new HTTPS URL
ssh deployer@YOUR_VPS_IP
nano ~/solana-tracker/.env

# Update HELIUS_WEBHOOK_URL to https://your-domain.com/webhook

# Restart services
cd ~/solana-tracker
docker-compose restart app

# Setup webhook
curl -X POST https://your-domain.com/admin/webhook/setup
```

---

## Maintenance

### Update Application

Push to GitHub `main` branch to trigger automatic deployment.

### Backup Redis Data

```bash
ssh deployer@YOUR_VPS_IP << 'EOF'
  cd ~/solana-tracker
  docker exec solana-tracker-redis redis-cli BGSAVE
  docker cp solana-tracker-redis:/data/dump.rdb ./backups/redis-$(date +%Y%m%d-%H%M%S).rdb
EOF
```

### Restart Services

```bash
ssh deployer@YOUR_VPS_IP 'cd ~/solana-tracker && docker-compose restart'
```

### Update Docker Images

```bash
ssh deployer@YOUR_VPS_IP << 'EOF'
  cd ~/solana-tracker
  docker-compose pull
  docker-compose up -d
  docker image prune -f
EOF
```

---

## Security Best Practices

1. **Enable firewall**:
   ```bash
   ssh root@YOUR_VPS_IP
   ufw allow 22/tcp
   ufw allow 80/tcp
   ufw allow 443/tcp
   ufw enable
   ```

2. **Disable root SSH login**:
   ```bash
   ssh root@YOUR_VPS_IP
   nano /etc/ssh/sshd_config
   # Set: PermitRootLogin no
   systemctl restart sshd
   ```

3. **Keep system updated**:
   ```bash
   ssh root@YOUR_VPS_IP
   apt-get update && apt-get upgrade -y
   ```

4. **Use strong passwords** for all services

5. **Enable IP whitelisting** for admin endpoints

6. **Rotate SSH keys** periodically

---

For more information, see the main [README.md](../README.md).
