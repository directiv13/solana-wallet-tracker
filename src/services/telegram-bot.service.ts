import { Telegraf, Context } from 'telegraf';
import { config } from '../config';
import { DatabaseService } from './database.service';
import { HeliusService } from './helius.service';
import { RedisService } from './redis.service';
import pino from 'pino';

const logger = pino({ name: 'telegram-bot-service' });

export class TelegramBotService {
    private bot: Telegraf;
    private databaseService: DatabaseService;
    private heliusService: HeliusService;
    private redisService: RedisService;

    constructor(databaseService: DatabaseService, heliusService: HeliusService, redisService: RedisService) {
        this.bot = new Telegraf(config.telegram.botToken);
        this.databaseService = databaseService;
        this.heliusService = heliusService;
        this.redisService = redisService;

        this.setupCommands();
        logger.info('Telegram bot service initialized');
    }

    private setupCommands(): void {
        // User commands
        this.bot.command('start', this.handleStart.bind(this));
        this.bot.command('enable_pushover', this.handleEnablePushover.bind(this));
        this.bot.command('disable_pushover', this.handleDisablePushover.bind(this));
        this.bot.command('subscribe', this.handleSubscribe.bind(this));
        this.bot.command('unsubscribe', this.handleUnsubscribe.bind(this));
        this.bot.command('cum_30m', this.handleCum30m.bind(this));
        this.bot.command('cum_1h', this.handleCum1h.bind(this));
        this.bot.command('cum_4h', this.handleCum4h.bind(this));
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

    private async handleStart(ctx: Context): Promise<void> {
        try {
            const userId = ctx.from?.id;
            if (!userId) {
                await ctx.reply('❌ Could not identify user');
                return;
            }

            // Add user to database
            const isNew = this.databaseService.addUser(userId);

            if (isNew) {
                await ctx.reply(
                    '👋 Welcome to Solana Wallet Tracker Bot!\n\n' +
                    '✅ You have been registered and will receive periodic cumulative amount updates.\n\n' +
                    'Use /help to see all available commands.'
                );
                logger.info({ userId }, 'New user registered');
            } else {
                await ctx.reply(
                    '👋 Welcome back to Solana Wallet Tracker Bot!\n\n' +
                    'You are already registered.\n\n' +
                    'Use /help to see all available commands.'
                );
            }
        } catch (error) {
            logger.error({ error }, 'Error handling start command');
            await ctx.reply('❌ Failed to register user');
        }
    }

    private async handleCum30m(ctx: Context): Promise<void> {
        try {
            const userId = ctx.from?.id;
            if (!userId) {
                await ctx.reply('❌ Could not identify user');
                return;
            }

            const { buys, sells } = await this.redisService.getCumulativeAmounts(1800); // 30 minutes in seconds

            await ctx.reply(
                '📊 **Cumulative Amount (30 minutes)**\n\n' +
                `🟢 Total Buys: $${buys.toFixed(2)} USD\n` +
                `🔴 Total Sells: $${sells.toFixed(2)} USD\n\n` +
                `📈 Net: $${(buys - sells).toFixed(2)} USD\n` +
                `⏰ ${new Date().toLocaleString()}`,
                { parse_mode: 'Markdown' }
            );

            logger.info({ userId, period: '30m' }, 'User requested cumulative amount');
        } catch (error) {
            logger.error({ error }, 'Error getting cumulative amount');
            await ctx.reply('❌ Failed to get cumulative amount');
        }
    }

    private async handleCum1h(ctx: Context): Promise<void> {
        try {
            const userId = ctx.from?.id;
            if (!userId) {
                await ctx.reply('❌ Could not identify user');
                return;
            }

            const { buys, sells } = await this.redisService.getCumulativeAmounts(3600); // 1 hour in seconds

            await ctx.reply(
                '📊 **Cumulative Amount (1 hour)**\n\n' +
                `🟢 Total Buys: $${buys.toFixed(2)} USD\n` +
                `🔴 Total Sells: $${sells.toFixed(2)} USD\n\n` +
                `📈 Net: $${(buys - sells).toFixed(2)} USD\n` +
                `⏰ ${new Date().toLocaleString()}`,
                { parse_mode: 'Markdown' }
            );

            logger.info({ userId, period: '1h' }, 'User requested cumulative amount');
        } catch (error) {
            logger.error({ error }, 'Error getting cumulative amount');
            await ctx.reply('❌ Failed to get cumulative amount');
        }
    }

    private async handleCum4h(ctx: Context): Promise<void> {
        try {
            const userId = ctx.from?.id;
            if (!userId) {
                await ctx.reply('❌ Could not identify user');
                return;
            }

            const { buys, sells } = await this.redisService.getCumulativeAmounts(14400); // 4 hours in seconds

            await ctx.reply(
                '📊 **Cumulative Amount (4 hours)**\n\n' +
                `🟢 Total Buys: $${buys.toFixed(2)} USD\n` +
                `🔴 Total Sells: $${sells.toFixed(2)} USD\n\n` +
                `📈 Net: $${(buys - sells).toFixed(2)} USD\n` +
                `⏰ ${new Date().toLocaleString()}`,
                { parse_mode: 'Markdown' }
            );

            logger.info({ userId, period: '4h' }, 'User requested cumulative amount');
        } catch (error) {
            logger.error({ error }, 'Error getting cumulative amount');
            await ctx.reply('❌ Failed to get cumulative amount');
        }
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

            this.databaseService.setPushoverUserKey(userId, userKey);

            await ctx.reply(
                '✅ Pushover user key saved!\n\n' +
                'You can now subscribe to specific notification types using:\n' +
                '/subscribe single_swap - High-value swap alerts\n' +
                '/subscribe change_direction - Direction change alerts\n\n' +
                'Use /status to check your subscriptions.'
            );

            logger.info({ userId }, 'User enabled Pushover');
        } catch (error) {
            logger.error({ error }, 'Error enabling Pushover');
            await ctx.reply('❌ Failed to enable Pushover');
        }
    }

    private async handleDisablePushover(ctx: Context): Promise<void> {
        try {
            const userId = ctx.from?.id;
            if (!userId) {
                await ctx.reply('❌ Could not identify user');
                return;
            }

            const removed = this.databaseService.removePushoverUserKey(userId);

            if (removed) {
                await ctx.reply('✅ Pushover user key removed. All subscriptions have been disabled.');
                logger.info({ userId }, 'User disabled Pushover');
            } else {
                await ctx.reply('ℹ️ You did not have a Pushover key set');
            }
        } catch (error) {
            logger.error({ error }, 'Error disabling Pushover');
            await ctx.reply('❌ Failed to disable Pushover');
        }
    }

    private async handleSubscribe(ctx: Context): Promise<void> {
        try {
            const userId = ctx.from?.id;
            if (!userId) {
                await ctx.reply('❌ Could not identify user');
                return;
            }

            // Check if user has Pushover key set
            const user = this.databaseService.getUser(userId);
            if (!user || !user.pushoverUserKey) {
                await ctx.reply(
                    '❌ You need to set up Pushover first!\n\n' +
                    'Use: /enable_pushover <user_key>\n\n' +
                    'Get your key from: https://pushover.net/'
                );
                return;
            }

            // Parse command: /subscribe <key>
            const text = ctx.message && 'text' in ctx.message ? ctx.message.text : '';
            const parts = text.split(' ').filter(p => p.length > 0);

            if (parts.length !== 2) {
                await ctx.reply(
                    '❌ Invalid format!\n\n' +
                    'Usage: /subscribe <key>\n\n' +
                    'Available keys:\n' +
                    '• single_swap - High-value swap alerts\n' +
                    '• change_direction - Cumulative amount direction change alerts\n\n' +
                    'Example: /subscribe single_swap'
                );
                return;
            }

            const [, key] = parts;

            // Validate key
            const validKeys = ['single_swap', 'change_direction'];
            if (!validKeys.includes(key)) {
                await ctx.reply(
                    '❌ Invalid subscription key!\n\n' +
                    'Available keys:\n' +
                    '• single_swap - High-value swap alerts\n' +
                    '• change_direction - Cumulative amount direction change alerts'
                );
                return;
            }

            this.databaseService.subscribePushover(userId, key);

            const keyDescriptions: { [key: string]: string } = {
                'single_swap': 'High-value swap alerts',
                'change_direction': 'Cumulative amount direction change alerts'
            };

            await ctx.reply(
                `✅ Subscribed to: ${keyDescriptions[key]}\n\n` +
                'Use /status to see all your subscriptions.\n' +
                'Use /unsubscribe <key> to unsubscribe.'
            );

            logger.info({ userId, key }, 'User subscribed to notification');
        } catch (error) {
            logger.error({ error }, 'Error subscribing');
            await ctx.reply('❌ Failed to subscribe');
        }
    }

    private async handleUnsubscribe(ctx: Context): Promise<void> {
        try {
            const userId = ctx.from?.id;
            if (!userId) {
                await ctx.reply('❌ Could not identify user');
                return;
            }

            // Parse command: /unsubscribe <key>
            const text = ctx.message && 'text' in ctx.message ? ctx.message.text : '';
            const parts = text.split(' ').filter(p => p.length > 0);

            if (parts.length !== 2) {
                await ctx.reply(
                    '❌ Invalid format!\n\n' +
                    'Usage: /unsubscribe <key>\n\n' +
                    'Example: /unsubscribe single_swap\n\n' +
                    'Use /status to see your current subscriptions.'
                );
                return;
            }

            const [, key] = parts;

            const removed = this.databaseService.unsubscribePushover(userId, key);

            if (removed) {
                await ctx.reply(`✅ Unsubscribed from: ${key}`);
                logger.info({ userId, key }, 'User unsubscribed from notification');
            } else {
                await ctx.reply(`ℹ️ You were not subscribed to: ${key}`);
            }
        } catch (error) {
            logger.error({ error }, 'Error unsubscribing');
            await ctx.reply('❌ Failed to unsubscribe');
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

            const [skip, limit] = ctx.message && 'text' in ctx.message ? ctx.message.text.split(' ').slice(1).map(Number) : [0, 100];

            const wallets = this.databaseService.getWallets(skip, limit);

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
            const usersWithPushover = this.databaseService.getUsersWithPushoverKey().length;
            const singleSwapSubs = this.databaseService.getAllPushoverSubscriptions('single_swap').length;
            const changeDirectionSubs = this.databaseService.getAllPushoverSubscriptions('change_direction').length;

            // Get cumulative amounts for the tracked token
            const cumulativeBuy = await this.redisService.getCumulativeAmount(config.targetTokenMint, 'buy');
            const cumulativeSell = await this.redisService.getCumulativeAmount(config.targetTokenMint, 'sell');
            const timeWindowMinutes = Math.floor(config.swapTimeWindowSeconds / 60);

            await ctx.reply(
                `📊 **Tracker Statistics**\n\n` +
                `Tracked Wallets: ${walletCount}\n` +
                `Users with Pushover: ${usersWithPushover}\n` +
                `Single Swap Subscriptions: ${singleSwapSubs}\n` +
                `Change Direction Subscriptions: ${changeDirectionSubs}\n` +
                `Target Token: \`${config.targetTokenMint.substring(0, 8)}...\`\n` +
                `Price Threshold: $${config.priceThresholdUsd}\n` +
                `Time Window: ${timeWindowMinutes}m\n\n` +
                `📊 **Cumulative Amounts (${timeWindowMinutes}m window)**\n` +
                `🟢 Buys: $${cumulativeBuy.toFixed(2)} USD\n` +
                `🔴 Sells: $${cumulativeSell.toFixed(2)} USD\n` +
                `📈 Net: $${(cumulativeBuy - cumulativeSell).toFixed(2)} USD\n`,
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

            const user = this.databaseService.getUser(userId);
            const subscriptions = this.databaseService.getPushoverSubscriptions(userId);
            const isAdmin = this.isAdmin(userId);

            // Get cumulative amounts for different periods
            const cum30m = await this.redisService.getCumulativeAmounts(1800);
            const cum1h = await this.redisService.getCumulativeAmounts(3600);
            const cum4h = await this.redisService.getCumulativeAmounts(14400);

            const pushoverStatus = user?.pushoverUserKey ? '✅ Enabled' : '❌ Disabled';
            const subscriptionsList = subscriptions.length > 0 
                ? subscriptions.map(s => `  • ${s.key}`).join('\n')
                : '  None';

            await ctx.reply(
                `👤 **Your Status**\n\n` +
                `User ID: ${userId}\n` +
                `Admin: ${isAdmin ? '✅ Yes' : '❌ No'}\n` +
                `Pushover: ${pushoverStatus}\n` +
                `Subscriptions:\n${subscriptionsList}\n\n` +
                `📊 **Cumulative Amounts**\n\n` +
                `**30 minutes:**\n` +
                `🟢 Buys: $${cum30m.buys.toFixed(2)} | 🔴 Sells: $${cum30m.sells.toFixed(2)}\n` +
                `📈 Net: $${(cum30m.buys - cum30m.sells).toFixed(2)}\n\n` +
                `**1 hour:**\n` +
                `🟢 Buys: $${cum1h.buys.toFixed(2)} | 🔴 Sells: $${cum1h.sells.toFixed(2)}\n` +
                `📈 Net: $${(cum1h.buys - cum1h.sells).toFixed(2)}\n\n` +
                `**4 hours:**\n` +
                `🟢 Buys: $${cum4h.buys.toFixed(2)} | 🔴 Sells: $${cum4h.sells.toFixed(2)}\n` +
                `📈 Net: $${(cum4h.buys - cum4h.sells).toFixed(2)}`,
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
            `/start \\- Register to receive cumulative updates\n` +
            `/help \\- Show this help message\n` +
            `/status \\- Check your subscription status\n` +
            `/cum\\_30m \\- Get cumulative amount \\(30 min\\)\n` +
            `/cum\\_1h \\- Get cumulative amount \\(1 hour\\)\n` +
            `/cum\\_4h \\- Get cumulative amount \\(4 hours\\)\n` +
            `/enable\\_pushover \\<user\\_key\\> \\- Enable Pushover alerts\n` +
            `/disable\\_pushover \\- Disable Pushover alerts\n` +
            `/subscribe \\<key\\> \\- Subscribe to notification type\n` +
            `/unsubscribe \\<key\\> \\- Unsubscribe from notification type\n\n` +
            `*Available Subscription Keys:*\n` +
            `• single\\_swap \\- High\\-value swap alerts\n` +
            `• change\\_direction \\- Cumulative amount direction change alerts\n\n`;

        if (isAdmin) {
            helpText +=
                `*Admin Commands:*\n` +
                `/add \\<wallet\\> \\- Add wallet to tracking\n` +
                `/remove \\<wallet\\> \\- Remove wallet from tracking\n` +
                `/list \\<skip\\> \\<limit\\> \\- List all tracked wallets\n` +
                `/stats \\- Show tracker statistics\n\n`;
        }

        helpText +=
            `*About Pushover:*\n` +
            `1\\. Get your user key from: https://pushover\\.net/\n` +
            `2\\. Enable Pushover: /enable\\_pushover \\<user\\_key\\>\n` +
            `3\\. Subscribe to notifications: /subscribe \\<key\\>`;

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

    /**
     * Send cumulative amounts to all registered users
     * Called periodically by the scheduler
     */
    async sendCumulativeAmountsToUsers(periodSeconds: number, periodLabel: string): Promise<void> {
        try {
            const users = this.databaseService.getAllUsers();
            
            if (users.length === 0) {
                logger.info('No users to send cumulative amounts to');
                return;
            }

            const { buys, sells } = await this.redisService.getCumulativeAmounts(periodSeconds);

            const message =
                `📊 **Cumulative Amount (${periodLabel})**\n\n` +
                `🟢 Total Buys: $${buys.toFixed(2)} USD\n` +
                `🔴 Total Sells: $${sells.toFixed(2)} USD\n\n` +
                `📈 Net: $${(buys - sells).toFixed(2)} USD\n` +
                `⏰ ${new Date().toLocaleString()}`;

            logger.info({ userCount: users.length, period: periodLabel }, 'Sending cumulative amounts to users');

            // Send to each user
            const promises = users.map(async (user) => {
                try {
                    await this.bot.telegram.sendMessage(
                        user.userId,
                        message,
                        { parse_mode: 'Markdown' }
                    );
                    logger.info({ userId: user.userId, period: periodLabel }, 'Sent cumulative amount to user');
                } catch (error) {
                    logger.error({ error, userId: user.userId }, 'Failed to send cumulative amount to user');
                }
            });

            await Promise.allSettled(promises);

            logger.info({ userCount: users.length, period: periodLabel }, 'Finished sending cumulative amounts');
        } catch (error) {
            logger.error({ error, period: periodLabel }, 'Error sending cumulative amounts to users');
        }
    }

    getBot(): Telegraf {
        return this.bot;
    }
}
