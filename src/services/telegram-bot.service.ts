import { Telegraf, Context } from 'telegraf';
import { config } from '../config';
import { DatabaseService } from './database.service';
import { HeliusService } from './helius.service';
import pino from 'pino';

const logger = pino({ name: 'telegram-bot-service' });

export class TelegramBotService {
    private bot: Telegraf;
    private databaseService: DatabaseService;
    private heliusService: HeliusService;

    constructor(databaseService: DatabaseService, heliusService: HeliusService) {
        this.bot = new Telegraf(config.telegram.botToken);
        this.databaseService = databaseService;
        this.heliusService = heliusService;

        this.setupCommands();
        logger.info('Telegram bot service initialized');
    }

    private setupCommands(): void {
        // User commands
        this.bot.command('enable_pushover', this.handleEnablePushover.bind(this));
        this.bot.command('disable_pushover', this.handleDisablePushover.bind(this));
        this.bot.command('enable_pushover_5sells', this.handleEnablePushover5Sells.bind(this));
        this.bot.command('disable_pushover_5sells', this.handleDisablePushover5Sells.bind(this));
        this.bot.command('help', this.handleHelp.bind(this));
        this.bot.command('status', this.handleStatus.bind(this));

        // Admin commands
        this.bot.command('add', this.handleAddWallet.bind(this));
        this.bot.command('remove', this.handleRemoveWallet.bind(this));
        this.bot.command('list', this.handleListWallets.bind(this));
        this.bot.command('stats', this.handleStats.bind(this));

        // Error handling
        this.bot.catch((err, ctx) => {
            logger.error({ err, chatId: ctx.chat?.id, user_id: ctx.from?.id }, 'Telegram bot error');
            ctx.reply('An error occurred processing your command. Please try again.');
        });
    }

    private isAdmin(userId: number): boolean {
        return config.telegram.adminUserIds.includes(userId);
    }

    private async handleEnablePushover(ctx: Context): Promise<void> {
        try {
            const userId = ctx.from?.id;
            if (!userId) {
                await ctx.reply('❌ Could not identify user');
                return;
            }

            // Parse command: /enable_pushover <user_key>
            const text = ctx.message && 'text' in ctx.message ? ctx.message.text : '';
            const parts = text.split(' ').filter(p => p.length > 0);

            if (parts.length !== 2) {
                await ctx.reply(
                    '❌ Invalid format!\n\n' +
                    'Usage: /enable_pushover <user_key>\n\n' +
                    'Example:\n' +
                    '/enable_pushover uQiRzpo4DXghDmr9QzzfQu27jqWCH\n\n' +
                    'Get your user key from: https://pushover.net/'
                );
                return;
            }

            const [, userKey] = parts;

            // Validate key (basic check)
            if (userKey.length < 20) {
                await ctx.reply('❌ Invalid Pushover user key. Key should be at least 20 characters.');
                return;
            }

            this.databaseService.subscribePushover(userId, userKey);

            await ctx.reply(
                '✅ Pushover notifications enabled!\n\n' +
                'You will now receive high-priority alerts for:\n' +
                `• Single swaps over $${config.priceThresholdUsd}\n` +
                `• Cumulative buys/sells over $${config.priceThresholdUsd} in ${Math.floor(config.swapTimeWindowSeconds / 60)} minutes`
            );

            logger.info({ userId }, 'User enabled Pushover notifications');
        } catch (error) {
            logger.error({ error }, 'Error enabling Pushover');
            await ctx.reply('❌ Failed to enable Pushover notifications');
        }
    }

    private async handleDisablePushover(ctx: Context): Promise<void> {
        try {
            const userId = ctx.from?.id;
            if (!userId) {
                await ctx.reply('❌ Could not identify user');
                return;
            }

            const removed = this.databaseService.unsubscribePushover(userId);

            if (removed) {
                await ctx.reply('✅ Pushover notifications disabled');
                logger.info({ userId }, 'User disabled Pushover notifications');
            } else {
                await ctx.reply('ℹ️ You were not subscribed to Pushover notifications');
            }
        } catch (error) {
            logger.error({ error }, 'Error disabling Pushover');
            await ctx.reply('❌ Failed to disable Pushover notifications');
        }
    }

    private async handleEnablePushover5Sells(ctx: Context): Promise<void> {
        try {
            const userId = ctx.from?.id;
            if (!userId) {
                await ctx.reply('❌ Could not identify user');
                return;
            }

            // Parse command: /enable_pushover_5sells <user_key>
            const text = ctx.message && 'text' in ctx.message ? ctx.message.text : '';
            const parts = text.split(' ').filter(p => p.length > 0);

            if (parts.length !== 2) {
                await ctx.reply(
                    '❌ Invalid format!\n\n' +
                    'Usage: /enable_pushover_5sells <user_key>\n\n' +
                    'Example:\n' +
                    '/enable_pushover_5sells uQiRzpo4DXghDmr9QzzfQu27jqWCH\n\n' +
                    'Get your user key from: https://pushover.net/'
                );
                return;
            }

            const [, userKey] = parts;

            // Validate key (basic check)
            if (userKey.length < 20) {
                await ctx.reply('❌ Invalid Pushover user key. Key should be at least 20 characters.');
                return;
            }

            this.databaseService.subscribePushover5Sells(userId, userKey);

            await ctx.reply(
                '✅ Pushover 5 Sells notifications enabled!\n\n' +
                'You will now receive alerts when:\n' +
                `• 5 sequential sells are detected (each over $${config.fiveSellsThresholdUsd})\n` +
                '• No buys occur between the sells\n\n' +
                'Note: This is a separate subscription from regular Pushover notifications.'
            );

            logger.info({ userId }, 'User enabled Pushover 5 Sells notifications');
        } catch (error) {
            logger.error({ error }, 'Error enabling Pushover 5 Sells');
            await ctx.reply('❌ Failed to enable Pushover 5 Sells notifications');
        }
    }

    private async handleDisablePushover5Sells(ctx: Context): Promise<void> {
        try {
            const userId = ctx.from?.id;
            if (!userId) {
                await ctx.reply('❌ Could not identify user');
                return;
            }

            const removed = this.databaseService.unsubscribePushover5Sells(userId);

            if (removed) {
                await ctx.reply('✅ Pushover 5 Sells notifications disabled');
                logger.info({ userId }, 'User disabled Pushover 5 Sells notifications');
            } else {
                await ctx.reply('ℹ️ You were not subscribed to Pushover 5 Sells notifications');
            }
        } catch (error) {
            logger.error({ error }, 'Error disabling Pushover 5 Sells');
            await ctx.reply('❌ Failed to disable Pushover 5 Sells notifications');
        }
    }

    private async handleAddWallet(ctx: Context): Promise<void> {
        try {
            const userId = ctx.from?.id;
            if (!userId || !this.isAdmin(userId)) {
                await ctx.reply('❌ This command is only available to administrators');
                return;
            }

            const text = ctx.message && 'text' in ctx.message ? ctx.message.text : '';
            const parts = text.split(' ').filter(p => p.length > 0);

            if (parts.length < 2) {
                await ctx.reply(
                    '❌ Invalid format!\n\n' +
                    'Usage: /add <wallet_address1> <wallet_address2> ...\n\n' +
                    'Example:\n' +
                    '/add 7xKXtg2CW87d97TXJSDpbD5jBkheTqA83TZRuJosgAsU'
                );
                return;
            }

            const [, ...walletAddresses] = parts;
            const results = {
                added: [] as string[],
                duplicate: [] as string[],
                invalid: [] as string[]
            };

            // Process all wallet addresses
            for (const walletAddress of walletAddresses) {
                // Basic validation (Solana addresses are base58, 32-44 chars)
                if (walletAddress.length < 32 || walletAddress.length > 44) {
                    results.invalid.push(walletAddress);
                    continue;
                }

                const added = this.databaseService.addWallet(walletAddress, userId);
                if (added) {
                    results.added.push(walletAddress);
                } else {
                    results.duplicate.push(walletAddress);
                }
            }

            // Sync webhook once if any wallets were added
            if (results.added.length > 0) {
                try {
                    await this.heliusService.setupWebhook();
                    
                    const count = this.databaseService.getWalletCount();
                    let message = `✅ ${results.added.length} wallet(s) added to tracking\n\n`;
                    
                    if (results.added.length <= 3) {
                        message += results.added.map(w => `\`${w}\``).join('\n') + '\n\n';
                    }
                    
                    message += `Total wallets: ${count}\n🔄 Webhook synchronized with Helius`;
                    
                    if (results.duplicate.length > 0) {
                        message += `\n\nℹ️ ${results.duplicate.length} wallet(s) already tracked`;
                    }
                    
                    if (results.invalid.length > 0) {
                        message += `\n\n❌ ${results.invalid.length} invalid address(es)`;
                    }
                    
                    await ctx.reply(message, { parse_mode: 'Markdown' });
                    logger.info({ added: results.added.length, userId, count }, 'Admin added wallets and synced webhook');
                } catch (webhookError) {
                    logger.error({ error: webhookError }, 'Failed to sync webhook after adding wallets');
                    await ctx.reply(
                        `✅ ${results.added.length} wallet(s) added to tracking\n\n` +
                        `⚠️ Warning: Webhook sync failed. Manual sync may be required.`,
                        { parse_mode: 'Markdown' }
                    );
                }
            } else {
                let message = '';
                if (results.duplicate.length > 0) {
                    message += `ℹ️ ${results.duplicate.length} wallet(s) already being tracked\n`;
                }
                if (results.invalid.length > 0) {
                    message += `❌ ${results.invalid.length} invalid address(es)`;
                }
                await ctx.reply(message || 'ℹ️ No wallets were added');
            }
        } catch (error) {
            logger.error({ error }, 'Error adding wallet');
            await ctx.reply('❌ Failed to add wallet');
        }
    }

    private async handleRemoveWallet(ctx: Context): Promise<void> {
        try {
            const userId = ctx.from?.id;
            if (!userId || !this.isAdmin(userId)) {
                await ctx.reply('❌ This command is only available to administrators');
                return;
            }

            const text = ctx.message && 'text' in ctx.message ? ctx.message.text : '';
            const parts = text.split(' ').filter(p => p.length > 0);

            if (parts.length !== 2) {
                await ctx.reply(
                    '❌ Invalid format!\n\n' +
                    'Usage: /remove <wallet_address>\n\n' +
                    'Example:\n' +
                    '/remove 7xKXtg2CW87d97TXJSDpbD5jBkheTqA83TZRuJosgAsU'
                );
                return;
            }

            const [, walletAddress] = parts;
            const removed = this.databaseService.removeWallet(walletAddress);

            if (removed) {
                const count = this.databaseService.getWalletCount();

                // Sync webhook with updated wallet list
                try {
                    await this.heliusService.setupWebhook();
                    await ctx.reply(
                        `✅ Wallet removed from tracking\n\n` +
                        `Address: \`${walletAddress}\`\n` +
                        `Total wallets: ${count}\n\n` +
                        `🔄 Webhook synchronized with Helius`,
                        { parse_mode: 'Markdown' }
                    );
                    logger.info({ walletAddress, userId, count }, 'Admin removed wallet and synced webhook');
                } catch (webhookError) {
                    logger.error({ error: webhookError, walletAddress }, 'Failed to sync webhook after removing wallet');
                    await ctx.reply(
                        `✅ Wallet removed from tracking\n\n` +
                        `Address: \`${walletAddress}\`\n` +
                        `Total wallets: ${count}\n\n` +
                        `⚠️ Warning: Webhook sync failed. Manual sync may be required.`,
                        { parse_mode: 'Markdown' }
                    );
                }
            } else {
                await ctx.reply('ℹ️ This wallet was not being tracked');
            }
        } catch (error) {
            logger.error({ error }, 'Error removing wallet');
            await ctx.reply('❌ Failed to remove wallet');
        }
    }

    private async handleListWallets(ctx: Context): Promise<void> {
        try {
            const userId = ctx.from?.id;
            if (!userId || !this.isAdmin(userId)) {
                await ctx.reply('❌ This command is only available to administrators');
                return;
            }

            const wallets = this.databaseService.getAllWallets();

            if (wallets.length === 0) {
                await ctx.reply('ℹ️ No wallets are currently being tracked');
                return;
            }

            const walletList = wallets
                .map((w, idx) => `${idx + 1}. \`${w.address}\``)
                .join('\n');

            await ctx.reply(
                `📋 **Tracked Wallets** (${wallets.length})\n\n${walletList}`,
                { parse_mode: 'Markdown' }
            );
        } catch (error) {
            logger.error({ error }, 'Error listing wallets');
            await ctx.reply('❌ Failed to list wallets');
        }
    }

    private async handleStats(ctx: Context): Promise<void> {
        try {
            const userId = ctx.from?.id;
            if (!userId || !this.isAdmin(userId)) {
                await ctx.reply('❌ This command is only available to administrators');
                return;
            }

            const walletCount = this.databaseService.getWalletCount();
            const pushoverSubs = this.databaseService.getAllPushoverSubscriptions().length;

            await ctx.reply(
                `📊 **Tracker Statistics**\n\n` +
                `Tracked Wallets: ${walletCount}\n` +
                `Pushover Subscribers: ${pushoverSubs}\n` +
                `Target Token: \`${config.targetTokenMint.substring(0, 8)}...\`\n` +
                `Price Threshold: $${config.priceThresholdUsd}\n` +
                `Time Window: ${Math.floor(config.swapTimeWindowSeconds / 60)}m`,
                { parse_mode: 'Markdown' }
            );
        } catch (error) {
            logger.error({ error }, 'Error getting stats');
            await ctx.reply('❌ Failed to get statistics');
        }
    }

    private async handleStatus(ctx: Context): Promise<void> {
        try {
            const userId = ctx.from?.id;
            if (!userId) {
                await ctx.reply('❌ Could not identify user');
                return;
            }

            const subscription = this.databaseService.getPushoverSubscription(userId);
            const isAdmin = this.isAdmin(userId);

            await ctx.reply(
                `👤 **Your Status**\n\n` +
                `User ID: ${userId}\n` +
                `Admin: ${isAdmin ? '✅ Yes' : '❌ No'}\n` +
                `Pushover: ${subscription ? '✅ Enabled' : '❌ Disabled'}`,
                { parse_mode: 'Markdown' }
            );
        } catch (error) {
            logger.error({ error }, 'Error getting status');
            await ctx.reply('❌ Failed to get status');
        }
    }

    private async handleHelp(ctx: Context): Promise<void> {
        const userId = ctx.from?.id;
        const isAdmin = userId && this.isAdmin(userId);

        let helpText =
            `🤖 *Solana Wallet Tracker Bot*\n\n` +
            `*User Commands:*\n` +
            `/help \\- Show this help message\n` +
            `/status \\- Check your subscription status\n` +
            `/enable\\_pushover \\<user\\_key\\> \\- Enable Pushover alerts\n` +
            `/disable\\_pushover \\- Disable Pushover alerts\n\n`;

        if (isAdmin) {
            helpText +=
                `*Admin Commands:*\n` +
                `/add \\<wallet\\> \\- Add wallet to tracking\n` +
                `/remove \\<wallet\\> \\- Remove wallet from tracking\n` +
                `/list \\- List all tracked wallets\n` +
                `/stats \\- Show tracker statistics\n\n`;
        }

        helpText +=
            `*About Pushover:*\n` +
            `Get your keys from: https://pushover\\.net/\n` +
            `You'll receive alerts for high\\-value swaps and activity surges\\.`;

        await ctx.reply(helpText, { parse_mode: 'MarkdownV2' });
    }

    async launch(): Promise<void> {
        await this.bot.launch();
        logger.info('Telegram bot launched');
    }

    async stop(): Promise<void> {
        this.bot.stop();
        logger.info('Telegram bot stopped');
    }

    getBot(): Telegraf {
        return this.bot;
    }
}
