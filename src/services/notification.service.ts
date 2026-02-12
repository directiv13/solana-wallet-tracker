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
        case NotificationType.PUSHOVER_5SELLS:
          await this.sendPushover5Sells(payload);
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

      const title = `🚨 Large ${transfer.type.toUpperCase()} Alert`;
      const message = `
${tokenSymbol || 'Token'} ${transfer.type}
Wallet: ${transfer.walletAddress}
Value: $${transfer.valueUsd.toFixed(2)} USD
Amount: ${transfer.tokenAmount.toLocaleString()}

View: https://solscan.io/tx/${transfer.transactionSignature}
      `.trim();

      await this.sendPushoverToAllSubscribers(title, message, 1); // Priority 1 (high)

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
   * Send Pushover notification for threshold B (cumulative amount >= threshold in time window)
   */
  private async sendPushoverThresholdB(
    payload: NotificationPayload,
    cumulativeAmount: number
  ): Promise<void> {
    try {
      const { transfer, tokenSymbol } = payload;
      
      const title = `⚡ Volume Alert: ${transfer.type.toUpperCase()}`;
      const message = `
${tokenSymbol || 'Token'} ${transfer.type} volume surge!
Cumulative ${transfer.type}s: $${cumulativeAmount.toFixed(2)} USD
Time window: ${Math.floor(config.swapTimeWindowSeconds / 60)} minutes

Latest ${transfer.type}:
Wallet: ${transfer.walletAddress}
Amount: ${transfer.tokenAmount.toLocaleString()}
${transfer.valueUsd ? `Value: $${transfer.valueUsd.toFixed(2)} USD` : ''}

View: https://solscan.io/tx/${transfer.transactionSignature}
      `.trim();

      await this.sendPushoverToAllSubscribers(title, message, 1); // Priority 1 (high)

      logger.info(
        {
          type: transfer.type,
          cumulativeAmount,
          signature: transfer.transactionSignature,
        },
        'Pushover threshold B notification sent'
      );
    } catch (error) {
      logger.error({ error, payload, cumulativeAmount }, 'Error sending Pushover threshold B notification');
      throw error;
    }
  }

  /**
   * Send Pushover notification for 5 sequential sells
   */
  private async sendPushover5Sells(
    payload: NotificationPayload
  ): Promise<void> {
    try {
      const { transfer, tokenSymbol } = payload;
      
      const title = `🚨 5 Sequential Sells Alert`;
      const message = `
${tokenSymbol || 'Token'} - 5 sequential sells detected!

Wallet: ${transfer.walletAddress}
Latest sell: ${transfer.tokenAmount.toLocaleString()}
${transfer.valueUsd ? `Value: $${transfer.valueUsd.toFixed(2)} USD` : ''}

Threshold: Each sell > $${config.fiveSellsThresholdUsd} USD

View: https://solscan.io/tx/${transfer.transactionSignature}
      `.trim();

      await this.sendPushoverTo5SellsSubscribers(title, message, 1); // Priority 1 (high)

      logger.info(
        {
          walletAddress: transfer.walletAddress,
          signature: transfer.transactionSignature,
        },
        'Pushover 5 sells notification sent'
      );
    } catch (error) {
      logger.error({ error, payload }, 'Error sending Pushover 5 sells notification');
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
   * Send Pushover message to all 5 sells subscribed users
   */
  private async sendPushoverTo5SellsSubscribers(
    title: string,
    message: string,
    priority: number = 0
  ): Promise<void> {
    const subscriptions = this.databaseService.getAllPushover5SellsSubscriptions();
    
    if (subscriptions.length === 0) {
      logger.warn('No Pushover 5 Sells subscriptions found, skipping notification');
      return;
    }

    logger.info({ count: subscriptions.length }, 'Sending Pushover to all 5 sells subscribers');

    const promises = subscriptions.map(async (sub) => {
      try {
        const pushoverClient = new Pushover({
          user: sub.pushoverUserKey,
          token: config.pushover.appToken,
        });

        await this.sendPushoverMessage(pushoverClient, title, message, priority);
        logger.info({ userId: sub.userId }, 'Pushover 5 sells sent to subscriber');
      } catch (error) {
        logger.error({ error, userId: sub.userId }, 'Failed to send Pushover 5 sells to subscriber');
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
