import type { UsageData } from './types.js';
export declare function getUsageCachePath(homeDir: string): string;
/**
 * Fills the 5h and 7d windows stdin left out from the last values stdin carried.
 *
 * Claude Code does not send both windows on every refresh. Rendering only what
 * arrived makes the usage line flip between `5h` and `Weekly` from one refresh to
 * the next. Stdin always wins; a remembered window is dropped once it resets.
 * Windows that arrive on stdin are written back so the next render can use them.
 */
export declare function withLastKnownUsage(stdinUsage: UsageData | null, now?: number, homeDir?: string): UsageData | null;
//# sourceMappingURL=usage-cache.d.ts.map