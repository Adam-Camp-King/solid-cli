/**
 * `solid render` with no browser on the machine.
 *
 * ⛔ An AI agent (no TTY) asked to render used to be refused with "run
 * `solid render --install`" unless SOLID_AUTO_INSTALL=1 — the tool told the
 * agent to go and do the tool's job. Now the browser is downloaded for a person
 * or an agent alike, and SOLID_AUTO_INSTALL=0 is the explicit opt-out.
 */
const mockFind = jest.fn();
const mockEnsure = jest.fn();
jest.mock('../../lib/browser-install', () => ({
  findChromiumExecutable: () => mockFind(),
  ensureChromium: (...a: unknown[]) => mockEnsure(...a),
  uninstallCachedBrowsers: jest.fn(),
}));
// Stop right after the browser step: the launch is not what this test is about.
jest.mock('puppeteer-core', () => ({ launch: () => { throw new Error('STOP_AT_LAUNCH'); } }), { virtual: true });

import { renderCommand } from '../../commands/render';

const ORIGINAL_ENV = process.env.SOLID_AUTO_INSTALL;

async function run(args: string[]): Promise<void> {
  await renderCommand.parseAsync(args, { from: 'user' });
}

describe('solid render — first use with no browser', () => {
  beforeEach(() => {
    jest.clearAllMocks();
    jest.spyOn(console, 'error').mockImplementation(() => {});
    jest.spyOn(console, 'log').mockImplementation(() => {});
    jest.spyOn(process.stdout, 'write').mockImplementation(() => true);
    jest.spyOn(process, 'exit').mockImplementation(((code?: number) => {
      throw new Error(`EXIT_${code}`);
    }) as never);
    mockFind.mockResolvedValue(null);
    mockEnsure.mockResolvedValue({ executablePath: '/tmp/chrome', buildId: 'x', downloaded: true });
    Object.defineProperty(process.stdout, 'isTTY', { value: false, configurable: true });
    Object.defineProperty(process.stdin, 'isTTY', { value: false, configurable: true });
  });
  afterEach(() => {
    jest.restoreAllMocks();
    if (ORIGINAL_ENV === undefined) delete process.env.SOLID_AUTO_INSTALL;
    else process.env.SOLID_AUTO_INSTALL = ORIGINAL_ENV;
  });

  it('an AI agent (no TTY, no env) gets the browser downloaded instead of a refusal', async () => {
    delete process.env.SOLID_AUTO_INSTALL;
    await run(['home']).catch(() => {});
    expect(mockEnsure).toHaveBeenCalledTimes(1);
  });

  it('SOLID_AUTO_INSTALL=0 forbids the download and refuses with the way forward', async () => {
    process.env.SOLID_AUTO_INSTALL = '0';
    await expect(run(['home'])).rejects.toThrow('EXIT_1');
    expect(mockEnsure).not.toHaveBeenCalled();
  });

  it('a browser already here (Google Chrome) is used — nothing is downloaded', async () => {
    mockFind.mockResolvedValue('/Applications/Google Chrome.app/Contents/MacOS/Google Chrome');
    await run(['home']).catch(() => {});
    expect(mockEnsure).not.toHaveBeenCalled();
  });
});
