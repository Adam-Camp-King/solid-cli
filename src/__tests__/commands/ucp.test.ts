/**
 * `solid ucp ...` command tests.
 *
 * Pins URL contract for the four subcommands: manifest, capabilities,
 * and consent list/grant/revoke. Authenticated wire-format only — the
 * RFC 9421 signing path lives in solid-backend and is exercised there.
 */

jest.mock('ora', () => ({
  __esModule: true,
  default: () => ({
    start: jest.fn().mockReturnThis(),
    stop: jest.fn().mockReturnThis(),
    succeed: jest.fn().mockReturnThis(),
    fail: jest.fn().mockReturnThis(),
  }),
}));

jest.mock('../../lib/api-client', () => ({
  apiClient: {
    get: jest.fn(),
    post: jest.fn(),
    delete: jest.fn(),
  },
  handleApiError: jest.fn((e: unknown) => {
    throw e;
  }),
}));

jest.mock('../../lib/config', () => ({
  config: {
    isLoggedIn: jest.fn().mockReturnValue(true),
    companyId: 61,
  },
}));

jest.mock('../../lib/json-output', () => ({
  isJsonOutput: jest.fn().mockReturnValue(true),
  activateProgramJsonIfRequested: jest.fn(),
}));

import { apiClient } from '../../lib/api-client';
import { config } from '../../lib/config';
import { ucpCommand } from '../../commands/ucp';


const mockGet = apiClient.get as jest.Mock;
const mockPost = apiClient.post as jest.Mock;
const mockDelete = apiClient.delete as jest.Mock;
const mockIsLoggedIn = config.isLoggedIn as jest.Mock;


async function runArgs(args: string[]): Promise<void> {
  await ucpCommand.parseAsync(args, { from: 'user' });
}


function silenceStdoutErr() {
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


describe('solid ucp manifest', () => {
  it('GETs /co/{id}/.well-known/ucp for the session tenant', async () => {
    mockGet.mockResolvedValue({ data: { profile: 'signed' } });
    const sink = silenceStdoutErr();
    try {
      await runArgs(['manifest']);
      expect(mockGet).toHaveBeenCalledWith('/co/61/.well-known/ucp');
    } finally {
      sink.restore();
    }
  });

  it('honors --company override', async () => {
    mockGet.mockResolvedValue({ data: {} });
    const sink = silenceStdoutErr();
    try {
      await runArgs(['manifest', '--company', '99']);
      expect(mockGet).toHaveBeenCalledWith('/co/99/.well-known/ucp');
    } finally {
      sink.restore();
    }
  });
});


describe('solid ucp capabilities', () => {
  it('GETs /co/{id}/ucp/capabilities', async () => {
    mockGet.mockResolvedValue({ data: { capabilities: [] } });
    const sink = silenceStdoutErr();
    try {
      await runArgs(['capabilities']);
      expect(mockGet).toHaveBeenCalledWith('/co/61/ucp/capabilities');
    } finally {
      sink.restore();
    }
  });
});


describe('solid ucp consent', () => {
  it('list GETs /api/v1/ucp/consent/ladder', async () => {
    mockGet.mockResolvedValue({ data: { grants: [] } });
    const sink = silenceStdoutErr();
    try {
      await runArgs(['consent', 'list']);
      expect(mockGet).toHaveBeenCalledWith('/api/v1/ucp/consent/ladder');
    } finally {
      sink.restore();
    }
  });

  it('grant POSTs to /api/v1/ucp/consent/grant with capability + scope', async () => {
    mockPost.mockResolvedValue({ data: { id: 'g-1' } });
    const sink = silenceStdoutErr();
    try {
      await runArgs(['consent', 'grant', 'core/booking', '--scope', 'session']);
      expect(mockPost).toHaveBeenCalledWith('/api/v1/ucp/consent/grant', {
        capability: 'core/booking',
        scope: 'session',
      });
    } finally {
      sink.restore();
    }
  });

  it('revoke DELETEs /api/v1/ucp/consent/grant/<id>', async () => {
    mockDelete.mockResolvedValue(undefined);
    const sink = silenceStdoutErr();
    try {
      await runArgs(['consent', 'revoke', 'grant-7']);
      expect(mockDelete).toHaveBeenCalledWith('/api/v1/ucp/consent/grant/grant-7');
    } finally {
      sink.restore();
    }
  });
});


describe('ucp login gate', () => {
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
