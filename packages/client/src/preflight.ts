import type { Force10Preflight, PreflightResult } from './types';

export function createPreflight(): Force10Preflight {
  let _data: Record<string, PreflightResult> = {};

  function update(data: Record<string, PreflightResult>): void {
    _data = data;
  }

  function check(middleware: string[]): boolean | null {
    let hasAnyData = false;

    for (const mw of middleware) {
      const result = _data[mw];
      if (!result) continue;

      hasAnyData = true;

      if (!result.pass) return false;

      if (result.expiresAt && Math.floor(Date.now() / 1000) >= result.expiresAt) {
        return false;
      }
    }

    return hasAnyData ? true : null;
  }

  return { update, check };
}
