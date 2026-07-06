/**
 * Init command tests — the Solid# starter kit.
 *
 * Tests the REAL pure builder (buildStarterFiles), not a simulation: a project
 * scaffolded for a company_id must be tenant-stamped, carry the operating-rules
 * CLAUDE.md, and never leak the scoped token into git.
 */

import {
  buildStarterFiles,
  renderStarterClaudeMd,
  STARTER_VERSION,
  StarterContext,
} from '../../commands/init';

function ctx(overrides: Partial<StarterContext> = {}): StarterContext {
  return {
    name: 'acme-site',
    type: 'basic',
    typeLabel: 'Basic App',
    companyId: 61,
    apiUrl: 'https://api.solidnumber.com',
    connectorUrl: 'https://api.solidnumber.com/mcp/connector',
    ...overrides,
  };
}

describe('starter kit — buildStarterFiles', () => {
  it('lands the starter-kit layer on top of the template', () => {
    const files = buildStarterFiles(ctx());
    expect(Object.keys(files)).toEqual(
      expect.arrayContaining(['package.json', 'CLAUDE.md', '.solid/config.json', '.gitignore', '.env.example']),
    );
  });

  it('.solid/config.json tenant-stamps company_id + connector + version', () => {
    const cfg = JSON.parse(buildStarterFiles(ctx())['.solid/config.json']);
    expect(cfg.companyId).toBe(61);
    expect(cfg.connectorUrl).toBe('https://api.solidnumber.com/mcp/connector');
    expect(cfg.starterVersion).toBe(STARTER_VERSION);
  });

  it('CLAUDE.md carries the operating rules and the connector protocol', () => {
    const md = buildStarterFiles(ctx())['CLAUDE.md'];
    expect(md).toContain('company_id 61');
    expect(md).toContain('Ground, don');            // rule 1
    expect(md).toContain('Persist everything');     // rule 2
    expect(md).toContain('confirm=true');           // rule 3 (preview→confirm→written)
    expect(md).toContain('start_here');             // rule 5
    expect(md).toContain('end_session');            // rule 5
  });

  it('.gitignore keeps the scoped token out of the client git', () => {
    const gi = buildStarterFiles(ctx())['.gitignore'];
    expect(gi).toContain('.env');
    expect(gi).toContain('.solid/token');
  });

  it('.env.example stamps the company and a blank token slot — never a real secret', () => {
    const env = buildStarterFiles(ctx())['.env.example'];
    expect(env).toContain('SOLID_COMPANY_ID=61');
    expect(env).toContain('SOLID_TOKEN=');
    expect(env).not.toContain('sk_solid_'); // no fake/placeholder secret baked in
  });

  it('leaves an explicit placeholder when no company is bound', () => {
    const files = buildStarterFiles(ctx({ companyId: null }));
    expect(JSON.parse(files['.solid/config.json']).companyId).toBeNull();
    expect(files['CLAUDE.md']).toContain('<set in .solid/config.json>');
    expect(files['.env.example']).toContain('SOLID_COMPANY_ID=\n');
  });

  it('applies the starter layer to every app type', () => {
    for (const type of ['basic', 'marketplace', 'saas', 'agency-dashboard']) {
      const files = buildStarterFiles(ctx({ type }));
      expect(files['CLAUDE.md']).toBeDefined();
      expect(files['.solid/config.json']).toBeDefined();
      expect(files['.gitignore']).toContain('.solid/token');
    }
  });

  it('renderStarterClaudeMd names the bound business front and center', () => {
    expect(renderStarterClaudeMd(ctx({ companyId: 76 }))).toContain('company_id 76');
  });
});
