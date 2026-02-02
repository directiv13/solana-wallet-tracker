// Minimal type shim for helius-sdk
// The actual types are provided by the library
// This bridges the module resolution issue between CommonJS and ESM
declare module 'helius-sdk' {
  export function createHelius(options: { apiKey: string; network?: 'mainnet' | 'devnet' }): any;
  
  // Re-export types from the actual library
  export type { Webhook, CreateWebhookRequest, UpdateWebhookRequest } from 'helius-sdk/types/webhooks';
}
