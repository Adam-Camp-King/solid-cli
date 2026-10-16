/**
 * A file on this machine, read only: is it there, and what version is written into it.
 *
 * Used for questions a set-up has to answer before it changes anything: is a program's
 * agent installed (its data file is there), and which build of a program is installed
 * (the version written into its program file).
 *
 * ⛔ READ ONLY. Nothing here opens, runs or changes a file.
 * ⛔ THE PATH IS DATA. On Windows it reaches a fixed PowerShell script through an
 *    environment variable and is used with -LiteralPath, so nothing in it is expanded; on
 *    a Mac it is one argument to a fixed program.
 */
import type { ActionResult, Exec, Platform } from './helper-actions';

const FILE_TIMEOUT_MS = 8000;

// Single quotes only, no backtick, sent base64-encoded: nothing on the way re-reads it.
export const WINDOWS_EXISTS = `
$ErrorActionPreference = 'Stop'
try { if (Test-Path -LiteralPath $env:SOLID_PATH) { 'yes' } else { 'no' } } catch { 'error' }
`;
export const WINDOWS_VERSION = `
$ErrorActionPreference = 'Stop'
$T = [char]9
try {
  if (-not (Test-Path -LiteralPath $env:SOLID_PATH -PathType Leaf)) { 'missing'; exit 0 }
  $v = (Get-Item -LiteralPath $env:SOLID_PATH).VersionInfo
  'OK' + $T + [string]$v.ProductVersion + $T + [string]$v.FileVersion
} catch { 'error' }
`;

const encoded = (script: string) => Buffer.from(script, 'utf16le').toString('base64');
const POWERSHELL = ['-NoProfile', '-NonInteractive', '-EncodedCommand'];

/** PURE. The build in a version: its last number. "4.1.1.3191" is 3191. */
export function buildOf(version: string): number | null {
  const parts = (version || '').match(/\d+/g);
  return parts ? Number(parts[parts.length - 1]) : null;
}

/** PURE. What the Windows version script printed → the version, or why not. */
export function windowsVersionFrom(stdout: string): { version?: string; reason?: string } {
  const line = stdout.split(/\r?\n/).map((l) => l.trim()).find(Boolean) || '';
  if (line === 'missing') return { reason: 'file_not_found' };
  const [tag, product, file] = line.split('\t');
  if (tag !== 'OK') return { reason: 'could_not_read_file' };
  const version = (product || '').trim() || (file || '').trim();
  return version ? { version } : { reason: 'no_version_in_file' };
}

/** PURE. What `mdls -raw -name kMDItemVersion` printed → the version, or why not. */
export function macVersionFrom(code: number, stdout: string): { version?: string; reason?: string } {
  const text = stdout.trim();
  if (code !== 0) return { reason: 'file_not_found' };
  if (!text || text === '(null)') return { reason: 'no_version_in_file' };
  return { version: text };
}

export async function runFile(action: string, path: string, platform: Platform, exec: Exec): Promise<ActionResult> {
  if (platform === 'linux') return { ok: false, reason: 'not_supported_on_this_system' };
  if (action === 'file.exists') {
    if (platform === 'windows') {
      const out = (await exec('powershell.exe', [...POWERSHELL, encoded(WINDOWS_EXISTS)],
        { env: { SOLID_PATH: path }, timeoutMs: FILE_TIMEOUT_MS })).stdout.trim();
      if (out !== 'yes' && out !== 'no') return { ok: false, reason: 'could_not_read_file' };
      return { ok: true, data: { path, exists: out === 'yes' } };
    }
    const done = await exec('test', ['-e', path], { timeoutMs: FILE_TIMEOUT_MS });
    return { ok: true, data: { path, exists: done.code === 0 } };
  }
  const got = platform === 'windows'
    ? windowsVersionFrom((await exec('powershell.exe', [...POWERSHELL, encoded(WINDOWS_VERSION)],
      { env: { SOLID_PATH: path }, timeoutMs: FILE_TIMEOUT_MS })).stdout)
    : await (async () => { const r = await exec('mdls', ['-raw', '-name', 'kMDItemVersion', path], { timeoutMs: FILE_TIMEOUT_MS });
      return macVersionFrom(r.code, r.stdout); })();
  if (!got.version) return { ok: false, reason: got.reason };
  const build = buildOf(got.version);
  return { ok: true, data: { path, version: got.version, ...(build === null ? {} : { build }) } };
}
