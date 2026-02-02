/**
 * Type definitions for pushover-notifications
 * Project: https://github.com/qbit/node-pushover
 */

declare module 'pushover-notifications' {
  interface PushoverOptions {
    user: string;
    token: string;
    onerror?: (error: Error) => void;
    update_sounds?: boolean;
    httpOptions?: any;
  }

  interface PushoverMessage {
    message: string;
    title?: string;
    device?: string;
    priority?: number;
    sound?: string;
    url?: string;
    url_title?: string;
    html?: number;
    timestamp?: number;
    retry?: number;
    expire?: number;
    callback?: string;
    attachment?: any;
    file?: any;
  }

  interface PushoverResponse {
    status: number;
    request: string;
    errors?: string[];
  }

  class Pushover {
    constructor(options: PushoverOptions);
    
    send(
      message: PushoverMessage,
      callback: (error: Error | null, result: PushoverResponse) => void
    ): void;
    
    sounds(callback: (error: Error | null, sounds: any) => void): void;
    
    devices(callback: (error: Error | null, devices: any) => void): void;
  }

  export = Pushover;
}
