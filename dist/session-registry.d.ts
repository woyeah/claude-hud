export declare function getSessionRegistryDir(homeDir: string): string;
/**
 * Pulls the session name out of one parsed registry record, but only when the
 * record describes the session we were asked about. Pure so the matching and
 * sanitizing rules can be tested without touching the filesystem.
 */
export declare function extractSessionName(record: unknown, sessionId: string): string | null;
/**
 * Resolves the current session's peer-messaging name, or null when the
 * registry has no record for this id (older Claude Code, or a session kind
 * that is not registered).
 *
 * Records are keyed by pid, not by session id, so the id has to be matched
 * against each record in turn.
 */
export declare function readSessionAddress(sessionId: string | undefined, homeDir?: string): string | null;
//# sourceMappingURL=session-registry.d.ts.map