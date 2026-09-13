import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, mkdir, writeFile, rm } from 'node:fs/promises';
import path from 'node:path';
import { tmpdir } from 'node:os';
import { extractSessionName, readSessionAddress, getSessionRegistryDir } from '../dist/session-registry.js';
import { renderSessionLine } from '../dist/render/session-line.js';
import { renderProjectLine } from '../dist/render/lines/project.js';
import { mergeConfig } from '../dist/config.js';

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
  try {
    if (files) {
      const dir = getSessionRegistryDir(home);
      await mkdir(dir, { recursive: true });
      for (const [name, contents] of Object.entries(files)) {
        await writeFile(path.join(dir, name), contents, 'utf8');
      }
    }
    return await fn(home);
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
    sessionDuration: '',
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
    async (home) => {
      assert.equal(readSessionAddress(SESSION_ID, home), 'demo-4b');
      assert.equal(readSessionAddress('no-such-id', home), null);
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
    async (home) => {
      assert.equal(readSessionAddress(SESSION_ID, home), 'demo-4b');
    },
  );
});

test('readSessionAddress returns null without an id or a registry', async () => {
  await withRegistry(null, async (home) => {
    assert.equal(readSessionAddress(SESSION_ID, home), null);
    assert.equal(readSessionAddress(undefined, home), null);
    assert.equal(readSessionAddress('   ', home), null);
  });
});

test('renderSessionLine shows the address only when enabled', () => {
  const ctx = baseContext();
  assert.ok(renderSessionLine(ctx).includes('🔗 demo-4b'));

  ctx.config.display.showSessionAddress = false;
  assert.ok(!renderSessionLine(ctx).includes('demo-4b'));
});

test('renderProjectLine shows the address only when one was resolved', () => {
  const ctx = baseContext();
  ctx.config.lineLayout = 'expanded';
  assert.ok(renderProjectLine(ctx)?.includes('🔗 demo-4b'));

  ctx.sessionAddress = null;
  assert.ok(!renderProjectLine(ctx)?.includes('🔗'));
});
