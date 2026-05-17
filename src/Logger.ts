// Centralized logger. All system errors and warnings flow through here so
// they show up in the browser console with a clear, scannable format and
// optionally surface in the in-game hint bar for the player.
//
// Usage:
//   import { Logger } from './Logger';
//   Logger.warn('CombatResolver', 'Tower has no projectile profile', { type });
//   Logger.error('GameLoop', err, { wave: state.wave });
//
// All messages are prefixed with [Roman TD][CATEGORY] for easy filtering.

type Level = 'debug' | 'info' | 'warn' | 'error';

interface LoggerOpts {
  level?: Level;                 // minimum level to emit
  surfaceErrorsToHint?: (msg: string) => void;
}

const LEVEL_RANK: Record<Level, number> = { debug: 0, info: 1, warn: 2, error: 3 };

let opts: LoggerOpts = { level: 'warn' };

export const Logger = {
  configure(o: LoggerOpts) { opts = { ...opts, ...o }; },

  debug(category: string, msg: string, data?: any) {
    if (LEVEL_RANK[opts.level ?? 'warn'] > LEVEL_RANK.debug) return;
    console.debug(`[Roman TD][${category}] ${msg}`, data ?? '');
  },
  info(category: string, msg: string, data?: any) {
    if (LEVEL_RANK[opts.level ?? 'warn'] > LEVEL_RANK.info) return;
    console.info(`[Roman TD][${category}] ${msg}`, data ?? '');
  },
  warn(category: string, msg: string, data?: any) {
    if (LEVEL_RANK[opts.level ?? 'warn'] > LEVEL_RANK.warn) return;
    console.warn(`[Roman TD][${category}] ${msg}`, data ?? '');
  },
  error(category: string, err: unknown, ctx?: any) {
    const msg = err instanceof Error ? err.message : String(err);
    const stack = err instanceof Error ? err.stack : undefined;
    console.error(`[Roman TD][${category}] ${msg}`, { ctx, stack });
    if (opts.surfaceErrorsToHint) {
      try { opts.surfaceErrorsToHint(`⚠ ${category}: ${msg}`); } catch { /* swallow */ }
    }
  },

  // Wraps a function so any thrown error is logged but does not crash the call site.
  // Returns the function's result, or `fallback` if it threw.
  safe<T>(category: string, fn: () => T, fallback: T): T {
    try {
      return fn();
    } catch (err) {
      Logger.error(category, err);
      return fallback;
    }
  }
};
