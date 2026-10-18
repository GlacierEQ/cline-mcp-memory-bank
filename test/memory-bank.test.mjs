import test from 'node:test';
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { mkdtemp, mkdir, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { StdioClientTransport } from '@modelcontextprotocol/sdk/client/stdio.js';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const serverEntry = path.join(root, 'build', 'index.js');

async function makeProject() {
  const projectPath = await mkdtemp(path.join(tmpdir(), 'memory-bank-test-'));
  await writeFile(
    path.join(projectPath, 'package.json'),
    JSON.stringify({
      name: 'fixture-project',
      version: '1.0.0',
      description: 'Test fixture',
      license: 'MIT',
      dependencies: { express: '^4.19.0' },
      devDependencies: { typescript: '^5.0.0' },
    })
  );
  await mkdir(path.join(projectPath, 'src'), { recursive: true });
  await writeFile(path.join(projectPath, 'src', 'index.ts'), 'export const value = 1;\n');
  // Files in ignored directories must not pollute stack detection.
  await mkdir(path.join(projectPath, 'node_modules', 'ignored'), { recursive: true });
  await writeFile(path.join(projectPath, 'node_modules', 'ignored', 'index.js'), 'ignored\n');
  return projectPath;
}

function runCli(projectPath, extraArgs = []) {
  return spawnSync(
    process.execPath,
    [serverEntry, 'initialize_memory_bank', projectPath, ...extraArgs],
    {
      encoding: 'utf8',
      env: {
        ...process.env,
        CLINE_MCP_SETTINGS_PATH: path.join(projectPath, 'cline_mcp_settings.json'),
      },
    }
  );
}

async function connectClient(projectPath) {
  const env = Object.fromEntries(
    Object.entries({
      ...process.env,
      PROJECT_PATH: projectPath,
      CLINE_MCP_SETTINGS_PATH: path.join(projectPath, 'cline_mcp_settings.json'),
    }).filter(([, value]) => value !== undefined)
  );

  const transport = new StdioClientTransport({
    command: process.execPath,
    args: [serverEntry],
    env,
    stderr: 'pipe',
  });
  const client = new Client({ name: 'memory-bank-tests', version: '1.0.0' });
  await client.connect(transport);
  return client;
}

test('CLI initialization creates the memory bank without scanning node_modules', async (t) => {
  const projectPath = await makeProject();
  t.after(() => rm(projectPath, { recursive: true, force: true }));

  const result = runCli(projectPath);
  assert.equal(result.status, 0, result.stderr);
  assert.match(result.stdout, /Created: .*projectContext\.md/);

  const memoryBankPath = path.join(projectPath, 'memory-bank');
  const expectedFiles = ['projectContext.md', 'activeContext.md', 'progress.md', 'decisionLog.md'];
  for (const fileName of expectedFiles) {
    const content = await readFile(path.join(memoryBankPath, fileName), 'utf8');
    assert.ok(content.length > 0, `${fileName} should not be empty`);
  }

  const projectContext = await readFile(path.join(memoryBankPath, 'projectContext.md'), 'utf8');
  assert.match(projectContext, /fixture-project/);
  assert.match(projectContext, /Languages: TypeScript/);
  assert.doesNotMatch(projectContext, /JavaScript/);
  assert.match(projectContext, /Frameworks: Express/);
  assert.doesNotMatch(projectContext, /ignored/);

  const settings = JSON.parse(
    await readFile(path.join(projectPath, 'cline_mcp_settings.json'), 'utf8')
  );
  assert.equal(settings.mcpServers['memory-bank'].args[0], serverEntry);
  assert.equal(settings.mcpServers['memory-bank'].env.PROJECT_PATH, projectPath);
  assert.equal(settings.mcpServers['memory-bank'].disabled, false);
});

test('initialization preserves unrelated MCP settings and user options', async (t) => {
  const projectPath = await makeProject();
  t.after(() => rm(projectPath, { recursive: true, force: true }));

  const settingsPath = path.join(projectPath, 'cline_mcp_settings.json');
  await writeFile(
    settingsPath,
    JSON.stringify({
      mcpServers: {
        other: { command: 'node', args: ['other.js'], disabled: true },
        'memory-bank': {
          command: 'old-node',
          args: ['old.js'],
          env: { KEEP: 'yes' },
          autoApprove: ['update_context'],
        },
      },
    }),
    'utf8'
  );

  const result = runCli(projectPath);
  assert.equal(result.status, 0, result.stderr);

  const settings = JSON.parse(await readFile(settingsPath, 'utf8'));
  assert.deepEqual(settings.mcpServers.other, {
    command: 'node',
    args: ['other.js'],
    disabled: true,
  });
  assert.equal(settings.mcpServers['memory-bank'].command, process.execPath);
  assert.deepEqual(settings.mcpServers['memory-bank'].args, [serverEntry]);
  assert.equal(settings.mcpServers['memory-bank'].env.KEEP, 'yes');
  assert.equal(settings.mcpServers['memory-bank'].env.PROJECT_PATH, projectPath);
  assert.deepEqual(settings.mcpServers['memory-bank'].autoApprove, ['update_context']);
});


test('re-initialization preserves existing memory bank files unless forced', async (t) => {
  const projectPath = await makeProject();
  t.after(() => rm(projectPath, { recursive: true, force: true }));

  assert.equal(runCli(projectPath).status, 0);

  const activeContextPath = path.join(projectPath, 'memory-bank', 'activeContext.md');
  await writeFile(activeContextPath, 'CUSTOM CONTENT\n', 'utf8');

  const preserved = runCli(projectPath);
  assert.equal(preserved.status, 0, preserved.stderr);
  assert.match(preserved.stdout, /Preserved: .*activeContext\.md/);
  assert.equal(await readFile(activeContextPath, 'utf8'), 'CUSTOM CONTENT\n');

  const forced = runCli(projectPath, ['--force']);
  assert.equal(forced.status, 0, forced.stderr);
  assert.match(forced.stdout, /Created: .*activeContext\.md/);
  assert.match(await readFile(activeContextPath, 'utf8'), /# Active Context/);
});

test('CLI resolves relative project paths and rejects missing directories', async (t) => {
  const projectPath = await makeProject();
  t.after(() => rm(projectPath, { recursive: true, force: true }));

  const result = spawnSync(
    process.execPath,
    [serverEntry, 'initialize_memory_bank', path.basename(projectPath)],
    {
      cwd: path.dirname(projectPath),
      encoding: 'utf8',
      env: {
        ...process.env,
        CLINE_MCP_SETTINGS_PATH: path.join(projectPath, 'cline_mcp_settings.json'),
      },
    }
  );
  assert.equal(result.status, 0, result.stderr);
  assert.ok((await readFile(path.join(projectPath, 'memory-bank', 'progress.md'), 'utf8')).length > 0);

  const missing = runCli(path.join(projectPath, 'does-not-exist'));
  assert.equal(missing.status, 1);
  assert.match(missing.stderr, /Project path does not exist/);
});

test('MCP tools update context, decisions, and progress', async (t) => {
  const projectPath = await makeProject();
  const client = await connectClient(projectPath);
  t.after(async () => {
    await client.close();
    await rm(projectPath, { recursive: true, force: true });
  });

  const { tools } = await client.listTools();
  assert.deepEqual(
    tools.map(tool => tool.name).sort(),
    ['initialize_memory_bank', 'record_decision', 'track_progress', 'update_context']
  );

  const initialized = await client.callTool({
    name: 'initialize_memory_bank',
    arguments: { projectPath },
  });
  assert.match(initialized.content[0].text, /Memory Bank initialized/);

  await client.callTool({
    name: 'update_context',
    arguments: {
      projectPath,
      content: {
        currentSession: { date: '2026-01-02', mode: 'Engineering', task: 'Audit the server' },
      },
    },
  });

  await client.callTool({
    name: 'record_decision',
    arguments: {
      projectPath,
      decision: {
        title: 'Draft caching layer',
        description: 'Consider adding a caching layer',
        rationale: 'Reduce repeated reads',
        status: 'proposed',
      },
    },
  });

  await client.callTool({
    name: 'record_decision',
    arguments: {
      projectPath,
      decision: {
        title: 'Adopt MCP SDK',
        description: 'Use the official MCP TypeScript SDK',
        rationale: 'Maintained protocol implementation',
        status: 'accepted',
        alternatives: ['Custom JSON-RPC implementation'],
      },
    },
  });

  await client.callTool({
    name: 'track_progress',
    arguments: {
      projectPath,
      progress: {
        phase: 'Testing',
        completed: ['Write tests'],
        inProgress: ['Audit the server'],
        blocked: ['Blocked dependency'],
      },
    },
  });

  const active = await client.readResource({ uri: 'memory://active/context' });
  assert.match(active.contents[0].text, /Session Update \(2026-01-02\)/);
  assert.match(active.contents[0].text, /Mode: Engineering/);
  assert.match(active.contents[0].text, /Task: Audit the server/);

  const decisions = await client.readResource({ uri: 'memory://decisions' });
  const decisionText = decisions.contents[0].text;
  const pendingIndex = decisionText.indexOf('## Pending Decisions');
  const technicalIndex = decisionText.indexOf('## Technical Decisions');
  const draftIndex = decisionText.indexOf('### Draft caching layer');
  const adoptedIndex = decisionText.indexOf('### Adopt MCP SDK');
  assert.ok(pendingIndex !== -1 && technicalIndex !== -1);
  assert.ok(draftIndex > pendingIndex, 'proposed decisions must be in the pending section');
  assert.ok(adoptedIndex > technicalIndex, 'accepted decisions must be in the technical section');
  assert.ok(adoptedIndex < pendingIndex, 'accepted decisions must not be appended to the pending section');

  const progress = await client.readResource({ uri: 'memory://progress' });
  const progressText = progress.contents[0].text;
  assert.match(progressText, /Phase: Testing/);
  assert.match(progressText, /- ✓ Write tests/);
  assert.match(progressText, /- → Audit the server/);
  assert.match(progressText, /- ⚠ Blocked dependency/);

  const project = await client.readResource({ uri: 'memory://project/context' });
  assert.match(project.contents[0].text, /fixture-project/);
});

test('MCP tools report a helpful error before initialization', async (t) => {
  const projectPath = await makeProject();
  const client = await connectClient(projectPath);
  t.after(async () => {
    await client.close();
    await rm(projectPath, { recursive: true, force: true });
  });

  await assert.rejects(
    () => client.callTool({
      name: 'update_context',
      arguments: {
        projectPath,
        content: { currentSession: { mode: 'Development', task: 'No memory bank' } },
      },
    }),
    /Memory Bank is not initialized/
  );

  await assert.rejects(
    () => client.callTool({
      name: 'record_decision',
      arguments: {
        projectPath,
        decision: {
          title: 'Invalid',
          description: 'Missing rationale is rejected',
          status: 'accepted',
        },
      },
    }),
    /decision\.rationale/
  );
});

