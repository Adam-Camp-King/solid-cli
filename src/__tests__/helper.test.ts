/**
 * The helper — what runs on a person's machine, and what it refuses.
 *
 * Pinned here: only a name in this machine's own list runs; an input is a name and
 * never a command; nothing runs without a grant this machine approved, for that grant
 * only, and never after Stop; a change is answered from the state read back, not from
 * what was asked; and no action ever goes through a shell.
 */
import { CATALOG, cleanInputs, gatewayFrom, platformOf, runAction, serviceStateFrom, type Exec } from '../lib/helper-actions';
import { HelperSession } from '../lib/helper-session';
import { MAC_SCRIPT, WINDOWS_SCRIPT, uiFrom } from '../lib/helper-ui';
import { WINDOWS_EXISTS, WINDOWS_VERSION, buildOf, macVersionFrom, windowsVersionFrom } from '../lib/helper-files';

type Call = { file: string; args: string[] };
const host = { platform: () => 'linux' as NodeJS.Platform, release: () => '6.1', arch: () => 'x64',
  networkInterfaces: () => ({ lo: [{ address: '127.0.0.1', netmask: '255.0.0.0', family: 'IPv4', internal: true }],
    eth0: [{ address: '192.168.1.50', netmask: '255.255.255.0', family: 'IPv4', internal: false }] }) } as never;

function machine(answers: Record<string, { code?: number; stdout?: string }> = {}) {
  const calls: Call[] = [];
  const exec: Exec = async (file, args) => {
    calls.push({ file, args });
    const hit = answers[`${file} ${args.join(' ')}`] ?? answers[file] ?? {};
    return { code: hit.code ?? 0, stdout: hit.stdout ?? '' };
  };
  return { calls, exec };
}

describe('the list', () => {
  it('is exactly the platform\'s eleven actions', () => {
    expect(Object.keys(CATALOG).sort()).toEqual(['file.exists', 'file.version', 'network.settings', 'process.running',
      'service.start', 'service.state', 'service.stop', 'system.info', 'ui.press', 'ui.read', 'ui.set']);
  });

  it.each(['shell.run', 'service.delete', '__proto__', 'constructor', '', 'service.stop; rm -rf /'])(
    'a name that is not on it is refused: %s', async (name) => {
      const m = machine();
      expect(await runAction(name, { service: 'x' }, 'linux', m.exec, host)).toEqual({ ok: false, reason: 'unknown_action' });
      expect(m.calls).toEqual([]);
    });
});

describe('inputs', () => {
  it.each(['utg2; reboot', 'a b', '../etc', '$(id)', '`id`', 'a|b', 'a"b', '', 'x'.repeat(81), '-rf'])(
    'an input that is not a plain name is refused: %s', async (service) => {
      const m = machine();
      expect(await runAction('service.stop', { service }, 'linux', m.exec, host)).toEqual({ ok: false, reason: 'bad_input' });
      expect(m.calls).toEqual([]);
    });

  it('an input the action does not take is a refusal, never dropped', () => {
    expect(cleanInputs('service.stop', { service: 'utg2', also: 'x' })).toEqual({ reason: 'unknown_input' });
    expect(cleanInputs('system.info', { anything: 1 })).toEqual({ reason: 'unknown_input' });
    expect(cleanInputs('service.stop', { service: 42 })).toEqual({ reason: 'bad_input' });
    expect(cleanInputs('service.stop', { service: 'UTG2.Service_1' })).toEqual({ inputs: { service: 'UTG2.Service_1' } });
  });
});

describe('what each platform is asked', () => {
  it('a service is stopped with one fixed program and its name as one argument', async () => {
    const win = machine({ 'sc.exe query utg2': { stdout: 'STATE : 1  STOPPED' } });
    expect(await runAction('service.stop', { service: 'utg2' }, 'windows', win.exec, host))
      .toEqual({ ok: true, data: { service: 'utg2', state: 'stopped' } });
    expect(win.calls).toEqual([{ file: 'sc.exe', args: ['stop', 'utg2'] }, { file: 'sc.exe', args: ['query', 'utg2'] }]);

    const linux = machine({ 'systemctl is-active utg2': { stdout: 'active\n' } });
    expect((await runAction('service.start', { service: 'utg2' }, 'linux', linux.exec, host)).ok).toBe(true);
    expect(linux.calls[0]).toEqual({ file: 'systemctl', args: ['start', 'utg2'] });
  });

  it('a change is answered from the state read back, not from what was asked', async () => {
    const stuck = machine({ 'sc.exe stop utg2': { code: 0 }, 'sc.exe query utg2': { stdout: 'STATE : 4  RUNNING' } });
    expect(await runAction('service.stop', { service: 'utg2' }, 'windows', stuck.exec, host))
      .toEqual({ ok: false, reason: 'state_did_not_change', data: { service: 'utg2', state: 'running' } });
    const denied = machine({ 'sc.exe stop utg2': { code: 5 }, 'sc.exe query utg2': { stdout: 'STATE : 4  RUNNING' } });
    expect((await runAction('service.stop', { service: 'utg2' }, 'windows', denied.exec, host)).reason).toBe('not_permitted_or_failed');
  });

  it('reads the machine without changing it', async () => {
    const m = machine({ ip: { stdout: 'default via 192.168.1.1 dev eth0' }, pgrep: { code: 1 } });
    expect(await runAction('system.info', {}, 'linux', m.exec, host)).toEqual({ ok: true, data: { platform: 'linux', release: '6.1', arch: 'x64' } });
    expect(await runAction('network.settings', {}, 'linux', m.exec, host))
      .toEqual({ ok: true, data: { address: '192.168.1.50', subnet_mask: '255.255.255.0', gateway: '192.168.1.1' } });
    expect(await runAction('process.running', { name: 'utg' }, 'linux', m.exec, host)).toEqual({ ok: true, data: { name: 'utg', running: false } });
    expect(await runAction('service.state', { service: 'nope' }, 'linux', m.exec, host)).toEqual({ ok: false, reason: 'service_not_found' });
  });

  it('a tool that throws, and a machine it does not know, are answers and not crashes', async () => {
    const broken: Exec = async () => { throw new Error('ENOENT'); };
    expect(await runAction('service.state', { service: 'x' }, 'linux', broken, host)).toEqual({ ok: false, reason: 'could_not_run' });
    expect(await runAction('system.info', {}, null, machine().exec, host)).toEqual({ ok: false, reason: 'unsupported_platform' });
    expect(platformOf('win32')).toBe('windows');
    expect(platformOf('darwin')).toBe('mac');
    expect(platformOf('sunos')).toBeNull();
  });

  it('parses what the tools print', () => {
    expect(serviceStateFrom('windows', 0, 'SERVICE_NAME: x\n  STATE              : 4  RUNNING')).toBe('running');
    expect(serviceStateFrom('linux', 3, 'inactive\n')).toBe('stopped');
    expect(serviceStateFrom('mac', 0, '{\n "PID" = 412;\n}')).toBe('running');
    expect(serviceStateFrom('mac', 0, '{\n "Label" = "x";\n}')).toBe('stopped');
    expect(serviceStateFrom('mac', 113, '')).toBe('unknown');
    expect(gatewayFrom('mac', '   gateway: 10.0.0.1\n')).toBe('10.0.0.1');
    expect(gatewayFrom('windows', '192.168.0.1\r\n')).toBe('192.168.0.1');
    expect(gatewayFrom('linux', 'nothing')).toBe('');
  });
});

describe('the second check, on the machine', () => {
  const ask = (extra: Record<string, unknown> = {}) => ({ type: 'do', rid: 'r1', action: 'system.info', inputs: {}, grant_id: 7, ...extra });

  it('nothing runs without a grant this machine approved', async () => {
    const m = machine();
    const s = new HelperSession('linux', m.exec);
    expect(await s.handle(ask())).toEqual({ rid: 'r1', result: { ok: false, reason: 'no_grant_on_this_machine' } });
    expect(m.calls).toEqual([]);
  });

  it('only for the grant it approved', async () => {
    const s = new HelperSession('linux', machine().exec);
    expect(s.approved(7)).toBe(true);
    expect((await s.handle(ask({ grant_id: 8 })))?.result).toEqual({ ok: false, reason: 'grant_not_this_one' });
    expect((await s.handle(ask({ grant_id: undefined })))?.result.reason).toBe('grant_not_this_one');
    expect((await s.handle(ask()))?.result.ok).toBe(true);
  });

  it('never after Stop, theirs or the platform\'s', async () => {
    const s = new HelperSession('linux', machine().exec);
    s.approved(7);
    s.stop();
    expect((await s.handle(ask()))?.result.reason).toBe('no_grant_on_this_machine');
    s.approved(7);
    expect(await s.handle({ type: 'grant_ended' })).toBeNull();
    expect(s.granted).toBe(false);
    s.approved(7);
    expect(await s.handle({ type: 'retired' })).toBeNull();
    expect(s.granted).toBe(false);
  });

  it('a grant id that is not one is not a grant', () => {
    const s = new HelperSession('linux', machine().exec);
    for (const bad of [0, -1, 1.5, '7', null, undefined]) expect(s.approved(bad)).toBe(false);
    expect(s.granted).toBe(false);
  });

  it('answers nothing to what it was not asked, and keeps a list of what it did', async () => {
    const s = new HelperSession('linux', machine().exec, () => 1000);
    s.approved(7);
    expect(await s.handle({ type: 'do', action: 'system.info' })).toBeNull();          // no request id
    expect(await s.handle({ type: 'hello' })).toBeNull();
    await s.handle(ask());
    await s.handle(ask({ action: 'shell.run' }));
    expect(s.log).toEqual([{ at: 1000, action: 'system.info', ok: true, reason: undefined },
      { at: 1000, action: 'shell.run', ok: false, reason: 'unknown_action' }]);
  });
});

describe('the line to the platform', () => {
  /* eslint-disable @typescript-eslint/no-var-requires */
  const { HelperClient, socketUrl, saveIdentity, loadIdentity, forgetIdentity } = require('../lib/helper-client');
  const fs = require('fs');
  const os = require('os');
  const path = require('path');

  const fetcher = (answers: Record<string, { ok?: boolean; status?: number; body?: unknown }>) => {
    const sent: Array<{ url: string; body: Record<string, unknown> }> = [];
    const fn = async (url: string, init: { body: string }) => {
      sent.push({ url, body: JSON.parse(init.body) });
      const hit = answers[url.split('/').pop() as string] ?? {};
      return { ok: hit.ok ?? true, status: hit.status ?? 200, json: async () => hit.body ?? {} };
    };
    return { fn, sent };
  };

  it('enrols with the code and keeps what it is handed', async () => {
    const f = fetcher({ enrol: { body: { token: 't'.repeat(43), endpoint_id: 12, name: 'Front desk' } } });
    const identity = await new HelperClient('https://api.test/', f.fn).enrol('ABCD-EFGH-JKLM', 'windows', '2.30.2');
    expect(identity).toEqual({ api_url: 'https://api.test/', token: 't'.repeat(43), endpoint_id: 12, name: 'Front desk' });
    expect(f.sent[0]).toEqual({ url: 'https://api.test/api/v1/remote/helper/enrol',
      body: { code: 'ABCD-EFGH-JKLM', platform: 'windows', version: '2.30.2' } });
  });

  it('a refused code, a broken answer and no network are all "not enrolled"', async () => {
    expect(await new HelperClient('https://a', fetcher({ enrol: { ok: false, status: 404 } }).fn).enrol('x', null, '1')).toBeNull();
    expect(await new HelperClient('https://a', fetcher({ enrol: { body: { token: 5 } } }).fn).enrol('x', null, '1')).toBeNull();
    const down = async () => { throw new Error('ECONNREFUSED'); };
    expect(await new HelperClient('https://a', down as never).enrol('x', null, '1')).toBeNull();
  });

  it('approval is the grant the platform names, or nothing', async () => {
    expect(await new HelperClient('https://a', fetcher({ approve: { body: { grant_id: 7 } } }).fn).approve('tok', '123456')).toBe(7);
    expect(await new HelperClient('https://a', fetcher({ approve: { ok: false, status: 404 } }).fn).approve('tok', '000000')).toBeNull();
    expect(await new HelperClient('https://a', fetcher({ approve: { body: { grant_id: '7' } } }).fn).approve('tok', '1')).toBeNull();
  });

  it('dials out to a socket on the API\'s own address', () => {
    expect(socketUrl('https://api.test/', 'a b')).toBe('wss://api.test/api/v1/remote/helper/connect?token=a%20b');
    expect(socketUrl('http://localhost:8000', 't')).toBe('ws://localhost:8000/api/v1/remote/helper/connect?token=t');
  });

  it('keeps the machine\'s token in a file only this user can read', () => {
    const file = path.join(fs.mkdtempSync(path.join(os.tmpdir(), 'helper-')), 'helper.json');
    expect(loadIdentity(file)).toBeNull();
    saveIdentity({ api_url: 'https://a', token: 't'.repeat(43), endpoint_id: 1, name: 'x' }, file);
    if (process.platform !== 'win32') expect(fs.statSync(file).mode & 0o777).toBe(0o600);
    expect(loadIdentity(file).endpoint_id).toBe(1);
    fs.writeFileSync(file, '{"token":"short","api_url":"https://a"}');
    expect(loadIdentity(file)).toBeNull();
    expect(forgetIdentity(file)).toBe(true);
    expect(forgetIdentity(file)).toBe(false);
  });
});


describe('a program\'s window, by its labels', () => {
  type Seen = { file: string; args: string[]; env?: Record<string, string>; timeoutMs?: number };
  function desk(stdout: string) {
    const seen: Seen[] = [];
    const exec: Exec = async (file, args, options) => {
      seen.push({ file, args, env: options?.env, timeoutMs: options?.timeoutMs });
      return { code: 0, stdout };
    };
    return { seen, exec };
  }
  const WINDOW = ['WIN\tTerminal Setup', 'CTL\tEdit\tDevice type\tVX520', 'CTL\tAXTextField\tPassword\t(hidden)',
    'CTL\tButton\tSave\t', 'CTL\tAXPopUpButton\tLane\t2', 'junk line'].join('\n');

  it('reads the labelled controls of the front window as short lines', async () => {
    const d = desk(WINDOW);
    const out = await runAction('ui.read', { program: 'Setup' }, 'mac', d.exec, host);
    expect(out).toEqual({ ok: true, data: { program: 'Setup', window: 'Terminal Setup', count: 4,
      controls: ['Field: Device type = VX520', 'Field: Password = (hidden)', 'Button: Save', 'List: Lane = 2'] } });
    expect(d.seen[0].file).toBe('osascript');
    expect(d.seen[0].args).toEqual(['-e', MAC_SCRIPT, 'read', 'Setup']);
    expect(d.seen[0].timeoutMs).toBe(10000);
  });

  it('the script is fixed text: on a Mac the inputs are arguments, on Windows they are in the environment', async () => {
    const mac = desk('OK\tVX 680');
    await runAction('ui.set', { program: 'Setup', control: 'Device type', value: 'VX 680' }, 'mac', mac.exec, host);
    expect(mac.seen[0].args).toEqual(['-e', MAC_SCRIPT, 'set', 'Setup', 'Device type', 'VX 680']);
    const win = desk('OK\tVX 680');
    await runAction('ui.set', { program: 'Setup', control: 'Device type', value: 'VX 680' }, 'windows', win.exec, host);
    expect(win.seen[0].file).toBe('powershell.exe');
    expect(win.seen[0].args.slice(0, 3)).toEqual(['-NoProfile', '-NonInteractive', '-EncodedCommand']);
    expect(Buffer.from(win.seen[0].args[3], 'base64').toString('utf16le')).toBe(WINDOWS_SCRIPT);
    expect(win.seen[0].env).toEqual({ SOLID_UI_MODE: 'set', SOLID_UI_PROGRAM: 'Setup', SOLID_UI_CONTROL: 'Device type', SOLID_UI_VALUE: 'VX 680' });
    for (const script of [MAC_SCRIPT, WINDOWS_SCRIPT]) {
      expect(script).not.toContain('VX 680');
      expect(script).not.toContain('Device type');
    }
  });

  it('a set is answered from what the field holds afterwards, not from what was asked', async () => {
    const held = desk('OK\tVX520');
    expect(await runAction('ui.set', { program: 'Setup', control: 'Device type', value: 'VX 680' }, 'windows', held.exec, host))
      .toEqual({ ok: false, reason: 'value_did_not_change', data: { control: 'Device type', holds: 'VX520' } });
    const done = desk('OK\tVX 680');
    expect(await runAction('ui.set', { program: 'Setup', control: 'Device type', value: 'VX 680' }, 'windows', done.exec, host))
      .toEqual({ ok: true, data: { program: 'Setup', control: 'Device type', holds: 'VX 680' } });
  });

  it('a press names what it pressed', async () => {
    const d = desk('OK');
    expect(await runAction('ui.press', { program: 'Setup', control: 'Save' }, 'mac', d.exec, host))
      .toEqual({ ok: true, data: { program: 'Setup', pressed: 'Save' } });
  });

  it.each([
    ['ERR\tpassword_field', 'password_field'], ['ERR\tcontrol_not_found', 'control_not_found'],
    ['ERR\tprogram_not_running', 'program_not_running'], ['ERR\tno_window', 'no_window'],
    ['ERR\tvalue_not_offered', 'value_not_offered'], ['ERR\tcontrol_disabled', 'control_disabled'],
    ['ERR\tscript\t-1719', 'not_permitted'], ['ERR\tscript\t-25211', 'not_permitted'],
    ['ERR\tscript\t-50', 'could_not_read_window'], ['ERR\tsomething new', 'could_not_read_window'],
    ['', 'could_not_read_window'], ['<html>', 'could_not_read_window'],
  ])('what the machine refused is said plainly: %j', async (stdout, reason) => {
    const d = desk(stdout);
    expect(await runAction('ui.set', { program: 'Setup', control: 'Password', value: 'x' }, 'mac', d.exec, host))
      .toEqual({ ok: false, reason });
  });

  it('both scripts refuse a password field and never print what one holds', () => {
    expect(WINDOWS_SCRIPT).toContain("if ($e.Current.IsPassword) { 'ERR' + $T + 'password_field'; exit 0 }");
    expect(WINDOWS_SCRIPT).toContain("if ($e.Current.IsPassword) { return '(hidden)' }");
    expect(MAC_SCRIPT).toContain('if sr is "AXSecureTextField" then return "ERR" & tab & "password_field"');
    expect(MAC_SCRIPT).toContain('if sr is "AXSecureTextField" then return "(hidden)"');
  });

  it('a label may carry a space; neither a label nor a value may carry a quote or a shell character', async () => {
    expect(cleanInputs('ui.set', { program: 'Setup', control: 'Device type (lane 2)', value: 'VX 680' }).inputs).toBeDefined();
    for (const bad of ['a"b', "a'b", 'a`b', 'a$b', 'a;b', 'a|b', 'a\\b', 'a\nb', '', ' x', 'x'.repeat(81)]) {
      expect(cleanInputs('ui.set', { program: 'Setup', control: bad, value: 'x' }).reason).toBe('bad_input');
      expect(cleanInputs('ui.set', { program: 'Setup', control: 'Name', value: bad }).reason).toBe('bad_input');
    }
    // The program is a name: no space.
    expect(cleanInputs('ui.read', { program: 'My App' }).reason).toBe('bad_input');
    expect(cleanInputs('ui.press', { program: 'Setup', control: 'Save', value: 'x' }).reason).toBe('unknown_input');
  });

  it('is not offered on Linux, and nothing is run there', async () => {
    const d = desk(WINDOW);
    expect(await runAction('ui.read', { program: 'Setup' }, 'linux', d.exec, host))
      .toEqual({ ok: false, reason: 'not_supported_on_this_system' });
    expect(d.seen).toEqual([]);
  });

  it('at most forty controls come back, each cut to size', () => {
    const many = ['WIN\tW', ...Array.from({ length: 70 }, (_, i) => `CTL\tButton\t${'n'.repeat(90)}${i}\t${'v'.repeat(90)}`)].join('\n');
    const got = uiFrom(many);
    expect(got.controls).toHaveLength(40);
    expect(Math.max(...(got.controls || []).map((c) => c.length))).toBeLessThanOrEqual(8 + 50 + 3 + 60);
  });

  it('needs a grant like any other action', async () => {
    const d = desk(WINDOW);
    const s = new HelperSession('mac', d.exec);
    expect((await s.handle({ type: 'do', rid: 'r1', action: 'ui.press', inputs: { program: 'Setup', control: 'Save' }, grant_id: 7 }))?.result.reason)
      .toBe('no_grant_on_this_machine');
    expect(d.seen).toEqual([]);
  });
});


describe('a file on this machine, read only', () => {
  type Seen = { file: string; args: string[]; env?: Record<string, string> };
  function box(answers: Record<string, { code?: number; stdout?: string }>) {
    const seen: Seen[] = [];
    const exec: Exec = async (file, args, options) => {
      seen.push({ file, args, env: options?.env });
      const hit = answers[file] ?? {};
      return { code: hit.code ?? 0, stdout: hit.stdout ?? '' };
    };
    return { seen, exec };
  }
  const UTG = 'C:\\Shift4\\UTG2\\Utg2.exe';

  it.each([
    ['C:\\Shift4\\UTG2\\Utg2.exe', true], ['C:\\ProgramData\\shift4.in4m\\agentState.json', true],
    ['/Applications/Setup.app', true], ['C:\\a\\..\\b', false], ['C:\\x*', false], ['Utg2.exe', false],
    ['\\\\server\\share', false], ['C:\\a;b', false], ['/tmp/$HOME', false], ['C:\\a"b', false],
    ['C:\\' + 'a'.repeat(300), false],
  ])('a path names one file and nothing else: %s', (path, ok) => {
    expect(Boolean(cleanInputs('file.version', { path }).inputs)).toBe(ok);
    expect(Boolean(cleanInputs('file.exists', { path }).inputs)).toBe(ok);
  });

  it('reads the version and build of a program file on Windows, the path passed as data', async () => {
    const b = box({ 'powershell.exe': { stdout: 'OK\t4.1.1.3191\t4.1.1.3191\r\n' } });
    expect(await runAction('file.version', { path: UTG }, 'windows', b.exec, host))
      .toEqual({ ok: true, data: { path: UTG, version: '4.1.1.3191', build: 3191 } });
    expect(b.seen[0].env).toEqual({ SOLID_PATH: UTG });
    expect(Buffer.from(b.seen[0].args[3], 'base64').toString('utf16le')).toBe(WINDOWS_VERSION);
    expect(WINDOWS_VERSION).not.toContain('Utg2');
  });

  it('says plainly when the file is missing or carries no version', async () => {
    expect(await runAction('file.version', { path: UTG }, 'windows', box({ 'powershell.exe': { stdout: 'missing' } }).exec, host))
      .toEqual({ ok: false, reason: 'file_not_found' });
    expect(windowsVersionFrom('OK\t\t')).toEqual({ reason: 'no_version_in_file' });
    expect(windowsVersionFrom('error')).toEqual({ reason: 'could_not_read_file' });
    expect(macVersionFrom(1, '')).toEqual({ reason: 'file_not_found' });
    expect(macVersionFrom(0, '(null)\n')).toEqual({ reason: 'no_version_in_file' });
    expect(macVersionFrom(0, '12.0')).toEqual({ version: '12.0' });
  });

  it('on a Mac, reads the version with mdls and checks a file with test', async () => {
    const b = box({ mdls: { stdout: '12.0' }, test: { code: 1 } });
    expect(await runAction('file.version', { path: '/Applications/Setup.app' }, 'mac', b.exec, host))
      .toEqual({ ok: true, data: { path: '/Applications/Setup.app', version: '12.0', build: 0 } });
    expect(b.seen[0]).toEqual({ file: 'mdls', args: ['-raw', '-name', 'kMDItemVersion', '/Applications/Setup.app'], env: undefined });
    expect(await runAction('file.exists', { path: '/Applications/Missing.app' }, 'mac', b.exec, host))
      .toEqual({ ok: true, data: { path: '/Applications/Missing.app', exists: false } });
  });

  it('checks a file on Windows through a fixed script', async () => {
    const b = box({ 'powershell.exe': { stdout: 'yes' } });
    expect(await runAction('file.exists', { path: 'C:\\ProgramData\\shift4.in4m\\agentState.json' }, 'windows', b.exec, host))
      .toEqual({ ok: true, data: { path: 'C:\\ProgramData\\shift4.in4m\\agentState.json', exists: true } });
    expect(Buffer.from(b.seen[0].args[3], 'base64').toString('utf16le')).toBe(WINDOWS_EXISTS);
    expect(await runAction('file.exists', { path: 'C:\\x\\y' }, 'windows', box({ 'powershell.exe': { stdout: '<html>' } }).exec, host))
      .toEqual({ ok: false, reason: 'could_not_read_file' });
  });

  it('the build is the last number of a version', () => {
    expect(buildOf('4.1.1.3191')).toBe(3191);
    expect(buildOf('5.0.0.3289')).toBe(3289);
    expect(buildOf('')).toBeNull();
  });

  it('is not offered on Linux', async () => {
    const b = box({});
    expect(await runAction('file.exists', { path: '/etc/hosts' }, 'linux', b.exec, host)).toEqual({ ok: false, reason: 'not_supported_on_this_system' });
    expect(b.seen).toEqual([]);
  });
});
