/** Schedule & appointment commands for Solid CLI */

import { Command } from 'commander';
import ora from 'ora';
import chalk from 'chalk';
import { config } from '../lib/config';
import { apiClient, handleApiError } from '../lib/api-client';
import { ui } from '../lib/ui';
import { isJsonOutput } from '../lib/json-output';

function requireAuth() {
  if (!config.isLoggedIn()) { console.error(chalk.red('Not logged in. Run `solid auth login` first.')); process.exit(1); }
}

export const scheduleCommand = new Command('schedule')
  .description('Appointment scheduling & calendar');

{
  const { withListFlags } = require('../lib/command-kit') as typeof import('../lib/command-kit');
  const listCmd = scheduleCommand.command('list').description('List appointments');
  withListFlags(listCmd, '20');
  listCmd.option('--date <date>', 'Filter by date (YYYY-MM-DD)');
  listCmd.option('--status <status>', 'Filter by status (confirmed, pending, cancelled)');
  listCmd.action(async (opts: { date?: string; status?: string } & import('../lib/command-kit').ListFlags) => {
    const { runListCommand } = await import('../lib/command-kit');
    await runListCommand(opts, {
      spinnerText: 'Loading appointments...',
      errorText: 'Failed to load appointments',
      fetch: async (offset, limit) => {
        const params: Record<string, unknown> = { limit, offset };
        if (opts.date) params.date = opts.date;
        if (opts.status) params.status = opts.status;
        return (await apiClient.get('/api/v1/schedule', { params })).data;
      },
      extract: (page) => {
        const d = page as Record<string, unknown>;
        return ((d.appointments || d.items || []) as Array<Record<string, unknown>>);
      },
      render: (items) => {
        if (!items.length) { console.log(chalk.dim('  No appointments found.')); return; }
        console.log('');
        for (const apt of items) {
          const sc = apt.status === 'confirmed' ? chalk.green : apt.status === 'cancelled' ? chalk.red : chalk.yellow;
          console.log(`  ${chalk.bold(`#${apt.id}`)}  ${apt.date || ''} ${apt.time || apt.start_time || ''}  ${sc(String(apt.status || 'pending'))}`);
          if (apt.service_name || apt.contact_name) console.log(chalk.dim(`    ${apt.service_name || ''} ${apt.contact_name ? '- ' + apt.contact_name : ''}`));
        }
      },
    });
  });
}

// Get appointment details
scheduleCommand
  .command('get <id>')
  .description('Get appointment details')
  .option('--json', 'Output as JSON')
  .action(async (id, options) => {
    requireAuth();
    const spinner = ora('Loading appointment...').start();

    try {
      const response = await apiClient.get(`/api/v1/schedule/${id}`);
      const apt = response.data as Record<string, any>;

      if (isJsonOutput(options)) {
        spinner.stop();
        console.log(JSON.stringify(apt, null, 2));
        return;
      }

      spinner.succeed(chalk.green(`Appointment #${id}`));
      console.log('');
      const fields: [string, string | undefined][] = [
        ['Status', apt.status], ['Date', apt.date], ['Time', apt.time || apt.start_time],
        ['Service', apt.service_name], ['Contact', apt.contact_name], ['Notes', apt.notes],
      ];
      for (const [k, v] of fields) { if (v) console.log(`  ${chalk.bold(k + ':')}  ${v}`); }
    } catch (error) {
      spinner.fail(chalk.red('Failed to load appointment'));
      console.error(chalk.red(`  ${handleApiError(error).message}`));
    }
  });

// Create appointment
scheduleCommand
  .command('create')
  .description('Create a new appointment')
  .requiredOption('--service-id <id>', 'Service ID')
  .requiredOption('--date <date>', 'Date (YYYY-MM-DD)')
  .requiredOption('--time <time>', 'Time (HH:MM)')
  .option('--contact-id <id>', 'Contact ID')
  .option('--notes <text>', 'Notes')
  .action(async (options) => {
    requireAuth();
    const spinner = ora('Creating appointment...').start();

    try {
      const body: Record<string, unknown> = {
        service_id: parseInt(options.serviceId),
        date: options.date,
        time: options.time,
      };
      if (options.contactId) body.contact_id = parseInt(options.contactId);
      if (options.notes) body.notes = options.notes;

      const response = await apiClient.post('/api/v1/schedule', body);
      const apt = response.data as Record<string, any>;

      spinner.succeed(chalk.green(`Appointment created (#${apt.id || 'OK'})`));
      console.log(chalk.dim(`  ${options.date} at ${options.time}`));
    } catch (error) {
      spinner.fail(chalk.red('Failed to create appointment'));
      console.error(chalk.red(`  ${handleApiError(error).message}`));
    }
  });

// Update appointment
scheduleCommand
  .command('update <id>')
  .description('Update an appointment')
  .option('--status <status>', 'New status')
  .option('--date <date>', 'New date (YYYY-MM-DD)')
  .option('--time <time>', 'New time (HH:MM)')
  .action(async (id, options) => {
    requireAuth();
    const body: Record<string, unknown> = {};
    if (options.status) body.status = options.status;
    if (options.date) body.date = options.date;
    if (options.time) body.time = options.time;

    if (Object.keys(body).length === 0) {
      console.error(chalk.red('Provide at least one field to update (--status, --date, --time).'));
      process.exit(1);
    }

    const spinner = ora('Updating appointment...').start();

    try {
      await apiClient.patch(`/api/v1/schedule/${id}`, body);
      spinner.succeed(chalk.green(`Appointment #${id} updated`));
    } catch (error) {
      spinner.fail(chalk.red('Failed to update appointment'));
      console.error(chalk.red(`  ${handleApiError(error).message}`));
    }
  });

// Hold a slot (10-minute reservation for checkout)
scheduleCommand
  .command('hold')
  .description('Hold an appointment slot (temporary reservation)')
  .requiredOption('--service-id <id>', 'Service ID')
  .requiredOption('--start <iso>', 'Start time (ISO8601)')
  .action(async (opts) => {
    requireAuth();
    const spinner = ora('Holding slot...').start();
    try {
      const res = await apiClient.post('/api/v1/appointments/hold', {
        service_id: parseInt(opts.serviceId, 10),
        start_time: opts.start,
      });
      const r = res.data as Record<string, any>;
      spinner.succeed(chalk.green(`Hold: ${r.hold_id || r.id}`));
      if (r.expires_at) console.log(chalk.dim(`  expires: ${r.expires_at}`));
    } catch (error) {
      spinner.fail(chalk.red('Failed to hold slot'));
      console.error(chalk.red(`  ${handleApiError(error).message}`));
    }
  });

// Book an appointment
scheduleCommand
  .command('book')
  .description('Book an appointment (converts a hold, or books directly)')
  .requiredOption('--service-id <id>', 'Service ID')
  .requiredOption('--start <iso>', 'Start time (ISO8601)')
  .requiredOption('--customer-email <email>', 'Customer email')
  .option('--hold-id <id>', 'Hold ID if converting a held slot')
  .option('--notes <text>', 'Notes')
  .action(async (opts) => {
    requireAuth();
    const body: Record<string, unknown> = {
      service_id: parseInt(opts.serviceId, 10),
      start_time: opts.start,
      customer_email: opts.customerEmail,
    };
    if (opts.holdId) body.hold_id = opts.holdId;
    if (opts.notes) body.notes = opts.notes;
    const spinner = ora('Booking...').start();
    try {
      const res = await apiClient.post('/api/v1/appointments/book', body);
      const a = res.data as Record<string, any>;
      spinner.succeed(chalk.green(`Appointment booked: ${a.id}`));
    } catch (error) {
      spinner.fail(chalk.red('Failed to book'));
      console.error(chalk.red(`  ${handleApiError(error).message}`));
    }
  });

// Reschedule
scheduleCommand
  .command('reschedule <id>')
  .description('Reschedule an appointment')
  .requiredOption('--start <iso>', 'New start time (ISO8601)')
  .action(async (id, opts) => {
    requireAuth();
    const spinner = ora('Rescheduling...').start();
    try {
      const res = await apiClient.post('/api/v1/appointments/reschedule', {
        appointment_id: parseInt(id, 10),
        start_time: opts.start,
      });
      const a = res.data as Record<string, any>;
      spinner.succeed(chalk.green(`Rescheduled: ${a.id}`));
    } catch (error) {
      spinner.fail(chalk.red('Failed to reschedule'));
      console.error(chalk.red(`  ${handleApiError(error).message}`));
    }
  });

// Cancel appointment
scheduleCommand
  .command('cancel <id>')
  .description('Cancel an appointment')
  .option('--reason <text>', 'Cancellation reason')
  .action(async (id, options) => {
    requireAuth();
    const spinner = ora('Cancelling appointment...').start();

    try {
      await apiClient.post('/api/v1/appointments/cancel', {
        appointment_id: parseInt(id),
        reason: options.reason || '',
      });
      spinner.succeed(chalk.green(`Appointment #${id} cancelled`));
    } catch (error) {
      spinner.fail(chalk.red('Failed to cancel appointment'));
      console.error(chalk.red(`  ${handleApiError(error).message}`));
    }
  });

// Calendar view
scheduleCommand
  .command('calendar')
  .description('View appointment calendar')
  .option('--json', 'Output as JSON')
  .action(async (options) => {
    requireAuth();
    const spinner = ora('Loading calendar...').start();

    try {
      const response = await apiClient.get('/api/v1/schedule/calendar');
      const data = response.data as Record<string, any>;

      if (isJsonOutput(options)) {
        spinner.stop();
        console.log(JSON.stringify(data, null, 2));
        return;
      }

      spinner.succeed(chalk.green('Calendar loaded'));
      const days = data.days || data.calendar || [];
      if (days.length === 0) { console.log(chalk.dim('  No upcoming calendar entries.')); return; }
      console.log('');
      for (const day of days) {
        console.log(chalk.cyan(`  ${day.date || day.day}`));
        for (const s of (day.appointments || day.slots || [])) {
          console.log(`    ${s.time || s.start_time || ''} ${chalk.bold(s.service_name || s.title || '')} ${chalk.dim(s.status || '')}`);
        }
      }
    } catch (error) {
      spinner.fail(chalk.red('Failed to load calendar'));
      console.error(chalk.red(`  ${handleApiError(error).message}`));
    }
  });

// Available slots
scheduleCommand
  .command('slots')
  .description('View available booking slots')
  .requiredOption('--service-id <id>', 'Service ID')
  .requiredOption('--date <date>', 'Date (YYYY-MM-DD)')
  .option('--json', 'Output as JSON')
  .action(async (options) => {
    requireAuth();
    const spinner = ora('Checking availability...').start();

    try {
      const params = { service_id: options.serviceId, date: options.date };
      const response = await apiClient.get('/api/v1/availability/slots', { params });
      const data = response.data as Record<string, any>;
      const slots = data.slots || data.available || [];

      if (isJsonOutput(options)) {
        spinner.stop();
        console.log(JSON.stringify(data, null, 2));
        return;
      }

      spinner.succeed(chalk.green(`${slots.length} available slot(s) on ${options.date}`));
      if (slots.length === 0) { console.log(chalk.dim('  No availability for this date.')); return; }
      console.log('');
      for (const slot of slots) {
        const end = slot.end_time || slot.end || '';
        console.log(`  ${chalk.green(slot.time || slot.start || '')}${end ? chalk.dim(` - ${end}`) : ''}`);
      }
    } catch (error) {
      spinner.fail(chalk.red('Failed to check availability'));
      console.error(chalk.red(`  ${handleApiError(error).message}`));
    }
  });
