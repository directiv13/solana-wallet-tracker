import { Telegraf } from 'telegraf';
import Pushover from 'pushover-notifications';
import { config } from '../config';
import { NotificationPayload, NotificationType } from '../types';
import pino from 'pino';

const logger = pino({ name: 'notification-service' });

export class NotificationService {
  private telegramBot: Telegraf;
  private pushoverClient: Pushover;
  private lastPushoverThresholdBNotification: number = 0;
  private readonly PUSHOVER_COOLDOWN_MS = 300000; // 5 minutes cooldown for threshold B

  constructor() {
    this.telegramBot = new Telegraf(config.telegram.botToken);
    this.pushoverClient = new Pushover({
      user: config.pushover.userKey,
      token: config.pushover.appToken,
    });

    logger.info('Notification service initialized');
  }

  /**
   * Send notification based on type
   */
  async sendNotification(
    type: NotificationType,
    payload: NotificationPayload,
    additionalContext?: { swapCount?: number }
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
          await this.sendPushoverThresholdB(payload, additionalContext?.swapCount || 0);
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

👤 Wallet: \`${this.truncateAddress(swap.walletAddress)}\`
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
Wallet: ${this.truncateAddress(swap.walletAddress)}
Value: $${swap.valueUsd.toFixed(2)} USD
Amount: ${swap.tokenAmount.toLocaleString()}

View: https://solscan.io/tx/${swap.transactionSignature}
      `.trim();

      await this.sendPushoverMessage(title, message, 1); // Priority 1 (high)

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
   * Send Pushover notification for threshold B (10 swaps in 1 hour)
   */
  private async sendPushoverThresholdB(
    payload: NotificationPayload,
    swapCount: number
  ): Promise<void> {
    try {
      // Check cooldown to prevent spam
      const now = Date.now();
      if (now - this.lastPushoverThresholdBNotification < this.PUSHOVER_COOLDOWN_MS) {
        logger.info('Skipping threshold B notification due to cooldown');
        return;
      }

      const { swap, tokenSymbol } = payload;
      
      const title = `⚡ High Activity Alert`;
      const message = `
${tokenSymbol || 'Token'} trading surge detected!
${swapCount} swaps in last hour

Latest swap:
Type: ${swap.type.toUpperCase()}
Wallet: ${this.truncateAddress(swap.walletAddress)}
${swap.valueUsd ? `Value: $${swap.valueUsd.toFixed(2)} USD` : ''}

View: https://solscan.io/tx/${swap.transactionSignature}
      `.trim();

      await this.sendPushoverMessage(title, message, 1); // Priority 1 (high)

      this.lastPushoverThresholdBNotification = now;

      logger.info(
        {
          swapCount,
          signature: swap.transactionSignature,
        },
        'Pushover threshold B notification sent'
      );
    } catch (error) {
      logger.error({ error, payload, swapCount }, 'Error sending Pushover threshold B notification');
      throw error;
    }
  }

  /**
   * Send Pushover message
   */
  private async sendPushoverMessage(
    title: string,
    message: string,
    priority: number = 0
  ): Promise<void> {
    return new Promise((resolve, reject) => {
      this.pushoverClient.send(
        {
          title,
          message,
          priority,
          sound: priority > 0 ? 'cashregister' : 'pushover',
        },
        (err) => {
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
   * Truncate Solana address for display
   */
  private truncateAddress(address: string): string {
    if (address.length <= 12) {
      return address;
    }
    return `${address.substring(0, 6)}...${address.substring(address.length - 4)}`;
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
      await this.sendPushoverMessage(
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
