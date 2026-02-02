import { Telegraf } from 'telegraf';
// @ts-ignore - No types available for pushover-notifications
import Pushover from 'pushover-notifications';
import { config } from '../config';
import { NotificationPayload, NotificationType } from '../types';
import { DatabaseService } from './database.service';
import pino from 'pino';

const logger = pino({ name: 'notification-service' });

export class NotificationService {
  private telegramBot: Telegraf;
  private databaseService: DatabaseService;

  constructor(databaseService: DatabaseService) {
    this.telegramBot = new Telegraf(config.telegram.botToken);
    this.databaseService = databaseService;

    logger.info('Notification service initialized');
  }

  /**
   * Send notification based on type
   */
  async sendNotification(
    type: NotificationType,
    payload: NotificationPayload,
    additionalContext?: { cumulativeAmount?: number }
  ): Promise<void> {
    try {
      switch (type) {
        case NotificationType.TELEGRAM_ALL:
          await this.sendTelegramNotification(payload);
          break;
        case NotificationType.PUSHOVER_THRESHOLD_A:
          await this.sendPushoverThresholdA(payload);
          break;
        case NotificationType.PUSHOVER_THRESHOLD_B:
          await this.sendPushoverThresholdB(payload, additionalContext?.cumulativeAmount || 0);
          break;
        default:
          logger.warn({ type }, 'Unknown notification type');
      }
    } catch (error) {
      logger.error({ error, type, payload }, 'Error sending notification');
    }
  }

  /**
   * Send Telegram notification for every buy/sell
   */
  private async sendTelegramNotification(
    payload: NotificationPayload
  ): Promise<void> {
    try {
      const { swap, tokenSymbol, tokenName } = payload;
      
      const emoji = swap.type === 'buy' ? '🟢' : '🔴';
      const action = swap.type === 'buy' ? 'BOUGHT' : 'SOLD';
      
      const tokenDisplay = tokenSymbol || tokenName || 'Token';
      const valueDisplay = swap.valueUsd 
        ? `\n💰 Value: $${swap.valueUsd.toFixed(2)} USD`
        : '';

      const message = `
${emoji} **${action}** ${tokenDisplay}

👤 Wallet: \`${swap.walletAddress}\`
🔢 Amount: ${swap.tokenAmount.toLocaleString()}${valueDisplay}
🔗 [View Transaction](https://solscan.io/tx/${swap.transactionSignature})
⏰ ${new Date(swap.timestamp * 1000).toLocaleString()}
      `.trim();

      await this.telegramBot.telegram.sendMessage(
        config.telegram.chatId,
        message,
        { parse_mode: 'Markdown' }
      );

      logger.info(
        {
          walletAddress: swap.walletAddress,
          type: swap.type,
          signature: swap.transactionSignature,
        },
        'Telegram notification sent'
      );
    } catch (error) {
      logger.error({ error, payload }, 'Error sending Telegram notification');
      throw error;
    }
  }

  /**
   * Send Pushover notification for threshold A (single swap > $300)
   */
  private async sendPushoverThresholdA(
    payload: NotificationPayload
  ): Promise<void> {
    try {
      const { swap, tokenSymbol } = payload;
      
      if (!swap.valueUsd) {
        logger.warn('Cannot send threshold A notification without USD value');
        return;
      }

      const title = `🚨 Large ${swap.type.toUpperCase()} Alert`;
      const message = `
${tokenSymbol || 'Token'} ${swap.type}
Wallet: ${swap.walletAddress}
Value: $${swap.valueUsd.toFixed(2)} USD
Amount: ${swap.tokenAmount.toLocaleString()}

View: https://solscan.io/tx/${swap.transactionSignature}
      `.trim();

      await this.sendPushoverToAllSubscribers(title, message, 1); // Priority 1 (high)

      logger.info(
        {
          walletAddress: swap.walletAddress,
          valueUsd: swap.valueUsd,
          signature: swap.transactionSignature,
        },
        'Pushover threshold A notification sent'
      );
    } catch (error) {
      logger.error({ error, payload }, 'Error sending Pushover threshold A notification');
      throw error;
    }
  }

  /**
   * Send Pushover notification for threshold B (cumulative amount >= threshold in time window)
   */
  private async sendPushoverThresholdB(
    payload: NotificationPayload,
    cumulativeAmount: number
  ): Promise<void> {
    try {
      const { swap, tokenSymbol } = payload;
      
      const title = `⚡ Volume Alert: ${swap.type.toUpperCase()}`;
      const message = `
${tokenSymbol || 'Token'} ${swap.type} volume surge!
Cumulative ${swap.type}s: $${cumulativeAmount.toFixed(2)} USD
Time window: ${Math.floor(config.swapTimeWindowSeconds / 60)} minutes

Latest ${swap.type}:
Wallet: ${swap.walletAddress}
Amount: ${swap.tokenAmount.toLocaleString()}
${swap.valueUsd ? `Value: $${swap.valueUsd.toFixed(2)} USD` : ''}

View: https://solscan.io/tx/${swap.transactionSignature}
      `.trim();

      await this.sendPushoverToAllSubscribers(title, message, 1); // Priority 1 (high)

      logger.info(
        {
          type: swap.type,
          cumulativeAmount,
          signature: swap.transactionSignature,
        },
        'Pushover threshold B notification sent'
      );
    } catch (error) {
      logger.error({ error, payload, cumulativeAmount }, 'Error sending Pushover threshold B notification');
      throw error;
    }
  }

  /**
   * Send Pushover message to all subscribed users
   */
  private async sendPushoverToAllSubscribers(
    title: string,
    message: string,
    priority: number = 0
  ): Promise<void> {
    const subscriptions = this.databaseService.getAllPushoverSubscriptions();
    
    if (subscriptions.length === 0) {
      logger.warn('No Pushover subscriptions found, skipping notification');
      return;
    }

    logger.info({ count: subscriptions.length }, 'Sending Pushover to all subscribers');

    const promises = subscriptions.map(async (sub) => {
      try {
        const pushoverClient = new Pushover({
          user: sub.pushoverUserKey,
          token: config.pushover.appToken,
        });

        await this.sendPushoverMessage(pushoverClient, title, message, priority);
        logger.info({ userId: sub.userId }, 'Pushover sent to subscriber');
      } catch (error) {
        logger.error({ error, userId: sub.userId }, 'Failed to send Pushover to subscriber');
      }
    });

    await Promise.allSettled(promises);
  }

  /**
   * Send Pushover message
   */
  private async sendPushoverMessage(
    pushoverClient: Pushover,
    title: string,
    message: string,
    priority: number = 0
  ): Promise<void> {
    return new Promise((resolve, reject) => {
      pushoverClient.send(
        {
          title,
          message,
          priority,
          sound: priority > 0 ? 'cashregister' : 'pushover',
        },
        (err: Error | null) => {
          if (err) {
            reject(err);
          } else {
            resolve();
          }
        }
      );
    });
  }

  /**
   * Test Telegram connection
   */
  async testTelegram(): Promise<boolean> {
    try {
      await this.telegramBot.telegram.sendMessage(
        config.telegram.chatId,
        '✅ Telegram bot connected successfully!'
      );
      logger.info('Telegram test successful');
      return true;
    } catch (error) {
      logger.error({ error }, 'Telegram test failed');
      return false;
    }
  }

  /**
   * Test Pushover connection
   */
  async testPushover(): Promise<boolean> {
    try {
      const subscriptions = this.databaseService.getAllPushoverSubscriptions();
      
      if (subscriptions.length === 0) {
        logger.warn('No Pushover subscriptions found to test');
        return false;
      }

      const testClient = new Pushover({
        user: subscriptions[0].pushoverUserKey,
        token: config.pushover.appToken,
      });

      await this.sendPushoverMessage(
        testClient,
        'Test Notification',
        '✅ Pushover integration connected successfully!',
        0
      );
      logger.info('Pushover test successful');
      return true;
    } catch (error) {
      logger.error({ error }, 'Pushover test failed');
      return false;
    }
  }
}
