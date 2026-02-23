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
  private readonly PREV_CUMULATIVE_PREFIX = 'prev_cumulative:';

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
      const cleanupThreshold = timestamp - 14400; // Keep 4 hours of data

      // Lua script for atomic operations:
      // 1. Remove old entries outside 4 hours to conserve memory
      // 2. Add new amount with timestamp as score and amount as member value
      // 3. Sum all amounts in current window (swapTimeWindowSeconds)
      // 4. Set TTL to keep the key alive while data is being added
      const luaScript = `
        local key = KEYS[1]
        local windowStart = tonumber(ARGV[1])
        local timestamp = tonumber(ARGV[2])
        local amount = tonumber(ARGV[3])
        local ttl = tonumber(ARGV[4])
        local cleanupThreshold = tonumber(ARGV[5])
        
        -- Remove entries older than 4 hours
        redis.call('ZREMRANGEBYSCORE', key, '-inf', cleanupThreshold)
        
        -- Add new amount (use timestamp:amount as member to ensure uniqueness)
        local member = timestamp .. ':' .. amount
        redis.call('ZADD', key, timestamp, member)
        
        -- Set expiry on the key to prevent it from living forever if no new data comes
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
        (14700).toString(), // TTL (4 hours + 5 minutes) in seconds 
        cleanupThreshold.toString()
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
      // Note: We keep data for 4 hours (14400 seconds) to support longer-term queries
      const luaScript = `
        local key = KEYS[1]
        local windowStart = tonumber(ARGV[1])
        local cleanupThreshold = tonumber(ARGV[2])
        
        -- Remove entries older than 4 hours to conserve memory
        redis.call('ZREMRANGEBYSCORE', key, '-inf', cleanupThreshold)
        
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

      const cleanupThreshold = now - 14400; // Keep 4 hours of data

      const totalAmount = await this.client.eval(
        luaScript,
        1,
        key,
        windowStart.toString(),
        cleanupThreshold.toString()
      ) as number;

      return totalAmount || 0;
    } catch (error) {
      logger.error({ error, tokenMint, type }, 'Error getting cumulative amount');
      return 0;
    }
  }

  /**
   * Get cumulative amounts for all tokens in a specific time period (in seconds)
   * Returns total buys and sells
   */
  async getCumulativeAmounts(periodSeconds: number): Promise<{ buys: number; sells: number }> {
    try {
      const now = Math.floor(Date.now() / 1000);
      const windowStart = now - periodSeconds;
      const cleanupThreshold = now - 14400; // Keep 4 hours of data

      // Get all keys for buy and sell amounts
      const buyKeys = await this.client.keys(`${this.BUY_AMOUNT_PREFIX}*`);
      const sellKeys = await this.client.keys(`${this.SELL_AMOUNT_PREFIX}*`);

      let totalBuys = 0;
      let totalSells = 0;

      // Lua script to sum amounts in window
      // Note: We keep data for 4 hours to support longer-term queries
      const luaScript = `
        local key = KEYS[1]
        local windowStart = tonumber(ARGV[1])
        local cleanupThreshold = tonumber(ARGV[2])
        
        -- Remove entries older than 4 hours to conserve memory
        redis.call('ZREMRANGEBYSCORE', key, '-inf', cleanupThreshold)
        
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

      // Sum all buy amounts
      for (const key of buyKeys) {
        const amount = await this.client.eval(
          luaScript,
          1,
          key,
          windowStart.toString(),
          cleanupThreshold.toString()
        ) as number;
        totalBuys += amount || 0;
      }

      // Sum all sell amounts
      for (const key of sellKeys) {
        const amount = await this.client.eval(
          luaScript,
          1,
          key,
          windowStart.toString(),
          cleanupThreshold.toString()
        ) as number;
        totalSells += amount || 0;
      }

      return { buys: totalBuys, sells: totalSells };
    } catch (error) {
      logger.error({ error, periodSeconds }, 'Error getting cumulative amounts');
      return { buys: 0, sells: 0 };
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
   * Get previous cumulative amount for direction change detection
   */
  async getPreviousCumulativeAmount(periodSeconds: number): Promise<number | null> {
    try {
      const key = `${this.PREV_CUMULATIVE_PREFIX}${periodSeconds}`;
      const cached = await this.client.get(key);
      
      if (!cached) {
        return null;
      }

      const amount = parseFloat(cached);
      if (isNaN(amount)) {
        logger.warn({ periodSeconds }, 'Invalid previous cumulative amount format');
        return null;
      }

      return amount;
    } catch (error) {
      logger.error({ error, periodSeconds }, 'Error getting previous cumulative amount');
      return null;
    }
  }

  /**
   * Set previous cumulative amount for direction change detection
   * TTL set to 2x the period to ensure it persists between checks
   */
  async setPreviousCumulativeAmount(periodSeconds: number, amount: number): Promise<void> {
    try {
      const key = `${this.PREV_CUMULATIVE_PREFIX}${periodSeconds}`;
      const ttl = periodSeconds * 2; // 2x the period
      await this.client.setex(key, ttl, amount.toString());
    } catch (error) {
      logger.error({ error, periodSeconds, amount }, 'Error setting previous cumulative amount');
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
   * Close Redis connection
   */
  async close(): Promise<void> {
    await this.client.quit();
    logger.info('Redis client disconnected');
  }
}
