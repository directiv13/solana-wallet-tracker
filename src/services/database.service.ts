import Database from 'better-sqlite3';
import path from 'path';
import pino from 'pino';

const logger = pino({ name: 'database-service' });

export interface PushoverSubscription {
  userId: number;
  pushoverUserKey: string;
  createdAt: number;
}

export interface Pushover5SellsSubscription {
  userId: number;
  pushoverUserKey: string;
  createdAt: number;
}

export interface TrackedWallet {
  address: string;
  addedBy: number;
  addedAt: number;
}

export class DatabaseService {
  private db: Database.Database;

  constructor(dbPath: string = '/app/data/tracker.db') {
    // Ensure directory exists
    const dir = path.dirname(dbPath);
    const fs = require('fs');
    if (!fs.existsSync(dir)) {
      fs.mkdirSync(dir, { recursive: true });
    }

    this.db = new Database(dbPath);
    this.db.pragma('journal_mode = WAL');
    
    this.initDatabase();
    logger.info({ dbPath }, 'Database initialized');
  }

  private initDatabase(): void {
    // Create pushover_subscriptions table
    this.db.exec(`
      CREATE TABLE IF NOT EXISTS pushover_subscriptions (
        user_id INTEGER PRIMARY KEY,
        pushover_user_key TEXT NOT NULL,
        created_at INTEGER NOT NULL
      )
    `);

    // Create pushover_5sells_subscriptions table
    this.db.exec(`
      CREATE TABLE IF NOT EXISTS pushover_5sells_subscriptions (
        user_id INTEGER PRIMARY KEY,
        pushover_user_key TEXT NOT NULL,
        created_at INTEGER NOT NULL
      )
    `);

    // Create tracked_wallets table
    this.db.exec(`
      CREATE TABLE IF NOT EXISTS tracked_wallets (
        address TEXT PRIMARY KEY,
        added_by INTEGER NOT NULL,
        added_at INTEGER NOT NULL
      )
    `);

    // Create indexes
    this.db.exec(`
      CREATE INDEX IF NOT EXISTS idx_tracked_wallets_added_by 
      ON tracked_wallets(added_by)
    `);

    logger.info('Database schema initialized');
  }

  // Pushover Subscriptions
  
  subscribePushover(userId: number, pushoverUserKey: string): void {
    const stmt = this.db.prepare(`
      INSERT OR REPLACE INTO pushover_subscriptions 
      (user_id, pushover_user_key, created_at)
      VALUES (?, ?, ?)
    `);
    
    stmt.run(userId, pushoverUserKey, Date.now());
    logger.info({ userId }, 'User subscribed to Pushover notifications');
  }

  unsubscribePushover(userId: number): boolean {
    const stmt = this.db.prepare('DELETE FROM pushover_subscriptions WHERE user_id = ?');
    const result = stmt.run(userId);
    
    if (result.changes > 0) {
      logger.info({ userId }, 'User unsubscribed from Pushover notifications');
      return true;
    }
    return false;
  }

  getPushoverSubscription(userId: number): PushoverSubscription | null {
    const stmt = this.db.prepare(`
      SELECT user_id as userId, pushover_user_key as pushoverUserKey, created_at as createdAt
      FROM pushover_subscriptions
      WHERE user_id = ?
    `);
    
    return stmt.get(userId) as PushoverSubscription | null;
  }

  getAllPushoverSubscriptions(): PushoverSubscription[] {
    const stmt = this.db.prepare(`
      SELECT user_id as userId, pushover_user_key as pushoverUserKey, created_at as createdAt
      FROM pushover_subscriptions
    `);
    
    return stmt.all() as PushoverSubscription[];
  }

  // Pushover 5 Sells Subscriptions
  
  subscribePushover5Sells(userId: number, pushoverUserKey: string): void {
    const stmt = this.db.prepare(`
      INSERT OR REPLACE INTO pushover_5sells_subscriptions 
      (user_id, pushover_user_key, created_at)
      VALUES (?, ?, ?)
    `);
    
    stmt.run(userId, pushoverUserKey, Date.now());
    logger.info({ userId }, 'User subscribed to Pushover 5 Sells notifications');
  }

  unsubscribePushover5Sells(userId: number): boolean {
    const stmt = this.db.prepare('DELETE FROM pushover_5sells_subscriptions WHERE user_id = ?');
    const result = stmt.run(userId);
    
    if (result.changes > 0) {
      logger.info({ userId }, 'User unsubscribed from Pushover 5 Sells notifications');
      return true;
    }
    return false;
  }

  getPushover5SellsSubscription(userId: number): Pushover5SellsSubscription | null {
    const stmt = this.db.prepare(`
      SELECT user_id as userId, pushover_user_key as pushoverUserKey, created_at as createdAt
      FROM pushover_5sells_subscriptions
      WHERE user_id = ?
    `);
    
    return stmt.get(userId) as Pushover5SellsSubscription | null;
  }

  getAllPushover5SellsSubscriptions(): Pushover5SellsSubscription[] {
    const stmt = this.db.prepare(`
      SELECT user_id as userId, pushover_user_key as pushoverUserKey, created_at as createdAt
      FROM pushover_5sells_subscriptions
    `);
    
    return stmt.all() as Pushover5SellsSubscription[];
  }

  // Tracked Wallets
  
  addWallet(address: string, addedBy: number): boolean {
    try {
      const stmt = this.db.prepare(`
        INSERT INTO tracked_wallets (address, added_by, added_at)
        VALUES (?, ?, ?)
      `);
      
      stmt.run(address, addedBy, Date.now());
      logger.info({ address, addedBy }, 'Wallet added to tracking');
      return true;
    } catch (error: any) {
      if (error.code === 'SQLITE_CONSTRAINT') {
        logger.warn({ address }, 'Wallet already tracked');
        return false;
      }
      throw error;
    }
  }

  removeWallet(address: string): boolean {
    const stmt = this.db.prepare('DELETE FROM tracked_wallets WHERE address = ?');
    const result = stmt.run(address);
    
    if (result.changes > 0) {
      logger.info({ address }, 'Wallet removed from tracking');
      return true;
    }
    return false;
  }

  getWallet(address: string): TrackedWallet | null {
    const stmt = this.db.prepare(`
      SELECT address, added_by as addedBy, added_at as addedAt
      FROM tracked_wallets 
      WHERE address = ?
    `);
    
    return stmt.get(address) as TrackedWallet | null;
  }

  getAllWallets(): TrackedWallet[] {
    const stmt = this.db.prepare(`
      SELECT address, added_by as addedBy, added_at as addedAt
      FROM tracked_wallets
      ORDER BY added_at DESC
    `);
    
    return stmt.all() as TrackedWallet[];
  }

  getWalletAddresses(): string[] {
    const stmt = this.db.prepare('SELECT address FROM tracked_wallets');
    const rows = stmt.all() as { address: string }[];
    return rows.map(row => row.address);
  }

  getWalletCount(): number {
    const stmt = this.db.prepare('SELECT COUNT(*) as count FROM tracked_wallets');
    const result = stmt.get() as { count: number };
    return result.count;
  }

  close(): void {
    this.db.close();
    logger.info('Database connection closed');
  }
}
