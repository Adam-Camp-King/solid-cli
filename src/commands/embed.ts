/**
 * `solid embed` — ready-to-paste snippets that wire any website (hand-built
 * or AI-generated) to this company's real backend: chat widget, lead form,
 * payment-link button. The snippet IS the integration; nothing to install.
 */

import { Command } from 'commander';
import ora from 'ora';
import chalk from 'chalk';
import { config } from '../lib/config';
import { apiClient, handleApiError } from '../lib/api-client';
import { isJsonOutput } from '../lib/json-output';
import {
  chatEmbedSnippet,
  formEmbedSnippet,
  formEmbedSnippetReact,
  paylinkEmbedSnippet,
  FormConfig,
} from '../lib/embed-snippets';

function requireAuth() {
  if (!config.isLoggedIn()) {
    console.error(chalk.red('Not logged in. Run `solid auth login` first.'));
    process.exit(1);
  }
}

function emit(snippet: string, meta: Record<string, unknown>, options: { json?: boolean }) {
  if (isJsonOutput(options)) {
    console.log(JSON.stringify({ ...meta, snippet }, null, 2));
    return;
  }
  console.log('');
  console.log(snippet);
  console.log('');
}

export const embedCommand = new Command('embed')
  .description('Embed snippets — wire any website to Solid# (chat, form, paylink)');

embedCommand
  .command('chat <integrationId>')
  .description('Chat widget script tag for an AI chat integration')
  .option('--json', 'Output as JSON')
  .action(async (integrationId: string, options) => {
    const snippet = chatEmbedSnippet(config.apiUrl, integrationId);
    emit(snippet, { type: 'chat', integration_id: integrationId }, options);
    if (!isJsonOutput(options)) {
      console.log(chalk.dim('  Manage integrations: ') + chalk.cyan('solid chat-widgets list'));
      console.log('');
    }
  });

embedCommand
  .command('form <formId>')
  .description('Lead form — submissions create CRM contacts with lead scoring')
  .option('--react', 'Emit a React component instead of HTML + vanilla JS')
  .option('--json', 'Output as JSON')
  .action(async (formId: string, options) => {
    const id = parseInt(formId, 10);
    if (isNaN(id)) {
      console.error(chalk.red('Invalid form ID.'));
      process.exit(1);
    }
    const spinner = ora(`Loading form #${id}...`).start();
    try {
      // Public config endpoint — also proves the form exists and is active.
      const res = await apiClient.get<FormConfig>(`/api/v1/public/forms/${id}`);
      spinner.stop();
      const form = res.data;
      const snippet = options.react
        ? formEmbedSnippetReact(config.apiUrl, form)
        : formEmbedSnippet(config.apiUrl, form);
      emit(snippet, { type: 'form', form_id: id, format: options.react ? 'react' : 'html' }, options);
    } catch (error) {
      spinner.fail(chalk.red('Failed to load form'));
      console.error(chalk.red(`  ${handleApiError(error).message}`));
      console.error(chalk.dim('  List forms: ') + chalk.cyan('solid forms list'));
      process.exit(1);
    }
  });

embedCommand
  .command('paylink <linkId>')
  .description('Payment-link button — checkout on the processor-hosted page')
  .option('--label <label>', 'Button label', 'Pay now')
  .option('--json', 'Output as JSON')
  .action(async (linkId: string, options) => {
    requireAuth();
    const spinner = ora(`Loading payment link ${linkId}...`).start();
    try {
      const res = await apiClient.get<Record<string, unknown>>(`/api/v1/payment-links/${linkId}`);
      spinner.stop();
      const link = (res.data as { payment_link?: Record<string, unknown> }).payment_link || res.data;
      const checkoutUrl = String(link.checkout_url || '');
      if (!checkoutUrl) {
        console.error(chalk.red('Payment link has no checkout_url — is it active?'));
        process.exit(1);
      }
      const snippet = paylinkEmbedSnippet(checkoutUrl, options.label);
      emit(snippet, { type: 'paylink', link_id: linkId, checkout_url: checkoutUrl }, options);
    } catch (error) {
      spinner.fail(chalk.red('Failed to load payment link'));
      console.error(chalk.red(`  ${handleApiError(error).message}`));
      process.exit(1);
    }
  });
