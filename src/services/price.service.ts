import axios from 'axios';
import { config } from '../config';
import { DexScreenerResponse } from '../types';
import { RedisService } from './redis.service';
import pino from 'pino';

const logger = pino({ name: 'price-service' });

export class PriceService {
  constructor(private redisService: RedisService) {}

  /**
   * Get token price in USD with caching
   * @param tokenMint - Solana token mint address
   * @returns Price in USD or null if not found
   */
  async getTokenPrice(tokenMint: string): Promise<number | null> {
    try {
      // Check cache first
      const cachedPrice = await this.redisService.getCachedPrice(tokenMint);
      if (cachedPrice !== null) {
        logger.debug({ tokenMint, price: cachedPrice }, 'Using cached price');
        return cachedPrice;
      }

      // Fetch from DexScreener
      const price = await this.fetchPriceFromDexScreener(tokenMint);
      
      if (price !== null) {
        // Cache the price
        await this.redisService.setCachedPrice(tokenMint, price);
        logger.info({ tokenMint, price }, 'Fetched and cached new price');
      }

      return price;
    } catch (error) {
      logger.error({ error, tokenMint }, 'Error getting token price');
      return null;
    }
  }

  /**
   * Fetch token price from DexScreener API
   * @param tokenMint - Solana token mint address
   * @returns Price in USD or null if not found
   */
  private async fetchPriceFromDexScreener(
    tokenMint: string
  ): Promise<number | null> {
    try {
      const url = `${config.dexScreenerApiUrl}/${tokenMint}`;
      
      logger.debug({ url }, 'Fetching price from DexScreener');

      const response = await axios.get<DexScreenerResponse>(url, {
        timeout: 5000,
        headers: {
          'Accept': 'application/json',
        },
      });

      if (!response.data || !response.data.pairs || response.data.pairs.length === 0) {
        logger.warn({ tokenMint }, 'No pairs found for token');
        return null;
      }

      // Get the first pair with the highest liquidity
      const pairs = response.data.pairs.filter(pair => pair.priceUsd);
      
      if (pairs.length === 0) {
        logger.warn({ tokenMint }, 'No pairs with USD price found');
        return null;
      }

      // Sort by liquidity and get the most liquid pair
      const bestPair = pairs.sort((a, b) => {
        const liquidityA = a.liquidity?.usd || 0;
        const liquidityB = b.liquidity?.usd || 0;
        return liquidityB - liquidityA;
      })[0];

      const price = parseFloat(bestPair.priceUsd);
      
      if (isNaN(price) || price <= 0) {
        logger.warn({ tokenMint, priceUsd: bestPair.priceUsd }, 'Invalid price value');
        return null;
      }

      logger.info(
        {
          tokenMint,
          price,
          symbol: bestPair.baseToken.symbol,
          dexId: bestPair.dexId,
          liquidity: bestPair.liquidity?.usd,
        },
        'Successfully fetched price from DexScreener'
      );

      return price;
    } catch (error) {
      if (axios.isAxiosError(error)) {
        logger.error(
          {
            tokenMint,
            status: error.response?.status,
            statusText: error.response?.statusText,
            message: error.message,
          },
          'DexScreener API request failed'
        );
      } else {
        logger.error({ error, tokenMint }, 'Unexpected error fetching price');
      }
      return null;
    }
  }

  /**
   * Calculate USD value of a token amount
   * @param tokenMint - Solana token mint address
   * @param amount - Token amount
   * @param decimals - Token decimals
   * @returns USD value or null if price not available
   */
  async calculateUsdValue(
    tokenMint: string,
    amount: number,
    decimals: number
  ): Promise<number | null> {
    try {
      const price = await this.getTokenPrice(tokenMint);
      
      if (price === null) {
        return null;
      }

      // Convert raw amount to actual token amount using decimals
      const actualAmount = amount / Math.pow(10, decimals);
      const usdValue = actualAmount * price;

      logger.debug(
        {
          tokenMint,
          amount,
          decimals,
          actualAmount,
          price,
          usdValue,
        },
        'Calculated USD value'
      );

      return usdValue;
    } catch (error) {
      logger.error({ error, tokenMint, amount, decimals }, 'Error calculating USD value');
      return null;
    }
  }
}
