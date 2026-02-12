/**
 * Helius Enhanced Transaction Webhook Payload Types
 */

export interface HeliusWebhookPayload {
  accountData: AccountData[];
  description: string;
  type: string;
  source: string;
  fee: number;
  feePayer: string;
  signature: string;
  slot: number;
  timestamp: number;
  nativeTransfers: NativeTransfer[];
  tokenTransfers: TokenTransfer[];
  events: {
    swap?: SwapEvent;
  };
}

export interface AccountData {
  account: string;
  nativeBalanceChange: number;
  tokenBalanceChanges?: TokenBalanceChange[];
}

export interface TokenBalanceChange {
  mint: string;
  rawTokenAmount: RawTokenAmount;
  tokenAccount: string;
  userAccount: string;
}

export interface RawTokenAmount {
  tokenAmount: string;
  decimals: number;
}

export interface NativeTransfer {
  fromUserAccount: string;
  toUserAccount: string;
  amount: number;
}

export interface TokenTransfer {
  fromUserAccount: string;
  toUserAccount: string;
  fromTokenAccount: string;
  toTokenAccount: string;
  tokenAmount: number;
  mint: string;
  tokenStandard: string;
}

export interface SwapEvent {
  nativeInput?: {
    account: string;
    amount: string;
  };
  nativeOutput?: {
    account: string;
    amount: string;
  };
  tokenInputs: TokenSwapData[];
  tokenOutputs: TokenSwapData[];
}

export interface TokenSwapData {
  mint: string;
  rawTokenAmount: RawTokenAmount;
  tokenAccount: string;
  userAccount: string;
}

/**
 * DexScreener API Types
 */

export interface DexScreenerResponse {
  schemaVersion: string;
  pairs: DexScreenerPair[] | null;
}

export interface DexScreenerPair {
  chainId: string;
  dexId: string;
  url: string;
  pairAddress: string;
  labels?: string[];
  baseToken: {
    address: string;
    name: string;
    symbol: string;
  };
  quoteToken: {
    address: string;
    name: string;
    symbol: string;
  };
  priceNative: string;
  priceUsd: string;
  txns: {
    [key: string]: {
      buys: number;
      sells: number;
    };
  };
  volume: {
    [key: string]: number;
  };
  priceChange: {
    [key: string]: number;
  };
  liquidity?: {
    usd?: number;
    base?: number;
    quote?: number;
  };
  fdv?: number;
  marketCap?: number;
  pairCreatedAt?: number;
  info?: {
    imageUrl?: string;
    websites?: Array<{ url: string }>;
    socials?: Array<{ platform: string; handle: string }>;
  };
  boosts?: {
    active?: number;
  };
}

/**
 * Internal Application Types
 */

export interface ParsedTransaction {
  walletAddress: string;
  tokenMint: string;
  tokenAmount: number;
  decimals: number;
  transactionSignature: string;
  timestamp: number;
  type: 'buy' | 'sell';
  valueUsd?: number;
}

export interface PriceCache {
  price: number;
  timestamp: number;
}

export interface NotificationPayload {
  transfer: ParsedTransaction;
  tokenSymbol?: string;
  tokenName?: string;
}

export enum NotificationType {
  TELEGRAM_ALL = 'telegram_all',
  PUSHOVER_THRESHOLD_A = 'pushover_threshold_a',
  PUSHOVER_THRESHOLD_B = 'pushover_threshold_b',
  PUSHOVER_5SELLS = 'pushover_5sells',
}
