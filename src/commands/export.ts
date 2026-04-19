/**
 * Export command for Solid CLI — full company data export (backup, GDPR).
 */
import { Command } from 'commander';
import chalk from 'chalk';
import * as fs from 'fs';
import * as path from 'path';
import { config } from '../lib/config';
import { apiClient, handleApiError } from '../lib/api-client';
import { ui } from '../lib/ui';

export const exportCommand = new Command('export')
  .description('Export all company data (backup, GDPR)')
  .option('-d, --dir <directory>', 'Output directory', '.')
  .option('--contacts-only', 'Only export CRM contacts')
  .action(async (options) => {
    if (!config.isLoggedIn()) { console.error(chalk.red('Not logged in.')); process.exit(1); }
    const companyId = config.companyId;
    if (!companyId) { console.error(chalk.red('No company selected.')); process.exit(1); }

    const ora = (await import('ora')).default;
    const baseDir = path.resolve(options.dir);
    const ts = new Date().toISOString().split('T')[0];
    const exportDir = path.join(baseDir, `solid-export-${companyId}-${ts}`);
    if (!fs.existsSync(exportDir)) fs.mkdirSync(exportDir, { recursive: true });

    const spinner = ora('Exporting company data...').start();
    let fileCount = 0;

    try {
      // Company info
      spinner.text = 'Exporting company info...';
      try { const r = await apiClient.companyInfo(); fs.writeFileSync(path.join(exportDir, 'company.json'), JSON.stringify((r.data as Record<string, any>).company, null, 2)); fileCount++; } catch { /* skip */ }

      if (!options.contactsOnly) {
        // KB
        spinner.text = 'Exporting knowledge base...';
        try { const r = await apiClient.kbSearch('', 100); fs.writeFileSync(path.join(exportDir, 'knowledge-base.json'), JSON.stringify((r.data as Record<string, any>).results || [], null, 2)); fileCount++; } catch { /* skip */ }

        // Pages
        spinner.text = 'Exporting pages...';
        try { const r = await apiClient.pagesList(); fs.writeFileSync(path.join(exportDir, 'pages.json'), JSON.stringify((r.data as Record<string, any>).pages || [], null, 2)); fileCount++; } catch { /* skip */ }

        // Services
        spinner.text = 'Exporting services...';
        try { const r = await apiClient.servicesList(); fs.writeFileSync(path.join(exportDir, 'services.json'), JSON.stringify((r.data as Record<string, any>).items || [], null, 2)); fileCount++; } catch { /* skip */ }

        // Products
        spinner.text = 'Exporting products...';
        try { const r = await apiClient.productsList(); fs.writeFileSync(path.join(exportDir, 'products.json'), JSON.stringify((r.data as Record<string, any>).items || [], null, 2)); fileCount++; } catch { /* skip */ }

        // Agents
        spinner.text = 'Exporting agents...';
        try { const r = await apiClient.agentsList(); fs.writeFileSync(path.join(exportDir, 'agents.json'), JSON.stringify((r.data as Record<string, any>).agents || [], null, 2)); fileCount++; } catch { /* skip */ }
      }

      // Contacts
      spinner.text = 'Exporting contacts...';
      try {
        const r = await apiClient.get('/api/v1/crm/contacts/export', { params: { format: 'json' } });
        fs.writeFileSync(path.join(exportDir, 'contacts.json'), JSON.stringify(r.data, null, 2));
        fileCount++;
      } catch { /* skip */ }

      spinner.succeed(chalk.green(`Exported ${fileCount} files`));
      console.log('');
      console.log(ui.successBox('Export Complete', [
        `${chalk.dim('Company:')}  ${companyId}`,
        `${chalk.dim('Dir:')}      ${exportDir}`,
        `${chalk.dim('Files:')}    ${fileCount}`,
      ]));
      console.log('');
    } catch (e) { spinner.fail(chalk.red('Export failed')); console.error(handleApiError(e).message); }
  });

import { appendExamples as __ae_export } from '../lib/command-kit';
__ae_export(exportCommand, [
  { cmd: 'solid export',                why: 'Full backup of this company (pages, KB, settings, crm)' },
  { cmd: 'solid export --out ./backup', why: 'Choose output dir' },
  { cmd: 'solid export --gdpr <email>', why: 'Single-user GDPR export' },
]);
