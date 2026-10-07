/**
 * The doctor's score counts only what can be wrong on THIS machine.
 * 2026-10-07: a healthy-enough setup read "4 of 11" because apps the person
 * does not use, and a global install nobody needs, were scored as failures.
 */
import { clientConfigCheck, scoreChecks, DoctorCheck } from '../../lib/mcp-doctor-score';

describe('mcp doctor score', () => {
  it('an app that is not set up is shown and never counted', () => {
    const noFile = clientConfigCheck('cursor', { configExists: false, entryName: null, hasKey: false });
    const noEntry = clientConfigCheck('claude', { configExists: true, entryName: null, hasKey: false });
    expect(noFile.applies).toBe(false);
    expect(noEntry.applies).toBe(false);
    expect(noEntry.detail).toContain('solid mcp install claude');
    expect(scoreChecks([noFile, noEntry])).toEqual({ passing: 0, total: 0, notApplicable: 2 });
  });

  it('an entry with no key is still a counted failure — the false green stays closed', () => {
    const keyless = clientConfigCheck('claude', { configExists: true, entryName: 'solid', hasKey: false });
    expect(keyless.applies).toBeUndefined();
    expect(keyless.ok).toBe(false);
    expect(keyless.detail).toContain('NO SOLID_API_KEY');
    const wired = clientConfigCheck('claude', { configExists: true, entryName: 'solid', hasKey: true });
    expect(wired.ok).toBe(true);
    expect(scoreChecks([keyless, wired])).toEqual({ passing: 1, total: 2, notApplicable: 0 });
  });

  it('the reported machine reads 4 of 6 with the real failure in it, not 4 of 11', () => {
    const checks: DoctorCheck[] = [
      { label: 'Authentication', ok: true, detail: '' },
      { label: 'API connectivity', ok: true, detail: '' },
      { label: 'Verb count', ok: true, detail: '' },
      { label: 'Solid# connections', ok: false, detail: 'two connections' },
      { label: '  ↳ claude.ai Solid#', ok: true, detail: '' },
      { label: '  ↳ solid', ok: false, detail: 'Connection closed' },
      { label: '@solidnumber/mcp installed', ok: false, applies: false, detail: '' },
      clientConfigCheck('claude', { configExists: true, entryName: null, hasKey: false }),
      clientConfigCheck('claude-code', { configExists: true, entryName: null, hasKey: false }),
      clientConfigCheck('cursor', { configExists: false, entryName: null, hasKey: false }),
      clientConfigCheck('windsurf', { configExists: false, entryName: null, hasKey: false }),
    ];
    expect(scoreChecks(checks)).toEqual({ passing: 4, total: 6, notApplicable: 5 });
  });
});
