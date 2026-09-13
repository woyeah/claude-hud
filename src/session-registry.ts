import * as fs from 'node:fs';
import * as os from 'node:os';
import * as path from 'node:path';
import { getClaudeConfigDir } from './claude-config-dir.js';
import { sanitizeDisplayText } from './utils/sanitize.js';

/**
 * The peer-messaging name of the current session, read from the session
 * registry Claude Code keeps in {CLAUDE_CONFIG_DIR}/sessions/<pid>.json.
 *
 * That name (e.g. "my-project-4b") is the address other sessions use to reach
 * this one, and it is what `ListAgents` prints. It is NOT the `session_id`
 * stdin carries: the id addresses a transcript (`claude --resume <id>`), the
 * name addresses a running session. Only the registry ties the two together,
 * so the id from stdin is the key we look the name up by.
 */
const SESSION_NAME_MAX_LEN = 64;
const SESSION_FILE_MAX_BYTES = 16 * 1024;
// Registry files are per-process and tiny, but the scan runs on every
// statusline refresh, so cap the work a stale registry directory can cause.
const SESSION_FILES_MAX = 200;

export function getSessionRegistryDir(homeDir: string): string {
  return path.join(getClaudeConfigDir(homeDir), 'sessions');
}

/**
 * Pulls the session name out of one parsed registry record, but only when the
 * record describes the session we were asked about. Pure so the matching and
 * sanitizing rules can be tested without touching the filesystem.
 */
export function extractSessionName(record: unknown, sessionId: string): string | null {
  if (!record || typeof record !== 'object') {
    return null;
  }
  const entry = record as Record<string, unknown>;
  if (typeof entry.sessionId !== 'string' || entry.sessionId !== sessionId) {
    return null;
  }
  if (typeof entry.name !== 'string') {
    return null;
  }
  // Registry values reach the terminal verbatim, so strip escapes the same way
  // every other externally-sourced label does.
  const name = sanitizeDisplayText(entry.name).trim().slice(0, SESSION_NAME_MAX_LEN);
  return name.length > 0 ? name : null;
}

function readRegistryFile(filePath: string, sessionId: string): string | null {
  let fd: number | undefined;
  try {
    const flags = fs.constants.O_RDONLY | (fs.constants.O_NOFOLLOW ?? 0);
    fd = fs.openSync(filePath, flags);
    const stat = fs.fstatSync(fd);
    if (!stat.isFile() || stat.size <= 0 || stat.size > SESSION_FILE_MAX_BYTES) {
      return null;
    }
    return extractSessionName(JSON.parse(fs.readFileSync(fd, 'utf-8')), sessionId);
  } catch {
    // A half-written or unreadable record is just a miss.
    return null;
  } finally {
    if (fd !== undefined) {
      try { fs.closeSync(fd); } catch { /* best effort */ }
    }
  }
}

/**
 * Resolves the current session's peer-messaging name, or null when the
 * registry has no record for this id (older Claude Code, or a session kind
 * that is not registered).
 *
 * Records are keyed by pid, not by session id, so the id has to be matched
 * against each record in turn.
 */
export function readSessionAddress(
  sessionId: string | undefined,
  homeDir: string = os.homedir(),
): string | null {
  const id = sessionId?.trim();
  if (!id) {
    return null;
  }

  const dir = getSessionRegistryDir(homeDir);
  let entries: fs.Dirent[];
  try {
    entries = fs.readdirSync(dir, { withFileTypes: true });
  } catch {
    return null;
  }

  let scanned = 0;
  for (const entry of entries) {
    if (scanned >= SESSION_FILES_MAX) {
      break;
    }
    if (!entry.isFile() || !entry.name.endsWith('.json')) {
      continue;
    }
    scanned += 1;
    const name = readRegistryFile(path.join(dir, entry.name), id);
    if (name) {
      return name;
    }
  }

  return null;
}
