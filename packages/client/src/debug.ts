import { getConfig } from './config';

export function log(message: string, data?: unknown): void {
  if (!getConfig().debug) return;
  if (data !== undefined) {
    console.log('[Force10]', message, data);
  } else {
    console.log('[Force10]', message);
  }
}

export function warn(message: string, data?: unknown): void {
  if (!getConfig().debug) return;
  if (data !== undefined) {
    console.warn('[Force10]', message, data);
  } else {
    console.warn('[Force10]', message);
  }
}
