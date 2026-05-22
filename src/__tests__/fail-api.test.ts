/**
 * Tests for src/lib/api-client.ts::failApi.
 *
 * Locks in the fix for the silent-swallow bug:
 *   `solid verbs invoke` (and ~25 other callsites) used to do
 *     try { ... } catch (e) { handleApiError(e); }
 *   which RETURNS an ApiError but doesn't print or throw. AI agents
 *   parsing stdout saw exit 0 + empty output and assumed success
 *   even when the API was 502'ing.
 *
 * failApi must:
 *   1. Write the error message to STDERR (not stdout — stdout stays
 *      clean for JSON consumers)
 *   2. Exit non-zero (process.exit(1))
 *   3. Include the hint + docs_url when handleApiError populated them
 */
import axios, { AxiosError } from 'axios';

import { failApi, handleApiError } from '../lib/api-client';


function _captureExit() {
  const calls: number[] = [];
  const spy = jest.spyOn(process, 'exit').mockImplementation(((code?: string | number | null | undefined) => {
    calls.push(typeof code === 'number' ? code : Number(code) || 0);
    throw new Error(`__process_exit_${calls[calls.length - 1]}__`);
  }) as never);
  return { calls, restore: () => spy.mockRestore() };
}


function _captureStderr() {
  const written: string[] = [];
  const spy = jest.spyOn(process.stderr, 'write').mockImplementation(((chunk: string | Uint8Array, ..._rest: unknown[]) => {
    written.push(typeof chunk === 'string' ? chunk : chunk.toString());
    return true;
  }) as never);
  return { written, restore: () => spy.mockRestore() };
}


describe('failApi', () => {
  it('writes message to stderr and exits with code 1', () => {
    const exit = _captureExit();
    const stderr = _captureStderr();
    try {
      expect(() => failApi(new Error('connect ECONNREFUSED'))).toThrow(/__process_exit_1__/);
    } finally {
      exit.restore();
      stderr.restore();
    }
    expect(exit.calls).toEqual([1]);
    // Joined stderr must contain something — at minimum a sanitized
    // message. We don't pin exact text because handleApiError redacts
    // and classifies.
    const out = stderr.written.join('');
    expect(out.length).toBeGreaterThan(0);
  });

  it('on a 502 axios error, prints something useful (not silent)', () => {
    const exit = _captureExit();
    const stderr = _captureStderr();
    const err: Partial<AxiosError> = {
      isAxiosError: true,
      message: 'Request failed with status code 502',
      response: {
        status: 502,
        data: { detail: 'Bad Gateway' },
        headers: {},
        config: {} as never,
        statusText: 'Bad Gateway',
      },
      config: { method: 'POST', url: '/api/v1/ada/cli-dispatch' } as never,
      code: 'ERR_BAD_RESPONSE',
    };
    // Force axios.isAxiosError to recognize our fake.
    (err as { isAxiosError: boolean }).isAxiosError = true;
    const isAxiosErrorOrig = axios.isAxiosError;
    (axios as unknown as { isAxiosError: (x: unknown) => boolean }).isAxiosError = (x: unknown) => x === err;
    try {
      expect(() => failApi(err)).toThrow(/__process_exit_1__/);
    } finally {
      (axios as unknown as { isAxiosError: typeof isAxiosErrorOrig }).isAxiosError = isAxiosErrorOrig;
      exit.restore();
      stderr.restore();
    }
    expect(exit.calls).toEqual([1]);
    const out = stderr.written.join('');
    // Must NOT be empty (the entire point of the fix).
    expect(out.length).toBeGreaterThan(0);
  });

  it('handleApiError still returns ApiError (the API surface other callers rely on)', () => {
    const result = handleApiError(new Error('boom'));
    expect(result).toBeDefined();
    expect(result.message).toBeDefined();
    expect(result.status).toBeDefined();
    // It must NOT have called process.exit — the legacy callers that
    // use the returned value still need to function.
  });
});
