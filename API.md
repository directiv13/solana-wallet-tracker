# API Documentation

## Overview

This document describes all API endpoints available in the Solana Wallet Tracker application.

**Base URL**: `http://localhost:3000` (development)

**Content-Type**: `application/json`

## Authentication

Currently, no authentication is required. In production, consider implementing:
- API key authentication
- JWT tokens
- IP whitelist
- HMAC signature verification for webhooks

---

## Endpoints

### 1. Health Check

Check the health status of the application and its dependencies.

**Endpoint**: `GET /health`

**Response**: `200 OK` (healthy) or `503 Service Unavailable` (degraded)

```json
{
  "status": "healthy",
  "timestamp": "2026-01-28T12:00:00.000Z",
  "services": {
    "redis": "up",
    "server": "up"
  },
  "config": {
    "targetTokenMint": "EPjFWdd5AufqSSqeM2qN1xzybapC8G4wEGGkZwyTDt1v",
    "trackedWalletsCount": 2,
    "pushoverSubscribersCount": 0,
    "priceThresholdUsd": 300,
    "swapTimeWindowSeconds": 3600
  }
}
```

**Status Codes**:
- `200`: All services operational
- `503`: One or more services degraded

**Example**:
```bash
curl http://localhost:3000/health
```

---

### 2. Webhook Receiver

Receives and processes Helius Enhanced Transaction webhooks.

**Endpoint**: `POST /webhook`

**Content-Type**: `application/json`

**Request Body**: Helius Enhanced Transaction payload

```json
{
  "accountData": [...],
  "description": "User swapped 100 USDC for 0.05 SOL on Raydium",
  "type": "SWAP",
  "source": "RAYDIUM",
  "fee": 5000,
  "feePayer": "7xKXtg2CW87d97TXJSDpbD5jBkheTqA83TZRuJosgAsU",
  "signature": "5J7XnW...",
  "slot": 123456789,
  "timestamp": 1706443200,
  "nativeTransfers": [...],
  "tokenTransfers": [...],
  "events": {
    "swap": {
      "tokenInputs": [
        {
          "mint": "EPjFWdd5AufqSSqeM2qN1xzybapC8G4wEGGkZwyTDt1v",
          "rawTokenAmount": {
            "tokenAmount": "100000000",
            "decimals": 6
          },
          "tokenAccount": "...",
          "userAccount": "7xKXtg2CW87d97TXJSDpbD5jBkheTqA83TZRuJosgAsU"
        }
      ],
      "tokenOutputs": [...]
    }
  }
}
```

**Response**: `200 OK`

```json
{
  "success": true,
  "signature": "5J7XnW...",
  "message": "Webhook received and queued for processing"
}
```

**Error Responses**:

`400 Bad Request` - Invalid payload structure
```json
{
  "error": "Invalid payload structure",
  "message": "The webhook payload does not match the expected structure"
}
```

`500 Internal Server Error` - Processing error
```json
{
  "error": "Internal server error",
  "message": "An error occurred while processing the webhook"
}
```

**Example**:
```bash
curl -X POST http://localhost:3000/webhook \
  -H "Content-Type: application/json" \
  -d @webhook-payload.json
```

---

### 3. Test Notifications

Test Telegram and Pushover notification integrations.

**Endpoint**: `POST /test/notifications`

**Response**: `200 OK`

```json
{
  "telegram": "success",
  "pushover": "success"
}
```

**Possible Values**:
- `"success"`: Notification sent successfully
- `"failed"`: Notification failed to send

**Example**:
```bash
curl -X POST http://localhost:3000/test/notifications
```

**Expected Behavior**:
- Sends test message to configured Telegram chat
- Sends test notification to configured Pushover device

---

### 4. Token Price

Get the current cached price of the target token in USD.

**Endpoint**: `GET /stats/price`

**Response**: `200 OK`

```json
{
  "tokenMint": "EPjFWdd5AufqSSqeM2qN1xzybapC8G4wEGGkZwyTDt1v",
  "priceUsd": 0.9998,
  "cachedAt": "2026-01-28T12:00:00.000Z"
}
```

**Error Responses**:

`404 Not Found` - Price not available
```json
{
  "error": "Price not found",
  "tokenMint": "EPjFWdd5AufqSSqeM2qN1xzybapC8G4wEGGkZwyTDt1v"
}
```

**Example**:
```bash
curl http://localhost:3000/stats/price
```

---

## Webhook Payload Structure

### Complete Helius Enhanced Transaction Schema

```typescript
interface HeliusWebhookPayload {
  accountData: AccountData[];
  description: string;
  type: string;                    // e.g., "SWAP", "TRANSFER", "NFT_MINT"
  source: string;                  // e.g., "RAYDIUM", "JUPITER"
  fee: number;                     // in lamports
  feePayer: string;                // wallet address
  signature: string;               // transaction signature
  slot: number;                    // Solana slot number
  timestamp: number;               // Unix timestamp
  nativeTransfers: NativeTransfer[];
  tokenTransfers: TokenTransfer[];
  events: {
    swap?: SwapEvent;
    // ... other event types
  };
}

interface SwapEvent {
  nativeInput?: {
    account: string;
    amount: string;
  };
  nativeOutput?: {
    account: string;
    amount: string;
  };
  tokenInputs: TokenSwapData[];    // Tokens sold
  tokenOutputs: TokenSwapData[];   // Tokens bought
}

interface TokenSwapData {
  mint: string;                    // Token mint address
  rawTokenAmount: {
    tokenAmount: string;           // Raw amount (without decimals)
    decimals: number;              // Token decimals
  };
  tokenAccount: string;            // Associated token account
  userAccount: string;             // User wallet address
}
```

### Example Real-World Webhook

```json
{
  "accountData": [
    {
      "account": "7xKXtg2CW87d97TXJSDpbD5jBkheTqA83TZRuJosgAsU",
      "nativeBalanceChange": -5000,
      "tokenBalanceChanges": [
        {
          "mint": "EPjFWdd5AufqSSqeM2qN1xzybapC8G4wEGGkZwyTDt1v",
          "rawTokenAmount": {
            "tokenAmount": "-100000000",
            "decimals": 6
          },
          "tokenAccount": "ABC123...",
          "userAccount": "7xKXtg2CW87d97TXJSDpbD5jBkheTqA83TZRuJosgAsU"
        }
      ]
    }
  ],
  "description": "7xKXtg swapped 100 USDC for 0.05 SOL",
  "type": "SWAP",
  "source": "RAYDIUM",
  "fee": 5000,
  "feePayer": "7xKXtg2CW87d97TXJSDpbD5jBkheTqA83TZRuJosgAsU",
  "signature": "5J7XnWxQJaKCmT9KKPv3hU8JQnDzMwV5jTBhR7nY4oXCqH2FpL1vN3mS8qW6rT4uZ9eA1bC3dE5fG7hI9jK0lM2n",
  "slot": 234567890,
  "timestamp": 1706443200,
  "nativeTransfers": [],
  "tokenTransfers": [
    {
      "fromUserAccount": "7xKXtg2CW87d97TXJSDpbD5jBkheTqA83TZRuJosgAsU",
      "toUserAccount": "RaydiumPoolAddress...",
      "fromTokenAccount": "ABC123...",
      "toTokenAccount": "DEF456...",
      "tokenAmount": 100,
      "mint": "EPjFWdd5AufqSSqeM2qN1xzybapC8G4wEGGkZwyTDt1v",
      "tokenStandard": "Fungible"
    }
  ],
  "events": {
    "swap": {
      "tokenInputs": [
        {
          "mint": "EPjFWdd5AufqSSqeM2qN1xzybapC8G4wEGGkZwyTDt1v",
          "rawTokenAmount": {
            "tokenAmount": "100000000",
            "decimals": 6
          },
          "tokenAccount": "ABC123...",
          "userAccount": "7xKXtg2CW87d97TXJSDpbD5jBkheTqA83TZRuJosgAsU"
        }
      ],
      "tokenOutputs": [
        {
          "mint": "So11111111111111111111111111111111111111112",
          "rawTokenAmount": {
            "tokenAmount": "50000000",
            "decimals": 9
          },
          "tokenAccount": "GHI789...",
          "userAccount": "7xKXtg2CW87d97TXJSDpbD5jBkheTqA83TZRuJosgAsU"
        }
      ]
    }
  }
}
```

---

## Rate Limits

**Current**: No rate limiting implemented

**Recommendations for Production**:
- `/webhook`: 1000 requests per minute
- `/stats/*`: 100 requests per minute
- `/test/*`: 10 requests per minute

---

## Error Handling

### Standard Error Response

```json
{
  "error": "Error type",
  "message": "Detailed error message",
  "statusCode": 400,
  "timestamp": "2026-01-28T12:00:00.000Z"
}
```

### Common HTTP Status Codes

| Code | Meaning | When Used |
|------|---------|-----------|
| 200 | OK | Successful request |
| 400 | Bad Request | Invalid payload or parameters |
| 404 | Not Found | Resource not found (e.g., price) |
| 500 | Internal Server Error | Server-side error |
| 503 | Service Unavailable | Service degraded (e.g., Redis down) |

---

## Versioning

**Current Version**: v1 (implicit)

API versioning not yet implemented. Future versions will use:
- URL versioning: `/v2/webhook`
- Header versioning: `Accept: application/vnd.api+json; version=2`

---

## CORS

CORS is enabled for all origins in development.

**Production Recommendations**:
```typescript
server.register(cors, {
  origin: ['https://yourdomain.com'],
  credentials: true,
  methods: ['GET', 'POST'],
});
```

---

## Request/Response Examples

### Full cURL Examples

**1. Health Check**
```bash
curl -i http://localhost:3000/health
```

**2. Submit Webhook (with file)**
```bash
curl -X POST http://localhost:3000/webhook \
  -H "Content-Type: application/json" \
  -d @examples/webhook-payload.json
```

**3. Test Notifications**
```bash
curl -X POST http://localhost:3000/test/notifications \
  -H "Content-Type: application/json"
```

**4. Get Swap Stats**
```bash
curl http://localhost:3000/stats/swaps | jq
```

**5. Get Token Price**
```bash
curl http://localhost:3000/stats/price | jq
```

### JavaScript Examples

**Using fetch:**
```javascript
// Submit webhook
const response = await fetch('http://localhost:3000/webhook', {
  method: 'POST',
  headers: { 'Content-Type': 'application/json' },
  body: JSON.stringify(webhookPayload),
});

const result = await response.json();
console.log(result);

// Get stats
const stats = await fetch('http://localhost:3000/stats/swaps')
  .then(res => res.json());
console.log(`Current swaps: ${stats.swapCount}`);
```

**Using axios:**
```javascript
const axios = require('axios');

// Health check
const health = await axios.get('http://localhost:3000/health');
console.log('Services:', health.data.services);

// Test notifications
await axios.post('http://localhost:3000/test/notifications');
```

### Python Examples

```python
import requests

# Health check
response = requests.get('http://localhost:3000/health')
print(f"Status: {response.json()['status']}")

# Submit webhook
webhook_data = {...}  # Your webhook payload
response = requests.post(
    'http://localhost:3000/webhook',
    json=webhook_data
)
print(f"Success: {response.json()['success']}")

# Get price
price_response = requests.get('http://localhost:3000/stats/price')
price = price_response.json()['priceUsd']
print(f"Token price: ${price}")
```

---

## Postman Collection

Import this collection to test all endpoints:

```json
{
  "info": {
    "name": "Solana Wallet Tracker",
    "schema": "https://schema.getpostman.com/json/collection/v2.1.0/collection.json"
  },
  "item": [
    {
      "name": "Health Check",
      "request": {
        "method": "GET",
        "url": "{{baseUrl}}/health"
      }
    },
    {
      "name": "Test Notifications",
      "request": {
        "method": "POST",
        "url": "{{baseUrl}}/test/notifications"
      }
    },
    {
      "name": "Get Swap Stats",
      "request": {
        "method": "GET",
        "url": "{{baseUrl}}/stats/swaps"
      }
    },
    {
      "name": "Get Token Price",
      "request": {
        "method": "GET",
        "url": "{{baseUrl}}/stats/price"
      }
    }
  ],
  "variable": [
    {
      "key": "baseUrl",
      "value": "http://localhost:3000"
    }
  ]
}
```

---

## Webhooks Integration Guide

### Setting up Helius Webhook

1. **Create Webhook in Helius Dashboard**
   - Navigate to https://dashboard.helius.xyz/webhooks
   - Click "Create Webhook"
   - Select "Enhanced Transactions"

2. **Configure Webhook**
   - **Webhook URL**: `https://your-domain.com/webhook`
   - **Transaction Types**: Select "SWAP"
   - **Account Addresses**: Add your tracked wallet addresses
   - **Webhook Type**: Enhanced

3. **Testing**
   - Use Helius webhook testing feature
   - Check server logs for incoming requests
   - Verify notifications are sent

### Webhook Security

**Verify requests are from Helius:**

```typescript
// Add middleware to verify Helius signature
server.addHook('preHandler', async (request, reply) => {
  if (request.url === '/webhook') {
    const signature = request.headers['x-helius-signature'];
    if (!verifyHeliusSignature(signature, request.body)) {
      reply.code(401).send({ error: 'Unauthorized' });
    }
  }
});
```

---

*API documentation version 1.0 - Last updated: January 28, 2026*
