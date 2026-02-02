import dotenv from 'dotenv';

dotenv.config();

export interface Config {
  // Server
  port: number;
  nodeEnv: string;

  // Redis
  redis: {
    host: string;
    port: number;
    password?: string;
    db: number;
  };

  // Telegram
  telegram: {
    botToken: string;
    chatId: string;
  };

  // Pushover
  pushover: {
    userKey: string;
    appToken: string;
  };

  // Solana
  targetTokenMint: string;
  trackedWallets: string[];

  // Helius
  helius: {
    apiKey: string;
    webhookUrl: string;
  };

  // Thresholds
  priceThresholdUsd: number;
  swapCountThreshold: number;
  swapTimeWindowSeconds: number;

  // API
  dexScreenerApiUrl: string;
  priceCacheTtlSeconds: number;
}

function getEnvVar(key: string, defaultValue?: string): string {
  const value = process.env[key] || defaultValue;
  if (value === undefined) {
    throw new Error(`Environment variable ${key} is required but not set`);
  }
  return value;
}

function getEnvVarAsNumber(key: string, defaultValue?: number): number {
  const value = process.env[key];
  if (value === undefined) {
    if (defaultValue !== undefined) {
      return defaultValue;
    }
    throw new Error(`Environment variable ${key} is required but not set`);
  }
  const parsed = Number(value);
  if (isNaN(parsed)) {
    throw new Error(`Environment variable ${key} must be a valid number`);
  }
  return parsed;
}

export const config: Config = {
  port: getEnvVarAsNumber('PORT', 3000),
  nodeEnv: getEnvVar('NODE_ENV', 'development'),

  redis: {
    host: getEnvVar('REDIS_HOST', 'localhost'),
    port: getEnvVarAsNumber('REDIS_PORT', 6379),
    password: process.env.REDIS_PASSWORD || undefined,
    db: getEnvVarAsNumber('REDIS_DB', 0),
  },

  telegram: {
    botToken: getEnvVar('TELEGRAM_BOT_TOKEN'),
    chatId: getEnvVar('TELEGRAM_CHAT_ID'),
  },

  pushover: {
    userKey: getEnvVar('PUSHOVER_USER_KEY'),
    appToken: getEnvVar('PUSHOVER_APP_TOKEN'),
  },

  targetTokenMint: getEnvVar('TARGET_TOKEN_MINT'),
  trackedWallets: getEnvVar('TRACKED_WALLETS', '')
    .split(',')
    .map(w => w.trim())
    .filter(w => w.length > 0),

  helius: {
    apiKey: getEnvVar('HELIUS_API_KEY'),
    webhookUrl: getEnvVar('HELIUS_WEBHOOK_URL'),
  },

  priceThresholdUsd: getEnvVarAsNumber('PRICE_THRESHOLD_USD', 300),
  swapCountThreshold: getEnvVarAsNumber('SWAP_COUNT_THRESHOLD', 10),
  swapTimeWindowSeconds: getEnvVarAsNumber('SWAP_TIME_WINDOW_SECONDS', 3600),

  dexScreenerApiUrl: getEnvVar(
    'DEX_SCREENER_API_URL',
    'https://api.dexscreener.com/latest/dex/tokens'
  ),
  priceCacheTtlSeconds: getEnvVarAsNumber('PRICE_CACHE_TTL_SECONDS', 60),
};
