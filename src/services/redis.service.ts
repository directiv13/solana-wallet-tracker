import Redis from 'ioredis';
import { config } from '../config';
import pino from 'pino';

const logger = pino({ name: 'redis-service' });

export class RedisService {
  private client: Redis;
  private readonly PRICE_CACHE_PREFIX = 'price:';
  private readonly BUY_AMOUNT_PREFIX = 'buy_amount:';
  private readonly SELL_AMOUNT_PREFIX = 'sell_amount:';
  private readonly COOLDOWN_PREFIX = 'cooldown:';
  private readonly SEQUENTIAL_SELLS_PREFIX = 'sequential_sells:';

  constructor() {
    this.client = new Redis({
      host: config.redis.host,
      port: config.redis.port,
      password: config.redis.password,
      db: config.redis.db,
      retryStrategy: (times) => {
        const delay = Math.min(times * 50, 2000);
        return delay;
      },
    });

    this.client.on('connect', () => {
      logger.info('Redis client connected');
    });

    this.client.on('error', (err) => {
      logger.error({ err }, 'Redis client error');
    });
  }

  /**
   * Get cached token price in USD
   */
  async getCachedPrice(tokenMint: string): Promise<number | null> {
    try {
      const key = `${this.PRICE_CACHE_PREFIX}${tokenMint}`;
      const cached = await this.client.get(key);
      
      if (!cached) {
        return null;
      }

      const price = parseFloat(cached);
      if (isNaN(price)) {
        logger.warn({ tokenMint }, 'Invalid cached price format');
        return null;
      }

      return price;
    } catch (error) {
      logger.error({ error, tokenMint }, 'Error getting cached price');
      return null;
    }
  }

  /**
   * Cache token price in USD with TTL
   */
  async setCachedPrice(tokenMint: string, price: number): Promise<void> {
    try {
      const key = `${this.PRICE_CACHE_PREFIX}${tokenMint}`;
      await this.client.setex(
        key,
        config.priceCacheTtlSeconds,
        price.toString()
      );
    } catch (error) {
      logger.error({ error, tokenMint, price }, 'Error caching price');
    }
  }

  /**
   * Add USD amount to cumulative buy/sell tracking in time window
   * Returns the total cumulative amount in the current window
   */
  async addAmountToWindow(
    tokenMint: string,
    type: 'buy' | 'sell',
    usdAmount: number,
    timestamp: number
  ): Promise<number> {
    try {
      const prefix = type === 'buy' ? this.BUY_AMOUNT_PREFIX : this.SELL_AMOUNT_PREFIX;
      const key = `${prefix}${tokenMint}`;
      const windowStart = timestamp - config.swapTimeWindowSeconds;

      // Lua script for atomic operations:
      // 1. Remove old entries outside the time window
      // 2. Add new amount with timestamp as score and amount as member value
      // 3. Sum all amounts in current window
      const luaScript = `
        local key = KEYS[1]
        local windowStart = tonumber(ARGV[1])
        local timestamp = tonumber(ARGV[2])
        local amount = tonumber(ARGV[3])
        local ttl = tonumber(ARGV[4])
        
        -- Remove entries older than window start
        redis.call('ZREMRANGEBYSCORE', key, '-inf', windowStart)
        
        -- Add new amount (use timestamp:amount as member to ensure uniqueness)
        local member = timestamp .. ':' .. amount
        redis.call('ZADD', key, timestamp, member)
        
        -- Set expiry on the key
        redis.call('EXPIRE', key, ttl)
        
        -- Get all amounts in current window and sum them
        local entries = redis.call('ZRANGEBYSCORE', key, windowStart, '+inf')
        local total = 0
        for i, entry in ipairs(entries) do
          local amount_str = string.match(entry, ':(.+)')
          if amount_str then
            total = total + tonumber(amount_str)
          end
        end
        
        return total
      `;

      const totalAmount = await this.client.eval(
        luaScript,
        1,
        key,
        windowStart.toString(),
        timestamp.toString(),
        usdAmount.toString(),
        (config.swapTimeWindowSeconds + 300).toString()
      ) as number;

      return totalAmount;
    } catch (error) {
      logger.error({ error, tokenMint, type, usdAmount }, 'Error adding amount to window');
      throw error;
    }
  }

  /**
   * Get current cumulative amount in window for a token type
   */
  async getCumulativeAmount(
    tokenMint: string,
    type: 'buy' | 'sell'
  ): Promise<number> {
    try {
      const prefix = type === 'buy' ? this.BUY_AMOUNT_PREFIX : this.SELL_AMOUNT_PREFIX;
      const key = `${prefix}${tokenMint}`;
      const now = Math.floor(Date.now() / 1000);
      const windowStart = now - config.swapTimeWindowSeconds;

      // Lua script to sum all amounts in current window
      const luaScript = `
        local key = KEYS[1]
        local windowStart = tonumber(ARGV[1])
        
        -- Remove entries older than window start
        redis.call('ZREMRANGEBYSCORE', key, '-inf', windowStart)
        
        -- Get all amounts in current window and sum them
        local entries = redis.call('ZRANGEBYSCORE', key, windowStart, '+inf')
        local total = 0
        for i, entry in ipairs(entries) do
          local amount_str = string.match(entry, ':(.+)')
          if amount_str then
            total = total + tonumber(amount_str)
          end
        end
        
        return total
      `;

      const totalAmount = await this.client.eval(
        luaScript,
        1,
        key,
        windowStart.toString()
      ) as number;

      return totalAmount || 0;
    } catch (error) {
      logger.error({ error, tokenMint, type }, 'Error getting cumulative amount');
      return 0;
    }
  }

  /**
   * Check if notification cooldown is active
   */
  async isInCooldown(key: string): Promise<boolean> {
    try {
      const cooldownKey = `${this.COOLDOWN_PREFIX}${key}`;
      const exists = await this.client.exists(cooldownKey);
      return exists === 1;
    } catch (error) {
      logger.error({ error, key }, 'Error checking cooldown');
      return false;
    }
  }

  /**
   * Set notification cooldown
   */
  async setCooldown(key: string, seconds: number): Promise<void> {
    try {
      const cooldownKey = `${this.COOLDOWN_PREFIX}${key}`;
      await this.client.setex(cooldownKey, seconds, '1');
    } catch (error) {
      logger.error({ error, key, seconds }, 'Error setting cooldown');
    }
  }

  /**
   * Health check for Redis connection
   */
  async healthCheck(): Promise<boolean> {
    try {
      await this.client.ping();
      return true;
    } catch (error) {
      logger.error({ error }, 'Redis health check failed');
      return false;
    }
  }

  /**
   * Increment sequential sell counter for a wallet
   * Returns the new count
   */
  async incrementSequentialSells(walletAddress: string): Promise<number> {
    try {
      const key = `${this.SEQUENTIAL_SELLS_PREFIX}${walletAddress}`;
      const count = await this.client.incr(key);
      // Set expiry for 24 hours
      await this.client.expire(key, 86400);
      logger.info({ walletAddress, count }, 'Incremented sequential sells counter');
      return count;
    } catch (error) {
      logger.error({ error, walletAddress }, 'Error incrementing sequential sells');
      return 0;
    }
  }

  /**
   * Reset sequential sell counter for a wallet (called when a buy is detected)
   */
  async resetSequentialSells(walletAddress: string): Promise<void> {
    try {
      const key = `${this.SEQUENTIAL_SELLS_PREFIX}${walletAddress}`;
      await this.client.del(key);
      logger.info({ walletAddress }, 'Reset sequential sells counter');
    } catch (error) {
      logger.error({ error, walletAddress }, 'Error resetting sequential sells');
    }
  }

  /**
   * Get current sequential sell count for a wallet
   */
  async getSequentialSells(walletAddress: string): Promise<number> {
    try {
      const key = `${this.SEQUENTIAL_SELLS_PREFIX}${walletAddress}`;
      const count = await this.client.get(key);
      return count ? parseInt(count) : 0;
    } catch (error) {
      logger.error({ error, walletAddress }, 'Error getting sequential sells');
      return 0;
    }
  }

  /**
   * Close Redis connection
   */
  async close(): Promise<void> {
    await this.client.quit();
    logger.info('Redis client disconnected');
  }
}
