/**
 * The Claude Code SessionStart hook that keeps tenant context fresh — the one
 * place that knows its command, its legacy spellings, and how to write it.
 * `solid install` adds or removes it; `solid update` brings an existing one to
 * the current command. No UI here, so both can use it.
 */
import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';

// Resolves the Claude Code settings.json path. Honors
// SOLID_CLAUDE_SETTINGS_PATH so tests can point us at a tmp file — makes
// install tests hermetic without fragile fs module mocks.
export function claudeSettingsPath(): string {
  return process.env.SOLID_CLAUDE_SETTINGS_PATH
    || path.join(os.homedir(), '.claude', 'settings.json');
}
// The command Claude Code runs before every session.
//   --raw       — clean output, no spinner / decoration
//   --if-tenant — silently exit 0 when the cwd is not a tenant directory
//                 (no manifest, or a protected root like the platform
//                 monorepo or $HOME). Without this, every `claude` launched
//                 outside a tenant repo would print a scary "Refusing to
//                 write tenant data" banner that's not the user's fault.
export const HOOK_COMMAND = 'solid context --claude --raw --if-tenant';

type HookEntry = { type: 'command'; command: string };
type HookGroup = { hooks: HookEntry[] };

export function loadSettings(): Record<string, unknown> {
  if (!fs.existsSync(claudeSettingsPath())) return {};
  try {
    return JSON.parse(fs.readFileSync(claudeSettingsPath(), 'utf-8'));
  } catch (err) {
    // Corrupt JSON — refuse to clobber. User has to fix it first.
    throw new Error(`~/.claude/settings.json is not valid JSON (${(err as Error).message}). Fix the file and re-run.`);
  }
}

export function saveSettings(obj: Record<string, unknown>): void {
  const dir = path.dirname(claudeSettingsPath());
  if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });
  fs.writeFileSync(claudeSettingsPath(), JSON.stringify(obj, null, 2) + '\n', 'utf-8');
}

// Older installs wrote earlier hook commands. When we see any of these legacy
// variants, treat them as "ours" so upsert rewrites them to the current
// HOOK_COMMAND on the next `solid install` invocation.
//
//   --quiet  (pre-2.2): not a real flag on `solid context`; was always broken.
//   --raw    (2.2-2.3.0): worked but emitted "Refusing to write tenant data"
//                          whenever the user launched Claude Code outside a
//                          tenant directory. Replaced by --raw --if-tenant
//                          in 2.3.1 which silently no-ops in that case.
const LEGACY_HOOK_COMMANDS = [
  'solid context --claude --quiet',
  'solid context --claude --raw',
];

function isSolidHook(command: string): boolean {
  return command === HOOK_COMMAND || LEGACY_HOOK_COMMANDS.includes(command);
}

// Idempotent merge: add our hook entry if (and only if) it isn't already
// there. If a legacy (broken) variant is present, migrate it in place.
// Returns true when the file was modified.
export function upsertSessionStartHook(settings: Record<string, unknown>): boolean {
  const hooks = (settings.hooks as Record<string, unknown> | undefined) || {};
  const sessionStart = (hooks.SessionStart as HookGroup[] | undefined) || [];

  let mutated = false;

  // Migration pass: rewrite any legacy command to the current one.
  for (const group of sessionStart) {
    for (const h of group.hooks || []) {
      if (LEGACY_HOOK_COMMANDS.includes(h.command)) {
        h.command = HOOK_COMMAND;
        mutated = true;
      }
    }
  }

  const alreadyHasCurrent = sessionStart.some((group) =>
    (group.hooks || []).some((h) => h.command === HOOK_COMMAND),
  );
  if (!alreadyHasCurrent) {
    sessionStart.push({
      hooks: [{ type: 'command', command: HOOK_COMMAND }],
    });
    mutated = true;
  }

  hooks.SessionStart = sessionStart;
  settings.hooks = hooks;
  return mutated;
}

export function removeSessionStartHook(settings: Record<string, unknown>): boolean {
  const hooks = settings.hooks as Record<string, unknown> | undefined;
  if (!hooks || !Array.isArray(hooks.SessionStart)) return false;

  // Remove BOTH the current command and any legacy variants so users who
  // installed an older broken hook get a clean uninstall.
  const original = hooks.SessionStart as HookGroup[];
  const filtered = original
    .map((group) => ({ ...group, hooks: (group.hooks || []).filter((h) => !isSolidHook(h.command)) }))
    .filter((group) => group.hooks.length > 0);

  const removedSomething =
    filtered.length !== original.length ||
    filtered.some((g, i) => g.hooks.length !== original[i].hooks.length);

  if (!removedSomething) return false;

  if (filtered.length === 0) {
    delete hooks.SessionStart;
  } else {
    hooks.SessionStart = filtered;
  }
  return true;
}

/**
 * `solid update`'s half of the hook: bring an EXISTING Solid hook to the
 * current command. It never adds a hook the user did not install — that is
 * `solid install`'s job, and an update is not consent to new wiring.
 */
export function refreshClaudeHook(apply: boolean): { state: 'absent' | 'current' | 'updated' | 'would_update' | 'failed'; detail: string } {
  const where = claudeSettingsPath();
  let settings: Record<string, unknown>;
  try {
    settings = loadSettings();
  } catch (err) {
    return { state: 'failed', detail: (err as Error).message };
  }
  const groups = ((settings.hooks as Record<string, unknown> | undefined)?.SessionStart as HookGroup[] | undefined) || [];
  const ours = groups.flatMap((g) => g.hooks || []).filter((h) => isSolidHook(h.command));
  if (ours.length === 0) return { state: 'absent', detail: where };
  if (!upsertSessionStartHook(settings)) return { state: 'current', detail: where };
  if (!apply) return { state: 'would_update', detail: where };
  try {
    saveSettings(settings);
  } catch (err) {
    return { state: 'failed', detail: (err as Error).message };
  }
  return { state: 'updated', detail: where };
}
