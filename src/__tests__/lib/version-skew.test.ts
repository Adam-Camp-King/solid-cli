/**
 * Version-skew handshake tests.
 *
 * The client side is plumbed: X-Solid-CLI-Version outbound + parse a few
 * advisory response headers inbound. The backend hasn't opted in yet, so
 * these tests exercise the parsing/warning logic in isolation.
 */

import { checkSkewFromHeaders, _resetSkewWarnedForTest } from '../../lib/version-skew';

describe('checkSkewFromHeaders', () => {
  let stderrSpy: jest.SpyInstance;

  beforeEach(() => {
    _resetSkewWarnedForTest();
    delete process.env.SOLID_SKEW_SILENT;
    stderrSpy = jest.spyOn(process.stderr, 'write').mockImplementation(() => true);
  });

  afterEach(() => {
    stderrSpy.mockRestore();
  });

  it('is a no-op when no advisory headers are set', () => {
    checkSkewFromHeaders('1.9.19', { 'content-type': 'application/json' });
    expect(stderrSpy).not.toHaveBeenCalled();
  });

  it('warns red when CLI is below the server minimum', () => {
    checkSkewFromHeaders('1.5.0', { 'x-solid-min-cli-version': '1.9.0' });
    expect(stderrSpy).toHaveBeenCalled();
    const msg = stderrSpy.mock.calls.map((c) => String(c[0])).join('');
    expect(msg).toMatch(/below the supported minimum/);
  });

  it('does not warn when CLI meets the minimum', () => {
    checkSkewFromHeaders('1.9.0', { 'x-solid-min-cli-version': '1.9.0' });
    expect(stderrSpy).not.toHaveBeenCalled();
  });

  it('nudges when latest is minor-ahead, stays silent on patch skew', () => {
    checkSkewFromHeaders('1.9.19', { 'x-solid-latest-cli-version': '1.9.20' });
    expect(stderrSpy).not.toHaveBeenCalled();

    _resetSkewWarnedForTest();
    checkSkewFromHeaders('1.9.19', { 'x-solid-latest-cli-version': '1.10.0' });
    expect(stderrSpy).toHaveBeenCalled();
    const msg = stderrSpy.mock.calls.map((c) => String(c[0])).join('');
    expect(msg).toMatch(/newer Solid CLI is available/);
  });

  it('honors X-Solid-Deprecated-CLI', () => {
    checkSkewFromHeaders('1.9.19', { 'x-solid-deprecated-cli': 'true' });
    expect(stderrSpy).toHaveBeenCalled();
    const msg = stderrSpy.mock.calls.map((c) => String(c[0])).join('');
    expect(msg).toMatch(/deprecated/);
  });

  it('only warns once per process', () => {
    checkSkewFromHeaders('1.5.0', { 'x-solid-min-cli-version': '1.9.0' });
    checkSkewFromHeaders('1.5.0', { 'x-solid-min-cli-version': '1.9.0' });
    checkSkewFromHeaders('1.5.0', { 'x-solid-min-cli-version': '1.9.0' });
    expect(stderrSpy).toHaveBeenCalledTimes(1);
  });

  it('is silenced by SOLID_SKEW_SILENT=1', () => {
    process.env.SOLID_SKEW_SILENT = '1';
    checkSkewFromHeaders('1.5.0', { 'x-solid-min-cli-version': '1.9.0' });
    expect(stderrSpy).not.toHaveBeenCalled();
  });

  it('tolerates header casing', () => {
    checkSkewFromHeaders('1.5.0', { 'X-Solid-Min-CLI-Version': '1.9.0' });
    expect(stderrSpy).toHaveBeenCalled();
  });

  it('ignores malformed semver gracefully', () => {
    checkSkewFromHeaders('garbage', { 'x-solid-min-cli-version': '1.9.0' });
    expect(stderrSpy).not.toHaveBeenCalled();
  });
});
