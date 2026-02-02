# Helius Webhook Setup Guide

This guide explains how to configure Helius webhooks to send transaction data to your application.

## Overview

Helius webhooks deliver real-time transaction data to your application. This tracker uses the **Enhanced Transaction** webhook type to monitor token swaps.

## Prerequisites

- Helius API Key ([Get one here](https://helius.xyz/))
- Public webhook endpoint (HTTPS recommended)
- Application running and accessible

## Setup Options

### Option 1: Automatic Setup (Recommended)

The application automatically creates/updates webhooks on startup.

1. Configure environment variables:
   ```env
   HELIUS_API_KEY=your_api_key_here
   HELIUS_WEBHOOK_URL=https://your-domain.com/webhook
   TRACKED_WALLETS=wallet1,wallet2,wallet3
   ```

2. Start the application:
   ```bash
   npm start
   ```

The webhook will be created automatically. Check logs for confirmation:
```
✅ Webhook setup successful: wh_abc123...
```

### Option 2: Manual API Setup

Use the admin endpoints to manage webhooks:

#### Create/Update Webhook

```bash
curl -X POST http://localhost:3000/admin/webhook/setup \
  -H "Content-Type: application/json"
```

Response:
```json
{
  "success": true,
  "webhookId": "wh_abc123...",
  "message": "Webhook created successfully"
}
```

#### List All Webhooks

```bash
curl http://localhost:3000/admin/webhooks
```

#### Get Webhook Details

```bash
curl http://localhost:3000/admin/webhook/wh_abc123
```

#### Add Wallets to Webhook

```bash
curl -X POST http://localhost:3000/admin/webhook/wh_abc123/wallets/add \
  -H "Content-Type: application/json" \
  -d '{
    "wallets": ["wallet4", "wallet5"]
  }'
```

#### Remove Wallets from Webhook

```bash
curl -X POST http://localhost:3000/admin/webhook/wh_abc123/wallets/remove \
  -H "Content-Type: application/json" \
  -d '{
    "wallets": ["wallet4"]
  }'
```

#### Delete Webhook

```bash
curl -X DELETE http://localhost:3000/admin/webhook/wh_abc123
```

### Option 3: Helius Dashboard

1. Go to [Helius Dashboard](https://dashboard.helius.xyz/)
2. Navigate to **Webhooks**
3. Click **Create Webhook**
4. Configure:
   - **Type**: Enhanced Transaction
   - **Webhook URL**: `https://your-domain.com/webhook`
   - **Account Addresses**: Your tracked wallet addresses
   - **Transaction Types**: Select all (SWAP, TRANSFER, etc.)
5. Click **Create**

## Webhook Configuration

### Transaction Types

The application processes these transaction types:
- **SWAP**: Token buy/sell events (primary focus)
- **TRANSFER**: Token transfers
- All other transaction types are logged but may not trigger notifications

### Event Filtering

The webhook service automatically:
- Validates wallet addresses against `TRACKED_WALLETS`
- Detects buy/sell actions for `TARGET_TOKEN_MINT`
- Calculates USD values via DEX Screener API
- Checks price and frequency thresholds

### Rate Limiting

Nginx is configured to rate-limit webhook requests:
- **Default**: 100 requests per minute per IP
- **Burst**: 20 additional requests
- Adjust in [nginx/nginx.conf](../nginx/nginx.conf)

## Testing

### Test Webhook Delivery

Helius provides webhook testing in the dashboard:

1. Go to your webhook in Helius Dashboard
2. Click **Test Webhook**
3. Select a sample transaction type
4. Click **Send Test**

Check your application logs for the received payload.

### Manual Test

Send a test payload:

```bash
curl -X POST http://localhost:3000/webhook \
  -H "Content-Type: application/json" \
  -d @test-payload.json
```

Example `test-payload.json`:
```json
[
  {
    "type": "ENHANCED",
    "source": "HELIUS_WEBHOOK",
    "timestamp": 1640000000000,
    "signature": "test_signature_123",
    "description": "Test swap",
    "accountData": [
      {
        "account": "7xKXtg2CW87d97TXJSDpbD5jBkheTqA83TZRuJosgAsU",
        "nativeBalanceChange": -1000000,
        "tokenBalanceChanges": []
      }
    ],
    "tokenTransfers": [
      {
        "fromUserAccount": "7xKXtg2CW87d97TXJSDpbD5jBkheTqA83TZRuJosgAsU",
        "toUserAccount": "other_wallet",
        "mint": "EPjFWdd5AufqSSqeM2qN1xzybapC8G4wEGGkZwyTDt1v",
        "tokenAmount": 100
      }
    ]
  }
]
```

## Monitoring

### Check Webhook Status

```bash
curl http://localhost:3000/admin/webhook/wh_abc123
```

Response includes:
- Webhook ID
- Webhook URL
- Number of tracked wallets
- Status

### View Webhook Statistics

Helius Dashboard provides:
- Delivery success rate
- Response times
- Error logs
- Request volume

### Application Logs

Monitor webhook processing:

```bash
# Docker
docker-compose logs -f app

# Direct
npm run dev
```

Look for:
- `📨 Received webhook: ...` - Incoming webhooks
- `💱 SWAP detected: ...` - Detected swaps
- `📤 Notification sent: ...` - Sent notifications
- `❌ Error: ...` - Processing errors

## Troubleshooting

### Webhook Not Receiving Data

**Check webhook URL:**
```bash
curl http://your-domain.com/health
```

**Verify Helius webhook configuration:**
```bash
curl http://localhost:3000/admin/webhooks
```

**Check if wallets are tracked:**
- Ensure `TRACKED_WALLETS` in `.env` matches webhook addresses
- Verify wallet addresses are correct Solana public keys

### 502 Bad Gateway (Nginx)

**Check if application is running:**
```bash
docker-compose ps
```

**Check application logs:**
```bash
docker-compose logs app
```

**Restart services:**
```bash
docker-compose restart
```

### Webhook Signature Validation

If you need to verify webhook authenticity:

1. Get your webhook secret from Helius Dashboard
2. Add verification to `src/services/webhook.service.ts`:

```typescript
import crypto from 'crypto';

function verifyWebhookSignature(
  payload: string, 
  signature: string, 
  secret: string
): boolean {
  const expectedSignature = crypto
    .createHmac('sha256', secret)
    .update(payload)
    .digest('hex');
  return crypto.timingSafeEqual(
    Buffer.from(signature),
    Buffer.from(expectedSignature)
  );
}
```

### Rate Limit Errors

If webhooks are being rate-limited:

1. Increase Nginx rate limit in `nginx/nginx.conf`:
   ```nginx
   limit_req_zone $binary_remote_addr zone=webhook_limit:10m rate=200r/m;
   ```

2. Restart Nginx:
   ```bash
   docker-compose restart nginx
   ```

### Missing Transactions

**Verify transaction types:**
- Helius webhook must be configured for relevant transaction types
- Check webhook settings in Helius Dashboard

**Check DEX Screener API:**
```bash
curl http://localhost:3000/stats/price
```

If price is `null`, the token may not be listed on DEX Screener.

## Best Practices

1. **Use HTTPS**: Always use HTTPS for production webhooks
2. **Monitor Logs**: Regularly check application and Nginx logs
3. **Test Webhooks**: Use Helius test feature before going live
4. **Rate Limits**: Configure appropriate rate limits for your volume
5. **Backup Webhook IDs**: Save webhook IDs in case you need to recover
6. **Security**: Protect admin endpoints with IP whitelisting or authentication

## Webhook Limits

- **Maximum wallets per webhook**: 500
- **Maximum webhooks per account**: Check Helius plan limits
- **Request timeout**: 30 seconds
- **Payload size**: Up to 1MB

## Support

- **Helius Documentation**: https://docs.helius.xyz/
- **Helius Discord**: https://discord.gg/helius
- **Application Issues**: Check application logs and DEPLOYMENT.md

---

For more information, see:
- [DEPLOYMENT.md](DEPLOYMENT.md) - Full deployment guide
- [README.md](README.md) - Application overview
- [API.md](API.md) - API documentation
