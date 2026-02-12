import { createHelius } from 'helius-sdk';
import { config } from '../config';
import { DatabaseService } from './database.service';
import type { Webhook, CreateWebhookRequest, UpdateWebhookRequest } from 'helius-sdk';
import pino from 'pino';

const logger = pino({ name: 'helius-service' });

export class HeliusService {
  private helius: ReturnType<typeof createHelius>;
  private databaseService: DatabaseService;

  constructor(databaseService: DatabaseService) {
    this.helius = createHelius({
      apiKey: config.helius.apiKey,
    });
    this.databaseService = databaseService;
    logger.info('Helius service initialized');
  }

  /**
   * Create or update webhook for tracked wallets
   */
  async setupWebhook(): Promise<Webhook> {
    try {
      // Check if webhook already exists
      const existingWebhooks = await this.getAllWebhooks();
      const existingWebhook = existingWebhooks.find(
        (wh) => wh.webhookURL === config.helius.webhookUrl
      );

      if (existingWebhook) {
        logger.info(
          { webhookId: existingWebhook.webhookID },
          'Webhook already exists, updating...'
        );
        return await this.updateWebhook(existingWebhook.webhookID);
      }

      // Create new webhook
      logger.info('Creating new webhook...');
      return await this.createWebhook();
    } catch (error) {
      logger.error({ error }, 'Error setting up webhook');
      throw error;
    }
  }

  /**
   * Create a new webhook
   */
  async createWebhook(): Promise<Webhook> {
    try {
      const walletAddresses = this.databaseService.getWalletAddresses();
      
      if (walletAddresses.length === 0) {
        throw new Error('No wallets found in database. Add wallets before creating webhook.');
      }

      if (walletAddresses.length > 500) {
        logger.warn(
          { count: walletAddresses.length },
          'Wallet count exceeds Helius limit of 500, using first 500'
        );
      }

      const webhookConfig: CreateWebhookRequest = {
        webhookURL: config.helius.webhookUrl,
        transactionTypes: ['ANY'],
        accountAddresses: walletAddresses.slice(0, 500),
        webhookType: 'enhanced',
      };

      logger.info({ config: webhookConfig }, 'Creating webhook');

      const webhook = await this.helius.webhooks.create(webhookConfig);

      logger.info(
        {
          webhookId: webhook.webhookID,
          url: webhook.webhookURL,
          wallets: webhook.accountAddresses.length,
        },
        'Webhook created successfully'
      );

      return webhook;
    } catch (error) {
      logger.error({ error }, 'Error creating webhook');
      throw error;
    }
  }

  /**
   * Get all webhooks
   */
  async getAllWebhooks(): Promise<Webhook[]> {
    try {
      const webhooks = await this.helius.webhooks.getAll();
      logger.info({ count: webhooks.length }, 'Retrieved all webhooks');
      return webhooks;
    } catch (error) {
      logger.error({ error }, 'Error getting webhooks');
      throw error;
    }
  }

  /**
   * Get webhook by ID
   */
  async getWebhook(webhookId: string): Promise<Webhook> {
    try {
      const webhook = await this.helius.webhooks.get(webhookId);
      logger.info({ webhookId }, 'Retrieved webhook');
      return webhook;
    } catch (error) {
      logger.error({ error, webhookId }, 'Error getting webhook');
      throw error;
    }
  }

  /**
   * Update existing webhook
   */
  async updateWebhook(webhookId: string): Promise<Webhook> {
    try {
      const walletAddresses = this.databaseService.getWalletAddresses();
      
      if (walletAddresses.length === 0) {
        throw new Error('No wallets found in database. Add wallets before updating webhook.');
      }

      if (walletAddresses.length > 500) {
        logger.warn(
          { count: walletAddresses.length },
          'Wallet count exceeds Helius limit of 500, using first 500'
        );
      }

      const updateConfig: UpdateWebhookRequest = {
        webhookURL: config.helius.webhookUrl,
        transactionTypes: ['ANY'],
        accountAddresses: walletAddresses.slice(0, 500),
        webhookType: 'enhanced',
      };

      logger.info({ webhookId, config: updateConfig }, 'Updating webhook');

      const webhook = await this.helius.webhooks.update(webhookId, updateConfig);

      logger.info(
        {
          webhookId: webhook.webhookID,
          url: webhook.webhookURL,
          wallets: webhook.accountAddresses.length,
        },
        'Webhook updated successfully'
      );

      return webhook;
    } catch (error) {
      logger.error({ error, webhookId }, 'Error updating webhook');
      throw error;
    }
  }

  /**
   * Delete webhook by ID
   */
  async deleteWebhook(webhookId: string): Promise<boolean> {
    try {
      logger.info({ webhookId }, 'Deleting webhook');
      const result = await this.helius.webhooks.delete(webhookId);
      logger.info({ webhookId, result }, 'Webhook deleted');
      return result;
    } catch (error) {
      logger.error({ error, webhookId }, 'Error deleting webhook');
      throw error;
    }
  }

  /**
   * Add wallets to existing webhook
   */
  async addWalletsToWebhook(webhookId: string, wallets: string[]): Promise<Webhook> {
    try {
      const existing = await this.getWebhook(webhookId);
      const updatedAddresses = [
        ...new Set([...existing.accountAddresses, ...wallets]),
      ];

      if (updatedAddresses.length > 500) {
        throw new Error(
          `Cannot add wallets: would exceed 500 wallet limit (current: ${existing.accountAddresses.length}, adding: ${wallets.length})`
        );
      }

      logger.info(
        {
          webhookId,
          currentCount: existing.accountAddresses.length,
          addingCount: wallets.length,
          newCount: updatedAddresses.length,
        },
        'Adding wallets to webhook'
      );

      return await this.helius.webhooks.update(webhookId, {
        accountAddresses: updatedAddresses,
      });
    } catch (error) {
      logger.error({ error, webhookId }, 'Error adding wallets to webhook');
      throw error;
    }
  }

  /**
   * Remove wallets from existing webhook
   */
  async removeWalletsFromWebhook(
    webhookId: string,
    wallets: string[]
  ): Promise<Webhook> {
    try {
      const existing = await this.getWebhook(webhookId);
      const walletsToRemove = new Set(wallets.map((w) => w.toLowerCase()));
      const updatedAddresses = existing.accountAddresses.filter(
        (addr: string) => !walletsToRemove.has(addr.toLowerCase())
      );

      logger.info(
        {
          webhookId,
          currentCount: existing.accountAddresses.length,
          removingCount: wallets.length,
          newCount: updatedAddresses.length,
        },
        'Removing wallets from webhook'
      );

      return await this.helius.webhooks.update(webhookId, {
        accountAddresses: updatedAddresses,
      });
    } catch (error) {
      logger.error({ error, webhookId }, 'Error removing wallets from webhook');
      throw error;
    }
  }

  /**
   * List all tracked wallets for a webhook
   */
  async listTrackedWallets(webhookId: string): Promise<string[]> {
    try {
      const webhook = await this.getWebhook(webhookId);
      logger.info(
        { webhookId, count: webhook.accountAddresses.length },
        'Listed tracked wallets'
      );
      return webhook.accountAddresses;
    } catch (error) {
      logger.error({ error, webhookId }, 'Error listing tracked wallets');
      throw error;
    }
  }

  /**
   * Get webhook statistics
   */
  async getWebhookStats(webhookId: string): Promise<{
    webhookId: string;
    url: string;
    trackedWallets: number;
    transactionTypes: string[];
    webhookType: string;
  }> {
    try {
      const webhook = await this.getWebhook(webhookId);
      return {
        webhookId: webhook.webhookID,
        url: webhook.webhookURL,
        trackedWallets: webhook.accountAddresses.length,
        transactionTypes: webhook.transactionTypes,
        webhookType: webhook.webhookType,
      };
    } catch (error) {
      logger.error({ error, webhookId }, 'Error getting webhook stats');
      throw error;
    }
  }
}
