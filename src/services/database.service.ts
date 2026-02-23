import Database from 'better-sqlite3';
import path from 'path';
import pino from 'pino';

const logger = pino({ name: 'database-service' });

export interface PushoverSubscription {
  userId: number;
  key: string;
  createdAt: number;
}

export interface TrackedWallet {
  address: string;
  addedBy: number;
  addedAt: number;
}

export interface User {
  userId: number;
  pushoverUserKey: string | null;
  startedAt: number;
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
    // Create users table with pushover_user_key
    this.db.exec(`
      CREATE TABLE IF NOT EXISTS users (
        user_id INTEGER PRIMARY KEY,
        pushover_user_key TEXT,
        started_at INTEGER NOT NULL
      )
    `);

    // Create pushover_subscriptions table
    this.db.exec(`
      CREATE TABLE IF NOT EXISTS pushover_subscriptions (
        user_id INTEGER NOT NULL,
        key TEXT NOT NULL,
        created_at INTEGER NOT NULL,
        PRIMARY KEY (user_id, key)
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

    this.db.exec(`
      CREATE INDEX IF NOT EXISTS idx_pushover_subscriptions_user_id 
      ON pushover_subscriptions(user_id)
    `);

    // Migration: Drop old pushover_5sells_subscriptions table if exists
    this.db.exec(`DROP TABLE IF EXISTS pushover_5sells_subscriptions`);

    logger.info('Database schema initialized');
  }

  // Pushover Subscriptions
  
  subscribePushover(userId: number, key: string): void {
    const stmt = this.db.prepare(`
      INSERT OR REPLACE INTO pushover_subscriptions 
      (user_id, key, created_at)
      VALUES (?, ?, ?)
    `);
    
    stmt.run(userId, key, Date.now());
    logger.info({ userId, key }, 'User subscribed to Pushover notification');
  }

  unsubscribePushover(userId: number, key: string): boolean {
    const stmt = this.db.prepare('DELETE FROM pushover_subscriptions WHERE user_id = ? AND key = ?');
    const result = stmt.run(userId, key);
    
    if (result.changes > 0) {
      logger.info({ userId, key }, 'User unsubscribed from Pushover notification');
      return true;
    }
    return false;
  }

  getPushoverSubscriptions(userId: number): PushoverSubscription[] {
    const stmt = this.db.prepare(`
      SELECT user_id as userId, key, created_at as createdAt
      FROM pushover_subscriptions
      WHERE user_id = ?
    `);
    
    return stmt.all(userId) as PushoverSubscription[];
  }

  getAllPushoverSubscriptions(key?: string): PushoverSubscription[] {
    let stmt;
    if (key) {
      stmt = this.db.prepare(`
        SELECT user_id as userId, key, created_at as createdAt
        FROM pushover_subscriptions
        WHERE key = ?
      `);
      return stmt.all(key) as PushoverSubscription[];
    } else {
      stmt = this.db.prepare(`
        SELECT user_id as userId, key, created_at as createdAt
        FROM pushover_subscriptions
      `);
      return stmt.all() as PushoverSubscription[];
    }
  }

  getUsersWithPushoverKey(): { userId: number; pushoverUserKey: string }[] {
    const stmt = this.db.prepare(`
      SELECT user_id as userId, pushover_user_key as pushoverUserKey
      FROM users
      WHERE pushover_user_key IS NOT NULL
    `);
    
    return stmt.all() as { userId: number; pushoverUserKey: string }[];
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

  getWallets(skip: number = 0, limit: number = 100): TrackedWallet[] {
    const stmt = this.db.prepare(`
      SELECT address, added_by as addedBy, added_at as addedAt
      FROM tracked_wallets
      ORDER BY added_at DESC
      OFFSET ? LIMIT ?
    `);
    
    return stmt.all(skip, limit) as TrackedWallet[];
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

  // Users
  
  addUser(userId: number): boolean {
    try {
      const stmt = this.db.prepare(`
        INSERT INTO users (user_id, pushover_user_key, started_at)
        VALUES (?, NULL, ?)
      `);
      
      stmt.run(userId, Date.now());
      logger.info({ userId }, 'User added to database');
      return true;
    } catch (error: any) {
      if (error.code === 'SQLITE_CONSTRAINT') {
        logger.warn({ userId }, 'User already exists');
        return false;
      }
      throw error;
    }
  }

  setPushoverUserKey(userId: number, pushoverUserKey: string): void {
    const stmt = this.db.prepare(`
      UPDATE users 
      SET pushover_user_key = ?
      WHERE user_id = ?
    `);
    
    stmt.run(pushoverUserKey, userId);
    logger.info({ userId }, 'User Pushover key updated');
  }

  removePushoverUserKey(userId: number): boolean {
    const stmt = this.db.prepare(`
      UPDATE users 
      SET pushover_user_key = NULL
      WHERE user_id = ?
    `);
    
    const result = stmt.run(userId);
    if (result.changes > 0) {
      logger.info({ userId }, 'User Pushover key removed');
      return true;
    }
    return false;
  }

  getUser(userId: number): User | null {
    const stmt = this.db.prepare(`
      SELECT user_id as userId, pushover_user_key as pushoverUserKey, started_at as startedAt
      FROM users 
      WHERE user_id = ?
    `);
    
    return stmt.get(userId) as User | null;
  }

  getAllUsers(): User[] {
    const stmt = this.db.prepare(`
      SELECT user_id as userId, pushover_user_key as pushoverUserKey, started_at as startedAt
      FROM users
      ORDER BY started_at DESC
    `);
    
    return stmt.all() as User[];
  }

  getUserCount(): number {
    const stmt = this.db.prepare('SELECT COUNT(*) as count FROM users');
    const result = stmt.get() as { count: number };
    return result.count;
  }

  close(): void {
    this.db.close();
    logger.info('Database connection closed');
  }
}
