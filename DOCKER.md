# Docker Deployment Guide

This guide explains how to run the Solana Wallet Tracker using Docker and Docker Compose.

## Prerequisites

- [Docker](https://docs.docker.com/get-docker/) (version 20.10+)
- [Docker Compose](https://docs.docker.com/compose/install/) (version 2.0+)

Check your installation:
```bash
docker --version
docker-compose --version
```

## Quick Start

### 1. Configure Environment

Create a `.env` file in the project root:

```bash
cp .env.example .env
```

Edit `.env` with your configuration:

```env
# Required configurations
TELEGRAM_BOT_TOKEN=your_telegram_bot_token_here
TELEGRAM_CHAT_ID=your_telegram_chat_id_here
PUSHOVER_USER_KEY=your_pushover_user_key_here
PUSHOVER_APP_TOKEN=your_pushover_app_token_here
TARGET_TOKEN_MINT=your_target_token_mint_address_here
TRACKED_WALLETS=wallet1,wallet2,wallet3
```

### 2. Start Services

Build and start all services:

```bash
docker-compose up -d
```

This will:
- Build the application Docker image
- Start the Redis container
- Start the application container
- Create a network for inter-container communication
- Set up persistent storage for Redis data

### 3. Verify Deployment

Check service status:
```bash
docker-compose ps
```

View logs:
```bash
docker-compose logs -f app
```

Check health:
```bash
curl http://localhost:3000/health
```

## Docker Compose Commands

### Basic Operations

**Start services (detached mode):**
```bash
docker-compose up -d
```

**Start services (with logs):**
```bash
docker-compose up
```

**Stop services:**
```bash
docker-compose stop
```

**Stop and remove containers:**
```bash
docker-compose down
```

**Stop and remove everything (including volumes):**
```bash
docker-compose down -v
```

**Restart services:**
```bash
docker-compose restart
```

**Restart specific service:**
```bash
docker-compose restart app
```

### Logs & Monitoring

**View logs (all services):**
```bash
docker-compose logs
```

**Follow logs (real-time):**
```bash
docker-compose logs -f
```

**View app logs only:**
```bash
docker-compose logs -f app
```

**View last 100 lines:**
```bash
docker-compose logs --tail=100 app
```

### Building & Updates

**Rebuild images:**
```bash
docker-compose build
```

**Rebuild without cache:**
```bash
docker-compose build --no-cache
```

**Pull latest base images and rebuild:**
```bash
docker-compose build --pull
```

**Update and restart:**
```bash
docker-compose up -d --build
```

### Container Management

**Execute command in running container:**
```bash
docker-compose exec app sh
```

**Check container resource usage:**
```bash
docker stats solana-tracker-app solana-tracker-redis
```

**Inspect container:**
```bash
docker-compose exec app node -v
docker-compose exec redis redis-cli INFO
```

## Architecture

The Docker setup includes two services:

### Application Service (`app`)
- **Base Image**: `node:18-alpine`
- **Build**: Multi-stage build (builder + production)
- **Port**: 3000 (configurable)
- **Health Check**: HTTP check on `/health` endpoint
- **Restart Policy**: `unless-stopped`

### Redis Service (`redis`)
- **Image**: `redis:7-alpine`
- **Port**: 6379
- **Persistence**: Append-only file (AOF) enabled
- **Memory**: 256MB max with LRU eviction
- **Health Check**: Redis PING command

### Network
- **Type**: Bridge network
- **Name**: `solana-tracker-network`
- **Purpose**: Isolated communication between services

### Volumes
- **redis-data**: Persistent storage for Redis data

## Configuration

### Environment Variables

All environment variables can be configured in `.env`:

| Variable | Required | Default | Description |
|----------|----------|---------|-------------|
| `PORT` | No | 3000 | Application port |
| `NODE_ENV` | No | production | Node environment |
| `REDIS_HOST` | No | redis | Redis hostname (service name) |
| `REDIS_PORT` | No | 6379 | Redis port |
| `TELEGRAM_BOT_TOKEN` | Yes | - | Telegram bot token |
| `TELEGRAM_CHAT_ID` | Yes | - | Telegram chat ID |
| `PUSHOVER_USER_KEY` | Yes | - | Pushover user key |
| `PUSHOVER_APP_TOKEN` | Yes | - | Pushover app token |
| `TARGET_TOKEN_MINT` | Yes | - | Solana token mint address |
| `TRACKED_WALLETS` | Yes | - | Comma-separated wallet addresses |

### Port Mapping

To change the exposed port, edit `docker-compose.yml`:

```yaml
services:
  app:
    ports:
      - "8080:3000"  # Expose on port 8080
```

Or use environment variable:
```bash
PORT=8080 docker-compose up -d
```

### Redis Password

To add Redis password protection:

1. Update `docker-compose.yml`:
```yaml
services:
  redis:
    command: >
      redis-server
      --appendonly yes
      --requirepass YOUR_PASSWORD
```

2. Update `.env`:
```env
REDIS_PASSWORD=YOUR_PASSWORD
```

### Memory Limits

Add resource limits in `docker-compose.yml`:

```yaml
services:
  app:
    deploy:
      resources:
        limits:
          cpus: '1.0'
          memory: 512M
        reservations:
          cpus: '0.5'
          memory: 256M
```

## Production Considerations

### 1. Use Docker Secrets

For sensitive data in production:

```yaml
services:
  app:
    secrets:
      - telegram_bot_token
      - pushover_user_key
    environment:
      - TELEGRAM_BOT_TOKEN_FILE=/run/secrets/telegram_bot_token

secrets:
  telegram_bot_token:
    external: true
  pushover_user_key:
    external: true
```

### 2. Enable Logging Driver

For centralized logging:

```yaml
services:
  app:
    logging:
      driver: "syslog"
      options:
        syslog-address: "tcp://logs.example.com:514"
```

### 3. Add Reverse Proxy

Example with Nginx:

```yaml
services:
  nginx:
    image: nginx:alpine
    ports:
      - "80:80"
      - "443:443"
    volumes:
      - ./nginx.conf:/etc/nginx/nginx.conf:ro
      - ./ssl:/etc/nginx/ssl:ro
    depends_on:
      - app
```

### 4. Health Checks

Monitor service health:

```bash
# Check app health
docker-compose exec app wget -q -O- http://localhost:3000/health

# Check Redis health
docker-compose exec redis redis-cli ping
```

### 5. Automated Backups

Backup Redis data:

```bash
# Create backup
docker-compose exec redis redis-cli BGSAVE

# Copy backup file
docker cp solana-tracker-redis:/data/dump.rdb ./backups/redis-$(date +%Y%m%d).rdb
```

Automated backup script:

```bash
#!/bin/bash
# backup.sh
docker-compose exec -T redis redis-cli BGSAVE
sleep 5
docker cp solana-tracker-redis:/data/dump.rdb \
  ./backups/redis-$(date +%Y%m%d-%H%M%S).rdb
```

## Troubleshooting

### Container Won't Start

**Check logs:**
```bash
docker-compose logs app
```

**Check if port is already in use:**
```bash
# Windows
netstat -ano | findstr :3000

# Linux/Mac
lsof -i :3000
```

**Solution:** Change port in `.env` or `docker-compose.yml`

### Redis Connection Failed

**Check if Redis is running:**
```bash
docker-compose ps redis
```

**Check Redis logs:**
```bash
docker-compose logs redis
```

**Test Redis connection:**
```bash
docker-compose exec redis redis-cli ping
```

### Application Can't Connect to Redis

**Verify network:**
```bash
docker network ls
docker network inspect solana-tracker-network
```

**Check environment variables:**
```bash
docker-compose exec app env | grep REDIS
```

### Out of Memory

**Check memory usage:**
```bash
docker stats
```

**Increase Redis memory limit in `docker-compose.yml`:**
```yaml
redis:
  command: >
    redis-server
    --maxmemory 512mb
```

### Permission Denied

**Check file ownership:**
```bash
ls -la
```

**Fix permissions:**
```bash
sudo chown -R $USER:$USER .
```

### Image Build Fails

**Clean Docker cache:**
```bash
docker system prune -a
```

**Rebuild without cache:**
```bash
docker-compose build --no-cache
```

## Monitoring

### Docker Stats

Real-time resource usage:
```bash
docker stats solana-tracker-app solana-tracker-redis
```

### Container Logs

**Export logs:**
```bash
docker-compose logs --no-color > logs.txt
```

**Filter logs:**
```bash
docker-compose logs | grep ERROR
```

### Health Endpoints

**App health:**
```bash
curl http://localhost:3000/health | jq
```

**Swap stats:**
```bash
curl http://localhost:3000/stats/swaps | jq
```

**Token price:**
```bash
curl http://localhost:3000/stats/price | jq
```

## Development with Docker

### Development Compose Override

Create `docker-compose.dev.yml`:

```yaml
version: '3.8'

services:
  app:
    build:
      target: builder
    volumes:
      - .:/app
      - /app/node_modules
    environment:
      - NODE_ENV=development
    command: npm run dev
```

Run development setup:
```bash
docker-compose -f docker-compose.yml -f docker-compose.dev.yml up
```

### Hot Reload

Mount source code for hot reload:

```yaml
services:
  app:
    volumes:
      - ./src:/app/src
    command: npm run dev
```

## Cleanup

### Remove Stopped Containers
```bash
docker-compose rm
```

### Remove All (including volumes)
```bash
docker-compose down -v --remove-orphans
```

### Clean Docker System
```bash
docker system prune -a --volumes
```

## CI/CD Integration

### GitHub Actions Example

```yaml
name: Docker Build

on:
  push:
    branches: [main]

jobs:
  build:
    runs-on: ubuntu-latest
    steps:
      - uses: actions/checkout@v3
      
      - name: Build Docker image
        run: docker-compose build
      
      - name: Run tests
        run: docker-compose run app npm test
      
      - name: Push to registry
        run: |
          docker tag solana-tracker-app:latest registry.example.com/solana-tracker:latest
          docker push registry.example.com/solana-tracker:latest
```

---

**For more information, see:**
- [Main Documentation](README.md)
- [API Reference](API.md)
- [Implementation Guide](IMPLEMENTATION.md)
