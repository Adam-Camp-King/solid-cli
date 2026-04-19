/**
 * Adaptive banner tier tests.
 *
 * Locks the contract that banner() never chops, never leaks into pipes,
 * and degrades gracefully on legacy terminals. If these break, the CLI
 * either looks broken in a narrow terminal or corrupts piped output.
 */

import { banner, bannerSmall, bannerTier } from '../../lib/ui';

function withEnv<T>(env: Record<string, string | undefined>, fn: () => T): T {
  const prev: Record<string, string | undefined> = {};
  for (const k of Object.keys(env)) {
    prev[k] = process.env[k];
    if (env[k] === undefined) delete process.env[k];
    else process.env[k] = env[k];
  }
  try { return fn(); } finally {
    for (const k of Object.keys(prev)) {
      if (prev[k] === undefined) delete process.env[k];
      else process.env[k] = prev[k];
    }
  }
}

function withStdout<T>(opts: { tty?: boolean; columns?: number }, fn: () => T): T {
  const origTty = (process.stdout as any).isTTY;
  const origCols = (process.stdout as any).columns;
  (process.stdout as any).isTTY = opts.tty ?? true;
  (process.stdout as any).columns = opts.columns ?? 120;
  try { return fn(); } finally {
    (process.stdout as any).isTTY = origTty;
    (process.stdout as any).columns = origCols;
  }
}

const UTF8_ENV = { LANG: 'en_US.UTF-8', LC_ALL: undefined, LC_CTYPE: undefined, CI: undefined, GITHUB_ACTIONS: undefined, BUILD_NUMBER: undefined, WT_SESSION: undefined, TERM_PROGRAM: undefined };

describe('banner tiering', () => {
  test('silent when stdout is not a TTY (piped output stays clean)', () => {
    withEnv(UTF8_ENV, () => {
      withStdout({ tty: false, columns: 120 }, () => {
        expect(bannerTier()).toBe('silent');
        expect(banner()).toBe('');
        expect(bannerSmall()).toBe('');
      });
    });
  });

  test('silent in CI even when TTY is forced', () => {
    withEnv({ ...UTF8_ENV, CI: '1' }, () => {
      withStdout({ tty: true, columns: 200 }, () => {
        expect(bannerTier()).toBe('silent');
        expect(banner()).toBe('');
      });
    });
  });

  test('full banner on wide UTF-8 terminal', () => {
    withEnv(UTF8_ENV, () => {
      withStdout({ tty: true, columns: 120 }, () => {
        expect(bannerTier()).toBe('full');
        const out = banner();
        expect(out).toContain('█');
        expect(out).toContain('Solid');
      });
    });
  });

  test('small box-drawing banner on medium width', () => {
    withEnv(UTF8_ENV, () => {
      withStdout({ tty: true, columns: 40 }, () => {
        expect(bannerTier()).toBe('small');
        const out = banner();
        expect(out).toContain('┏');
        expect(out).not.toContain('█');
      });
    });
  });

  test('wordmark only on narrow terminal (no chopping)', () => {
    withEnv(UTF8_ENV, () => {
      withStdout({ tty: true, columns: 28 }, () => {
        expect(bannerTier()).toBe('wordmark');
        const out = banner();
        expect(out).toContain('Solid');
        expect(out).not.toContain('█');
        expect(out).not.toContain('┏');
      });
    });
  });

  test('ASCII fallback on non-UTF8 locale', () => {
    withEnv({ ...UTF8_ENV, LANG: 'C', LC_ALL: 'C', LC_CTYPE: 'C' }, () => {
      const origPlatform = process.platform;
      Object.defineProperty(process, 'platform', { value: 'win32', configurable: true });
      try {
        withStdout({ tty: true, columns: 120 }, () => {
          const tier = bannerTier();
          expect(tier === 'ascii' || tier === 'wordmark').toBe(true);
          const out = banner();
          expect(out).not.toContain('█');
          expect(out).not.toContain('┏');
        });
      } finally {
        Object.defineProperty(process, 'platform', { value: origPlatform, configurable: true });
      }
    });
  });

  test('modern Windows Terminal (WT_SESSION) gets full unicode banner', () => {
    const origPlatform = process.platform;
    Object.defineProperty(process, 'platform', { value: 'win32', configurable: true });
    try {
      withEnv({ ...UTF8_ENV, WT_SESSION: '1' }, () => {
        withStdout({ tty: true, columns: 120 }, () => {
          expect(bannerTier()).toBe('full');
        });
      });
    } finally {
      Object.defineProperty(process, 'platform', { value: origPlatform, configurable: true });
    }
  });

  test('banner never exceeds the terminal width at any tier', () => {
    const widths = [20, 28, 40, 60, 80, 120];
    withEnv(UTF8_ENV, () => {
      for (const cols of widths) {
        withStdout({ tty: true, columns: cols }, () => {
          const out = banner();
          const stripAnsi = (s: string) => s.replace(/\x1b\[[0-9;]*m/g, '');
          for (const line of out.split('\n')) {
            expect(stripAnsi(line).length).toBeLessThanOrEqual(cols);
          }
        });
      }
    });
  });
});
