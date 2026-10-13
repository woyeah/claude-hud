import type { UsageData } from './types.js';
export declare function getUsageCachePath(homeDir: string): string;
/**
 * Keeps the newest 5h and 7d readings any session has seen, shared through one file.
 *
 * Claude Code does not send both windows on every refresh, and an idle session keeps
 * sending the readings of its last response. Rendering only what arrived makes the
 * usage line flip between `5h` and `Weekly` and lets an idle session pull the shared
 * values back down. Each window shows the newest reading of stdin and the cache; a
 * remembered window is dropped once it resets. Newer readings from stdin are written
 * back so the next render, in any session, can use them.
 */
export declare function withLastKnownUsage(stdinUsage: UsageData | null, now?: number, homeDir?: string): UsageData | null;
//# sourceMappingURL=usage-cache.d.ts.map