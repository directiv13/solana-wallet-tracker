# Database Migration Guide

## Overview

This guide explains the database schema changes and how to migrate from the old structure to the new subscription-based system.

## What Changed

### Database Schema Changes

#### 1. Users Table
**Before:**
```sql
CREATE TABLE users (
    user_id INTEGER PRIMARY KEY,
    started_at INTEGER NOT NULL
);
```

**After:**
```sql
CREATE TABLE users (
    user_id INTEGER PRIMARY KEY,
    pushover_user_key TEXT,
    started_at INTEGER NOT NULL
);
```

**Change:** Added `pushover_user_key` column to store each user's Pushover key directly in the users table.

#### 2. Pushover Subscriptions Table
**Before:**
```sql
CREATE TABLE pushover_subscriptions (
    user_id INTEGER PRIMARY KEY,
    pushover_user_key TEXT NOT NULL,
    created_at INTEGER NOT NULL
);
```

**After:**
```sql
CREATE TABLE pushover_subscriptions (
    user_id INTEGER NOT NULL,
    key TEXT NOT NULL,
    created_at INTEGER NOT NULL,
    PRIMARY KEY (user_id, key)
);
```

**Changes:**
- Removed `pushover_user_key` column (now in users table)
- Added `key` column for subscription type (`big_sell`, `change_direction`)
- Changed primary key from `user_id` to composite key `(user_id, key)`
- This allows users to have multiple subscriptions

#### 3. Removed Table
**Deleted:** `pushover_5sells_subscriptions` table
- Functionality merged into main `pushover_subscriptions` table with `big_sell` key

### Bot Command Changes

#### Removed Commands
- `/enable_pushover_5sells <user_key>` - Removed
- `/disable_pushover_5sells` - Removed

#### Modified Commands
- `/enable_pushover <user_key>` - Now only sets the Pushover user key
- `/disable_pushover` - Now removes the Pushover user key and all subscriptions

#### New Commands
- `/subscribe <key>` - Subscribe to specific notification types
  - Available keys: `big_sell`, `change_direction`
- `/unsubscribe <key>` - Unsubscribe from specific notification types

### Notification Logic Changes

#### Subscription Types

**big_sell:**
- High-value sell alerts (single swaps > $300 USD)
- 5 sequential sells pattern
- Replaces old Threshold A (for sells only) and 5-sells notifications

**change_direction:**
- Volume surge alerts
- Replaces old Threshold B notifications
- Indicates potential trend changes

## Migration Process

### Automatic Migration

The new database schema includes automatic migration:
1. The old `pushover_5sells_subscriptions` table is automatically dropped
2. New schema is created with updated tables
3. Existing `tracked_wallets` data is preserved

### Manual Steps for Users

Users who previously had Pushover notifications enabled need to:

1. **Set up Pushover key** (if not already done):
   ```
   /enable_pushover <your_pushover_user_key>
   ```

2. **Subscribe to desired notification types:**
   ```
   /subscribe big_sell
   /subscribe change_direction
   ```

3. **Check subscription status:**
   ```
   /status
   ```

### Data Migration

**What is preserved:**
- ✅ All tracked wallets (`tracked_wallets` table)
- ✅ User registrations (users table is updated, not replaced)

**What needs to be reconfigured:**
- ❌ Old Pushover subscriptions (users need to re-subscribe using new commands)
- ❌ Old 5-sells subscriptions (merged into `big_sell` subscription type)

### Environment Variable Changes

**Before:**
```env
PUSHOVER_USER_KEY=your_user_key
PUSHOVER_APP_TOKEN=your_app_token
```

**After:**
```env
# Remove PUSHOVER_USER_KEY - users now subscribe with their own keys
PUSHOVER_APP_TOKEN=your_app_token
```

## Testing After Migration

1. **Check database initialization:**
   ```bash
   # The app should start without errors
   npm run dev
   ```

2. **Verify bot commands:**
   ```
   /help - Should show new commands
   /status - Should show empty subscriptions
   ```

3. **Test subscription flow:**
   ```
   /enable_pushover <user_key>
   /subscribe big_sell
   /status - Should show big_sell subscription
   /unsubscribe big_sell
   ```

4. **Test admin commands:**
   ```
   /stats - Should show updated statistics
   /list - Should show preserved wallet list
   ```

## Rollback (If Needed)

If you need to rollback:

1. Stop the application
2. Restore the database backup (if you made one)
3. Revert to previous git commit
4. Restart the application

**Note:** It's recommended to backup your database before running the new version:
```bash
# Backup SQLite database
cp /app/data/tracker.db /app/data/tracker.db.backup
```

## Benefits of New System

1. **User Privacy:** Each user manages their own Pushover key
2. **Flexibility:** Users can subscribe to specific notification types
3. **Scalability:** Better support for multiple notification types
4. **Simplicity:** No need for admin to manage all user keys
5. **Granular Control:** Users can enable/disable specific alert types

## Support

If you encounter issues during migration:

1. Check application logs for errors
2. Verify database schema with SQLite browser
3. Test bot commands individually
4. Create an issue on GitHub with:
   - Error messages
   - Steps to reproduce
   - Database schema dump

## Timeline

- **Old system:** Database with separate tables for each notification type
- **New system:** Unified subscription system with flexible keys
- **Migration:** Automatic on first startup with new version
