import Fastify from 'fastify';
import cors from '@fastify/cors';
import { config } from './config';
import { RedisService } from './services/redis.service';
import { PriceService } from './services/price.service';
import { NotificationService } from './services/notification.service';
import { WebhookService } from './services/webhook.service';
import { HeliusService } from './services/helius.service';
import { HeliusWebhookPayload } from './types';
import pino from 'pino';

const logger = pino({
  level: config.nodeEnv === 'production' ? 'info' : 'debug',
  transport:
    config.nodeEnv === 'development'
      ? {
          target: 'pino-pretty',
          options: {
            colorize: true,
            translateTime: 'HH:MM:ss Z',
            ignore: 'pid,hostname',
          },
        }
      : undefined,
});

// Initialize services
const redisService = new RedisService();
const priceService = new PriceService(redisService);
const notificationService = new NotificationService();
const heliusService = new HeliusService();
const webhookService = new WebhookService(
  redisService,
  priceService,
  notificationService
);

// Create Fastify server
const server = Fastify({
  logger: true,
  requestIdLogLabel: 'requestId',
  disableRequestLogging: false,
  requestIdHeader: 'x-request-id',
  trustProxy: true,
});

// Register plugins
server.register(cors, {
  origin: true,
});

// Health check endpoint
server.get('/health', async (_request, reply) => {
  const redisHealthy = await redisService.healthCheck();

  const health = {
    status: redisHealthy ? 'healthy' : 'degraded',
    timestamp: new Date().toISOString(),
    services: {
      redis: redisHealthy ? 'up' : 'down',
      server: 'up',
    },
    config: {
      targetTokenMint: config.targetTokenMint,
      trackedWalletsCount: config.trackedWallets.length,
      priceThresholdUsd: config.priceThresholdUsd,
      swapCountThreshold: config.swapCountThreshold,
      swapTimeWindowSeconds: config.swapTimeWindowSeconds,
    },
  };

  const statusCode = redisHealthy ? 200 : 503;
  return reply.code(statusCode).send(health);
});

// Webhook endpoint
server.post('/webhook', async (request, reply) => {
  try {
    const payload = request.body as HeliusWebhookPayload;

    // Validate payload
    if (!webhookService.validatePayload(payload)) {
      return reply.code(400).send({
        error: 'Invalid payload structure',
        message: 'The webhook payload does not match the expected structure',
      });
    }

    // Process webhook asynchronously (don't block response)
    webhookService.processWebhook(payload).catch((error) => {
      logger.error(
        { error, signature: payload.signature },
        'Error processing webhook asynchronously'
      );
    });

    // Return success immediately
    return reply.code(200).send({
      success: true,
      signature: payload.signature,
      message: 'Webhook received and queued for processing',
    });
  } catch (error) {
    logger.error({ error }, 'Error handling webhook request');
    return reply.code(500).send({
      error: 'Internal server error',
      message: 'An error occurred while processing the webhook',
    });
  }
});

// Test endpoint for notifications
server.post('/test/notifications', async (_request, reply) => {
  try {
    const telegramOk = await notificationService.testTelegram();
    const pushoverOk = await notificationService.testPushover();

    return reply.code(200).send({
      telegram: telegramOk ? 'success' : 'failed',
      pushover: pushoverOk ? 'success' : 'failed',
    });
  } catch (error) {
    logger.error({ error }, 'Error testing notifications');
    return reply.code(500).send({
      error: 'Failed to test notifications',
    });
  }
});

// Get current swap count for token
server.get('/stats/swaps', async (_request, reply) => {
  try {
    const timestamp = Math.floor(Date.now() / 1000);
    const swapCount = await redisService.getSwapCount(
      config.targetTokenMint,
      timestamp
    );

    return reply.code(200).send({
      tokenMint: config.targetTokenMint,
      swapCount,
      timeWindowSeconds: config.swapTimeWindowSeconds,
      threshold: config.swapCountThreshold,
    });
  } catch (error) {
    logger.error({ error }, 'Error getting swap stats');
    return reply.code(500).send({
      error: 'Failed to get swap statistics',
    });
  }
});

// Get cached token price
server.get('/stats/price', async (_request, reply) => {
  try {
    const price = await priceService.getTokenPrice(config.targetTokenMint);

    if (price === null) {
      return reply.code(404).send({
        error: 'Price not found',
        tokenMint: config.targetTokenMint,
      });
    }

    return reply.code(200).send({
      tokenMint: config.targetTokenMint,
      priceUsd: price,
      cachedAt: new Date().toISOString(),
    });
  } catch (error) {
    logger.error({ error }, 'Error getting token price');
    return reply.code(500).send({
      error: 'Failed to get token price',
    });
  }
});

// Helius webhook management endpoints
server.post('/admin/webhook/setup', async (_request, reply) => {
  try {
    const webhook = await heliusService.setupWebhook();
    return reply.code(200).send({
      success: true,
      webhook: {
        id: webhook.webhookID,
        url: webhook.webhookURL,
        trackedWallets: webhook.accountAddresses.length,
        transactionTypes: webhook.transactionTypes,
      },
    });
  } catch (error) {
    logger.error({ error }, 'Error setting up webhook');
    return reply.code(500).send({
      error: 'Failed to setup webhook',
    });
  }
});

server.get('/admin/webhooks', async (_request, reply) => {
  try {
    const webhooks = await heliusService.getAllWebhooks();
    return reply.code(200).send({
      count: webhooks.length,
      webhooks: webhooks.map((wh) => ({
        id: wh.webhookID,
        url: wh.webhookURL,
        trackedWallets: wh.accountAddresses.length,
        transactionTypes: wh.transactionTypes,
        webhookType: wh.webhookType,
      })),
    });
  } catch (error) {
    logger.error({ error }, 'Error getting webhooks');
    return reply.code(500).send({
      error: 'Failed to get webhooks',
    });
  }
});

server.get('/admin/webhook/:id', async (request, reply) => {
  try {
    const { id } = request.params as { id: string };
    const stats = await heliusService.getWebhookStats(id);
    return reply.code(200).send(stats);
  } catch (error) {
    logger.error({ error }, 'Error getting webhook stats');
    return reply.code(500).send({
      error: 'Failed to get webhook stats',
    });
  }
});

server.post('/admin/webhook/:id/wallets/add', async (request, reply) => {
  try {
    const { id } = request.params as { id: string };
    const { wallets } = request.body as { wallets: string[] };

    if (!Array.isArray(wallets) || wallets.length === 0) {
      return reply.code(400).send({
        error: 'Invalid request: wallets array required',
      });
    }

    const webhook = await heliusService.addWalletsToWebhook(id, wallets);
    return reply.code(200).send({
      success: true,
      trackedWallets: webhook.accountAddresses.length,
      added: wallets.length,
    });
  } catch (error) {
    logger.error({ error }, 'Error adding wallets');
    return reply.code(500).send({
      error: 'Failed to add wallets',
    });
  }
});

server.post('/admin/webhook/:id/wallets/remove', async (request, reply) => {
  try {
    const { id } = request.params as { id: string };
    const { wallets } = request.body as { wallets: string[] };

    if (!Array.isArray(wallets) || wallets.length === 0) {
      return reply.code(400).send({
        error: 'Invalid request: wallets array required',
      });
    }

    const webhook = await heliusService.removeWalletsFromWebhook(id, wallets);
    return reply.code(200).send({
      success: true,
      trackedWallets: webhook.accountAddresses.length,
      removed: wallets.length,
    });
  } catch (error) {
    logger.error({ error }, 'Error removing wallets');
    return reply.code(500).send({
      error: 'Failed to remove wallets',
    });
  }
});

server.delete('/admin/webhook/:id', async (request, reply) => {
  try {
    const { id } = request.params as { id: string };
    await heliusService.deleteWebhook(id);
    return reply.code(200).send({
      success: true,
      message: 'Webhook deleted successfully',
    });
  } catch (error) {
    logger.error({ error }, 'Error deleting webhook');
    return reply.code(500).send({
      error: 'Failed to delete webhook',
    });
  }
});

// Graceful shutdown handler
async function gracefulShutdown(signal: string) {
  logger.info(`${signal} received, shutting down gracefully...`);

  try {
    await server.close();
    await redisService.close();
    logger.info('Server shut down successfully');
    process.exit(0);
  } catch (error) {
    logger.error({ error }, 'Error during shutdown');
    process.exit(1);
  }
}

// Register shutdown handlers
process.on('SIGINT', () => gracefulShutdown('SIGINT'));
process.on('SIGTERM', () => gracefulShutdown('SIGTERM'));

// Handle uncaught errors
process.on('uncaughtException', (error) => {
  logger.error({ error }, 'Uncaught exception');
  gracefulShutdown('UNCAUGHT_EXCEPTION');
});

process.on('unhandledRejection', (reason, promise) => {
  logger.error({ reason, promise }, 'Unhandled rejection');
});

// Start server
async function start() {
  try {
    // Validate configuration
    logger.info('Validating configuration...');
    logger.info({
      targetTokenMint: config.targetTokenMint,
      trackedWalletsCount: config.trackedWallets.length,
      priceThresholdUsd: config.priceThresholdUsd,
      swapCountThreshold: config.swapCountThreshold,
    }, 'Configuration loaded');

    // Check Redis connection
    const redisHealthy = await redisService.healthCheck();
    if (!redisHealthy) {
      throw new Error('Redis connection failed');
    }
    logger.info('Redis connection established');

    // Setup Helius webhook if configured
    if (config.trackedWallets.length > 0) {
      try {
        logger.info('Setting up Helius webhook...');
        await heliusService.setupWebhook();
        logger.info('Helius webhook configured successfully');
      } catch (error) {
        logger.warn({ error }, 'Failed to setup Helius webhook automatically. You can set it up manually via POST /admin/webhook/setup');
      }
    } else {
      logger.warn('No tracked wallets configured. Skipping automatic webhook setup.');
    }

    // Start server
    await server.listen({
      port: config.port,
      host: '0.0.0.0',
    });

    logger.info(`Server listening on port ${config.port}`);
    logger.info(`Webhook endpoint: http://localhost:${config.port}/webhook`);
    logger.info(`Health check: http://localhost:${config.port}/health`);
  } catch (error) {
    logger.error({ error }, 'Failed to start server');
    process.exit(1);
  }
}

start();
