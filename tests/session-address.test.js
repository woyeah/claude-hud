import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, mkdir, writeFile, rm } from 'node:fs/promises';
import path from 'node:path';
import { tmpdir } from 'node:os';
import { extractSessionName, readSessionAddress } from '../src/session-registry.ts';
import { renderLines } from '../src/render/index.ts';
import { stripAnsi } from '../src/render/ansi.ts';
import { mergeConfig } from '../src/config.ts';

const SESSION_ID = '915ab155-6dd5-4092-8879-8eaf46ccd118';

function record(overrides = {}) {
  return {
    pid: 13564,
    sessionId: SESSION_ID,
    cwd: 'D:\projects\demo',
    kind: 'interactive',
    name: 'demo-4b',
    nameSource: 'derived',
    status: 'busy',
    ...overrides,
  };
}

async function withRegistry(files, fn) {
  const home = await mkdtemp(path.join(tmpdir(), 'hud-sessions-'));
  const dir = path.join(home, 'sessions');
  try {
    if (files) {
      await mkdir(dir, { recursive: true });
      for (const [name, contents] of Object.entries(files)) {
        await writeFile(path.join(dir, name), contents, 'utf8');
      }
    }
    return await fn(dir);
  } finally {
    await rm(home, { recursive: true, force: true });
  }
}

function baseContext() {
  return {
    stdin: { cwd: '/tmp/demo', model: { display_name: 'Opus' }, session_id: SESSION_ID },
    transcript: { tools: [], skills: [], mcpServers: [], agents: [], todos: [] },
    claudeMdCount: 0,
    rulesCount: 0,
    mcpCount: 0,
    hooksCount: 0,
    costTotals: null,
    outputSpeed: null,
    gitStatus: null,
    usageData: null,
    memoryUsage: null,
    config: mergeConfig({ display: { showSessionAddress: true } }),
    extraLabel: null,
    sessionAddress: 'demo-4b',
  };
}

test('extractSessionName returns the name only for the matching session id', () => {
  assert.equal(extractSessionName(record(), SESSION_ID), 'demo-4b');
  assert.equal(extractSessionName(record({ sessionId: 'other-id' }), SESSION_ID), null);
});

test('extractSessionName rejects records without a usable name', () => {
  assert.equal(extractSessionName(record({ name: undefined }), SESSION_ID), null);
  assert.equal(extractSessionName(record({ name: '   ' }), SESSION_ID), null);
  assert.equal(extractSessionName(record({ name: 42 }), SESSION_ID), null);
  assert.equal(extractSessionName(null, SESSION_ID), null);
  assert.equal(extractSessionName('demo-4b', SESSION_ID), null);
});

test('extractSessionName strips escapes and bounds the length', () => {
  const sneaky = extractSessionName(record({ name: '\u001b[31mred\u001b[0m' }), SESSION_ID);
  assert.equal(sneaky, 'red');
  const long = extractSessionName(record({ name: 'x'.repeat(200) }), SESSION_ID);
  assert.equal(long.length, 64);
});

test('readSessionAddress finds this session among several records', async () => {
  await withRegistry(
    {
      '111.json': JSON.stringify(record({ pid: 111, sessionId: 'aaa', name: 'demo-fb' })),
      '13564.json': JSON.stringify(record()),
      '222.json': JSON.stringify(record({ pid: 222, sessionId: 'bbb', name: 'demo-4d' })),
    },
    async (dir) => {
      assert.equal(readSessionAddress(SESSION_ID, dir), 'demo-4b');
      assert.equal(readSessionAddress('no-such-id', dir), null);
    },
  );
});

test('readSessionAddress survives malformed and non-JSON entries', async () => {
  await withRegistry(
    {
      'broken.json': '{ not json',
      'empty.json': '',
      'notes.txt': JSON.stringify(record({ name: 'ignored-non-json-file' })),
      '13564.json': JSON.stringify(record()),
    },
    async (dir) => {
      assert.equal(readSessionAddress(SESSION_ID, dir), 'demo-4b');
    },
  );
});

test('readSessionAddress returns null without an id or a registry', async () => {
  await withRegistry(null, async (dir) => {
    assert.equal(readSessionAddress(SESSION_ID, dir), null);
    assert.equal(readSessionAddress(undefined, dir), null);
    assert.equal(readSessionAddress('   ', dir), null);
  });
});

const NOW = new Date(2026, 9, 1, 12, 0).getTime();
const text = (ctx) => renderLines(ctx, null, NOW).map(stripAnsi).join(' | ');

test('readSessionAddress returns null without a registry directory', () => {
  assert.equal(readSessionAddress(SESSION_ID, undefined), null);
  assert.equal(readSessionAddress(SESSION_ID, null), null);
});

for (const lineLayout of ['expanded', 'compact']) {
  test(`${lineLayout} layout shows the address only when enabled`, () => {
    const ctx = baseContext();
    ctx.config.lineLayout = lineLayout;
    assert.ok(text(ctx).includes('🔗 demo-4b'));

    ctx.config.display.showSessionAddress = false;
    assert.ok(!text(ctx).includes('demo-4b'));
  });

  test(`${lineLayout} layout hides the address when none was resolved`, () => {
    const ctx = baseContext();
    ctx.config.lineLayout = lineLayout;
    ctx.sessionAddress = null;
    assert.ok(!text(ctx).includes('🔗'));
  });
}

// The real path: hud.mjs runs logic caged, so the registry must be among its read grants.
test('the CLI shows the address through the cage', async () => {
  const { spawnSync } = await import('node:child_process');
  const { fileURLToPath } = await import('node:url');
  const home = await mkdtemp(path.join(tmpdir(), 'hud-sessions-cli-'));
  try {
    const configDir = path.join(home, '.claude');
    await mkdir(path.join(configDir, 'sessions'), { recursive: true });
    await mkdir(path.join(configDir, 'plugins', 'claude-hud'), { recursive: true });
    await writeFile(path.join(configDir, 'sessions', '13564.json'), JSON.stringify(record()), 'utf8');
    await writeFile(path.join(configDir, 'plugins', 'claude-hud', 'config.json'), JSON.stringify({ display: { showSessionAddress: true } }), 'utf8');
    const result = spawnSync(process.execPath, [fileURLToPath(new URL('../hud.mjs', import.meta.url))], {
      input: JSON.stringify({ model: { display_name: 'Opus' }, cwd: home, session_id: SESSION_ID }),
      encoding: 'utf8',
      env: { PATH: process.env.PATH, SystemRoot: process.env.SystemRoot, HOME: home, USERPROFILE: home, CLAUDE_CONFIG_DIR: configDir, COLUMNS: '120' },
    });
    assert.equal(result.status, 0, result.stderr);
    assert.ok(stripAnsi(result.stdout).includes('🔗 demo-4b'), result.stdout);
  } finally {
    await rm(home, { recursive: true, force: true });
  }
});
