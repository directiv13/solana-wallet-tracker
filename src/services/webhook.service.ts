import { HeliusWebhookPayload, ParsedSwap, NotificationType } from '../types';
import { config } from '../config';
import { RedisService } from './redis.service';
import { PriceService } from './price.service';
import { NotificationService } from './notification.service';
import { DatabaseService } from './database.service';
import pino from 'pino';

const logger = pino({ name: 'webhook-service' });

export class WebhookService {
  constructor(
    private redisService: RedisService,
    private priceService: PriceService,
    private notificationService: NotificationService,
    private databaseService: DatabaseService
  ) { }

  /**
   * Process incoming Helius webhook payload
   */
  async processWebhook(payload: HeliusWebhookPayload): Promise<void> {
    try {
      logger.info(
        {
          signature: payload.signature,
          type: payload.type,
          timestamp: payload.timestamp,
        },
        'Processing webhook'
      );

      // Only process SWAP events
      if (payload.type !== 'SWAP' || !payload.events?.swap) {
        logger.debug({ type: payload.type }, 'Skipping non-SWAP event');
        return;
      }

      // Parse swap events
      const swaps = this.parseSwapEvent(payload);

      if (swaps.length === 0) {
        logger.debug('No relevant swaps found in transaction');
        return;
      }

      // Process each swap
      for (const swap of swaps) {
        await this.processSwap(swap);
      }
    } catch (error) {
      logger.error({ error, signature: payload.signature }, 'Error processing webhook');
      throw error;
    }
  }

  /**
   * Parse swap event from Helius payload
   */
  private parseSwapEvent(payload: HeliusWebhookPayload): ParsedSwap[] {
    const swaps: ParsedSwap[] = [];
    const swapEvent = payload.events.swap;

    if (!swapEvent) {
      return swaps;
    }

    // Check token inputs (sells)
    for (const input of swapEvent.tokenInputs) {
      if (input.mint === config.targetTokenMint) {
        const walletAddress = input.userAccount;

        // Check if wallet is tracked
        if (!this.isWalletTracked(walletAddress)) {
          continue;
        }

        swaps.push({
          walletAddress,
          tokenMint: input.mint,
          tokenAmount: parseFloat(input.rawTokenAmount.tokenAmount),
          decimals: input.rawTokenAmount.decimals,
          transactionSignature: payload.signature,
          timestamp: payload.timestamp,
          type: 'sell',
        });

        logger.info(
          {
            walletAddress,
            tokenMint: input.mint,
            amount: input.rawTokenAmount.tokenAmount,
            type: 'sell',
          },
          'Detected sell of target token'
        );
      }
    }

    // Check token outputs (buys)
    for (const output of swapEvent.tokenOutputs) {
      if (output.mint === config.targetTokenMint) {
        const walletAddress = output.userAccount;

        // Check if wallet is tracked
        if (!this.isWalletTracked(walletAddress)) {
          continue;
        }

        swaps.push({
          walletAddress,
          tokenMint: output.mint,
          tokenAmount: parseFloat(output.rawTokenAmount.tokenAmount),
          decimals: output.rawTokenAmount.decimals,
          transactionSignature: payload.signature,
          timestamp: payload.timestamp,
          type: 'buy',
        });

        logger.info(
          {
            walletAddress,
            tokenMint: output.mint,
            amount: output.rawTokenAmount.tokenAmount,
            type: 'buy',
          },
          'Detected buy of target token'
        );
      }
    }

    return swaps;
  }

  /**
   * Process individual swap
   */
  private async processSwap(swap: ParsedSwap): Promise<void> {
    try {
      // Use actual token decimals from the transaction
      const decimals = swap.decimals;

      // Calculate USD value
      const usdValue = await this.priceService.calculateUsdValue(
        swap.tokenMint,
        swap.tokenAmount,
        decimals
      );

      if (usdValue !== null) {
        swap.valueUsd = usdValue;
      }

      if (usdValue !== null && usdValue >= config.telegramThresholdUsd) {
        logger.info(
          {
            signature: swap.transactionSignature,
            valueUsd: usdValue,
            threshold: config.telegramThresholdUsd,
          },
          'Telegram threshold triggered: Single swap meets price threshold'
        );

        // Send both Telegram and Pushover for threshold A
        await this.notificationService.sendNotification(
          NotificationType.TELEGRAM_ALL,
          { swap }
        );
      }

      // Check threshold A: single swap >= price threshold
      if (usdValue !== null && usdValue >= config.priceThresholdUsd) {
        logger.info(
          {
            signature: swap.transactionSignature,
            valueUsd: usdValue,
            threshold: config.priceThresholdUsd,
          },
          'Threshold A triggered: Single swap meets price threshold'
        );

        await this.notificationService.sendNotification(
          NotificationType.PUSHOVER_THRESHOLD_A,
          { swap }
        );
      }

      // Check threshold B: cumulative buy/sell amount >= price threshold in time window
      if (usdValue !== null) {
        const cumulativeAmount = await this.redisService.addAmountToWindow(
          swap.tokenMint,
          swap.type,
          usdValue,
          swap.timestamp
        );

        logger.info(
          {
            tokenMint: swap.tokenMint,
            type: swap.type,
            cumulativeAmount,
            threshold: config.priceThresholdUsd,
          },
          'Current cumulative amount in window'
        );

        if (cumulativeAmount >= config.priceThresholdUsd) {
          // Check cooldown to prevent spam
          const cooldownKey = `${swap.tokenMint}:${swap.type}:threshold_b`;
          const inCooldown = await this.redisService.isInCooldown(cooldownKey);

          if (!inCooldown) {
            logger.info(
              {
                signature: swap.transactionSignature,
                type: swap.type,
                cumulativeAmount,
                threshold: config.priceThresholdUsd,
              },
              'Threshold B triggered: Cumulative amount meets threshold'
            );

            // Send both Pushover for threshold B
            await this.notificationService.sendNotification(
              NotificationType.PUSHOVER_THRESHOLD_B,
              { swap },
              { cumulativeAmount }
            );

            // Set cooldown for the time window duration
            await this.redisService.setCooldown(cooldownKey, config.swapTimeWindowSeconds);
          } else {
            logger.debug(
              { cooldownKey },
              'Threshold B triggered but in cooldown period'
            );
          }
        }
      }
    } catch (error) {
      logger.error({ error, swap }, 'Error processing swap');
      throw error;
    }
  }

  /**
   * Check if wallet is in tracked list
   */
  private isWalletTracked(walletAddress: string): boolean {
    const trackedWallets = this.databaseService.getWalletAddresses();

    // If no wallets specified, track all
    if (trackedWallets.length === 0) {
      logger.warn('No wallets in database, tracking all wallets');
      return true;
    }

    // Check if wallet is in the tracked list (case-insensitive)
    const isTracked = trackedWallets.some(
      (tracked) => tracked.toLowerCase() === walletAddress.toLowerCase()
    );

    if (!isTracked) {
      logger.debug({ walletAddress }, 'Wallet not tracked in database');
    }

    return isTracked;
  }

  /**
   * Validate webhook payload structure
   */
  validatePayload(payload: any): payload is HeliusWebhookPayload {
    if (!payload || typeof payload !== 'object') {
      return false;
    }

    const required = ['signature', 'type', 'timestamp', 'events'];
    const hasRequired = required.every((field) => field in payload);

    if (!hasRequired) {
      logger.warn({ payload }, 'Invalid webhook payload structure');
      return false;
    }

    return true;
  }
}
