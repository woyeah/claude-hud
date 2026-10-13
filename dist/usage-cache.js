import * as fs from 'node:fs';
import * as os from 'node:os';
import * as path from 'node:path';
import { getHudPluginDir } from './claude-config-dir.js';
import { createDebug } from './debug.js';
const debug = createDebug('usage-cache');
const FIVE_HOUR_WINDOW_MS = 5 * 60 * 60 * 1000;
const SEVEN_DAY_WINDOW_MS = 7 * 24 * 60 * 60 * 1000;
const EMPTY_CACHE = { five_hour: null, seven_day: null };
// Rate limits belong to the account, not the session, so one file per config directory.
export function getUsageCachePath(homeDir) {
    return path.join(getHudPluginDir(homeDir), 'usage-cache.json');
}
const isPercent = (value) => typeof value === 'number' && Number.isFinite(value) && value >= 0 && value <= 100;
const isTimestamp = (value) => typeof value === 'number' && Number.isFinite(value) && value > 0;
function parseWindow(value) {
    if (value === null || typeof value !== 'object' || Array.isArray(value))
        return null;
    const raw = value;
    if (!isPercent(raw.used_percentage) || !isTimestamp(raw.saved_at))
        return null;
    if (raw.resets_at !== null && !isTimestamp(raw.resets_at))
        return null;
    return { used_percentage: raw.used_percentage, resets_at: raw.resets_at, saved_at: raw.saved_at };
}
function readCache(file) {
    try {
        const value = JSON.parse(fs.readFileSync(file, 'utf8'));
        if (value === null || typeof value !== 'object' || Array.isArray(value))
            return EMPTY_CACHE;
        const raw = value;
        return { five_hour: parseWindow(raw.five_hour), seven_day: parseWindow(raw.seven_day) };
    }
    catch (err) {
        if (!(err instanceof Error && 'code' in err && err.code === 'ENOENT')) {
            debug('Failed to read usage cache:', err instanceof Error ? err.message : err);
        }
        return EMPTY_CACHE;
    }
}
function writeCache(file, cache) {
    const tmp = `${file}.${process.pid}.tmp`;
    try {
        fs.mkdirSync(path.dirname(file), { recursive: true, mode: 0o700 });
        fs.writeFileSync(tmp, `${JSON.stringify(cache, null, 2)}\n`, { mode: 0o600, flag: 'wx' });
        fs.renameSync(tmp, file);
    }
    catch (err) {
        debug('Failed to write usage cache:', err instanceof Error ? err.message : err);
        try {
            fs.rmSync(tmp, { force: true });
        }
        catch {
            // Nothing left to clean up.
        }
    }
}
// A remembered window is only worth showing until it resets. Without a reset time the
// best bound is the window length itself.
function isLive(window, windowMs, now) {
    if (!window)
        return null;
    const expiresAt = window.resets_at ?? window.saved_at + windowMs;
    return expiresAt > now ? window : null;
}
function toCached(percent, resetAt, now) {
    return percent === null ? null : { used_percentage: percent, resets_at: resetAt?.getTime() ?? null, saved_at: now };
}
const sameValues = (a, b) => a?.used_percentage === b?.used_percentage && a?.resets_at === b?.resets_at;
// Each session reports the limits from its own last response, so an idle session
// sends readings that are hours or days old. Usage only grows within a window, so of
// two readings of one window the higher is the newer. Two windows reset at least a
// window length apart, and the later reset is the newer window. Without both reset
// times there is nothing to compare, and stdin wins.
function newerReading(stdin, cached, windowMs) {
    if (stdin.resets_at === null || cached.resets_at === null)
        return stdin;
    if (Math.abs(stdin.resets_at - cached.resets_at) < windowMs / 2) {
        return cached.used_percentage > stdin.used_percentage ? cached : stdin;
    }
    return cached.resets_at > stdin.resets_at ? cached : stdin;
}
function pickWindow(stdin, cached, windowMs, now) {
    const live = isLive(cached, windowMs, now);
    if (!stdin)
        return live;
    return live ? newerReading(stdin, live, windowMs) : stdin;
}
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
export function withLastKnownUsage(stdinUsage, now = Date.now(), homeDir = os.homedir()) {
    const file = getUsageCachePath(homeDir);
    const cached = readCache(file);
    const stdinFiveHour = toCached(stdinUsage?.fiveHour ?? null, stdinUsage?.fiveHourResetAt ?? null, now);
    const stdinSevenDay = toCached(stdinUsage?.sevenDay ?? null, stdinUsage?.sevenDayResetAt ?? null, now);
    const fiveHour = pickWindow(stdinFiveHour, cached.five_hour, FIVE_HOUR_WINDOW_MS, now);
    const sevenDay = pickWindow(stdinSevenDay, cached.seven_day, SEVEN_DAY_WINDOW_MS, now);
    const next = {
        five_hour: fiveHour ?? cached.five_hour,
        seven_day: sevenDay ?? cached.seven_day,
    };
    if (stdinUsage && (!sameValues(next.five_hour, cached.five_hour) || !sameValues(next.seven_day, cached.seven_day))) {
        writeCache(file, next);
    }
    if (!fiveHour && !sevenDay) {
        return stdinUsage;
    }
    return {
        ...stdinUsage,
        fiveHour: fiveHour?.used_percentage ?? null,
        sevenDay: sevenDay?.used_percentage ?? null,
        fiveHourResetAt: fiveHour?.resets_at != null ? new Date(fiveHour.resets_at) : null,
        sevenDayResetAt: sevenDay?.resets_at != null ? new Date(sevenDay.resets_at) : null,
    };
}
//# sourceMappingURL=usage-cache.js.map