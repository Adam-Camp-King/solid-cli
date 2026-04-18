/**
 * Users / team management commands.
 * Wraps controllers/users.py at /api/v1/users/*.
 */

import { Command } from 'commander';
import ora from 'ora';
import chalk from 'chalk';
import { config } from '../lib/config';
import { apiClient, handleApiError } from '../lib/api-client';

function requireAuth() {
  if (!config.isLoggedIn()) {
    console.error(chalk.red('Not logged in. Run `solid auth login` first.'));
    process.exit(1);
  }
}

function fail(spinner: ReturnType<typeof ora>, msg: string, err: unknown) {
  spinner.fail(chalk.red(msg));
  console.error(chalk.red(`  ${handleApiError(err).message}`));
}

export const usersCommand = new Command('users')
  .description('Team — invite, list, set roles, manage AI permissions');

// ── List / get / stats ────────────────────────────────────────────────

usersCommand
  .command('list')
  .description('List users (defaults to all roles)')
  .option('--role <role>', 'Filter by role')
  .option('--json', 'Output as JSON')
  .action(async (opts) => {
    requireAuth();
    const spinner = ora('Loading users...').start();
    try {
      const params: Record<string, unknown> = {};
      if (opts.role) params.role = opts.role;
      const res = await apiClient.get('/api/v1/users/company', { params });
      const data = res.data as Record<string, any>;
      const items = data.users || data.items || data;
      const list = Array.isArray(items) ? items : (items.users || []);
      if (opts.json) { spinner.stop(); console.log(JSON.stringify(data, null, 2)); return; }
      spinner.succeed(chalk.green(`${list.length} user(s)`));
      console.log('');
      for (const u of list as Record<string, any>[]) {
        const dot = u.is_blocked ? chalk.red('●') : chalk.green('●');
        console.log(`  ${dot} ${chalk.bold(u.id)}  ${u.email}  ${chalk.dim(u.role || '—')}  ${u.full_name || ''}`);
      }
    } catch (e) { fail(spinner, 'Failed to load users', e); }
  });

usersCommand
  .command('get <user_id>')
  .description('Get a single user')
  .option('--json', 'Output as JSON')
  .action(async (id, opts) => {
    requireAuth();
    const spinner = ora(`Loading user ${id}...`).start();
    try {
      const res = await apiClient.get(`/api/v1/users/${id}`);
      const u = res.data as Record<string, any>;
      if (opts.json) { spinner.stop(); console.log(JSON.stringify(u, null, 2)); return; }
      spinner.succeed(chalk.green(`User ${id}`));
      console.log('');
      console.log(`  ${chalk.bold('Email:')}    ${u.email}`);
      console.log(`  ${chalk.bold('Name:')}     ${u.full_name || '—'}`);
      console.log(`  ${chalk.bold('Role:')}     ${u.role || '—'}`);
      console.log(`  ${chalk.bold('Blocked:')}  ${u.is_blocked ?? false}`);
      console.log(`  ${chalk.bold('Created:')}  ${u.created_at || '—'}`);
    } catch (e) { fail(spinner, 'Failed to load user', e); }
  });

usersCommand
  .command('stats')
  .description('Team summary stats')
  .option('--json', 'Output as JSON')
  .action(async (opts) => {
    requireAuth();
    const spinner = ora('Loading stats...').start();
    try {
      const res = await apiClient.get('/api/v1/users/stats/summary');
      const s = res.data as Record<string, any>;
      if (opts.json) { spinner.stop(); console.log(JSON.stringify(s, null, 2)); return; }
      spinner.succeed(chalk.green('Team stats'));
      console.log('');
      console.log(`  ${chalk.bold('Total:')}     ${s.total ?? 'N/A'}`);
      console.log(`  ${chalk.bold('Active:')}    ${s.active ?? 'N/A'}`);
      console.log(`  ${chalk.bold('Blocked:')}   ${s.blocked ?? 'N/A'}`);
      console.log(`  ${chalk.bold('Admins:')}    ${s.admins ?? 'N/A'}`);
    } catch (e) { fail(spinner, 'Failed to load stats', e); }
  });

// ── Create / update / delete ─────────────────────────────────────────

usersCommand
  .command('create')
  .description('Create a user directly (prefer `users invite` for safer flow)')
  .requiredOption('--email <email>', 'Email')
  .requiredOption('--name <name>', 'Full name')
  .option('--role <role>', 'Role', 'user')
  .option('--password <pw>', 'Password (auto-generated if omitted)')
  .action(async (opts) => {
    requireAuth();
    const spinner = ora('Creating user...').start();
    try {
      const body: Record<string, unknown> = {
        email: opts.email,
        full_name: opts.name,
        role: opts.role,
      };
      if (opts.password) body.password = opts.password;
      const res = await apiClient.post('/api/v1/users', body);
      const u = res.data as Record<string, any>;
      spinner.succeed(chalk.green(`User created: ${u.id}`));
    } catch (e) { fail(spinner, 'Failed to create user', e); }
  });

usersCommand
  .command('update <user_id>')
  .description('Update a user')
  .option('--name <name>')
  .option('--email <email>')
  .action(async (id, opts) => {
    requireAuth();
    const body: Record<string, unknown> = {};
    if (opts.name) body.full_name = opts.name;
    if (opts.email) body.email = opts.email;
    if (Object.keys(body).length === 0) {
      console.error(chalk.red('Provide at least one field.'));
      process.exit(1);
    }
    const spinner = ora('Updating user...').start();
    try {
      await apiClient.put(`/api/v1/users/${id}`, body);
      spinner.succeed(chalk.green('User updated'));
    } catch (e) { fail(spinner, 'Failed to update user', e); }
  });

usersCommand
  .command('delete <user_id>')
  .description('Delete a user (prompts by default)')
  .option('-y, --yes', 'Skip confirmation prompt')
  .action(async (id: string, options: { yes?: boolean }) => {
    requireAuth();
    const { confirm } = await import('../lib/command-kit');
    const ok = await confirm(`Permanently delete user ${id}?`, { autoConfirm: Boolean(options.yes) });
    if (!ok) { console.error(chalk.dim('  Cancelled.')); process.exit(1); }
    const spinner = ora({ text: `Deleting user ${id}...`, stream: process.stderr }).start();
    try {
      await apiClient.delete(`/api/v1/users/${id}`);
      spinner.succeed(chalk.green('User deleted'));
    } catch (e) { fail(spinner, 'Failed to delete user', e); }
  });

usersCommand
  .command('role <user_id> <role>')
  .description('Change a user role (owner, admin, manager, user, viewer)')
  .action(async (id, role) => {
    requireAuth();
    const spinner = ora(`Setting role for ${id}...`).start();
    try {
      await apiClient.patch(`/api/v1/users/${id}/role`, { role });
      spinner.succeed(chalk.green(`Role set to ${role}`));
    } catch (e) { fail(spinner, 'Failed to set role', e); }
  });

usersCommand
  .command('block <user_id>')
  .description('Block a user from logging in')
  .action(async (id) => {
    requireAuth();
    const spinner = ora('Blocking...').start();
    try {
      await apiClient.post(`/api/v1/users/${id}/block`);
      spinner.succeed(chalk.green('User blocked'));
    } catch (e) { fail(spinner, 'Failed to block user', e); }
  });

usersCommand
  .command('unblock <user_id>')
  .description('Unblock a user')
  .action(async (id) => {
    requireAuth();
    const spinner = ora('Unblocking...').start();
    try {
      await apiClient.post(`/api/v1/users/${id}/unblock`);
      spinner.succeed(chalk.green('User unblocked'));
    } catch (e) { fail(spinner, 'Failed to unblock user', e); }
  });

// ── Per-user feature flags ────────────────────────────────────────────

usersCommand
  .command('features <user_id>')
  .description('Show per-user feature overrides')
  .option('--json', 'Output as JSON')
  .action(async (id, opts) => {
    requireAuth();
    const spinner = ora('Loading features...').start();
    try {
      const res = await apiClient.get(`/api/v1/users/${id}/features`);
      const data = res.data as Record<string, any>;
      if (opts.json) { spinner.stop(); console.log(JSON.stringify(data, null, 2)); return; }
      spinner.succeed(chalk.green('Per-user features'));
      const features = data.features || data;
      console.log('');
      for (const [k, v] of Object.entries(features as Record<string, unknown>)) {
        const dot = v ? chalk.green('●') : chalk.dim('○');
        console.log(`  ${dot} ${k}`);
      }
    } catch (e) { fail(spinner, 'Failed to load features', e); }
  });

usersCommand
  .command('feature-set <user_id> <feature_key>')
  .description('Set/enable a per-user feature override')
  .option('--disable', 'Disable instead of enable')
  .action(async (id, key, opts) => {
    requireAuth();
    const spinner = ora('Updating feature...').start();
    try {
      await apiClient.post(`/api/v1/users/${id}/features`, {
        feature_key: key,
        enabled: !opts.disable,
      });
      spinner.succeed(chalk.green(`Feature ${key} ${opts.disable ? 'disabled' : 'enabled'} for user ${id}`));
    } catch (e) { fail(spinner, 'Failed', e); }
  });

usersCommand
  .command('feature-clear <user_id> <feature_key>')
  .description('Remove a per-user feature override (revert to tier default)')
  .action(async (id, key) => {
    requireAuth();
    const spinner = ora('Clearing feature override...').start();
    try {
      await apiClient.delete(`/api/v1/users/${id}/features/${key}`);
      spinner.succeed(chalk.green(`Override cleared`));
    } catch (e) { fail(spinner, 'Failed', e); }
  });

usersCommand
  .command('features-catalog')
  .description('List feature keys available to override per user')
  .option('--json', 'Output as JSON')
  .action(async (opts) => {
    requireAuth();
    const spinner = ora('Loading catalog...').start();
    try {
      const res = await apiClient.get('/api/v1/users/features/catalog');
      const data = res.data as Record<string, any>;
      const items = data.features || data.items || data;
      if (opts.json) { spinner.stop(); console.log(JSON.stringify(data, null, 2)); return; }
      const list = Array.isArray(items) ? items : Object.keys(items);
      spinner.succeed(chalk.green(`${list.length} feature(s)`));
      console.log('');
      for (const f of list) console.log(`  ${chalk.bold(typeof f === 'string' ? f : f.key)}  ${chalk.dim((f as any).description || '')}`);
    } catch (e) { fail(spinner, 'Failed to load catalog', e); }
  });

// ── Invitations ───────────────────────────────────────────────────────

usersCommand
  .command('invite')
  .description('Invite a new team member')
  .requiredOption('--email <email>', 'Invitee email')
  .option('--role <role>', 'Role', 'user')
  .option('--name <name>', 'Display name')
  .action(async (opts) => {
    requireAuth();
    const body: Record<string, unknown> = { email: opts.email, role: opts.role };
    if (opts.name) body.full_name = opts.name;
    const spinner = ora(`Inviting ${opts.email}...`).start();
    try {
      const res = await apiClient.post('/api/v1/users/invitations', body);
      const r = res.data as Record<string, any>;
      spinner.succeed(chalk.green('Invitation sent'));
      if (r.token) console.log(chalk.dim(`  token: ${r.token}`));
      if (r.invite_url) console.log(chalk.cyan(`  ${r.invite_url}`));
    } catch (e) { fail(spinner, 'Failed to invite', e); }
  });

usersCommand
  .command('invitations')
  .description('List pending invitations')
  .option('--json', 'Output as JSON')
  .action(async (opts) => {
    requireAuth();
    const spinner = ora('Loading invitations...').start();
    try {
      const res = await apiClient.get('/api/v1/users/invitations');
      const data = res.data as Record<string, any>;
      const items = data.invitations || data.items || data;
      const list = Array.isArray(items) ? items : (items.invitations || []);
      if (opts.json) { spinner.stop(); console.log(JSON.stringify(data, null, 2)); return; }
      spinner.succeed(chalk.green(`${list.length} pending invitation(s)`));
      console.log('');
      for (const i of list as Record<string, any>[]) {
        console.log(`  ${chalk.bold(i.id)}  ${i.email}  ${chalk.dim(i.role)}  ${chalk.dim(i.created_at?.split('T')[0] || '')}`);
      }
    } catch (e) { fail(spinner, 'Failed to load invitations', e); }
  });

usersCommand
  .command('invite-revoke <invitation_id>')
  .description('Revoke a pending invitation')
  .action(async (id) => {
    requireAuth();
    const spinner = ora('Revoking...').start();
    try {
      await apiClient.delete(`/api/v1/users/invitations/${id}`);
      spinner.succeed(chalk.green('Invitation revoked'));
    } catch (e) { fail(spinner, 'Failed to revoke', e); }
  });

usersCommand
  .command('invite-resend <invitation_id>')
  .description('Resend an invitation email')
  .action(async (id) => {
    requireAuth();
    const spinner = ora('Resending...').start();
    try {
      await apiClient.post(`/api/v1/users/invitations/${id}/resend`);
      spinner.succeed(chalk.green('Invitation resent'));
    } catch (e) { fail(spinner, 'Failed to resend', e); }
  });

usersCommand
  .command('invite-accept <token>')
  .description('Accept an invitation (joins the inviting company)')
  .action(async (token) => {
    const spinner = ora('Accepting invitation...').start();
    try {
      const res = await apiClient.post(`/api/v1/users/invitations/accept/${token}`);
      const r = res.data as Record<string, any>;
      spinner.succeed(chalk.green('Invitation accepted'));
      if (r.company_id) console.log(chalk.dim(`  joined company ${r.company_id}`));
    } catch (e) { fail(spinner, 'Failed to accept', e); }
  });

usersCommand
  .command('invite-defaults <role>')
  .description('Show default features granted to a role')
  .option('--json', 'Output as JSON')
  .action(async (role, opts) => {
    requireAuth();
    const spinner = ora('Loading defaults...').start();
    try {
      const res = await apiClient.get(`/api/v1/users/invitations/role-defaults/${role}`);
      if (opts.json) { spinner.stop(); console.log(JSON.stringify(res.data, null, 2)); return; }
      spinner.succeed(chalk.green(`Defaults for role: ${role}`));
      console.log(JSON.stringify(res.data, null, 2));
    } catch (e) { fail(spinner, 'Failed', e); }
  });

// ── AI permissions ────────────────────────────────────────────────────

usersCommand
  .command('ai-perms <user_id>')
  .description('Show AI permissions for a user')
  .option('--json', 'Output as JSON')
  .action(async (id, opts) => {
    requireAuth();
    const spinner = ora('Loading AI permissions...').start();
    try {
      const res = await apiClient.get(`/api/v1/users/users/${id}/ai-permissions`);
      if (opts.json) { spinner.stop(); console.log(JSON.stringify(res.data, null, 2)); return; }
      spinner.succeed(chalk.green('AI permissions'));
      console.log(JSON.stringify(res.data, null, 2));
    } catch (e) { fail(spinner, 'Failed', e); }
  });

usersCommand
  .command('ai-perms-set <user_id>')
  .description('Set AI permissions (JSON via --permissions)')
  .requiredOption('--permissions <json>', 'JSON object of permission keys → bool')
  .action(async (id, opts) => {
    requireAuth();
    const spinner = ora('Updating AI permissions...').start();
    try {
      const body = JSON.parse(opts.permissions);
      await apiClient.post(`/api/v1/users/users/${id}/ai-permissions`, body);
      spinner.succeed(chalk.green('AI permissions updated'));
    } catch (e) { fail(spinner, 'Failed', e); }
  });

// ── Notification settings ─────────────────────────────────────────────

usersCommand
  .command('notifications <user_id>')
  .description('Show notification settings')
  .option('--json', 'Output as JSON')
  .action(async (id, opts) => {
    requireAuth();
    const spinner = ora('Loading...').start();
    try {
      const res = await apiClient.get(`/api/v1/users/${id}/notification-settings`);
      if (opts.json) { spinner.stop(); console.log(JSON.stringify(res.data, null, 2)); return; }
      spinner.succeed(chalk.green('Notification settings'));
      console.log(JSON.stringify(res.data, null, 2));
    } catch (e) { fail(spinner, 'Failed', e); }
  });

usersCommand
  .command('notifications-set <user_id>')
  .description('Update notification settings (JSON via --settings)')
  .requiredOption('--settings <json>', 'JSON object')
  .action(async (id, opts) => {
    requireAuth();
    const spinner = ora('Updating...').start();
    try {
      const body = JSON.parse(opts.settings);
      await apiClient.put(`/api/v1/users/${id}/notification-settings`, body);
      spinner.succeed(chalk.green('Settings updated'));
    } catch (e) { fail(spinner, 'Failed', e); }
  });
