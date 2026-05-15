/**
 * `solid webmcp ...` command tests.
 *
 * Pins the wire contract every subcommand promises:
 *   - manifest GETs /api/v1/webmcp/manifest?surface=<surface>.
 *   - test POSTs /api/v1/webmcp/execute/<tool> with the right body.
 *   - --confirm pre-grants once-consent before invoking write tools.
 *   - invocations GETs /api/v1/webmcp/invocations with filters.
 *   - consent list/grant/revoke route to the right URLs and methods.
 *   - Login gate exits 1 when not authenticated.
 *
 * Mocks apiClient + config — no real network, deterministic output.
 */

// Mock the ESM-only `ora` spinner so jest's CJS transform can load the
// command module. Matches the pattern in src/__tests__/commands/context.test.ts.
jest.mock('ora', () => ({
  __esModule: true,
  default: () => ({
    start: jest.fn().mockReturnThis(),
    stop: jest.fn().mockReturnThis(),
    succeed: jest.fn().mockReturnThis(),
    fail: jest.fn().mockReturnThis(),
  }),
}));

// Mock handleApiError to RETURN an ApiError-shaped object (matching the
// real api-client behavior — handleApiError is NOT a throw helper). This
// is the fix for the bug uncovered in smoke-testing 2026-05-15: the
// command's catch block depends on the returned `.message` to print +
// exit. A throwing mock silently swallowed the test for that path.
jest.mock('../../lib/api-client', () => ({
  apiClient: {
    get: jest.fn(),
    post: jest.fn(),
    delete: jest.fn(),
  },
  handleApiError: jest.fn((e: unknown) => ({
    message: (e as { message?: string })?.message ?? 'mock api error',
    status: (e as { status?: number })?.status ?? 500,
  })),
}));

jest.mock('../../lib/config', () => ({
  config: {
    isLoggedIn: jest.fn().mockReturnValue(true),
  },
}));

jest.mock('../../lib/json-output', () => ({
  isJsonOutput: jest.fn().mockReturnValue(true),
  activateProgramJsonIfRequested: jest.fn(),
}));

import { apiClient } from '../../lib/api-client';
import { config } from '../../lib/config';
import { webmcpCommand } from '../../commands/webmcp';


const mockGet = apiClient.get as jest.Mock;
const mockPost = apiClient.post as jest.Mock;
const mockDelete = apiClient.delete as jest.Mock;
const mockIsLoggedIn = config.isLoggedIn as jest.Mock;


async function runArgs(args: string[]): Promise<void> {
  // commander's parseAsync runs the matching subcommand.
  await webmcpCommand.parseAsync(args, { from: 'user' });
}


function silenceStdoutErr(): { restore: () => void; out: string[]; err: string[] } {
  const origLog = console.log;
  const origErr = console.error;
  const out: string[] = [];
  const err: string[] = [];
  console.log = (...a: unknown[]) => out.push(a.map((x) => (typeof x === 'string' ? x : JSON.stringify(x))).join(' '));
  console.error = (...a: unknown[]) => err.push(a.map((x) => (typeof x === 'string' ? x : JSON.stringify(x))).join(' '));
  return {
    restore: () => {
      console.log = origLog;
      console.error = origErr;
    },
    out,
    err,
  };
}


beforeEach(() => {
  mockGet.mockReset();
  mockPost.mockReset();
  mockDelete.mockReset();
  mockIsLoggedIn.mockReset().mockReturnValue(true);
});


// ── manifest ──────────────────────────────────────────────────────────────

describe('solid webmcp manifest', () => {
  it('GETs the manifest URL with the default surface=dashboard', async () => {
    mockGet.mockResolvedValue({ data: { tools: [], count: 0, surface: 'dashboard', tier: 'starter', company_id: 1 } });
    const sink = silenceStdoutErr();
    try {
      await runArgs(['manifest']);
      expect(mockGet).toHaveBeenCalledWith('/api/v1/webmcp/manifest?surface=dashboard');
    } finally {
      sink.restore();
    }
  });

  it('passes --surface through to the URL', async () => {
    mockGet.mockResolvedValue({ data: { tools: [], count: 0, surface: 'developer', tier: 'starter', company_id: 1 } });
    const sink = silenceStdoutErr();
    try {
      await runArgs(['manifest', '--surface', 'developer']);
      expect(mockGet).toHaveBeenCalledWith('/api/v1/webmcp/manifest?surface=developer');
    } finally {
      sink.restore();
    }
  });

  it('rejects an unknown --surface with exit 2', async () => {
    const exitSpy = jest.spyOn(process, 'exit').mockImplementation(((code?: number) => {
      throw new Error(`exit:${code}`);
    }) as never);
    const sink = silenceStdoutErr();
    try {
      await expect(runArgs(['manifest', '--surface', 'rogue'])).rejects.toThrow('exit:2');
      expect(mockGet).not.toHaveBeenCalled();
    } finally {
      sink.restore();
      exitSpy.mockRestore();
    }
  });
});


// ── test ──────────────────────────────────────────────────────────────────

describe('solid webmcp test', () => {
  it('POSTs to /execute/<tool> with empty input by default', async () => {
    mockPost.mockResolvedValue({ data: { tool: 'list_sites', result: { items: [] }, latency_ms: 12 } });
    const sink = silenceStdoutErr();
    try {
      await runArgs(['test', 'list_sites']);
      expect(mockPost).toHaveBeenCalledWith('/api/v1/webmcp/execute/list_sites', {
        input: {},
        surface: 'cli',
      });
    } finally {
      sink.restore();
    }
  });

  it('parses --input inline JSON', async () => {
    mockPost.mockResolvedValue({ data: { result: 'ok', latency_ms: 8 } });
    const sink = silenceStdoutErr();
    try {
      await runArgs(['test', 'list_sites', '--input', '{"q":"hello"}']);
      expect(mockPost.mock.calls[0][1].input).toEqual({ q: 'hello' });
    } finally {
      sink.restore();
    }
  });

  it('pre-grants once-consent when --confirm is supplied', async () => {
    mockPost.mockResolvedValueOnce({ data: { id: 'g-1' } });           // consent grant
    mockPost.mockResolvedValueOnce({ data: { result: 'ok', latency_ms: 5 } }); // execute
    const sink = silenceStdoutErr();
    try {
      await runArgs(['test', 'send_email_to_contact', '--confirm']);
      expect(mockPost.mock.calls[0]).toEqual([
        '/api/v1/webmcp/consent',
        { tool_name: 'send_email_to_contact', scope: 'once' },
      ]);
      expect(mockPost.mock.calls[1][0]).toBe('/api/v1/webmcp/execute/send_email_to_contact');
    } finally {
      sink.restore();
    }
  });
});


// ── invocations ───────────────────────────────────────────────────────────

describe('solid webmcp invocations', () => {
  it('GETs /invocations with default limit', async () => {
    mockGet.mockResolvedValue({ data: { items: [], count: 0 } });
    const sink = silenceStdoutErr();
    try {
      await runArgs(['invocations']);
      expect(mockGet.mock.calls[0][0]).toContain('/api/v1/webmcp/invocations?');
      expect(mockGet.mock.calls[0][0]).toContain('limit=50');
    } finally {
      sink.restore();
    }
  });

  it('passes --tool and --status filters into the URL', async () => {
    mockGet.mockResolvedValue({ data: { items: [], count: 0 } });
    const sink = silenceStdoutErr();
    try {
      await runArgs(['invocations', '--tool', 'list_sites', '--status', 'success', '--limit', '10']);
      const url = mockGet.mock.calls[0][0];
      expect(url).toContain('limit=10');
      expect(url).toContain('tool=list_sites');
      expect(url).toContain('status=success');
    } finally {
      sink.restore();
    }
  });

  // NOTE: Commander persists option state across parseAsync calls on the
  // same Command instance. Tests that set --status to a known-good value
  // run BEFORE the test that sets --status to a bad value, so we don't
  // poison subsequent tests with stale `halfway` state.
  it('clamps --limit to 500 max', async () => {
    mockGet.mockResolvedValue({ data: { items: [], count: 0 } });
    const sink = silenceStdoutErr();
    try {
      // Pass --status success explicitly to override any state carried
      // over from earlier tests in the same instance.
      await runArgs(['invocations', '--limit', '99999', '--status', 'success']);
      expect(mockGet.mock.calls[0][0]).toContain('limit=500');
    } finally {
      sink.restore();
    }
  });

  it('rejects an unknown --status', async () => {
    const exitSpy = jest.spyOn(process, 'exit').mockImplementation(((code?: number) => {
      throw new Error(`exit:${code}`);
    }) as never);
    const sink = silenceStdoutErr();
    try {
      await expect(runArgs(['invocations', '--status', 'halfway'])).rejects.toThrow('exit:2');
    } finally {
      sink.restore();
      exitSpy.mockRestore();
    }
  });
});


// ── consent ───────────────────────────────────────────────────────────────

describe('solid webmcp consent', () => {
  it('list GETs /consent', async () => {
    mockGet.mockResolvedValue({ data: { items: [], count: 0 } });
    const sink = silenceStdoutErr();
    try {
      await runArgs(['consent', 'list']);
      expect(mockGet).toHaveBeenCalledWith('/api/v1/webmcp/consent');
    } finally {
      sink.restore();
    }
  });

  it('grant POSTs to /consent with tool_name + scope', async () => {
    mockPost.mockResolvedValue({ data: { id: 'd-1', tool_name: 'send_email_to_contact', scope: 'session' } });
    const sink = silenceStdoutErr();
    try {
      await runArgs(['consent', 'grant', 'send_email_to_contact', '--scope', 'session']);
      expect(mockPost).toHaveBeenCalledWith('/api/v1/webmcp/consent', {
        tool_name: 'send_email_to_contact',
        scope: 'session',
      });
    } finally {
      sink.restore();
    }
  });

  it('grant rejects an unknown --scope', async () => {
    const exitSpy = jest.spyOn(process, 'exit').mockImplementation(((code?: number) => {
      throw new Error(`exit:${code}`);
    }) as never);
    const sink = silenceStdoutErr();
    try {
      await expect(
        runArgs(['consent', 'grant', 'x', '--scope', 'forever']),
      ).rejects.toThrow('exit:2');
    } finally {
      sink.restore();
      exitSpy.mockRestore();
    }
  });

  it('revoke DELETEs /consent/<id>', async () => {
    mockDelete.mockResolvedValue(undefined);
    const sink = silenceStdoutErr();
    try {
      await runArgs(['consent', 'revoke', 'abc-123']);
      expect(mockDelete).toHaveBeenCalledWith('/api/v1/webmcp/consent/abc-123');
    } finally {
      sink.restore();
    }
  });
});


// ── login gate ────────────────────────────────────────────────────────────

describe('login gate', () => {
  it('exits 1 when not logged in', async () => {
    mockIsLoggedIn.mockReturnValue(false);
    const exitSpy = jest.spyOn(process, 'exit').mockImplementation(((code?: number) => {
      throw new Error(`exit:${code}`);
    }) as never);
    const sink = silenceStdoutErr();
    try {
      await expect(runArgs(['manifest'])).rejects.toThrow('exit:1');
      expect(mockGet).not.toHaveBeenCalled();
    } finally {
      sink.restore();
      exitSpy.mockRestore();
    }
  });
});


// ── error-path: backend errors must print + exit 1 ─────────────────────────
//
// REGRESSION GUARDS for the Phase 8 smoke-test bug (2026-05-15): every
// subcommand's catch block must call handleApiError, print the returned
// .message to stderr, and exit(1). The original Phase 8 commit shipped
// without these tests — handleApiError's return value was discarded so
// errors landed silently with exit 0. These tests pin the contract.

describe('error path — every subcommand surfaces backend errors', () => {
  function setupExitSpy() {
    return jest.spyOn(process, 'exit').mockImplementation(((code?: number) => {
      throw new Error(`exit:${code}`);
    }) as never);
  }

  it('manifest: 401 prints stderr + exits 1', async () => {
    mockGet.mockRejectedValue(Object.assign(new Error('Not authenticated'), { status: 401 }));
    const exitSpy = setupExitSpy();
    const sink = silenceStdoutErr();
    try {
      // Commander persists option state across parseAsync on the same
      // Command instance. The earlier "rejects an unknown --surface"
      // test leaves --surface set to 'rogue', which would short-circuit
      // this test with exit 2 before hitting the mock. Pass an explicit
      // valid surface to override that polluted state.
      await expect(runArgs(['manifest', '--surface', 'dashboard'])).rejects.toThrow('exit:1');
      // Stderr carries the error; stdout stays silent (no success JSON leak).
      expect(sink.err.join(' ')).toMatch(/Not authenticated/i);
      expect(sink.out.join(' ')).not.toMatch(/Not authenticated/i);
    } finally {
      sink.restore();
      exitSpy.mockRestore();
    }
  });

  it('test: handler error prints stderr + exits 1', async () => {
    mockPost.mockRejectedValue(Object.assign(new Error('handler exploded'), { status: 500 }));
    const exitSpy = setupExitSpy();
    const sink = silenceStdoutErr();
    try {
      await expect(runArgs(['test', 'list_sites'])).rejects.toThrow('exit:1');
      expect(sink.err.join(' ')).toMatch(/handler exploded/);
    } finally {
      sink.restore();
      exitSpy.mockRestore();
    }
  });

  it('test --confirm: failed pre-grant prints stderr + exits 1 (no execute call)', async () => {
    // The --confirm pre-grant POSTs to /consent. If that fails, we must
    // bail out before invoking /execute. Previously this catch swallowed
    // the error and continued — now it should print + exit 1.
    mockPost.mockReset();
    mockPost.mockRejectedValueOnce(Object.assign(new Error('grant failed'), { status: 403 }));
    const exitSpy = setupExitSpy();
    const sink = silenceStdoutErr();
    try {
      await expect(
        runArgs(['test', 'send_email_to_contact', '--confirm']),
      ).rejects.toThrow('exit:1');
      expect(sink.err.join(' ')).toMatch(/grant failed/);
      // Only one POST attempt (the failed grant). No /execute follow-up.
      expect(mockPost).toHaveBeenCalledTimes(1);
      expect(mockPost.mock.calls[0][0]).toBe('/api/v1/webmcp/consent');
    } finally {
      sink.restore();
      exitSpy.mockRestore();
    }
  });

  it('invocations: network error prints stderr + exits 1', async () => {
    mockGet.mockRejectedValue(new Error('ECONNREFUSED'));
    const exitSpy = setupExitSpy();
    const sink = silenceStdoutErr();
    try {
      // Override --status to a valid value — earlier "rejects an
      // unknown --status" test left it set to 'halfway' on the
      // Commander instance, which short-circuits this test with
      // exit 2 before the mock can fire.
      await expect(runArgs(['invocations', '--status', 'success'])).rejects.toThrow('exit:1');
      expect(sink.err.join(' ')).toMatch(/ECONNREFUSED/);
    } finally {
      sink.restore();
      exitSpy.mockRestore();
    }
  });

  it('consent list: backend 500 prints stderr + exits 1', async () => {
    mockGet.mockRejectedValue(Object.assign(new Error('server exploded'), { status: 500 }));
    const exitSpy = setupExitSpy();
    const sink = silenceStdoutErr();
    try {
      await expect(runArgs(['consent', 'list'])).rejects.toThrow('exit:1');
      expect(sink.err.join(' ')).toMatch(/server exploded/);
    } finally {
      sink.restore();
      exitSpy.mockRestore();
    }
  });

  it('consent grant: 403 prints stderr + exits 1', async () => {
    mockPost.mockRejectedValue(Object.assign(new Error('owner role required'), { status: 403 }));
    const exitSpy = setupExitSpy();
    const sink = silenceStdoutErr();
    try {
      await expect(
        runArgs(['consent', 'grant', 'send_email_to_contact', '--scope', 'session']),
      ).rejects.toThrow('exit:1');
      expect(sink.err.join(' ')).toMatch(/owner role required/);
    } finally {
      sink.restore();
      exitSpy.mockRestore();
    }
  });

  it('consent revoke: 404 (no matching grant) prints stderr + exits 1', async () => {
    mockDelete.mockRejectedValue(Object.assign(new Error('no matching consent grant'), { status: 404 }));
    const exitSpy = setupExitSpy();
    const sink = silenceStdoutErr();
    try {
      await expect(runArgs(['consent', 'revoke', 'does-not-exist'])).rejects.toThrow('exit:1');
      expect(sink.err.join(' ')).toMatch(/no matching consent grant/);
    } finally {
      sink.restore();
      exitSpy.mockRestore();
    }
  });
});
