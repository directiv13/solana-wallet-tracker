import cron from 'node-cron';
import { RedisService } from './redis.service';
import { NotificationService } from './notification.service';
import { config } from '../config';
import pino from 'pino';

const logger = pino({ name: 'scheduler-service' });

export class SchedulerService {
  constructor(
    private redisService: RedisService,
    private notificationService: NotificationService
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

    logger.info('Scheduler service started');
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
}
