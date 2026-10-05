/**
 * Save the builder protocol into this package: platform-docs/BUILDER-PROTOCOL.md.
 *
 * ⛔ WHY. The protocol is written once, in the backend
 * (solid-backend/services/builder_protocol.py), where its upload limits are read
 * from the code that enforces them. The CLI answers offline, so it carries a copy.
 * A copy typed by hand is right on the day it is typed; this one is rendered.
 *
 *   npx ts-node scripts/sync-builder-protocol.ts            # write the file
 *   npx ts-node scripts/sync-builder-protocol.ts --check    # exit 1 if it would change
 *
 * It renders from the backend checkout beside this one (../solid-backend, or
 * SOLID_BACKEND_DIR). Without one it FAILS — a check that skips reads as a pass.
 *
 * ⛔ ONE EXCEPTION, AND IT IS NAMED: the publish runner. The backend is a private
 * repository the CLI's GitHub Actions job cannot clone, so `--check` there could
 * only ever fail — it stopped 2.29.0 from publishing on the day this gate was
 * added. On GitHub Actions, with no backend present, `--check` says it did not
 * compare and passes. The comparison is made where the backend exists: on the
 * machine that cuts the release (`prepublishOnly` runs there too) and in the
 * monorepo. Anywhere else a missing backend is still a failure.
 */
import { spawnSync } from 'child_process';
import * as fs from 'fs';
import * as path from 'path';

const FILE = path.join(__dirname, '..', 'platform-docs', 'BUILDER-PROTOCOL.md');
const BACKEND = process.env.SOLID_BACKEND_DIR || path.join(__dirname, '..', '..', 'solid-backend');

function main(): void {
  if (!fs.existsSync(path.join(BACKEND, 'services', 'builder_protocol.py'))) {
    if (process.argv.includes('--check') && process.env.GITHUB_ACTIONS === 'true' && fs.existsSync(FILE)) {
      console.log('· BUILDER-PROTOCOL.md not compared here: this runner has no backend checkout. '
        + 'It is compared on the machine that cuts the release.');
      return;
    }
    throw new Error(`no backend checkout at ${BACKEND} (set SOLID_BACKEND_DIR) — the protocol is rendered from it`);
  }
  const run = spawnSync('python3', ['-m', 'services.builder_protocol'], { cwd: BACKEND, encoding: 'utf8' });
  if (run.status !== 0 || !run.stdout.trim()) {
    throw new Error(`python3 -m services.builder_protocol failed in ${BACKEND}: ${(run.stderr || '').trim().split('\n').pop()}`);
  }
  const live = run.stdout;
  const before = fs.existsSync(FILE) ? fs.readFileSync(FILE, 'utf8') : '';
  if (process.argv.includes('--check')) {
    if (before !== live) {
      console.error('✗ platform-docs/BUILDER-PROTOCOL.md is behind the backend. Run: npx ts-node scripts/sync-builder-protocol.ts');
      process.exit(1);
    }
    console.log('✓ BUILDER-PROTOCOL.md matches the backend');
    return;
  }
  if (before === live) {
    console.log('✓ already in sync');
    return;
  }
  fs.writeFileSync(FILE, live);
  console.log(`→ platform-docs/BUILDER-PROTOCOL.md — ${live.split('\n').length} lines`);
}

try {
  main();
} catch (e) {
  console.error(`✗ ${(e as Error).message}`);
  process.exit(1);
}
