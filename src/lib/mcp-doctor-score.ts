/**
 * What the MCP doctor counts, and what it only mentions.
 *
 * ⛔ WHY — 2026-10-07. A client's AI ran `solid mcp doctor` and reported "the
 * score was 4 of 11". Seven of those eleven were never problems: no Cursor, no
 * Windsurf, no Claude Desktop config, and no global install of a package every
 * client runs through npx. A working setup read as mostly broken, and the one
 * real failure — a local connection that would not start — was one ✗ among
 * seven. A check that cannot fail for a healthy machine is not a check.
 *
 * So a line is one of three things:
 *   ok              it applies and it is right        ✓  counted
 *   not ok          it applies and it is wrong        ✗  counted
 *   applies:false   nothing to judge on this machine  –  shown, never counted
 */
export interface DoctorCheck {
  label: string;
  ok: boolean;
  detail: string;
  /** false = shown for information; not part of the score and never a failure. */
  applies?: boolean;
}

export function scoreChecks(checks: DoctorCheck[]): { passing: number; total: number; notApplicable: number } {
  const counted = checks.filter((c) => c.applies !== false);
  return {
    passing: counted.filter((c) => c.ok).length,
    total: counted.length,
    notApplicable: checks.length - counted.length,
  };
}

/**
 * One AI app's config file. Only an entry that EXISTS can be wrong: a Solid#
 * entry with no key authenticates as nobody (the 2026-09-15 false green). An
 * app with no config file, or a config with no Solid# entry, is an app this
 * person has not connected — information, not a failure.
 */
export function clientConfigCheck(
  client: string,
  state: { configExists: boolean; entryName: string | null; hasKey: boolean },
): DoctorCheck {
  const label = `${client} config`;
  if (!state.entryName) {
    return {
      label,
      ok: false,
      applies: false,
      detail: state.configExists
        ? `Not connected here — \`solid mcp install ${client}\` if you use it`
        : 'App not set up on this machine',
    };
  }
  return state.hasKey
    ? { label, ok: true, detail: `Solid# wired with a credential ("${state.entryName}")` }
    : {
        label,
        ok: false,
        detail: `"${state.entryName}" is present but carries NO SOLID_API_KEY — it authenticates as nobody. Run \`solid mcp connect\`.`,
      };
}
