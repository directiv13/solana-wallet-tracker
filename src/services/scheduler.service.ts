import cron from 'node-cron';
import { RedisService } from './redis.service';
import { NotificationService } from './notification.service';
import { TelegramBotService } from './telegram-bot.service';
import { config } from '../config';
import pino from 'pino';

const logger = pino({ name: 'scheduler-service' });

export class SchedulerService {
  constructor(
    private redisService: RedisService,
    private notificationService: NotificationService,
    private telegramBotService: TelegramBotService,
  ) {}

  /**
   * Start all scheduled jobs
   */
  start(): void {
    // Run hourly summary at the start of every hour
    cron.schedule('0 * * * *', async () => {
      logger.info('Running hourly summary job');
      await this.sendHourlySummary();
    });

    // Send 30 minutes cumulative to users every 30 minutes
    // Send Pushover cumulative amount direction change notification
    cron.schedule('*/30 * * * *', async () => {
      logger.info('Running 30-minute cumulative notification job');
      await this.telegramBotService.sendCumulativeAmountsToUsers(1800, '30 minutes');
      await this.checkCumulativeDirectionChange(1800, '30 minutes');
    });

    // Send 1 hour cumulative to users every hour
    cron.schedule('0 * * * *', async () => {
      logger.info('Running 1-hour cumulative notification job');
      await this.telegramBotService.sendCumulativeAmountsToUsers(3600, '1 hour');
    });

    // Send 4 hours cumulative to users every 4 hours
    cron.schedule('0 */4 * * *', async () => {
      logger.info('Running 4-hour cumulative notification job');
      await this.telegramBotService.sendCumulativeAmountsToUsers(14400, '4 hours');
    });

    logger.info('Scheduler service started with cumulative notification jobs');
  }

  /**
   * Send hourly cumulative summary
   */
  private async sendHourlySummary(): Promise<void> {
    try {
      const buysAmount = await this.redisService.getCumulativeAmount(
        config.targetTokenMint,
        'buy'
      );
      
      const sellsAmount = await this.redisService.getCumulativeAmount(
        config.targetTokenMint,
        'sell'
      );

      await this.notificationService.sendHourlySummary(buysAmount, sellsAmount);

      logger.info(
        { buysAmount, sellsAmount },
        'Hourly summary completed'
      );
    } catch (error) {
      logger.error({ error }, 'Error in hourly summary job');
    }
  }

  /**
   * Check cumulative amount direction change and send Pushover notification
   */
  private async checkCumulativeDirectionChange(
    periodSeconds: number,
    periodLabel: string
  ): Promise<void> {
    try {
      // Get current cumulative amounts
      const { buys, sells } = await this.redisService.getCumulativeAmounts(periodSeconds);
      const currentCumulative = buys - sells;

      // Get previous cumulative amount
      const previousCumulative = await this.redisService.getPreviousCumulativeAmount(periodSeconds);

      // Store current as previous for next check
      await this.redisService.setPreviousCumulativeAmount(periodSeconds, currentCumulative);

      // If no previous data, skip notification (first run)
      if (previousCumulative === null) {
        logger.info({ periodSeconds, currentCumulative }, 'No previous cumulative data, skipping direction check');
        return;
      }

      // Check for direction change
      const directionChanged = 
        (previousCumulative >= 0 && currentCumulative < 0) ||  // Went from positive/zero to negative
        (previousCumulative < 0 && currentCumulative >= 0);    // Went from negative to positive/zero

      if (directionChanged) {
        logger.info(
          { previousCumulative, currentCumulative, periodLabel },
          'Cumulative direction changed, sending notifications'
        );

        await this.notificationService.sendCumulativeDirectionChange(
          previousCumulative,
          currentCumulative,
          periodLabel
        );
      } else {
        logger.debug(
          { previousCumulative, currentCumulative, periodLabel },
          'No direction change detected'
        );
      }
    } catch (error) {
      logger.error({ error, periodSeconds, periodLabel }, 'Error checking cumulative direction change');
    }
  }
}
