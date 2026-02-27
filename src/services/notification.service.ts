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
   * Send hourly cumulative summary to Telegram
   */
  async sendHourlySummary(buysAmount: number, sellsAmount: number): Promise<void> {
    try {
      const message = `
📊 **Hourly Summary**

🟢 Total Buys: $${buysAmount.toFixed(2)} USD
🔴 Total Sells: $${sellsAmount.toFixed(2)} USD

📈 Net: $${(buysAmount - sellsAmount).toFixed(2)} USD
⏰ ${new Date().toLocaleString()}
      `.trim();

      await this.telegramBot.telegram.sendMessage(
        config.telegram.chatId,
        message,
        { parse_mode: 'Markdown' }
      );

      logger.info(
        { buysAmount, sellsAmount },
        'Hourly summary sent to Telegram'
      );
    } catch (error) {
      logger.error({ error }, 'Error sending hourly summary');
    }
  }

  /**
   * Send notification based on type
   */
  async sendNotification(
    type: NotificationType,
    payload: NotificationPayload
  ): Promise<void> {
    try {
      switch (type) {
        case NotificationType.TELEGRAM_ALL:
          await this.sendTelegramNotification(payload);
          break;
        case NotificationType.PUSHOVER_SINGLE_SWAP:
          await this.sendPushoverThresholdA(payload);
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
      const { transfer, tokenSymbol, tokenName } = payload;
      
      const emoji = transfer.type === 'buy' ? '🟢' : '🔴';
      const action = transfer.type === 'buy' ? 'BOUGHT' : 'SOLD';
      
      const tokenDisplay = tokenSymbol || tokenName || 'Token';
      const valueDisplay = transfer.valueUsd 
        ? `\n💰 Value: $${transfer.valueUsd.toFixed(2)} USD`
        : '';

      const message = `
${emoji} **${action}** ${tokenDisplay}

👤 Wallet: \`${transfer.walletAddress}\`
🔢 Amount: ${transfer.tokenAmount.toLocaleString()}${valueDisplay}
🔗 [View Transaction](https://solscan.io/tx/${transfer.transactionSignature})
⏰ ${new Date(transfer.timestamp * 1000).toLocaleString()}
      `.trim();

      await this.telegramBot.telegram.sendMessage(
        config.telegram.chatId,
        message,
        { parse_mode: 'Markdown' }
      );

      logger.info(
        {
          walletAddress: transfer.walletAddress,
          type: transfer.type,
          signature: transfer.transactionSignature,
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
      const { transfer, tokenSymbol } = payload;
      
      if (!transfer.valueUsd) {
        logger.warn('Cannot send threshold A notification without USD value');
        return;
      }

      // Only send for sells with the single_swap subscription
      if (transfer.type !== 'sell') {
        logger.debug('Threshold A notification skipped for non-sell transaction');
        return;
      }

      const title = `🚨 Large ${transfer.type.toUpperCase()} Alert`;
      const message = `
${tokenSymbol || 'Token'} ${transfer.type}
Wallet: ${transfer.walletAddress}
Value: $${transfer.valueUsd.toFixed(2)} USD
Amount: ${transfer.tokenAmount.toLocaleString()}

View: https://solscan.io/tx/${transfer.transactionSignature}
      `.trim();

      await this.sendPushoverToSubscribers('single_swap', title, message, 1); // Priority 1 (high)

      logger.info(
        {
          walletAddress: transfer.walletAddress,
          valueUsd: transfer.valueUsd,
          signature: transfer.transactionSignature,
        },
        'Pushover threshold A notification sent'
      );
    } catch (error) {
      logger.error({ error, payload }, 'Error sending Pushover threshold A notification');
      throw error;
    }
  }

  /**
   * Send Pushover notification for cumulative amount direction change
   */
  async sendCumulativeDirectionChange(
    previousAmount: number,
    currentAmount: number,
    periodLabel: string
  ): Promise<void> {
    try {
      const directionLabel = currentAmount >= 0 
        ? '🟢 Turned Positive' 
        : '🔴 Turned Negative';

      const title = `${directionLabel} - ${periodLabel}`;
      const message = `
Cumulative direction changed (${periodLabel})

Previous: $${previousAmount.toFixed(2)} USD
Current: $${currentAmount.toFixed(2)} USD

Change: $${(currentAmount - previousAmount).toFixed(2)} USD
      `.trim();

      await this.sendPushoverToSubscribers('change_direction', title, message, 0);

      logger.info(
        {
          previousAmount,
          currentAmount,
          periodLabel,
        },
        'Cumulative direction change notification sent'
      );
    } catch (error) {
      logger.error({ error, previousAmount, currentAmount, periodLabel }, 'Error sending direction change notification');
      throw error;
    }
  }

  /**
   * Send Pushover message to all subscribed users for a specific subscription key
   */
  private async sendPushoverToSubscribers(
    subscriptionKey: string,
    title: string,
    message: string,
    priority: number = 0
  ): Promise<void> {
    // Get all subscriptions for this key
    const subscriptions = this.databaseService.getAllPushoverSubscriptions(subscriptionKey);
    
    if (subscriptions.length === 0) {
      logger.warn({ subscriptionKey }, 'No Pushover subscriptions found for key, skipping notification');
      return;
    }

    logger.info({ count: subscriptions.length, subscriptionKey }, 'Sending Pushover to subscribers');

    const promises = subscriptions.map(async (sub) => {
      try {
        // Get user's Pushover key
        const user = this.databaseService.getUser(sub.userId);
        if (!user || !user.pushoverUserKey) {
          logger.warn({ userId: sub.userId }, 'User has subscription but no Pushover key');
          return;
        }

        const pushoverClient = new Pushover({
          user: user.pushoverUserKey,
          token: config.pushover.appToken,
        });

        await this.sendPushoverMessage(pushoverClient, title, message, priority);
        logger.info({ userId: sub.userId, subscriptionKey }, 'Pushover sent to subscriber');
      } catch (error) {
        logger.error({ error, userId: sub.userId, subscriptionKey }, 'Failed to send Pushover to subscriber');
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
      const usersWithPushover = this.databaseService.getUsersWithPushoverKey();
      
      if (usersWithPushover.length === 0) {
        logger.warn('No users with Pushover keys found to test');
        return false;
      }

      const testClient = new Pushover({
        user: usersWithPushover[0].pushoverUserKey,
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
