/**
 * `--flag '{"a":1}'` or `--flag @payload.json` → a parsed value.
 *
 * Extracted from commands/verbs.ts when `solid forms quiz/walk --branching`
 * needed the same contract. One implementation, so `@file` support and the
 * error wording cannot drift between the two commands an AI is most likely
 * to script against.
 */
import * as fs from 'fs';

import chalk from 'chalk';

export function parseJsonArg(name: string, raw: string | undefined): any {
  if (!raw) return undefined;
  if (raw.startsWith('@')) {
    const path = raw.slice(1);
    try {
      return JSON.parse(fs.readFileSync(path, 'utf-8'));
    } catch (e) {
      console.error(chalk.red(`failed to read --${name} from ${path}: ${(e as Error).message}`));
      process.exit(1);
    }
  }
  try {
    return JSON.parse(raw);
  } catch {
    console.error(chalk.red(`--${name} must be valid JSON`));
    process.exit(1);
  }
}
