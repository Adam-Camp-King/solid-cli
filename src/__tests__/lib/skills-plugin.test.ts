/**
 * Agent Plugins 1.1.0 conformance for what `solid agent setup` writes.
 *
 * ⛔ THESE ASSERTIONS ARE TRANSCRIBED FROM THE NORMATIVE SCHEMAS, NOT FROM THE
 * PROSE. Both `plugin.schema.json` and `mcp.schema.json` are CLOSED
 * (`additionalProperties: false`) and the spec makes a schema violation other
 * than an unknown top-level field FATAL — the client rejects the plugin and
 * loads none of its components. So "it has the fields we meant" is not the
 * test; "it has ONLY permitted fields" is. A helpful extra key is a broken
 * plugin.
 *
 * The schemas are pinned here rather than fetched: §5.2.1 forbids a client
 * from retrieving a schema while loading a plugin, and a test that reached the
 * network would fail offline and drift silently when the spec moved.
 */
import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';

import {
  AGENT_PLUGINS_VERSION,
  MCP_SCHEMA_URL,
  PLUGIN_DIR,
  PLUGIN_SCHEMA_URL,
  buildMcpConfig,
  buildPluginManifest,
  isValidPluginName,
  writePlugin,
} from '../../lib/skills/plugin';
import { SKILLS } from '../../lib/skills/index';

/** plugin.schema.json 1.1.0, `properties` keys. The schema is closed. */
const PLUGIN_FIELDS = new Set([
  '$schema', 'name', 'version', 'description', 'author',
  'homepage', 'repository', 'license', 'keywords', 'extensions',
]);

/** mcp.schema.json 1.1.0 stdio server, `properties` keys. Also closed. */
const STDIO_FIELDS = new Set(['type', 'command', 'args', 'env', 'cwd']);

describe('plugin.json conforms to Agent Plugins 1.1.0', () => {
  const manifest = buildPluginManifest({ name: 'solid', version: '2.22.0' });

  it('declares the exact canonical schema identifier', () => {
    // §5.2.1: the value MUST be the canonical identifier for the targeted
    // version, and clients MUST reject a version they do not recognise. This
    // is the one field that cannot be approximated.
    expect(manifest.$schema).toBe(PLUGIN_SCHEMA_URL);
    expect(manifest.$schema).toContain(`/${AGENT_PLUGINS_VERSION}/`);
  });

  it('carries both required fields', () => {
    expect(manifest.$schema).toBeTruthy();
    expect(manifest.name).toBeTruthy();
  });

  it('emits no field outside the closed schema', () => {
    for (const key of Object.keys(manifest)) expect(PLUGIN_FIELDS.has(key)).toBe(true);
  });

  it('omits an unknown optional rather than writing an empty string', () => {
    // "" satisfies `type: string` and then shows up as a blank description in
    // a client's plugin list. Absent is the honest encoding.
    const bare = buildPluginManifest({ name: 'solid' });
    expect('version' in bare).toBe(false);
    expect('description' in bare).toBe(false);
  });

  it('enforces the §5.5 name constraints', () => {
    expect(isValidPluginName('solid')).toBe(true);
    expect(isValidPluginName('solid-number.cli')).toBe(true);
    expect(isValidPluginName('Solid')).toBe(false);        // uppercase
    expect(isValidPluginName('-solid')).toBe(false);       // must end alphanumeric
    expect(isValidPluginName('solid-')).toBe(false);
    expect(isValidPluginName('solid--cli')).toBe(false);   // no --
    expect(isValidPluginName('solid..cli')).toBe(false);   // no ..
    expect(isValidPluginName('a'.repeat(65))).toBe(false); // 64 max
    expect(() => buildPluginManifest({ name: 'Solid' })).toThrow(/5\.5/);
  });
});

describe('mcp.json conforms to Agent Plugins 1.1.0', () => {
  const cfg = buildMcpConfig({ companyId: 1 });
  const server = cfg.mcpServers.solid;

  it('declares the canonical MCP schema and the required server map', () => {
    expect(cfg.$schema).toBe(MCP_SCHEMA_URL);
    expect(cfg.mcpServers).toBeDefined();
  });

  it('sets the transport discriminator', () => {
    // ⛔ REGRESSION GUARD. The server object is a `oneOf` discriminated on
    // `type`. Our own native client configs (lib/mcp-client-config.ts) omit
    // it and are still valid there — copying that shape here would fail the
    // schema outright while looking correct.
    expect(server.type).toBe('stdio');
    expect(server.command).toBe('npx');
  });

  it('emits no field outside the closed stdio schema', () => {
    for (const key of Object.keys(server)) expect(STDIO_FIELDS.has(key)).toBe(true);
  });

  it('never reserves PLUGIN_ROOT or PLUGIN_DATA as env names', () => {
    // The schema forbids both as `env` property names.
    for (const key of Object.keys(server.env ?? {})) {
      expect(['PLUGIN_ROOT', 'PLUGIN_DATA']).not.toContain(key);
    }
  });

  it('⛔ carries no credential — a plugin directory is distributable', () => {
    // buildServerEntry in mcp-client-config DOES put SOLID_API_KEY in env,
    // because a client config is a private file on one machine. A plugin is
    // meant to be shared. The two look alike and are opposites.
    const serialised = JSON.stringify(buildMcpConfig({ companyId: 1, apiUrl: 'https://api.solidnumber.com' }));
    expect(serialised).not.toMatch(/SOLID_API_KEY/);
    expect(serialised).not.toMatch(/api[_-]?key/i);
    expect(serialised).not.toMatch(/token|secret|password/i);
  });

  it('pins the tenant, which is not a secret', () => {
    expect(server.env?.SOLID_COMPANY_ID).toBe('1');
  });
});

describe('writePlugin produces the standard layout', () => {
  let dir: string;
  beforeEach(() => { dir = fs.mkdtempSync(path.join(os.tmpdir(), 'solid-plugin-')); });
  afterEach(() => { fs.rmSync(dir, { recursive: true, force: true }); });

  it('writes plugin.json, mcp.json and one skills/<name>/SKILL.md each', () => {
    const written = writePlugin(dir, SKILLS, { manifest: { name: 'solid' } });
    const root = path.join(dir, PLUGIN_DIR);

    expect(fs.existsSync(path.join(root, 'plugin.json'))).toBe(true);
    expect(fs.existsSync(path.join(root, 'mcp.json'))).toBe(true);
    for (const s of SKILLS) {
      expect(fs.existsSync(path.join(root, 'skills', s.dirname, 'SKILL.md'))).toBe(true);
    }
    expect(written).toHaveLength(2 + SKILLS.length);
    expect(written.every((f) => f.state === 'written')).toBe(true);
  });

  it('places every skill exactly one level under skills/', () => {
    // §7.1: only IMMEDIATE children of skills/ are discovered — clients MUST
    // NOT search deeper. A nested layout silently installs nothing.
    writePlugin(dir, SKILLS, { manifest: { name: 'solid' } });
    const skillsDir = path.join(dir, PLUGIN_DIR, 'skills');
    for (const entry of fs.readdirSync(skillsDir)) {
      expect(fs.statSync(path.join(skillsDir, entry)).isDirectory()).toBe(true);
      expect(fs.existsSync(path.join(skillsDir, entry, 'SKILL.md'))).toBe(true);
    }
  });

  it('writes valid JSON that round-trips', () => {
    writePlugin(dir, SKILLS, { manifest: { name: 'solid', version: '2.22.0' } });
    const root = path.join(dir, PLUGIN_DIR);
    const manifest = JSON.parse(fs.readFileSync(path.join(root, 'plugin.json'), 'utf8'));
    const mcp = JSON.parse(fs.readFileSync(path.join(root, 'mcp.json'), 'utf8'));
    expect(manifest.name).toBe('solid');
    expect(manifest.version).toBe('2.22.0');
    expect(mcp.mcpServers.solid.type).toBe('stdio');
  });

  it('is quiet on a re-run when nothing changed', () => {
    writePlugin(dir, SKILLS, { manifest: { name: 'solid' } });
    const again = writePlugin(dir, SKILLS, { manifest: { name: 'solid' } });
    expect(again.every((f) => f.state === 'unchanged')).toBe(true);
  });

  it('stays inside the tenant-guarded .solid directory', () => {
    // §4.1: everything a client reads must resolve within the plugin root,
    // and everything we WRITE must stay inside the boundary requireTenantManifest
    // governs. Both hold only if the root is where we say it is.
    expect(PLUGIN_DIR.split(path.sep)[0]).toBe('.solid');
    const written = writePlugin(dir, SKILLS, { manifest: { name: 'solid' } });
    for (const f of written) {
      expect(path.resolve(f.path).startsWith(path.resolve(dir, PLUGIN_DIR))).toBe(true);
    }
  });
});
