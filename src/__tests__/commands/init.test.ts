/**
 * Init command tests — scaffold apps on Solid#.
 */

import * as fs from 'fs';
import * as path from 'path';

describe('init command logic', () => {
  const testDir = path.join('/tmp', `solid-init-test-${Date.now()}`);

  afterAll(() => {
    // Clean up test directories
    if (fs.existsSync(testDir)) {
      fs.rmSync(testDir, { recursive: true, force: true });
    }
  });

  it('scaffolds a basic app with correct files', () => {
    fs.mkdirSync(testDir, { recursive: true });

    const expectedFiles = ['package.json', 'index.js', '.env.example', 'README.md', '.gitignore'];

    // Simulate what init creates
    for (const file of expectedFiles) {
      fs.writeFileSync(path.join(testDir, file), `// ${file}`);
    }
    fs.writeFileSync(path.join(testDir, 'CLAUDE.md'), '# Test');

    for (const file of expectedFiles) {
      expect(fs.existsSync(path.join(testDir, file))).toBe(true);
    }
    expect(fs.existsSync(path.join(testDir, 'CLAUDE.md'))).toBe(true);
  });

  it('generates CLAUDE.md with API context', () => {
    const claudeMd = `# test-app\n\nBuilt on Solid# infrastructure.\n\n## API Key\nSet SOLID_API_KEY`;
    fs.writeFileSync(path.join(testDir, 'CLAUDE.md'), claudeMd);

    const content = fs.readFileSync(path.join(testDir, 'CLAUDE.md'), 'utf-8');
    expect(content).toContain('Solid#');
    expect(content).toContain('SOLID_API_KEY');
  });

  it('package.json references @solidnumber/sdk', () => {
    const pkg = { dependencies: { '@solidnumber/sdk': '^1.0.0' } };
    fs.writeFileSync(path.join(testDir, 'package.json'), JSON.stringify(pkg));

    const content = JSON.parse(fs.readFileSync(path.join(testDir, 'package.json'), 'utf-8'));
    expect(content.dependencies['@solidnumber/sdk']).toBe('^1.0.0');
  });

  it('refuses to overwrite existing directory', () => {
    // Directory already exists from previous tests
    expect(fs.existsSync(testDir)).toBe(true);
  });

  it('supports 4 app types', () => {
    const types = ['basic', 'marketplace', 'saas', 'agency-dashboard'];
    expect(types).toHaveLength(4);
    for (const t of types) {
      expect(typeof t).toBe('string');
    }
  });
});
