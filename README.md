# Solana Wallet Tracker

A high-performance Node.js TypeScript application that monitors Solana transactions via Helius Enhanced Transaction Webhooks and sends real-time alerts to Telegram and Pushover based on configurable triggers.

## 🎯 Features

- **Real-time Transaction Monitoring**: Receives and processes Solana SWAP events via Helius webhooks
- **Multi-wallet Tracking**: Monitor up to 500 wallet addresses simultaneously
- **Smart Notifications**:
  - 📱 **Telegram**: Instant notifications for every buy/sell of tracked tokens
  - 🔔 **Pushover Subscriptions**: User-based subscription system for customized alerts
    - **single_swap**: High-value swap alerts (single swaps > $300 USD)
    - **change_direction**: Direction change alerts (volume surges indicating trend changes)
- **Price Intelligence**: Automatic USD valuation using DEX Screener API with Redis caching
- **Sliding Window Analytics**: Atomic Redis-based event counting for accurate activity detection
- **High Performance**: Built on Fastify for maximum throughput and minimal latency

## 📋 Table of Contents

- [Architecture](#architecture)
- [Prerequisites](#prerequisites)
- [Installation](#installation)
- [Configuration](#configuration)
- [Usage](#usage)
- [API Endpoints](#api-endpoints)
- [Webhook Setup](#webhook-setup)
- [Notification Logic](#notification-logic)
- [Development](#development)
- [Deployment](#deployment)
- [Troubleshooting](#troubleshooting)
- [License](#license)

## 🏗️ Architecture

### Tech Stack

| Component | Technology | Purpose |
|-----------|-----------|---------|
| Runtime | Node.js 18+ | JavaScript runtime |
| Language | TypeScript | Type-safe development |
| Web Framework | Fastify | High-performance HTTP server |
| Blockchain API | Helius | Enhanced Solana transaction data |
| Storage | Redis | Price caching & sliding window tracking |
| Notifications | Telegraf | Telegram bot integration |
| Notifications | Pushover SDK | Mobile push notifications |
| Price Data | DEX Screener API | Real-time token pricing |

### System Flow

```
Helius Webhook → Fastify Server → Webhook Service
                                        ↓
                           ┌────────────┴────────────┐
                           ↓                         ↓
                    Price Service              Redis Service
                           ↓                         ↓
                    DEX Screener              Sliding Window
                           ↓                         ↓
                           └────────────┬────────────┘
                                        ↓
                              Notification Service
                                        ↓
                           ┌────────────┴────────────┐
                           ↓                         ↓
                      Telegram                  Pushover
```

## 📦 Prerequisites

- **Node.js**: v18.0.0 or higher
- **Redis**: v6.0 or higher
- **Helius Account**: [Sign up here](https://helius.xyz/)
- **Telegram Bot**: Create via [@BotFather](https://t.me/botfather)
- **Pushover Account**: [Get API keys](https://pushover.net/)

## 🚀 Installation

### 1. Clone the Repository

```bash
git clone <repository-url>
cd solana-wallet-tracker
```

### 2. Install Dependencies

```bash
npm install
```

### 3. Configure Environment

Copy the example environment file:

```bash
cp .env.example .env
```

Edit `.env` with your credentials (see [Configuration](#configuration) section).

### 4. Start Redis

**Using Docker:**
```bash
docker run -d -p 6379:6379 --name redis redis:7-alpine
```

**Using local installation:**
```bash
redis-server
```

### 5. Build and Run

**Development mode (with hot reload):**
```bash
npm run dev
```

**Production mode:**
```bash
npm run build
npm start
```

## ⚙️ Configuration

### Environment Variables

Create a `.env` file with the following configuration:

```env
# Server Configuration
PORT=3000
NODE_ENV=development

# Redis Configuration
REDIS_HOST=localhost
REDIS_PORT=6379
REDIS_PASSWORD=                    # Optional
REDIS_DB=0

# Telegram Configuration
TELEGRAM_BOT_TOKEN=123456:ABC-DEF1234ghIkl-zyx57W2v1u123ew11
TELEGRAM_CHAT_ID=-1001234567890

# Pushover Configuration
# Create an application at https://pushover.net/ to get your APP_TOKEN
# Users will subscribe with their own user keys via /enable_pushover command
PUSHOVER_APP_TOKEN=azGDORePK8gMaC0QOYAMyEEuzJnyUi

# Solana Configuration
TARGET_TOKEN_MINT=EPjFWdd5AufqSSqeM2qN1xzybapC8G4wEGGkZwyTDt1v
TRACKED_WALLETS=7xKXtg2CW87d97TXJSDpbD5jBkheTqA83TZRuJosgAsU,9WzDXwBbmkg8ZTbNMqUxvQRAyrZzDsGYdLVL9zYtAWWM

# Thresholds
PRICE_THRESHOLD_USD=300
SWAP_COUNT_THRESHOLD=10
SWAP_TIME_WINDOW_SECONDS=3600

# API Configuration
DEX_SCREENER_API_URL=https://api.dexscreener.com/latest/dex/tokens
PRICE_CACHE_TTL_SECONDS=60
```

### Configuration Details

#### Telegram Setup

1. Create a bot via [@BotFather](https://t.me/botfather)
2. Get your bot token (format: `123456:ABC-DEF...`)
3. Start a chat with your bot
4. Get your chat ID by messaging [@userinfobot](https://t.me/userinfobot)

#### Pushover Setup

1. Sign up at [pushover.net](https://pushover.net/)
2. Create an application to get your APP_TOKEN for the .env file
3. Users subscribe individually via Telegram bot commands:
   - `/enable_pushover <user_key>` - Set up Pushover with your user key
   - `/subscribe <key>` - Subscribe to specific notification types
   - Available keys: `single_swap`, `change_direction`

#### Tracked Wallets

- Add wallet addresses as comma-separated values
- Maximum 500 wallets recommended
- Leave empty to track all wallets (not recommended)

#### Token Configuration

- `TARGET_TOKEN_MINT`: The Solana token address to monitor
- Example: `EPjFWdd5AufqSSqeM2qN1xzybapC8G4wEGGkZwyTDt1v` (USDC)

## 📖 Usage

### Starting the Server

```bash
npm run dev
```

You should see:
```
Server listening on port 3000
Webhook endpoint: http://localhost:3000/webhook
Health check: http://localhost:3000/health
```

### Testing Notifications

Test your notification setup:

```bash
curl -X POST http://localhost:3000/test/notifications
```

Expected response:
```json
{
  "telegram": "success",
  "pushover": "success"
}
```

## 🌐 API Endpoints

### Health Check
```http
GET /health
```

**Response:**
```json
{
  "status": "healthy",
  "timestamp": "2026-01-28T12:00:00.000Z",
  "services": {
    "redis": "up",
    "server": "up"
  },
  "config": {
    "targetTokenMint": "EPjFWdd5...",
    "trackedWalletsCount": 2,
    "pushoverSubscribersCount": 0,
    "priceThresholdUsd": 300,
    "swapTimeWindowSeconds": 3600
  }
}
```

### Webhook Receiver
```http
POST /webhook
Content-Type: application/json
```

**Request Body:** Helius Enhanced Transaction payload

**Response:**
```json
{
  "success": true,
  "signature": "5J7Xn...",
  "message": "Webhook received and queued for processing"
}
```

### Swap Statistics
```http
GET /stats/swaps
```

**Response:**
```json
{
  "tokenMint": "EPjFWdd5...",
  "swapCount": 7,
  "timeWindowSeconds": 3600,
  "threshold": 10
}
```

### Token Price
```http
GET /stats/price
```

**Response:**
```json
{
  "tokenMint": "EPjFWdd5...",
  "priceUsd": 0.9998,
  "cachedAt": "2026-01-28T12:00:00.000Z"
}
```

## 🔗 Webhook Setup

### Configure Helius Webhook

1. Log in to [Helius Dashboard](https://dashboard.helius.xyz/)
2. Navigate to **Webhooks** → **Create Webhook**
3. Configure:
   - **Webhook Type**: Enhanced Transactions
   - **Transaction Types**: Select `SWAP`
   - **Webhook URL**: `https://your-domain.com/webhook`
   - **Account Addresses**: Add your tracked wallet addresses

### Testing Locally with ngrok

For local development:

```bash
# Install ngrok
npm install -g ngrok

# Expose local server
ngrok http 3000

# Use the ngrok URL in Helius webhook configuration
# Example: https://abc123.ngrok.io/webhook
```

## 🔔 Notification Logic

### Telegram Notifications (All Events)

**Trigger:** Every buy/sell of the target token by tracked wallets

**Message Format:**
```
🟢 BOUGHT Token

👤 Wallet: 7xKXt...gAsU
🔢 Amount: 1,234.56
💰 Value: $300.45 USD
🔗 View Transaction
⏰ 1/28/2026, 12:00:00 PM
```

### Pushover: Big Sell Alerts

**Subscription Key:** `single_swap`

**Triggers:**
1. Single swap value exceeds `PRICE_THRESHOLD_USD` (default: $300)

**Priority:** High (Priority 1)

**Sound:** Cash register

**Notification Examples:**
```
🚨 Large SELL Alert

USDC sell
Wallet: 7xKXt...gAsU
Value: $1,234.56 USD
Amount: 1,234.56

View: https://solscan.io/tx/...
```

### Pushover: Change Direction Alerts

**Subscription Key:** `change_direction`

**Trigger:** Volume surge indicating potential trend change - cumulative buy/sell amounts exceeding threshold within time window

**Cooldown:** 5 minutes between notifications

**Priority:** High (Priority 1)

**Notification:**
```
⚡ Volume Alert: SELL

USDC sell volume surge!
Cumulative sells: $1,234.56 USD
Time window: 60 minutes

Latest sell:
Wallet: 7xKXt...gAsU
Amount: 1,234.56
Value: $45.67 USD

View: https://solscan.io/tx/...
```

## 🤖 Telegram Bot Commands

### User Commands

| Command | Description | Example |
|---------|-------------|---------|
| `/start` | Register to receive cumulative updates | `/start` |
| `/help` | Show all available commands | `/help` |
| `/status` | Check your subscription status and view stats | `/status` |
| `/cum_30m` | Get cumulative amounts for last 30 minutes | `/cum_30m` |
| `/cum_1h` | Get cumulative amounts for last hour | `/cum_1h` |
| `/cum_4h` | Get cumulative amounts for last 4 hours | `/cum_4h` |
| `/enable_pushover <user_key>` | Enable Pushover notifications with your user key | `/enable_pushover uQiRzpo4DXgh...` |
| `/disable_pushover` | Disable Pushover notifications | `/disable_pushover` |
| `/subscribe <key>` | Subscribe to specific notification type | `/subscribe single_swap` |
| `/unsubscribe <key>` | Unsubscribe from notification type | `/unsubscribe single_swap` |

### Admin Commands

| Command | Description | Example |
|---------|-------------|---------|
| `/add <wallet>` | Add wallet(s) to tracking | `/add 7xKXtg2CW87d97TX...` |
| `/remove <wallet>` | Remove wallet from tracking | `/remove 7xKXtg2CW87d97TX...` |
| `/list <skip> <limit>` | List tracked wallets | `/list 0 10` |
| `/stats` | Show tracker statistics | `/stats` |

### Subscription Keys

| Key | Description | Notifications |
|-----|-------------|---------------|
| `single_swap` | High-value swap alerts | Single swap > $1000 |
| `change_direction` | Direction change alerts | Volume surges indicating potential trend changes |

### Database Schema

```sql
-- Users table
CREATE TABLE users (
    user_id INTEGER PRIMARY KEY,
    pushover_user_key TEXT,
    started_at INTEGER NOT NULL
);

-- Pushover subscriptions table
CREATE TABLE pushover_subscriptions (
    user_id INTEGER NOT NULL,
    key TEXT NOT NULL,
    created_at INTEGER NOT NULL,
    PRIMARY KEY (user_id, key)
);

-- Tracked wallets table
CREATE TABLE tracked_wallets (
    address TEXT PRIMARY KEY,
    added_by INTEGER NOT NULL,
    added_at INTEGER NOT NULL
);
```

## 🔧 Development

### Project Structure

```
solana-wallet-tracker/
├── src/
│   ├── config.ts                 # Configuration management
│   ├── types.ts                  # TypeScript interfaces
│   ├── index.ts                  # Main server entry point
│   └── services/
│       ├── redis.service.ts      # Redis operations & sliding window
│       ├── price.service.ts      # DEX Screener integration
│       ├── notification.service.ts # Telegram & Pushover
│       └── webhook.service.ts    # Webhook processing logic
├── .env                          # Environment configuration
├── .env.example                  # Environment template
├── package.json                  # Dependencies & scripts
├── tsconfig.json                 # TypeScript configuration
└── README.md                     # Documentation
```

### Available Scripts

```bash
npm run dev      # Start development server with hot reload
npm run build    # Compile TypeScript to JavaScript
npm start        # Run production build
npm run lint     # Run ESLint
```

### Adding New Features

#### Example: Add Email Notifications

1. Install dependency:
```bash
npm install nodemailer @types/nodemailer
```

2. Update `types.ts`:
```typescript
export enum NotificationType {
  TELEGRAM_ALL = 'telegram_all',
  PUSHOVER_THRESHOLD_A = 'pushover_threshold_a',
  PUSHOVER_THRESHOLD_B = 'pushover_threshold_b',
  EMAIL = 'email', // New
}
```

3. Extend `notification.service.ts`:
```typescript
private async sendEmailNotification(payload: NotificationPayload): Promise<void> {
  // Implementation
}
```

## 🚢 Deployment

### Quick Start with Docker

The project includes production-ready Docker configuration with Nginx reverse proxy.

**1. Local Development:**
```bash
docker-compose up -d
```

**2. Production Deployment:**
```bash
docker-compose -f docker-compose.prod.yml up -d
```

This will start:
- Application container (Node.js)
- Redis container (data storage)
- Nginx container (reverse proxy)

### Linux VPS Deployment

For complete VPS deployment with GitHub Actions CI/CD, see [DEPLOYMENT.md](DEPLOYMENT.md).

**Quick Setup:**

1. **Prepare VPS:**
   ```bash
   # Copy and run setup script on your VPS
   scp scripts/setup-vps.sh root@YOUR_VPS_IP:/tmp/
   ssh root@YOUR_VPS_IP
   chmod +x /tmp/setup-vps.sh
   /tmp/setup-vps.sh
   ```

2. **Configure GitHub Secrets:**
   - `VPS_HOST`: Your VPS IP or domain
   - `VPS_USER`: Deployment user (default: deployer)
   - `VPS_SSH_KEY`: Private SSH key for deployment

3. **Deploy:**
   - Push to `main` branch for automatic deployment
   - Or manually run GitHub Actions workflow

### Manual VPS Deployment

```bash
# Set VPS credentials
export VPS_USER=deployer
export VPS_HOST=your-vps-ip

# Deploy
chmod +x scripts/deploy.sh
./scripts/deploy.sh
```

### Architecture Overview

```
Internet → Nginx (Port 80/443) → Fastify (Port 3000) → Redis (Port 6379)
           ↓
    - Rate Limiting
    - SSL/TLS
    - Security Headers
    - Access Logging
```

### SSL/HTTPS Setup

See [DEPLOYMENT.md](DEPLOYMENT.md) for complete SSL setup with Let's Encrypt.

### Cloud Deployment (Alternative Options)

- **Railway**: One-click deployment with Redis addon
- **Render**: Auto-scaling with managed Redis
- **DigitalOcean App Platform**: Container-based deployment
- **AWS ECS**: Enterprise-grade with ElastiCache Redis

### Environment Variables for Production

Ensure these are set securely:
- Use secrets management (AWS Secrets Manager, Vault, etc.)
- Never commit `.env` to version control
- Rotate API keys regularly
- Use HTTPS for webhook endpoints

## 🔍 Troubleshooting

### Redis Connection Errors

**Problem:** `Redis connection failed`

**Solutions:**
- Verify Redis is running: `redis-cli ping`
- Check `REDIS_HOST` and `REDIS_PORT` in `.env`
- Ensure Redis accepts connections from your IP
- Check firewall rules

### Telegram Notifications Not Working

**Problem:** `Telegram test failed`

**Solutions:**
- Verify `TELEGRAM_BOT_TOKEN` is correct
- Ensure bot has been started (send `/start` to bot)
- Check `TELEGRAM_CHAT_ID` matches your chat
- For groups, ID should start with `-`

### Pushover Notifications Silent

**Problem:** Notifications not received

**Solutions:**
- Verify `PUSHOVER_USER_KEY` and `PUSHOVER_APP_TOKEN`
- Check device is registered in Pushover app
- Verify app isn't in Do Not Disturb mode
- Check Pushover delivery receipts

### No Webhooks Received

**Problem:** `/webhook` endpoint not receiving data

**Solutions:**
- Verify webhook URL in Helius dashboard
- Check server is publicly accessible
- Ensure firewall allows incoming connections
- Test with `curl -X POST http://your-url/webhook -d '{}'`
- Check Helius webhook logs for errors

### Price Fetching Issues

**Problem:** `Price not found` errors

**Solutions:**
- Verify token has liquidity on DEX Screener
- Check `TARGET_TOKEN_MINT` address is correct
- Ensure DEX Screener API is accessible
- Try fetching manually: `curl https://api.dexscreener.com/latest/dex/tokens/{mint}`

### Sliding Window Not Working

**Problem:** Threshold B not triggering

**Solutions:**
- Check Redis is storing data: `redis-cli KEYS swap_window:*`
- Verify `SWAP_TIME_WINDOW_SECONDS` configuration
- Check system time is accurate
- Review logs for swap counting

## 📊 Monitoring & Logs

### Log Levels

- **Production:** `info` and above
- **Development:** `debug` and above

### Key Metrics to Monitor

- Request rate to `/webhook`
- Redis connection status
- Notification success/failure rates
- API response times (DEX Screener)
- Memory usage
- Error rates

### Log Examples

```
INFO: Webhook received (signature: 5J7Xn...)
INFO: Detected buy of target token (wallet: 7xKXt..., amount: 1234.56)
INFO: Threshold A triggered (valueUsd: 456.78, threshold: 300)
INFO: Telegram notification sent (signature: 5J7Xn...)
```

## 🤝 Contributing

Contributions are welcome! Please:

1. Fork the repository
2. Create a feature branch
3. Commit your changes
4. Push to the branch
5. Open a Pull Request

## 📄 License

MIT License - see LICENSE file for details

## 🙏 Acknowledgments

- [Helius](https://helius.xyz/) - Solana transaction data
- [DEX Screener](https://dexscreener.com/) - Token pricing
- [Fastify](https://fastify.io/) - Web framework
- [Redis](https://redis.io/) - In-memory storage

## 📞 Support

For issues and questions:
- Open an issue on GitHub
- Check existing documentation
- Review logs for error details

---

**Built with ❤️ for the Solana community**
