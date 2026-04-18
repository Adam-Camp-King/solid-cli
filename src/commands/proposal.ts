/**
 * Proposal generator for agencies
 *
 * solid proposal "Joe's Plumbing" --template plumber
 * solid proposal "City Dental" --template dentist --tier professional
 */

import { Command } from 'commander';
import chalk from 'chalk';
import { config } from '../lib/config';
import { ui } from '../lib/ui';
import { isJsonOutput } from '../lib/json-output';

const TIER_DETAILS: Record<string, { name: string; price: string; features: string[] }> = {
  starter: {
    name: 'Starter',
    price: '$89/mo',
    features: [
      'AI-powered website with CMS',
      'CRM with lead scoring',
      'Appointment scheduling',
      '6 AI agents (Sarah, Marcus + 4 more)',
      'Phone number with AI receptionist',
      'Basic SEO audit',
    ],
  },
  builder: {
    name: 'Builder',
    price: '$199/mo',
    features: [
      'Everything in Starter',
      'Content Studio & blog',
      'Accounting sync (QuickBooks/Xero)',
      '12 AI agents',
      'Advanced SEO with citations',
      'Email campaigns',
    ],
  },
  professional: {
    name: 'Professional',
    price: '$499/mo',
    features: [
      'Everything in Builder',
      'AI workflows & automation',
      'API access & MCP tools',
      '17 AI agents',
      'White-label ready',
      'Priority support',
    ],
  },
  enterprise: {
    name: 'Enterprise',
    price: '$1,499/mo',
    features: [
      'Everything in Professional',
      'Unlimited AI agents (29+)',
      'Dedicated infrastructure',
      'Custom integrations',
      'SLA guarantee',
      'Onboarding concierge',
    ],
  },
};

const INDUSTRY_BENEFITS: Record<string, string[]> = {
  plumber: [
    'AI answers calls 24/7 — never miss a service request',
    'Automatic job scheduling from phone calls',
    'Google review requests after every completed job',
    'Service area SEO targeting your zip codes',
    'Emergency dispatch priority routing',
  ],
  dentist: [
    'AI handles appointment booking and reminders',
    'Patient intake forms auto-sync to CRM',
    'Insurance verification automation',
    'Review generation after visits',
    'New patient welcome campaigns',
  ],
  hvac: [
    'AI dispatches seasonal maintenance reminders',
    'Emergency call priority routing (24/7)',
    'Equipment warranty tracking',
    'Service agreement renewal automation',
    'Weather-triggered marketing campaigns',
  ],
  restaurant: [
    'AI handles reservations and waitlist',
    'Online ordering integration',
    'Review monitoring and response',
    'Staff scheduling optimization',
    'Loyalty program automation',
  ],
  default: [
    'AI-powered customer service 24/7',
    'Automatic lead capture and follow-up',
    'Website with industry-specific content',
    'Appointment scheduling and reminders',
    'Review generation and reputation management',
  ],
};

export const proposalCommand = new Command('proposal')
  .description('Generate a branded PDF pitch deck for a prospect (agency sales tool)')
  .argument('<business-name>', 'Client business name')
  .option('-t, --template <industry>', 'Industry template (plumber, dentist, hvac, etc.)')
  .option('--tier <tier>', 'Recommended tier (starter, builder, professional, enterprise)', 'starter')
  .option('--json', 'JSON output')
  .addHelpText('after', `
Examples:
  $ solid proposal "Joe's Plumbing" --template plumber
  $ solid proposal "City Dental" --template dentist --tier professional
  $ solid proposal "Acme Corp" --template hvac --json > proposal.json

Output: a hosted PDF URL + the tier recommendation. The PDF is rendered
server-side and cached; the same URL is reusable. For a LIVE demo where
the prospect can interact with the AI, use \`solid demo create\` instead.`)
  .action(async (businessName, options) => {
    const industry = options.template || 'default';
    const tier = options.tier;
    const tierInfo = TIER_DETAILS[tier] || TIER_DETAILS.starter;
    const benefits = INDUSTRY_BENEFITS[industry] || INDUSTRY_BENEFITS.default;

    const agencyName = config.userEmail
      ? config.userEmail.split('@')[1]?.replace(/\.(com|io|dev|agency)$/, '').replace(/^\w/, (c: string) => c.toUpperCase())
      : 'Your Agency';

    if (isJsonOutput(options)) {
      console.log(JSON.stringify({
        business_name: businessName,
        industry,
        tier: tierInfo,
        benefits,
        agency: agencyName,
        generated_at: new Date().toISOString(),
      }, null, 2));
      return;
    }

    console.log('');
    console.log(ui.header(`Proposal for ${businessName}`));
    console.log('');
    console.log(`  ${chalk.dim('Prepared by')} ${chalk.bold(agencyName)}`);
    console.log(`  ${chalk.dim('Date:')} ${new Date().toLocaleDateString()}`);
    console.log('');

    console.log(ui.divider('What We\'ll Build'));
    console.log('');
    for (const benefit of benefits) {
      console.log(`  ${chalk.green('✓')} ${benefit}`);
    }
    console.log('');

    console.log(ui.divider(`Recommended Plan: ${tierInfo.name} (${tierInfo.price})`));
    console.log('');
    for (const feature of tierInfo.features) {
      console.log(`  ${chalk.cyan('•')} ${feature}`);
    }
    console.log('');

    console.log(ui.divider('What Happens Next'));
    console.log('');
    console.log(`  ${chalk.bold('1.')} Sign up at ${chalk.hex('#818cf8')('solidnumber.com/pricing')}`);
    console.log(`  ${chalk.bold('2.')} We scaffold ${businessName} with the ${industry} template`);
    console.log(`  ${chalk.bold('3.')} AI agents go live within 24 hours`);
    console.log(`  ${chalk.bold('4.')} Your first leads start coming in`);
    console.log('');

    if (industry !== 'default') {
      console.log(chalk.dim(`  This proposal uses the "${industry}" industry template.`));
      console.log(chalk.dim('  52 industry templates available. Run: solid clone --list'));
    }
    console.log('');
  });
