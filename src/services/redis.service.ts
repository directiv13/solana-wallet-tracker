import Redis from 'ioredis';
import { config } from '../config';
import pino from 'pino';

const logger = pino({ name: 'redis-service' });

export class RedisService {
  private client: Redis;
  private readonly PRICE_CACHE_PREFIX = 'price:';
  private readonly SWAP_WINDOW_PREFIX = 'swap_window:';

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
   * Add a swap event to the sliding window using Redis ZSET
   * Returns the count of swaps in the current time window
   */
  async addSwapToWindow(
    tokenMint: string,
    timestamp: number
  ): Promise<number> {
    try {
      const key = `${this.SWAP_WINDOW_PREFIX}${tokenMint}`;
      const windowStart = timestamp - config.swapTimeWindowSeconds;

      // Lua script for atomic sliding window operations
      // 1. Remove old entries outside the time window
      // 2. Add new swap event
      // 3. Return count of swaps in window
      const luaScript = `
        local key = KEYS[1]
        local windowStart = tonumber(ARGV[1])
        local timestamp = tonumber(ARGV[2])
        local ttl = tonumber(ARGV[3])
        
        -- Remove entries older than window start
        redis.call('ZREMRANGEBYSCORE', key, '-inf', windowStart)
        
        -- Add new swap with timestamp as score
        redis.call('ZADD', key, timestamp, timestamp)
        
        -- Set expiry on the key (cleanup)
        redis.call('EXPIRE', key, ttl)
        
        -- Count swaps in current window
        local count = redis.call('ZCOUNT', key, windowStart, '+inf')
        
        return count
      `;

      const count = await this.client.eval(
        luaScript,
        1,
        key,
        windowStart.toString(),
        timestamp.toString(),
        (config.swapTimeWindowSeconds + 300).toString() // Add 5 min buffer for cleanup
      ) as number;

      return count;
    } catch (error) {
      logger.error({ error, tokenMint, timestamp }, 'Error adding swap to window');
      throw error;
    }
  }

  /**
   * Get current count of swaps in the sliding window
   */
  async getSwapCount(tokenMint: string, timestamp: number): Promise<number> {
    try {
      const key = `${this.SWAP_WINDOW_PREFIX}${tokenMint}`;
      const windowStart = timestamp - config.swapTimeWindowSeconds;

      const count = await this.client.zcount(
        key,
        windowStart,
        '+inf'
      );

      return count;
    } catch (error) {
      logger.error({ error, tokenMint }, 'Error getting swap count');
      return 0;
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
