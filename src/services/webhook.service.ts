import { HeliusWebhookPayload, ParsedSwap, NotificationType, ParsedTransaction } from '../types';
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
          payload: payload
        },
        'Processing webhook'
      );

      // Parse swap events
      const transfers = this.parseTransaction(payload);

      if (transfers.length === 0) {
        logger.debug('No relevant transfers found in transaction');
        return;
      }

      // Process each transfer
      for (const transfer of transfers) {
        await this.processTransfer(transfer);
      }
    } catch (error) {
      logger.error({ error, signature: payload.signature }, 'Error processing webhook');
      throw error;
    }
  }
   
  /**
   * Process transaction
   */
  private parseTransaction(payload: HeliusWebhookPayload): ParsedTransaction[] {
    const transfers: ParsedTransaction[] = [];

    const transaction = payload.tokenTransfers.find(transfer => transfer.mint === config.targetTokenMint);

    if(!transaction) {
      return transfers;
    }

    // BUY: The token was sent to the user's account
    if(transaction.toUserAccount === payload.feePayer) {
      transfers.push({
        walletAddress: transaction.toUserAccount,
        tokenMint: transaction.mint,
        tokenAmount: transaction.tokenAmount,
        decimals: 0, // You may want to fetch decimals from the blockchain or config
        transactionSignature: payload.signature,
        timestamp: payload.timestamp,
        type: 'buy',
      });
    }
    // SELL: The token was sent from the user's account
    else if(transaction.fromUserAccount === payload.feePayer) {
      transfers.push({
        walletAddress: transaction.fromUserAccount,
        tokenMint: transaction.mint,
        tokenAmount: transaction.tokenAmount,
        decimals: 0, // You may want to fetch decimals from the blockchain or config
        transactionSignature: payload.signature,
        timestamp: payload.timestamp,
        type: 'sell',
      });
    }
    return transfers;
  }

  /**
   * Process individual transfer
   */
  private async processTransfer(transfer: ParsedTransaction): Promise<void> {
    try {
      // Use actual token decimals from the transaction
      const decimals = transfer.decimals;

      // Calculate USD value
      const usdValue = await this.priceService.calculateUsdValue(
        transfer.tokenMint,
        transfer.tokenAmount,
        decimals
      );

      if (usdValue !== null) {
        transfer.valueUsd = usdValue;
      }

      if (usdValue !== null && usdValue >= config.telegramThresholdUsd) {
        logger.info(
          {
            signature: transfer.transactionSignature,
            valueUsd: usdValue,
            threshold: config.telegramThresholdUsd,
          },
          'Telegram threshold triggered: Single swap meets price threshold'
        );

        // Send both Telegram and Pushover for threshold A
        await this.notificationService.sendNotification(
          NotificationType.TELEGRAM_ALL,
          { transfer }
        );
      }

      // Check threshold A: single swap >= price threshold
      if (usdValue !== null && usdValue >= config.priceThresholdUsd) {
        logger.info(
          {
            signature: transfer.transactionSignature,
            valueUsd: usdValue,
            threshold: config.priceThresholdUsd,
          },
          'Threshold A triggered: Single swap meets price threshold'
        );

        await this.notificationService.sendNotification(
          NotificationType.PUSHOVER_THRESHOLD_A,
          { transfer }
        );
      }

      // Check threshold B: cumulative buy/sell amount >= price threshold in time window
      if (usdValue !== null) {
        const cumulativeAmount = await this.redisService.addAmountToWindow(
          transfer.tokenMint,
          transfer.type,
          usdValue,
          transfer.timestamp
        );

        logger.info(
          {
            tokenMint: transfer.tokenMint,
            type: transfer.type,
            cumulativeAmount,
            threshold: config.priceThresholdUsd,
          },
          'Current cumulative amount in window'
        );

        if (cumulativeAmount >= config.priceThresholdUsd) {
          // Check cooldown to prevent spam
          const cooldownKey = `${transfer.tokenMint}:${transfer.type}:threshold_b`;
          const inCooldown = await this.redisService.isInCooldown(cooldownKey);

          if (!inCooldown) {
            logger.info(
              {
                signature: transfer.transactionSignature,
                type: transfer.type,
                cumulativeAmount,
                threshold: config.priceThresholdUsd,
              },
              'Threshold B triggered: Cumulative amount meets threshold'
            );

            // Send both Pushover for threshold B
            await this.notificationService.sendNotification(
              NotificationType.PUSHOVER_THRESHOLD_B,
              { transfer },
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
      logger.error({ error, transfer }, 'Error processing transfer');
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

    const required = ['signature', 'timestamp'];
    const hasRequired = required.every((field) => field in payload);

    if (!hasRequired) {
      logger.warn({ payload }, 'Invalid webhook payload structure');
      return false;
    }

    return true;
  }
}
