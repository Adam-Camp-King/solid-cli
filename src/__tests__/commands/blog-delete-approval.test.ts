/**
 * `solid blog delete` against the R3 gate: the backend answers 409 with an
 * approval_url instead of deleting. The command must say a human has to
 * approve and print the link — not "Failed to delete blog post".
 *
 * Behavioural: runs the real commander action with the HTTP call mocked.
 */
import { AxiosError, AxiosHeaders } from 'axios';

const APPROVAL_URL = 'https://app.solidnumber.com/actions/approve/prop_42';

function approval409(): AxiosError {
  const headers = new AxiosHeaders();
  return new AxiosError('Request failed with status code 409', 'ERR_BAD_REQUEST', { headers } as never, {}, {
    status: 409,
    statusText: 'Conflict',
    headers: {},
    config: { headers } as never,
    data: {
      detail: {
        reason: 'approval_required',
        message: 'blog_delete needs the owner to approve.',
        preview_id: 'prop_42',
        approval_url: APPROVAL_URL,
      },
    },
  });
}

jest.mock('../../lib/config', () => {
  const actual = jest.requireActual('../../lib/config');
  return { ...actual, config: Object.assign(Object.create(actual.config), { isLoggedIn: () => true }) };
});

describe('solid blog delete — approval required (409)', () => {
  let stderr: string[];
  let stdout: string[];
  let exitCodes: number[];
  const spies: jest.SpyInstance[] = [];

  beforeEach(() => {
    stderr = [];
    stdout = [];
    exitCodes = [];
    spies.push(
      jest.spyOn(process.stderr, 'write').mockImplementation(((c: string) => { stderr.push(String(c)); return true; }) as never),
      jest.spyOn(process.stdout, 'write').mockImplementation(((c: string) => { stdout.push(String(c)); return true; }) as never),
      jest.spyOn(console, 'error').mockImplementation((...a: unknown[]) => { stderr.push(a.join(' ')); }),
      jest.spyOn(console, 'log').mockImplementation((...a: unknown[]) => { stdout.push(a.join(' ')); }),
      jest.spyOn(process, 'exit').mockImplementation(((code?: number) => {
        exitCodes.push(code ?? 0);
        throw new Error(`__exit_${code}__`);
      }) as never),
    );
  });

  afterEach(() => {
    while (spies.length) spies.pop()!.mockRestore();
    delete process.env.SOLID_JSON;
    jest.resetModules();
  });

  async function runDelete(extra: string[] = []): Promise<void> {
    const { apiClient } = await import('../../lib/api-client');
    jest.spyOn(apiClient, 'delete').mockRejectedValue(approval409());
    const { blogCommand } = await import('../../commands/blog');
    blogCommand.exitOverride();
    await expect(
      blogCommand.parseAsync(['delete', '42', '--yes', ...extra], { from: 'user' }),
    ).rejects.toThrow(/__exit_1__/);
  }

  it('prints the approval link and says a human must approve', async () => {
    await runDelete();
    const err = stderr.join('');
    expect(err).toContain(APPROVAL_URL);
    expect(err).toMatch(/needs a human's approval/);
    expect(err).toMatch(/nothing has been changed/);
    expect(err).not.toMatch(/Failed to delete blog post/);
    expect(exitCodes).toEqual([1]);
  });

  it('--json emits an APPROVAL_REQUIRED envelope carrying approval_url', async () => {
    process.env.SOLID_JSON = '1';
    await runDelete();
    const env = JSON.parse(stdout.join(''));
    expect(env.error.code).toBe('APPROVAL_REQUIRED');
    expect(env.error.approval_url).toBe(APPROVAL_URL);
    expect(env.error.retryable).toBe(false);
  });
});

describe('approvalRequiredLines', () => {
  it('is null for an ordinary failure', async () => {
    const { approvalRequiredLines } = await import('../../lib/command-kit');
    expect(approvalRequiredLines('x', { code: 'NOT_FOUND', status: 404 })).toBeNull();
  });

  it('treats a bare 409 with a link as approval', async () => {
    const { approvalRequiredLines } = await import('../../lib/command-kit');
    const lines = approvalRequiredLines('Deleting blog post #1', { status: 409, approval_url: 'https://a/b' })!;
    expect(lines.join('\n')).toContain('https://a/b');
  });
});
