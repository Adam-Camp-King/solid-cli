/**
 * `solid inbox --limit 5` died with "Unknown command: solid inbox 5".
 *
 * The inbox action re-read the REAL process.argv after "inbox" and dropped
 * everything starting with "-", which keeps an option's VALUE and reads it as
 * a subcommand. Same bug audit.ts had until 2.24.5. These tests set
 * process.argv to what a shell really passes and drive commander's own parse
 * through a parent program shaped like src/index.ts.
 */
jest.mock('ora', () => ({
  __esModule: true,
  default: () => ({
    start: jest.fn().mockReturnThis(), stop: jest.fn().mockReturnThis(),
    succeed: jest.fn().mockReturnThis(), fail: jest.fn().mockReturnThis(),
    warn: jest.fn().mockReturnThis(),
  }),
}));
jest.mock('../../lib/api-client', () => ({
  apiClient: { get: jest.fn(), post: jest.fn() },
  handleApiError: jest.fn((e: any) => ({ message: e?.message || 'Error', status: 500 })),
}));
jest.mock('../../lib/config', () => ({
  config: { isLoggedIn: () => true, apiUrl: 'https://api.test', companyId: 3 },
}));

import { apiClient } from '../../lib/api-client';

const mockGet = apiClient.get as jest.Mock;
const realArgv = process.argv;
let exited: number | null;
let exitSpy: jest.SpyInstance;

function buildProgram() {
  const { Command } = require('commander');
  let inbox: any;
  jest.isolateModules(() => { inbox = require('../../commands/inbox').inboxCommand; });
  const program = new Command('solid').exitOverride();
  program.addCommand(inbox);
  (function forbid(c: any) { c.allowExcessArguments(false); c.exitOverride(); c.commands.forEach(forbid); })(program);
  return program;
}

async function runShell(args: string[]) {
  process.argv = ['node', '/usr/local/bin/solid', ...args];
  const program = buildProgram();
  const log = jest.spyOn(console, 'log').mockImplementation(() => {});
  const errW = jest.spyOn(process.stderr, 'write').mockImplementation((() => true) as any);
  try {
    await program.parseAsync(['node', 'solid', ...args]);
  } finally { log.mockRestore(); errW.mockRestore(); }
}

beforeEach(() => {
  mockGet.mockReset();
  exited = null;
  exitSpy = jest.spyOn(process, 'exit').mockImplementation(((c?: number) => {
    exited = c ?? 0;
    throw new Error(`process.exit(${exited})`);
  }) as any);
});
afterEach(() => { process.argv = realArgv; exitSpy.mockRestore(); });

test('inbox --limit 5 (space-separated) reaches the route as limit=5', async () => {
  mockGet.mockResolvedValue({ data: { items: [] } });
  await runShell(['inbox', '--limit', '5']);
  expect(exited).toBeNull();
  expect(mockGet).toHaveBeenCalledWith('/api/v1/communications/inbox', { params: { limit: 5 } });
});

test('inbox --limit=5 still works', async () => {
  mockGet.mockResolvedValue({ data: { items: [] } });
  await runShell(['inbox', '--limit=5']);
  expect(exited).toBeNull();
  expect(mockGet.mock.calls[0][1]).toEqual({ params: { limit: 5 } });
});

test('inbox list --limit 5 is not read as a typo', async () => {
  mockGet.mockResolvedValue({ data: { items: [] } });
  await runShell(['inbox', 'list', '--limit', '5']);
  expect(exited).toBeNull();
  expect(mockGet.mock.calls[0][1]).toEqual({ params: { limit: 5 } });
});

test('a real typo is rejected by commander before any request', async () => {
  await expect(runShell(['inbox', 'bogus'])).rejects.toThrow(/too many arguments|unknown command/i);
  expect(mockGet).not.toHaveBeenCalled();
});

test('no command in src/commands re-scans process.argv for operands', () => {
  const fs = require('fs');
  const path = require('path');
  const dir = path.join(__dirname, '..', '..', 'commands');
  const offenders: string[] = [];
  for (const f of fs.readdirSync(dir)) {
    if (!f.endsWith('.ts')) continue;
    const src: string = fs.readFileSync(path.join(dir, f), 'utf-8');
    // indexOf('<cmd>') / slice() on process.argv is the operand re-scan shape.
    if (/process\.argv\.(indexOf|slice|filter)\(/.test(src)) offenders.push(f);
  }
  expect(offenders).toEqual([]);
});

test('inbox email list --limit 5 sends page_size=5 to the email route', async () => {
  mockGet.mockResolvedValue({ data: { items: [] } });
  await runShell(['inbox', 'email', 'list', '--limit', '5']);
  expect(exited).toBeNull();
  expect(mockGet.mock.calls[0][1].params).toMatchObject({ page_size: 5 });
});
