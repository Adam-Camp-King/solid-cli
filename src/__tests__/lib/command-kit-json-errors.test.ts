/**
 * command-kit error emission (Sprint 1 — T1.1).
 *
 * Verifies the catch-path in run() routes errors correctly based on
 *   isJsonOutput() × jsonErrorEnvelopeEnabled():
 *     * envelope to stdout under --json + SOLID_JSON_V2=1
 *     * prose to stderr otherwise (legacy behavior, preserved)
 * Exit code is always non-zero.
 */

// Mock config so requireAuth() passes through.
jest.mock('../../lib/config', () => ({
  config: { isLoggedIn: () => true },
}));

// Mock json-output so we can flip isJsonOutput per test.
jest.mock('../../lib/json-output', () => ({
  isJsonOutput: jest.fn(() => false),
  setProgramJson: jest.fn(),
  activateProgramJsonIfRequested: jest.fn(),
  emitJson: jest.fn(),
  mergeGlobalJson: (o: unknown) => o,
}));

import { run } from '../../lib/command-kit';
// eslint-disable-next-line @typescript-eslint/no-var-requires
const jsonOutput = require('../../lib/json-output');

function axiosLikeError(status: number, data: unknown, headers: Record<string, string> = {}) {
  return Object.assign(new Error('axios'), {
    isAxiosError: true,
    response: { status, data, headers },
    config: { method: 'GET', url: '/api/v1/leads' },
  });
}

describe('command-kit — JSON error envelope', () => {
  const originalV2 = process.env.SOLID_JSON_V2;
  let exitSpy: jest.SpyInstance;
  let stdoutSpy: jest.SpyInstance;
  let errSpy: jest.SpyInstance;

  beforeEach(() => {
    (jsonOutput.isJsonOutput as jest.Mock).mockReturnValue(false);
    delete process.env.SOLID_JSON_V2;

    exitSpy = jest.spyOn(process, 'exit').mockImplementation((code?: number | string | null) => {
      throw new Error(`EXIT:${code}`);
    }) as unknown as jest.SpyInstance;
    stdoutSpy = jest.spyOn(process.stdout, 'write').mockImplementation(() => true);
    errSpy = jest.spyOn(console, 'error').mockImplementation(() => {});
  });

  afterEach(() => {
    exitSpy.mockRestore();
    stdoutSpy.mockRestore();
    errSpy.mockRestore();
    if (originalV2 === undefined) delete process.env.SOLID_JSON_V2;
    else process.env.SOLID_JSON_V2 = originalV2;
  });

  it('prose to stderr by default (no --json, no V2)', async () => {
    await expect(
      run(async () => { throw axiosLikeError(404, { detail: 'Not found' }); }, { spinner: null }),
    ).rejects.toThrow('EXIT:1');

    expect(stdoutSpy).not.toHaveBeenCalled();
    expect(errSpy).toHaveBeenCalled();
  });

  it('prose to stderr when --json is on AND SOLID_LEGACY_ERRORS=1 (opt-out)', async () => {
    // v2.0.0 flipped the default — JSON envelopes are now default-on
    // when --json is set. SOLID_LEGACY_ERRORS=1 is the opt-out for
    // scripts that still want the legacy prose-style error output.
    (jsonOutput.isJsonOutput as jest.Mock).mockReturnValue(true);
    process.env.SOLID_LEGACY_ERRORS = '1';

    await expect(
      run(async () => { throw axiosLikeError(404, { detail: 'Not found' }); }, { spinner: null }),
    ).rejects.toThrow('EXIT:1');

    expect(stdoutSpy).not.toHaveBeenCalled();
    expect(errSpy).toHaveBeenCalled();

    delete process.env.SOLID_LEGACY_ERRORS;
  });

  it('JSON envelope to stdout when --json (default, no flag needed in v2)', async () => {
    (jsonOutput.isJsonOutput as jest.Mock).mockReturnValue(true);
    process.env.SOLID_JSON_V2 = '1';

    await expect(
      run(async () => { throw axiosLikeError(404, { detail: 'Not found' }); }, { spinner: null }),
    ).rejects.toThrow('EXIT:1');

    expect(stdoutSpy).toHaveBeenCalledTimes(1);
    const written = stdoutSpy.mock.calls[0][0] as string;
    const parsed = JSON.parse(written);
    expect(parsed.error.code).toBe('NOT_FOUND');
    expect(parsed.error.status).toBe(404);
    expect(typeof parsed.error.message).toBe('string');
  });

  it('JSON envelope includes scope for SCOPE_MISSING 403s', async () => {
    (jsonOutput.isJsonOutput as jest.Mock).mockReturnValue(true);
    process.env.SOLID_JSON_V2 = '1';

    await expect(
      run(
        async () => {
          throw axiosLikeError(403, { detail: 'Missing scope: agents:read' });
        },
        { spinner: null },
      ),
    ).rejects.toThrow('EXIT:1');

    const parsed = JSON.parse(stdoutSpy.mock.calls[0][0] as string);
    expect(parsed.error.code).toBe('SCOPE_MISSING');
    expect(parsed.error.scope).toBe('agents:read');
    expect(parsed.error.status).toBe(403);
  });

  it('JSON envelope includes feature/upgrade for FEATURE_GATED', async () => {
    (jsonOutput.isJsonOutput as jest.Mock).mockReturnValue(true);
    process.env.SOLID_JSON_V2 = '1';

    await expect(
      run(
        async () => {
          throw axiosLikeError(403, {
            code: 'FEATURE_GATED',
            feature: 'agents',
            upgrade_to: 'professional',
          });
        },
        { spinner: null },
      ),
    ).rejects.toThrow('EXIT:1');

    const parsed = JSON.parse(stdoutSpy.mock.calls[0][0] as string);
    expect(parsed.error.code).toBe('FEATURE_GATED');
    expect(parsed.error.feature).toBe('agents');
    expect(parsed.error.upgrade_to).toBe('professional');
  });

  it('JSON envelope surfaces backend RATE_LIMITED shape verbatim', async () => {
    (jsonOutput.isJsonOutput as jest.Mock).mockReturnValue(true);
    process.env.SOLID_JSON_V2 = '1';

    await expect(
      run(
        async () => {
          throw axiosLikeError(429, {
            error: {
              code: 'RATE_LIMITED',
              limit: 300,
              window_s: 60,
              retry_after_s: 42,
            },
          });
        },
        { spinner: null },
      ),
    ).rejects.toThrow('EXIT:1');

    const parsed = JSON.parse(stdoutSpy.mock.calls[0][0] as string);
    expect(parsed.error.code).toBe('RATE_LIMITED');
    expect(parsed.error.status).toBe(429);
  });

  it('JSON envelope carries request_id when header is present', async () => {
    (jsonOutput.isJsonOutput as jest.Mock).mockReturnValue(true);
    process.env.SOLID_JSON_V2 = '1';

    await expect(
      run(
        async () => {
          throw axiosLikeError(500, { detail: 'oops' }, { 'x-request-id': 'abc123' });
        },
        { spinner: null },
      ),
    ).rejects.toThrow('EXIT:1');

    const parsed = JSON.parse(stdoutSpy.mock.calls[0][0] as string);
    expect(parsed.error.request_id).toBe('abc123');
  });

  it('exit code is always non-zero even under V2', async () => {
    (jsonOutput.isJsonOutput as jest.Mock).mockReturnValue(true);
    process.env.SOLID_JSON_V2 = '1';

    await expect(
      run(async () => { throw axiosLikeError(500, {}); }, { spinner: null }),
    ).rejects.toThrow('EXIT:1');

    expect(exitSpy).toHaveBeenCalledWith(1);
  });
});
