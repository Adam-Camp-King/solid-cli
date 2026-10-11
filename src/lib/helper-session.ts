/**
 * The helper's own decisions — what it will do for a request, and what it refuses.
 *
 * The platform can ask. This is the second check, on the person's own machine, and it
 * does not trust the first:
 *
 *   ⛔ NOTHING RUNS WITHOUT A GRANT THIS MACHINE APPROVED. The person typed a code
 *      here; the platform answered with that grant's id; only a request naming that
 *      id is run. A request with no grant, another grant, or after Stop is refused.
 *   ⛔ ONLY A NAME IN THIS MACHINE'S OWN LIST. See helper-actions.ts.
 *   ⛔ STOP IS LOCAL AND IMMEDIATE. It clears the grant here before it tells anyone.
 *
 * Pure state plus an injected runner, so each rule is testable.
 */
import { runAction, type ActionResult, type Exec, type Platform } from './helper-actions';

export type HelperRequest = { type?: unknown; rid?: unknown; action?: unknown; kind?: unknown; inputs?: unknown; grant_id?: unknown };
export type Did = { at: number; action: string; ok: boolean; reason?: string };

export class HelperSession {
  private grantId: number | null = null;
  readonly log: Did[] = [];

  constructor(private readonly platform: Platform | null, private readonly exec: Exec,
    private readonly now: () => number = Date.now) {}

  get granted(): boolean { return this.grantId !== null; }

  /** The platform confirmed the code the person typed here. */
  approved(grantId: unknown): boolean {
    if (typeof grantId !== 'number' || !Number.isInteger(grantId) || grantId <= 0) return false;
    this.grantId = grantId;
    return true;
  }

  /** Stop: theirs (pressed here) or the platform's (the grant ended). Always wins. */
  stop(): void { this.grantId = null; }

  /** One request from the platform → the answer to send back, or null to send nothing. */
  async handle(request: HelperRequest): Promise<{ rid: string; result: ActionResult } | null> {
    if (!request || typeof request !== 'object') return null;
    if (request.type === 'grant_ended' || request.type === 'retired') { this.stop(); return null; }
    if (request.type !== 'do' || typeof request.rid !== 'string' || !request.rid) return null;
    const action = typeof request.action === 'string' ? request.action : '';
    const refuse = (reason: string) => {
      this.log.push({ at: this.now(), action, ok: false, reason });
      return { rid: request.rid as string, result: { ok: false, reason } };
    };
    if (this.grantId === null) return refuse('no_grant_on_this_machine');
    if (request.grant_id !== this.grantId) return refuse('grant_not_this_one');
    const result = await runAction(action, request.inputs, this.platform, this.exec);
    this.log.push({ at: this.now(), action, ok: result.ok, reason: result.reason });
    return { rid: request.rid, result };
  }
}
