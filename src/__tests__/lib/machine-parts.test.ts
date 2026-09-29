/**
 * The parts `solid update` keeps current besides the CLI and the MCP server —
 * run for real against temp directories, not a mocked fs.
 *
 * The rule every part follows: refresh what is installed, never install what
 * is not. An update is not consent to new files.
 */
import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';

import { Command } from 'commander';

import { refreshCachedChromium } from '../../lib/browser-install';
import { HOOK_COMMAND, refreshClaudeHook } from '../../lib/claude-hook';
import { knownProjects, refreshAllKits, rememberProject } from '../../lib/project-kits';
import { SKILLS } from '../../lib/skills/index';
import { refreshInstalledCompletions } from '../../commands/completion';

let tmp: string;
const env = { ...process.env };

beforeEach(() => {
  tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'solid-parts-'));
  process.env.SOLID_CLAUDE_SETTINGS_PATH = path.join(tmp, 'settings.json');
  process.env.SOLID_PROJECTS_PATH = path.join(tmp, 'projects.json');
});
afterEach(() => {
  process.env = { ...env };
  fs.rmSync(tmp, { recursive: true, force: true });
});

describe('Claude Code session hook', () => {
  const settings = () => JSON.parse(fs.readFileSync(process.env.SOLID_CLAUDE_SETTINGS_PATH!, 'utf8'));
  const write = (command: string) =>
    fs.writeFileSync(
      process.env.SOLID_CLAUDE_SETTINGS_PATH!,
      JSON.stringify({ theme: 'dark', hooks: { SessionStart: [{ hooks: [{ type: 'command', command }] }] } }),
    );

  it('no hook installed → none added', () => {
    expect(refreshClaudeHook(true).state).toBe('absent');
    expect(fs.existsSync(process.env.SOLID_CLAUDE_SETTINGS_PATH!)).toBe(false);
  });

  it('a legacy hook is moved to the current command, the rest of settings kept', () => {
    write('solid context --claude --raw');
    expect(refreshClaudeHook(true).state).toBe('updated');
    expect(settings().hooks.SessionStart[0].hooks[0].command).toBe(HOOK_COMMAND);
    expect(settings().theme).toBe('dark');
  });

  it('--check reports it and writes nothing', () => {
    write('solid context --claude --quiet');
    expect(refreshClaudeHook(false).state).toBe('would_update');
    expect(settings().hooks.SessionStart[0].hooks[0].command).toBe('solid context --claude --quiet');
  });

  it('a current hook is left alone', () => {
    write(HOOK_COMMAND);
    expect(refreshClaudeHook(true).state).toBe('current');
  });

  it('settings that are not JSON are reported, never overwritten', () => {
    fs.writeFileSync(process.env.SOLID_CLAUDE_SETTINGS_PATH!, '{ nope');
    expect(refreshClaudeHook(true).state).toBe('failed');
    expect(fs.readFileSync(process.env.SOLID_CLAUDE_SETTINGS_PATH!, 'utf8')).toBe('{ nope');
  });
});

describe('Shell completion', () => {
  const root = () => {
    const program = new Command('solid');
    program.command('pull').description('Pull');
    program.command('verbs').description('Verbs');
    return program;
  };

  it('not installed → nothing written', () => {
    expect(refreshInstalledCompletions(root(), true, tmp).state).toBe('absent');
    expect(fs.existsSync(path.join(tmp, '.solid-completion.zsh'))).toBe(false);
  });

  it('a snapshot from an older CLI is regenerated from the live command tree', () => {
    const file = path.join(tmp, '.solid-completion.zsh');
    fs.writeFileSync(file, '# old snapshot, no verbs command\n');
    expect(refreshInstalledCompletions(root(), true, tmp).state).toBe('updated');
    expect(fs.readFileSync(file, 'utf8')).toContain('verbs');
    expect(refreshInstalledCompletions(root(), true, tmp).state).toBe('current');
  });
});

describe('Agent skills + plugin, in every project they were set up', () => {
  const project = (name: string, companyId: number | null) => {
    const dir = path.join(tmp, name);
    fs.mkdirSync(path.join(dir, '.solid'), { recursive: true });
    if (companyId !== null) {
      fs.writeFileSync(path.join(dir, '.solid', 'manifest.json'), JSON.stringify({ company_id: companyId }));
    }
    return dir;
  };
  const skill = (dir: string, name = SKILLS[0].dirname) => path.join(dir, '.claude', 'skills', name, 'SKILL.md');
  const staleSkill = (dir: string) => {
    fs.mkdirSync(path.dirname(skill(dir)), { recursive: true });
    fs.writeFileSync(skill(dir), 'old skill');
  };

  it('a remembered project with an old skill gets the current one — from any directory', () => {
    const dir = project('shop', 61);
    staleSkill(dir);
    rememberProject(dir);
    const [r] = refreshAllKits('2.25.0', true, tmp);
    expect(r.state).toBe('updated');
    expect(fs.readFileSync(skill(dir), 'utf8')).toBe(SKILLS[0].content);
  });

  it('the plugin is re-stamped with the new CLI version and the MANIFEST\'s company', () => {
    const dir = project('shop', 61);
    fs.mkdirSync(path.join(dir, '.solid', 'plugin'), { recursive: true });
    fs.writeFileSync(path.join(dir, '.solid', 'plugin', 'plugin.json'), JSON.stringify({ name: 'solid', version: '2.20.0' }));
    rememberProject(dir);
    refreshAllKits('2.25.0', true, tmp);
    const plugin = JSON.parse(fs.readFileSync(path.join(dir, '.solid', 'plugin', 'plugin.json'), 'utf8'));
    const mcp = fs.readFileSync(path.join(dir, '.solid', 'plugin', 'mcp.json'), 'utf8');
    expect(plugin.version).toBe('2.25.0');
    expect(mcp).toContain('61');
  });

  it('only what is there: skills without a plugin never grow a plugin', () => {
    const dir = project('shop', 61);
    staleSkill(dir);
    refreshAllKits('2.25.0', true, dir);
    expect(fs.existsSync(path.join(dir, '.solid', 'plugin'))).toBe(false);
  });

  it('⛔ a directory without a tenant manifest is never written', () => {
    const dir = project('unbound', null);
    staleSkill(dir);
    rememberProject(dir);
    expect(refreshAllKits('2.25.0', true, tmp)).toEqual([]);
    expect(fs.readFileSync(skill(dir), 'utf8')).toBe('old skill');
  });

  it('--check changes nothing', () => {
    const dir = project('shop', 61);
    staleSkill(dir);
    const [r] = refreshAllKits('2.25.0', false, dir);
    expect(r.state).toBe('would_update');
    expect(fs.readFileSync(skill(dir), 'utf8')).toBe('old skill');
  });

  it('a kit found where update runs is remembered; a deleted project is forgotten', () => {
    const here = project('here', 61);
    staleSkill(here);
    const gone = project('gone', 61);
    rememberProject(gone);
    fs.rmSync(gone, { recursive: true });
    refreshAllKits('2.25.0', true, here);
    expect(knownProjects()).toEqual([here]);
  });
});

describe('Render browser', () => {
  it('never downloaded → an update never starts a 150 MB download', async () => {
    expect((await refreshCachedChromium(true, path.join(tmp, 'chromium'))).state).toBe('absent');
    expect(fs.existsSync(path.join(tmp, 'chromium'))).toBe(false);
  });
});
