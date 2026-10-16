/**
 * `solid helper …` — let a Solid# host do set-up steps on THIS computer, with your approval.
 *
 *   solid helper enrol <code>   make this computer one a business's host can work on
 *   solid helper run            connect, and wait for you to approve a session
 *   solid helper status         whether this computer is enrolled
 *   solid helper forget         remove this computer's token
 *
 * What it will and will not do is in src/lib/helper-actions.ts and helper-session.ts:
 * nine named actions, never a command line, nothing without a code YOU type here, and
 * `stop` ends it at once.
 */
import { isJsonOutput, printJson } from '../lib/json-output';
import { Command } from 'commander';
import chalk from 'chalk';
import * as readline from 'readline';
import { execFile } from 'child_process';
// eslint-disable-next-line @typescript-eslint/no-var-requires
const WebSocket = require('ws') as new (url: string) => HelperSocket;

/** The part of the `ws` socket this command uses (the package ships no types). */
interface HelperSocket {
  on(event: 'open', listener: () => void): void;
  on(event: 'message', listener: (raw: unknown) => void): void;
  on(event: 'close', listener: (code: number) => void): void;
  on(event: 'error', listener: () => void): void;
  close(): void;
}
import { config } from '../lib/config';
import { platformOf, type Exec } from '../lib/helper-actions';
import { HelperClient, forgetIdentity, loadIdentity, saveIdentity, socketUrl } from '../lib/helper-client';
import { HelperSession } from '../lib/helper-session';

// eslint-disable-next-line @typescript-eslint/no-var-requires
const VERSION: string = require('../../package.json').version;

const exec: Exec = (file, args, options) => new Promise((resolve) => {
  // ⛔ execFile, never exec: the arguments are an array, and no shell reads them.
  const env = options?.env ? { ...process.env, ...options.env } : process.env;
  execFile(file, args, { timeout: options?.timeoutMs ?? 15000, windowsHide: true, env }, (error, stdout) => {
    const code = error && typeof (error as NodeJS.ErrnoException & { code?: unknown }).code === 'number'
      ? ((error as unknown as { code: number }).code) : error ? 1 : 0;
    resolve({ code, stdout: String(stdout || '') });
  });
});

export const helperCommand = new Command('helper')
  .description('Let a Solid# host do set-up steps on this computer, with your approval');

helperCommand
  .command('enrol <code>')
  .alias('enroll')
  .description('Enrol this computer with the one-use code a business gave you')
  .option('--api <url>', 'API address (defaults to the one this CLI uses)')
  .action(async (code: string, options: { api?: string }) => {
    const apiUrl = options.api || config.apiUrl;
    const identity = await new HelperClient(apiUrl).enrol(code, platformOf(), VERSION);
    if (!identity) {
      console.error(chalk.red('That code is not valid, has been used, or has run out. Ask for a new one.'));
      process.exitCode = 1;
      return;
    }
    saveIdentity(identity);
    console.log(chalk.green(`This computer is enrolled${identity.name ? ` as "${identity.name}"` : ''}.`));
    console.log('Run `solid helper run` when you are in a session and want the host to help.');
  });

helperCommand
  .command('status')
  .description('Whether this computer is enrolled')
  .option('--json', 'Output as JSON. Never includes the token.')
  .action((options: { json?: boolean }) => {
    const identity = loadIdentity();
    if (isJsonOutput(options)) {
      printJson(identity
        ? { enrolled: true, endpoint_id: identity.endpoint_id, name: identity.name, api_url: identity.api_url }
        : { enrolled: false });
      return;
    }
    console.log(identity ? `Enrolled${identity.name ? ` as "${identity.name}"` : ''} (machine ${identity.endpoint_id}).`
      : 'This computer is not enrolled. Use `solid helper enrol <code>`.');
  });

helperCommand
  .command('forget')
  .description('Remove this computer\'s token. A business would have to enrol it again.')
  .action(() => {
    console.log(forgetIdentity() ? 'Removed. This computer is no longer enrolled.' : 'This computer was not enrolled.');
  });

helperCommand
  .command('run')
  .description('Connect, and wait for you to approve a session')
  .action(async () => {
    const identity = loadIdentity();
    if (!identity) {
      console.error(chalk.red('This computer is not enrolled. Use `solid helper enrol <code>` first.'));
      process.exitCode = 1;
      return;
    }
    const client = new HelperClient(identity.api_url);
    const session = new HelperSession(platformOf(), exec);
    const socket = new WebSocket(socketUrl(identity.api_url, identity.token));
    const rl = readline.createInterface({ input: process.stdin, output: process.stdout });
    const say = (line: string) => { console.log(line); rl.prompt(true); };

    socket.on('open', () => {
      say(chalk.green('Connected. Nothing can be done on this computer until you type a code here.'));
      say('When the host gives you a 6-digit code, type it and press Enter. Type `stop` to end at any time.');
    });
    // The grant the host asked to make changes under, until the person types allow.
    let pendingChange: number | null = null;
    socket.on('message', (raw) => {
      let request: Record<string, unknown>;
      try { request = JSON.parse(String(raw)); } catch { return; }
      if (request.type === 'grant_ended' && session.granted) say(chalk.yellow('The host has finished. Nothing more can be done until you type a new code.'));
      if (request.type === 'retired') say(chalk.yellow('This computer has been taken off the list. Run `solid helper forget`; a new code is needed to add it again.'));
      if (request.type === 'change_request' && session.granted) {
        pendingChange = typeof request.grant_id === 'number' ? request.grant_id : null;
        say(chalk.bold(`The host is asking to make changes on this computer, starting with: ${String(request.what || '')}`));
        say('Type `allow` to let it (it will still ask before each change), or `stop` to end.');
      }
      if (request.type === 'do') say(`The host is asking to run: ${chalk.bold(String(request.action))} ${JSON.stringify(request.inputs ?? {})}`);
      void session.handle(request).then((answer) => {
        if (!answer) return;
        say(answer.result.ok ? chalk.green(`  done: ${JSON.stringify(answer.result.data ?? {})}`)
          : chalk.red(`  not done: ${answer.result.reason}`));
        void client.answer(identity.token, answer.rid, answer.result as unknown as Record<string, unknown>);
      });
    });
    socket.on('close', (codeNumber) => {
      console.log(codeNumber === 4404 ? chalk.red('\nThis computer is no longer enrolled.') : '\nDisconnected.');
      session.stop();
      rl.close();
    });
    socket.on('error', () => { console.error(chalk.red('Could not connect. Check the network and try again.')); });

    rl.setPrompt('> ');
    rl.on('line', (typed) => {
      const text = typed.trim();
      if (!text) { rl.prompt(); return; }
      if (text.toLowerCase() === 'stop') {
        session.stop();                                  // here first; then tell the platform
        void client.stop(identity.token);
        say(chalk.yellow('Stopped. Nothing more can be done on this computer until you type a new code.'));
        return;
      }
      if (text.toLowerCase() === 'quit' || text.toLowerCase() === 'exit') { socket.close(); return; }
      if (text.toLowerCase() === 'allow') {
        const grantId = pendingChange;
        if (grantId === null || !session.granted) { say('Nothing is waiting for your permission.'); return; }
        void client.allow(identity.token, grantId).then((ok) => {
          if (ok && session.allowChanges(grantId)) say(chalk.green('Allowed. The host can make changes here, and still asks before each one. Type `stop` to end.'));
          else say(chalk.red('That did not go through. Ask the host to try again.'));
        });
        pendingChange = null;
        return;
      }
      void client.approve(identity.token, text).then((grantId) => {
        if (grantId !== null && session.approved(grantId)) say(chalk.green('Approved. The host can now do this session\'s steps here. Type `stop` to end it.'));
        else say(chalk.red('That code is not right, or it has run out. Ask the host for a new one.'));
      });
    });
    rl.on('close', () => { session.stop(); void client.stop(identity.token); socket.close(); });
  });
