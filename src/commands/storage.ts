/**
 * Storage / file management commands.
 * Wraps api/routers/storage.py at /api/v1/storage/*.
 *
 * Two surface areas:
 *   /storage/documents/*    — original document model (upload/download/delete)
 *   /storage/files/*        — newer file browser (star/archive/restore/dismiss)
 *   /storage/folders/*      — folder hierarchy
 *   /storage/packs/*        — asset packs
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

export const storageCommand = new Command('storage')
  .alias('files')
  .description('File storage — upload, download, organize folders, asset packs');

// ── Config / usage ────────────────────────────────────────────────────

storageCommand
  .command('config')
  .description('Show storage config (limits, supported types)')
  .option('--json', 'Output as JSON')
  .action(async (opts) => {
    requireAuth();
    const spinner = ora('Loading config...').start();
    try {
      const res = await apiClient.get('/api/v1/storage/config');
      if (opts.json) { spinner.stop(); console.log(JSON.stringify(res.data, null, 2)); return; }
      spinner.succeed(chalk.green('Storage config'));
      console.log('');
      console.log(JSON.stringify(res.data, null, 2));
    } catch (e) { fail(spinner, 'Failed', e); }
  });

storageCommand
  .command('usage')
  .description('Storage usage / quota')
  .option('--json', 'Output as JSON')
  .action(async (opts) => {
    requireAuth();
    const spinner = ora('Loading usage...').start();
    try {
      const res = await apiClient.get('/api/v1/storage/usage');
      const u = res.data as Record<string, any>;
      if (opts.json) { spinner.stop(); console.log(JSON.stringify(u, null, 2)); return; }
      spinner.succeed(chalk.green('Storage usage'));
      console.log('');
      console.log(`  ${chalk.bold('Used:')}   ${u.used_mb ?? u.used_bytes ?? 'N/A'} MB`);
      console.log(`  ${chalk.bold('Quota:')}  ${u.quota_mb ?? 'N/A'} MB`);
      console.log(`  ${chalk.bold('Files:')}  ${u.file_count ?? 'N/A'}`);
    } catch (e) { fail(spinner, 'Failed', e); }
  });

storageCommand
  .command('breakdown')
  .description('Storage breakdown by file type / source')
  .option('--json', 'Output as JSON')
  .action(async (opts) => {
    requireAuth();
    const spinner = ora('Loading breakdown...').start();
    try {
      const res = await apiClient.get('/api/v1/storage/breakdown');
      if (opts.json) { spinner.stop(); console.log(JSON.stringify(res.data, null, 2)); return; }
      spinner.succeed(chalk.green('Breakdown'));
      console.log(JSON.stringify(res.data, null, 2));
    } catch (e) { fail(spinner, 'Failed', e); }
  });

storageCommand
  .command('sources')
  .description('List storage sources (where files come from)')
  .option('--json', 'Output as JSON')
  .action(async (opts) => {
    requireAuth();
    const spinner = ora('Loading sources...').start();
    try {
      const res = await apiClient.get('/api/v1/storage/sources');
      if (opts.json) { spinner.stop(); console.log(JSON.stringify(res.data, null, 2)); return; }
      spinner.succeed(chalk.green('Sources'));
      const items = (res.data as Record<string, any>[]) ?? [];
      for (const s of items) console.log(`  ${chalk.bold(s.id)}  ${s.name}  ${chalk.dim(s.type || '')}`);
    } catch (e) { fail(spinner, 'Failed', e); }
  });

// ── Upload / download / documents ─────────────────────────────────────

storageCommand
  .command('upload <path>')
  .description('Upload a local file')
  .option('--folder <id>', 'Folder ID')
  .option('--description <text>', 'Description')
  .action(async (filePath, opts) => {
    requireAuth();
    const fs = await import('fs');
    const path = await import('path');
    const abs = path.resolve(filePath);
    if (!fs.existsSync(abs)) {
      console.error(chalk.red(`File not found: ${abs}`));
      process.exit(1);
    }
    const spinner = ora(`Uploading ${path.basename(abs)}...`).start();
    try {
      const FormData = (await import('form-data')).default;
      const form = new FormData();
      form.append('file', fs.createReadStream(abs));
      if (opts.folder) form.append('folder_id', opts.folder);
      if (opts.description) form.append('description', opts.description);
      const res = await apiClient.post('/api/v1/storage/upload', form);
      const r = res.data as Record<string, any>;
      spinner.succeed(chalk.green(`Uploaded: ${r.id || r.document_id || r.file_id}`));
      if (r.url) console.log(chalk.dim(`  ${r.url}`));
    } catch (e) { fail(spinner, 'Upload failed', e); }
  });

storageCommand
  .command('list')
  .description('List documents')
  .option('--folder <id>', 'Filter by folder ID')
  .option('-l, --limit <n>', 'Limit', '100')
  .option('--json', 'Output as JSON')
  .action(async (opts) => {
    requireAuth();
    const spinner = ora('Loading documents...').start();
    try {
      const params: Record<string, unknown> = { limit: parseInt(opts.limit, 10) };
      if (opts.folder) params.folder_id = parseInt(opts.folder, 10);
      const res = await apiClient.get('/api/v1/storage/documents', { params });
      const items = (res.data as Record<string, any>[]) ?? [];
      if (opts.json) { spinner.stop(); console.log(JSON.stringify(items, null, 2)); return; }
      spinner.succeed(chalk.green(`${items.length} document(s)`));
      console.log('');
      for (const d of items) {
        const size = d.size_bytes ? `${Math.round((d.size_bytes / 1024) * 10) / 10} KB` : '—';
        console.log(`  ${chalk.bold(d.id)}  ${d.filename || d.name}  ${chalk.dim(size)}  ${chalk.dim(d.created_at?.split('T')[0] || '')}`);
      }
    } catch (e) { fail(spinner, 'Failed to list documents', e); }
  });

storageCommand
  .command('get <document_id>')
  .description('Get document metadata')
  .option('--json', 'Output as JSON')
  .action(async (id, opts) => {
    requireAuth();
    const spinner = ora(`Loading ${id}...`).start();
    try {
      const res = await apiClient.get(`/api/v1/storage/documents/${id}`);
      const d = res.data as Record<string, any>;
      if (opts.json) { spinner.stop(); console.log(JSON.stringify(d, null, 2)); return; }
      spinner.succeed(chalk.green(`Document ${id}`));
      console.log('');
      console.log(`  ${chalk.bold('Name:')}   ${d.filename || d.name}`);
      console.log(`  ${chalk.bold('Type:')}   ${d.mime_type || '—'}`);
      console.log(`  ${chalk.bold('Size:')}   ${d.size_bytes ?? '—'} bytes`);
      console.log(`  ${chalk.bold('Folder:')} ${d.folder_id ?? '—'}`);
    } catch (e) { fail(spinner, 'Failed to get document', e); }
  });

storageCommand
  .command('download <document_id>')
  .description('Get a signed download URL for a document')
  .option('-o, --output <path>', 'Save to local path (downloads via the URL)')
  .action(async (id, opts) => {
    requireAuth();
    const spinner = ora(`Resolving download URL for ${id}...`).start();
    try {
      const res = await apiClient.get(`/api/v1/storage/documents/${id}/download`);
      const r = res.data as Record<string, any>;
      const url = r.url || r.download_url;
      if (!url) {
        spinner.fail(chalk.red('No URL returned by server'));
        return;
      }
      if (!opts.output) {
        spinner.succeed(chalk.green('Download URL'));
        console.log('');
        console.log(`  ${chalk.cyan(url)}`);
        return;
      }
      // Stream the URL to the local path
      spinner.text = 'Downloading...';
      const axios = (await import('axios')).default;
      const fs = await import('fs');
      const writer = fs.createWriteStream(opts.output);
      const resp = await axios.get(url, { responseType: 'stream' });
      await new Promise<void>((resolve, reject) => {
        resp.data.pipe(writer);
        writer.on('finish', resolve);
        writer.on('error', reject);
      });
      spinner.succeed(chalk.green(`Saved to ${opts.output}`));
    } catch (e) { fail(spinner, 'Download failed', e); }
  });

storageCommand
  .command('delete <document_id>')
  .description('Delete a document')
  .action(async (id) => {
    requireAuth();
    const spinner = ora(`Deleting ${id}...`).start();
    try {
      await apiClient.delete(`/api/v1/storage/documents/${id}`);
      spinner.succeed(chalk.green(`Document ${id} deleted`));
    } catch (e) { fail(spinner, 'Delete failed', e); }
  });

storageCommand
  .command('search <query>')
  .description('Search documents by name / content')
  .option('--json', 'Output as JSON')
  .action(async (query, opts) => {
    requireAuth();
    const spinner = ora(`Searching for "${query}"...`).start();
    try {
      const res = await apiClient.post('/api/v1/storage/search', { query });
      const data = res.data as Record<string, any>;
      const items = data.results || data.items || [];
      if (opts.json) { spinner.stop(); console.log(JSON.stringify(data, null, 2)); return; }
      spinner.succeed(chalk.green(`${items.length} match(es)`));
      for (const r of items as Record<string, any>[]) {
        console.log(`  ${chalk.bold(r.id)}  ${r.filename || r.name}`);
      }
    } catch (e) { fail(spinner, 'Search failed', e); }
  });

// ── Folders ───────────────────────────────────────────────────────────

const foldersCmd = new Command('folders').description('Folder hierarchy');

foldersCmd
  .command('list')
  .description('List folders')
  .option('--json', 'Output as JSON')
  .action(async (opts) => {
    requireAuth();
    const spinner = ora('Loading folders...').start();
    try {
      const res = await apiClient.get('/api/v1/storage/folders');
      const data = res.data as Record<string, any>;
      const items = data.folders || data;
      const list = Array.isArray(items) ? items : (items.folders || []);
      if (opts.json) { spinner.stop(); console.log(JSON.stringify(data, null, 2)); return; }
      spinner.succeed(chalk.green(`${list.length} folder(s)`));
      for (const f of list as Record<string, any>[]) {
        console.log(`  ${chalk.bold(f.id)}  ${f.icon || ''} ${f.name}  ${chalk.dim(`${f.file_count ?? 0} files`)}`);
      }
    } catch (e) { fail(spinner, 'Failed', e); }
  });

foldersCmd
  .command('create')
  .description('Create a folder')
  .requiredOption('--name <name>', 'Folder name')
  .option('--parent <id>', 'Parent folder ID')
  .option('--icon <name>', 'Icon name')
  .option('--color <hex>', 'Color')
  .action(async (opts) => {
    requireAuth();
    const body: Record<string, unknown> = { name: opts.name };
    if (opts.parent) body.parent_folder_id = parseInt(opts.parent, 10);
    if (opts.icon) body.icon = opts.icon;
    if (opts.color) body.color = opts.color;
    const spinner = ora(`Creating folder "${opts.name}"...`).start();
    try {
      const res = await apiClient.post('/api/v1/storage/folders', body);
      const f = res.data as Record<string, any>;
      spinner.succeed(chalk.green(`Folder created: ${f.id}`));
    } catch (e) { fail(spinner, 'Failed', e); }
  });

foldersCmd
  .command('update <folder_id>')
  .description('Update a folder')
  .option('--name <name>')
  .option('--icon <name>')
  .option('--color <hex>')
  .action(async (id, opts) => {
    requireAuth();
    const body: Record<string, unknown> = {};
    if (opts.name) body.name = opts.name;
    if (opts.icon) body.icon = opts.icon;
    if (opts.color) body.color = opts.color;
    const spinner = ora('Updating folder...').start();
    try {
      await apiClient.patch(`/api/v1/storage/folders/${id}`, body);
      spinner.succeed(chalk.green('Folder updated'));
    } catch (e) { fail(spinner, 'Failed', e); }
  });

foldersCmd
  .command('delete <folder_id>')
  .description('Delete a folder')
  .action(async (id) => {
    requireAuth();
    const spinner = ora(`Deleting folder ${id}...`).start();
    try {
      await apiClient.delete(`/api/v1/storage/folders/${id}`);
      spinner.succeed(chalk.green('Folder deleted'));
    } catch (e) { fail(spinner, 'Failed', e); }
  });

storageCommand.addCommand(foldersCmd);

// ── File browser actions (newer surface) ──────────────────────────────

storageCommand
  .command('star <file_id>')
  .description('Star a file')
  .action(async (id) => {
    requireAuth();
    const spinner = ora('Starring...').start();
    try {
      await apiClient.post(`/api/v1/storage/files/${id}/star`);
      spinner.succeed(chalk.green('Starred'));
    } catch (e) { fail(spinner, 'Failed', e); }
  });

storageCommand
  .command('archive <file_id>')
  .description('Archive a file')
  .action(async (id) => {
    requireAuth();
    const spinner = ora('Archiving...').start();
    try {
      await apiClient.post(`/api/v1/storage/files/${id}/archive`);
      spinner.succeed(chalk.green('Archived'));
    } catch (e) { fail(spinner, 'Failed', e); }
  });

storageCommand
  .command('restore <file_id>')
  .description('Restore an archived file')
  .action(async (id) => {
    requireAuth();
    const spinner = ora('Restoring...').start();
    try {
      await apiClient.post(`/api/v1/storage/files/${id}/restore`);
      spinner.succeed(chalk.green('Restored'));
    } catch (e) { fail(spinner, 'Failed', e); }
  });

// ── Asset packs ───────────────────────────────────────────────────────

storageCommand
  .command('packs')
  .description('List available asset packs')
  .option('--json', 'Output as JSON')
  .action(async (opts) => {
    requireAuth();
    const spinner = ora('Loading packs...').start();
    try {
      const res = await apiClient.get('/api/v1/storage/packs');
      if (opts.json) { spinner.stop(); console.log(JSON.stringify(res.data, null, 2)); return; }
      spinner.succeed(chalk.green('Asset packs'));
      const items = (res.data as Record<string, any>).packs || res.data;
      const list = Array.isArray(items) ? items : (items.items || []);
      for (const p of list as Record<string, any>[]) {
        console.log(`  ${chalk.bold(p.id)}  ${p.name}  ${chalk.dim(p.description || '')}`);
      }
    } catch (e) { fail(spinner, 'Failed', e); }
  });

storageCommand
  .command('pack-activate <pack_id>')
  .description('Activate an asset pack for this company')
  .action(async (id) => {
    requireAuth();
    const spinner = ora(`Activating pack ${id}...`).start();
    try {
      await apiClient.post('/api/v1/storage/packs/activate', { pack_id: id });
      spinner.succeed(chalk.green('Pack activated'));
    } catch (e) { fail(spinner, 'Failed', e); }
  });
