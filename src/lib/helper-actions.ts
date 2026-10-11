/**
 * The named actions the helper can run on this machine — and nothing else.
 *
 * The same list as the platform's (solid-backend/services/remote/actions.py). The
 * platform asks for an action by NAME with named inputs; this file decides what that
 * name means here. A name that is not in this list is refused, whoever asks.
 *
 * ⛔ NO SHELL. Every action runs one fixed program with its arguments as an array
 *    (`execFile`), never a command line. An input is a NAME (letters, digits and a few
 *    separators) or a LABEL as it reads on screen (a name that may also carry a space
 *    and the marks a label has); it is checked before it is used, and reaches the
 *    program as data.
 * ⛔ ADDING AN ACTION is a decision about what may be done on someone's computer: add
 *    it here AND in the platform's list, with its undo and its proof.
 *
 * `exec` is handed in, so every action is testable without touching a machine.
 */
import * as os from 'os';
import { runUi } from './helper-ui';

export type Platform = 'windows' | 'mac' | 'linux';
export type Kind = 'probe' | 'act';
export type ActionResult = { ok: boolean; reason?: string; data?: Record<string, string | number | boolean | string[]> };
export type ExecOptions = { env?: Record<string, string>; timeoutMs?: number };
export type Exec = (file: string, args: string[], options?: ExecOptions) => Promise<{ code: number; stdout: string }>;

const NAME = /^[A-Za-z0-9][A-Za-z0-9_.@-]{0,79}$/;
const LABEL = /^[A-Za-z0-9][A-Za-z0-9 _.@:&/()#+,-]{0,79}$/;
// The inputs that are a label as it reads on screen; every other input is a name.
const LABELS = new Set(['control', 'value']);

export const CATALOG: Record<string, { kind: Kind; inputs: string[] }> = {
  'system.info': { kind: 'probe', inputs: [] },
  'network.settings': { kind: 'probe', inputs: [] },
  'service.state': { kind: 'probe', inputs: ['service'] },
  'process.running': { kind: 'probe', inputs: ['name'] },
  'service.stop': { kind: 'act', inputs: ['service'] },
  'service.start': { kind: 'act', inputs: ['service'] },
  // A program's own window, by the labels on it (helper-ui.ts). Windows and Mac.
  'ui.read': { kind: 'probe', inputs: ['program'] },
  'ui.set': { kind: 'act', inputs: ['program', 'control', 'value'] },
  'ui.press': { kind: 'act', inputs: ['program', 'control'] },
};

export function platformOf(nodePlatform: string = process.platform): Platform | null {
  return nodePlatform === 'win32' ? 'windows' : nodePlatform === 'darwin' ? 'mac' : nodePlatform === 'linux' ? 'linux' : null;
}

/** PURE. The inputs exactly as this action takes them, or the reason they are refused. */
export function cleanInputs(action: string, inputs: unknown): { inputs?: Record<string, string>; reason?: string } {
  const spec = Object.prototype.hasOwnProperty.call(CATALOG, action) ? CATALOG[action] : null;
  if (!spec) return { reason: 'unknown_action' };
  const given = inputs && typeof inputs === 'object' ? (inputs as Record<string, unknown>) : {};
  if (Object.keys(given).some((k) => !spec.inputs.includes(k))) return { reason: 'unknown_input' };
  const out: Record<string, string> = {};
  for (const key of spec.inputs) {
    const value = given[key];
    if (typeof value !== 'string' || !(LABELS.has(key) ? LABEL : NAME).test(value)) return { reason: 'bad_input' };
    out[key] = value;
  }
  return { inputs: out };
}

/** PURE. A service's state from what the platform's own tool printed. */
export function serviceStateFrom(platform: Platform, code: number, stdout: string): 'running' | 'stopped' | 'unknown' {
  const text = stdout.toLowerCase();
  if (platform === 'windows') return /state\s*:\s*4\s+running/.test(text) ? 'running' : /state\s*:\s*1\s+stopped/.test(text) ? 'stopped' : 'unknown';
  if (platform === 'linux') return text.trim() === 'active' ? 'running' : ['inactive', 'failed', 'deactivating'].includes(text.trim()) ? 'stopped' : 'unknown';
  if (code !== 0) return 'unknown';
  return /"pid"\s*=\s*\d+/.test(text) ? 'running' : 'stopped';
}

/** PURE. The default gateway from what the platform's own tool printed. */
export function gatewayFrom(platform: Platform, stdout: string): string {
  const found = platform === 'mac' ? /gateway:\s*([0-9a-f.:]+)/i.exec(stdout)
    : platform === 'linux' ? /default via\s+([0-9a-f.:]+)/i.exec(stdout)
    : /([0-9]{1,3}(?:\.[0-9]{1,3}){3})/.exec(stdout);
  return found ? found[1] : '';
}

async function serviceState(platform: Platform, service: string, exec: Exec): Promise<'running' | 'stopped' | 'unknown'> {
  const run = platform === 'windows' ? exec('sc.exe', ['query', service])
    : platform === 'linux' ? exec('systemctl', ['is-active', service])
    : exec('launchctl', ['list', service]);
  const { code, stdout } = await run;
  return serviceStateFrom(platform, code, stdout);
}

/** Run ONE named action. Never throws: a failure is `{ ok: false, reason }`. */
export async function runAction(action: string, rawInputs: unknown, platform: Platform | null, exec: Exec,
  host: Pick<typeof os, 'platform' | 'release' | 'arch' | 'networkInterfaces'> = os): Promise<ActionResult> {
  const cleaned = cleanInputs(action, rawInputs);
  if (!cleaned.inputs) return { ok: false, reason: cleaned.reason };
  if (!platform) return { ok: false, reason: 'unsupported_platform' };
  const inputs = cleaned.inputs;
  try {
    switch (action) {
      case 'system.info':
        return { ok: true, data: { platform, release: host.release(), arch: host.arch() } };
      case 'network.settings': {
        const own = Object.values(host.networkInterfaces()).flat()
          .find((n) => n && !n.internal && n.family === 'IPv4');
        const route = platform === 'mac' ? await exec('route', ['-n', 'get', 'default'])
          : platform === 'linux' ? await exec('ip', ['route', 'show', 'default'])
          : await exec('powershell.exe', ['-NoProfile', '-NonInteractive', '-Command',
            '(Get-NetRoute -DestinationPrefix 0.0.0.0/0 | Select-Object -First 1).NextHop']);
        if (!own) return { ok: false, reason: 'no_network' };
        return { ok: true, data: { address: own.address, subnet_mask: own.netmask, gateway: gatewayFrom(platform, route.stdout) } };
      }
      case 'service.state': {
        const state = await serviceState(platform, inputs.service, exec);
        return state === 'unknown' ? { ok: false, reason: 'service_not_found' } : { ok: true, data: { service: inputs.service, state } };
      }
      case 'process.running': {
        const found = platform === 'windows'
          ? (await exec('tasklist.exe', ['/FI', `IMAGENAME eq ${inputs.name}`, '/NH'])).stdout.toLowerCase().includes(inputs.name.toLowerCase())
          : (await exec('pgrep', ['-x', inputs.name])).code === 0;
        return { ok: true, data: { name: inputs.name, running: found } };
      }
      case 'service.stop':
      case 'service.start': {
        const verb = action === 'service.stop' ? 'stop' : 'start';
        const done = platform === 'windows' ? await exec('sc.exe', [verb, inputs.service])
          : platform === 'linux' ? await exec('systemctl', [verb, inputs.service])
          : await exec('launchctl', [verb, inputs.service]);
        // What was asked is not what happened: read the state back before answering.
        const state = await serviceState(platform, inputs.service, exec);
        const wanted = verb === 'stop' ? 'stopped' : 'running';
        if (state !== wanted) return { ok: false, reason: done.code !== 0 ? 'not_permitted_or_failed' : 'state_did_not_change', data: { service: inputs.service, state } };
        return { ok: true, data: { service: inputs.service, state } };
      }
      case 'ui.read':
      case 'ui.set':
      case 'ui.press':
        return await runUi(action, inputs, platform, exec);
      default:
        return { ok: false, reason: 'unknown_action' };
    }
  } catch {
    return { ok: false, reason: 'could_not_run' };
  }
}
