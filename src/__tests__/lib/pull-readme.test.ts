/**
 * The README `solid pull` leaves behind. Every command it names must be real —
 * the help-examples integration test checks source files, so the names are
 * checked here against the command objects.
 */
import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';

import { PULL_README, pullReadme, writePullReadme } from '../../lib/pull-readme';

describe('pullReadme', () => {
  it('names the business and both addresses', () => {
    const text = pullReadme({ name: 'Acme Roofing', slug: 'acme' });
    expect(text).toContain('# Acme Roofing on Solid#');
    expect(text).toContain('acme.solidnumber.com');
    expect(text).toContain('acme.solidhost.app/<name>/');
  });

  it('says what a page is made of, what a kept design is, and what a verb is', () => {
    const text = pullReadme({});
    expect(text).toContain('layout_json.sections');
    expect(text).toContain('page.slot_update');
    expect(text).toContain('renders **nothing, with no error**');
    expect(text).toContain('cannot be deleted');
    expect(text).toContain('solid bring <folder>');
  });

  it('is never written as README.md, and is quiet when unchanged', () => {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'solid-readme-'));
    expect(PULL_README).not.toBe('README.md');
    expect(writePullReadme(dir, { name: 'A' })).toBe(true);
    expect(writePullReadme(dir, { name: 'A' })).toBe(false);
    expect(writePullReadme(dir, { name: 'B' })).toBe(true);
    expect(fs.existsSync(path.join(dir, 'README.md'))).toBe(false);
  });
});
