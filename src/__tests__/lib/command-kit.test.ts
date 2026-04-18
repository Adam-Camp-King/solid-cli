/**
 * command-kit tests — verify the run() lifecycle handles auth, spinner,
 * JSON, errors, and success rendering consistently across all commands.
 */

// Mock config so requireAuth() can be toggled per test.
jest.mock('../../lib/config', () => {
  let loggedIn = true;
  return {
    config: {
      isLoggedIn: () => loggedIn,
    },
    __setLoggedIn: (v: boolean) => {
      loggedIn = v;
    },
  };
});

import { run, requireAuth, __setSpinnerFactoryForTest, SpinnerLike } from '../../lib/command-kit';
// eslint-disable-next-line @typescript-eslint/no-var-requires
const { __setLoggedIn } = require('../../lib/config');

// Stub spinner that records calls
function makeStubSpinner() {
  const calls: string[] = [];
  const api: SpinnerLike = {
    start() { calls.push('start'); return api; },
    stop() { calls.push('stop'); return api; },
    succeed(text?: string) { calls.push(`succeed:${text || ''}`); return api; },
    fail(text?: string) { calls.push(`fail:${text || ''}`); return api; },
  };
  return { api, calls };
}

describe('command-kit', () => {
  let logSpy: jest.SpyInstance;
  let errSpy: jest.SpyInstance;
  let exitSpy: jest.SpyInstance;

  beforeEach(() => {
    __setLoggedIn(true);
    logSpy = jest.spyOn(console, 'log').mockImplementation(() => {});
    errSpy = jest.spyOn(console, 'error').mockImplementation(() => {});
    exitSpy = jest.spyOn(process, 'exit').mockImplementation(((code?: number) => {
      throw new Error(`EXIT:${code}`);
    }) as never);
  });

  afterEach(() => {
    logSpy.mockRestore();
    errSpy.mockRestore();
    exitSpy.mockRestore();
    __setSpinnerFactoryForTest(null);
  });

  describe('requireAuth', () => {
    it('no-ops when logged in', () => {
      expect(() => requireAuth()).not.toThrow();
    });

    it('exits with 1 when logged out', () => {
      __setLoggedIn(false);
      expect(() => requireAuth()).toThrow('EXIT:1');
      expect(errSpy).toHaveBeenCalledWith(expect.stringContaining('Not logged in'));
    });
  });

  describe('run', () => {
    it('runs the task and stops the spinner silently when no successText', async () => {
      const { api, calls } = makeStubSpinner();
      __setSpinnerFactoryForTest(() => api);

      await run(async () => ({ ok: true }), { spinner: 'loading' });

      expect(calls).toEqual(['stop']);
    });

    it('renders success text with succeed()', async () => {
      const { api, calls } = makeStubSpinner();
      __setSpinnerFactoryForTest(() => api);

      await run(async () => ({ foo: 1 }), { spinner: 'loading', successText: 'done' });

      expect(calls[0]).toMatch(/^succeed:/);
      expect(calls[0]).toContain('done');
    });

    it('passes the result to a successText function', async () => {
      const { api, calls } = makeStubSpinner();
      __setSpinnerFactoryForTest(() => api);

      await run(
        async () => ({ count: 7 }),
        {
          spinner: 'loading',
          successText: (r) => `got ${r.count}`,
        },
      );

      expect(calls[0]).toContain('got 7');
    });

    it('calls render with the result for pretty mode', async () => {
      const { api } = makeStubSpinner();
      __setSpinnerFactoryForTest(() => api);

      const render = jest.fn();
      await run(async () => ({ x: 'y' }), { spinner: 'loading', render });

      expect(render).toHaveBeenCalledWith({ x: 'y' });
    });

    it('emits JSON and skips render when json=true', async () => {
      const { api, calls } = makeStubSpinner();
      __setSpinnerFactoryForTest(() => api);

      const render = jest.fn();
      await run(
        async () => ({ value: 42 }),
        { spinner: 'loading', json: true, render },
      );

      expect(render).not.toHaveBeenCalled();
      expect(calls).toEqual(['stop']);
      expect(logSpy).toHaveBeenCalledWith(JSON.stringify({ value: 42 }, null, 2));
    });

    it('fails the spinner and exits on task error', async () => {
      const { api, calls } = makeStubSpinner();
      __setSpinnerFactoryForTest(() => api);

      await expect(
        run(
          async () => { throw new Error('boom'); },
          { spinner: 'loading', errorText: 'Could not load' },
        ),
      ).rejects.toThrow('EXIT:1');

      expect(calls[0]).toContain('fail:');
      expect(calls[0]).toContain('Could not load');
      expect(errSpy).toHaveBeenCalled();
    });

    it('surfaces the structured API error message', async () => {
      await expect(
        run(
          async () => {
            const err = Object.assign(new Error('Bad Request'), {
              isAxiosError: true,
              response: {
                status: 400,
                data: { detail: 'invalid company_id' },
              },
            });
            throw err;
          },
          { spinner: null, errorText: 'Fetch failed' },
        ),
      ).rejects.toThrow('EXIT:1');

      const errCalls = errSpy.mock.calls.map((c) => c.join(' '));
      expect(errCalls.some((c) => c.includes('invalid company_id'))).toBe(true);
    });

    it('blocks the task when not logged in and auth is required', async () => {
      __setLoggedIn(false);
      const task = jest.fn();

      await expect(
        run(task, { spinner: null }),
      ).rejects.toThrow('EXIT:1');

      expect(task).not.toHaveBeenCalled();
    });

    it('allows the task when skipAuth=true, even if logged out', async () => {
      __setLoggedIn(false);
      const task = jest.fn(async () => 'ok');

      await run(task, { spinner: null, skipAuth: true });

      expect(task).toHaveBeenCalledTimes(1);
    });

    it('runs without a spinner when spinner is null', async () => {
      const factory = jest.fn();
      __setSpinnerFactoryForTest(factory);

      await run(async () => 'hi', { spinner: null });

      expect(factory).not.toHaveBeenCalled();
    });

    describe('quiet mode', () => {
      it('suppresses the spinner when quiet=true', async () => {
        const factory = jest.fn();
        __setSpinnerFactoryForTest(factory);

        await run(async () => 'hi', { spinner: 'loading', quiet: true });

        expect(factory).not.toHaveBeenCalled();
      });

      it('still calls render in quiet mode (data goes through)', async () => {
        __setSpinnerFactoryForTest(() => makeStubSpinner().api);
        const render = jest.fn();

        await run(async () => ({ v: 1 }), { spinner: 'loading', quiet: true, render });

        expect(render).toHaveBeenCalledWith({ v: 1 });
      });

      it('still emits JSON in quiet mode', async () => {
        __setSpinnerFactoryForTest(() => makeStubSpinner().api);

        await run(async () => ({ x: 2 }), { spinner: 'loading', quiet: true, json: true });

        expect(logSpy).toHaveBeenCalledWith(JSON.stringify({ x: 2 }, null, 2));
      });

      it('SOLID_QUIET=1 env var engages quiet mode', async () => {
        const prev = process.env.SOLID_QUIET;
        process.env.SOLID_QUIET = '1';
        try {
          const factory = jest.fn();
          __setSpinnerFactoryForTest(factory);

          await run(async () => 'hi', { spinner: 'loading' });

          expect(factory).not.toHaveBeenCalled();
        } finally {
          if (prev === undefined) delete process.env.SOLID_QUIET;
          else process.env.SOLID_QUIET = prev;
        }
      });
    });
  });
});
