/**
 * tenant-warn — soft warning when a non-TTY caller (agent, script) is
 * about to operate on the implicit "current company" set by `solid switch`
 * without passing --company explicitly.
 *
 * Why soft (warning, not hard refusal):
 *   Hard refusal would break every existing automation overnight. The
 *   tier-1 feedback that surfaced this concern (2026-05-07)
 *   acknowledged the trade-off — implicit state is fine for humans, it
 *   is a data-leak vector for agents because they can forget to switch.
 *   A structured stderr warning gives agents the visibility to gate on
 *   the situation themselves while existing scripts keep working.
 *
 * What gets emitted (stderr, single line, JSON when --json is in effect,
 * prose otherwise):
 *
 *   {warning:{code:"IMPLICIT_TENANT", message:"...", company_id:N, hint:"..."}}
 *
 * Agents key on `warning.code === "IMPLICIT_TENANT"` and either
 * (a) abort and ask the human, or
 * (b) include --company <id> on the next call to silence it.
 *
 * Opt-out for noisy CI: SOLID_NO_TENANT_WARN=1.
 */
import { isJsonOutput, isNonTty } from './json-output';

export interface ImplicitTenantWarning {
  warning: {
    code: 'IMPLICIT_TENANT';
    message: string;
    company_id: number;
    hint: string;
  };
}

export function buildImplicitTenantWarning(companyId: number): ImplicitTenantWarning {
  return {
    warning: {
      code: 'IMPLICIT_TENANT',
      message: `Operating on implicit current company (id=${companyId}). Confirm this is the tenant you mean.`,
      company_id: companyId,
      // ⛔ The old hint named "--company <id>" and SOLID_COMPANY_ID. Neither
      // scopes a call: --company exists on four commands out of 171, and the
      // tenant is derived from the JWT, so an env var cannot change it. An
      // agent that followed this hint got an "unknown option" error, or worse,
      // set the env var and carried on against the wrong company. `solid
      // switch` is the one thing that actually changes tenant.
      hint: `Currently authenticated as company ${companyId}. To act on a different tenant, run \`solid switch\` (or \`solid auth login\` as a user of that company) — the tenant comes from your session, not from a flag. Silence with SOLID_NO_TENANT_WARN=1.`,
    },
  };
}

/**
 * True when the warning should fire for this invocation:
 *   - non-TTY caller (agent, MCP, CI),
 *   - no explicit --company / SOLID_COMPANY_ID,
 *   - opt-out env not set.
 *
 * The argv check deliberately scans for a few common spellings rather
 * than parsing options properly — this runs at boot before commander
 * dispatches and we want zero allocation cost.
 */
export function shouldWarnImplicitTenant(opts: {
  argv: string[];
  env: NodeJS.ProcessEnv;
  hasCurrentCompany: boolean;
}): boolean {
  if (!opts.hasCurrentCompany) return false;
  if (!isNonTty()) return false;
  if (opts.env.SOLID_NO_TENANT_WARN && /^(1|true|yes|on)$/i.test(opts.env.SOLID_NO_TENANT_WARN)) {
    return false;
  }
  // ⛔ Deliberately NOT silenced by SOLID_COMPANY_ID.
  //
  // It used to be, and that was the dangerous case: the variable silences
  // nothing real, because the tenant comes from the JWT. Setting it produced a
  // quiet session that operated on whichever company the session was actually
  // authenticated as. A mismatch is now an error (see assertTenantEnvMatches),
  // and a match is not a reason to suppress the warning.
  // Walk argv for any --company / --company-id / -c <value> form.
  for (const arg of opts.argv) {
    if (arg === '--company' || arg === '--company-id' || arg === '-c') return false;
    if (arg.startsWith('--company=') || arg.startsWith('--company-id=')) return false;
  }
  return true;
}

/** Emit the warning to stderr in the right format for the caller. */
export function emitImplicitTenantWarning(companyId: number): void {
  const w = buildImplicitTenantWarning(companyId);
  if (isJsonOutput()) {
    process.stderr.write(JSON.stringify(w) + '\n');
  } else {
    process.stderr.write(
      `[33m! Implicit tenant: company_id=${companyId}. Pass --company to be explicit.[0m\n`,
    );
  }
}

/**
 * Boot-time hook: call once from index.ts after argv has been parsed
 * for the global flags but before commander dispatches the action.
 */
export function maybeWarnImplicitTenant(opts: {
  argv: string[];
  env: NodeJS.ProcessEnv;
  hasCurrentCompany: boolean;
  companyId: number | null;
}): void {
  if (!shouldWarnImplicitTenant(opts)) return;
  if (opts.companyId == null) return;
  emitImplicitTenantWarning(opts.companyId);
}

/**
 * Refuse to run when SOLID_COMPANY_ID names a tenant the session is not.
 *
 * The variable cannot scope a request — the backend derives company_id from the
 * JWT. So when it disagrees with the authenticated company, the caller believes
 * it is acting on one tenant while every write lands on another. Silence there
 * is the failure: better to stop than to write a page, an invoice or a contact
 * into the wrong business.
 *
 * Returns an error message, or null when there is nothing to complain about.
 */
export function tenantEnvMismatch(
  env: NodeJS.ProcessEnv,
  authenticatedCompanyId: number | undefined,
): string | null {
  const raw = env.SOLID_COMPANY_ID;
  if (!raw || authenticatedCompanyId === undefined) return null;
  const wanted = parseInt(raw, 10);
  if (!Number.isFinite(wanted) || wanted === authenticatedCompanyId) return null;
  return (
    `SOLID_COMPANY_ID=${wanted} but this session is authenticated as company ` +
    `${authenticatedCompanyId}. The tenant comes from your session, not from ` +
    `that variable — every call would act on company ${authenticatedCompanyId}. ` +
    `Run \`solid switch\` to change tenant, or unset SOLID_COMPANY_ID.`
  );
}
