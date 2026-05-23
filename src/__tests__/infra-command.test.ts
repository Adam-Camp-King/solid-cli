/**
 * Smoke test for `solid infra` command surface.
 *
 * Verifies the command tree wires up the four expected subcommands
 * (diagnose / preview-resize / resize / scale-workers) with the right
 * required-argument shapes and option flags. No HTTP, no I/O.
 */
// ora is ESM-only — stub before importing the command module.
jest.mock('ora', () => ({
  __esModule: true,
  default: () => ({ start: () => ({ stop: jest.fn(), succeed: jest.fn(), fail: jest.fn() }) }),
}));

import { infraCommand } from '../commands/infra';

function subcommandNames(): string[] {
  // commander stores subcommands on `.commands`
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  return ((infraCommand as any).commands as Array<{ name(): string }>).map((c) => c.name());
}

function getSub(name: string) {
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  return ((infraCommand as any).commands as Array<{ name(): string }>).find((c) => c.name() === name);
}

describe('solid infra command surface', () => {
  it('registers the four expected subcommands', () => {
    const names = subcommandNames();
    expect(names).toEqual(
      expect.arrayContaining(['diagnose', 'preview-resize', 'resize', 'scale-workers']),
    );
  });

  it('diagnose takes no required args', () => {
    const sub = getSub('diagnose');
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const args = ((sub as any)._args as Array<{ required: boolean }>) || [];
    expect(args.filter((a) => a.required)).toHaveLength(0);
  });

  it('preview-resize requires a size arg', () => {
    const sub = getSub('preview-resize');
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const args = ((sub as any)._args as Array<{ name(): string; required: boolean }>) || [];
    expect(args[0]?.name()).toBe('size');
    expect(args[0]?.required).toBe(true);
  });

  it('resize requires --confirm and --phrase options', () => {
    const sub = getSub('resize');
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const opts = ((sub as any).options as Array<{ flags: string }>) || [];
    const flagSet = new Set(opts.map((o) => o.flags));
    expect([...flagSet].some((f) => f.includes('--confirm'))).toBe(true);
    expect([...flagSet].some((f) => f.includes('--phrase'))).toBe(true);
  });

  it('scale-workers requires --confirm and --phrase options', () => {
    const sub = getSub('scale-workers');
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const opts = ((sub as any).options as Array<{ flags: string }>) || [];
    const flagSet = new Set(opts.map((o) => o.flags));
    expect([...flagSet].some((f) => f.includes('--confirm'))).toBe(true);
    expect([...flagSet].some((f) => f.includes('--phrase'))).toBe(true);
  });

  it('command description mentions infrastructure', () => {
    expect(infraCommand.description().toLowerCase()).toMatch(/infra|droplet/);
  });
});
