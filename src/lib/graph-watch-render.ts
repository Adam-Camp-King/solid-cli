/**
 * Renderer for `solid graph --watch-actions` events.
 *
 * Each event arriving over SSE has shape:
 *
 *     { type: "order.created", payload: {...}, ts: "2026-04-29T..." }
 *
 * This module translates it into the one-line human-readable shape:
 *
 *     [12:34:56] + Contact #42 (Ada Lovelace)   created by Sarah (agent)
 *     [12:34:58] ~ Service #3 (Drain cleaning)  price: 99 → 119
 *
 * Pure module — no console.log, returns the string. Renderer in
 * `commands/graph.ts` does the printing. Easy to unit-test.
 */

export interface WatchEvent {
  type: string;
  payload?: Record<string, unknown>;
  ts?: string;
}

export interface RenderedLine {
  /** ANSI-coded short line for TTY rendering. */
  line: string;
  /** Plain-text version for --json output mode. */
  plain: string;
  /** The op verb (created / updated / deleted / fired / unknown). */
  op: 'create' | 'update' | 'delete' | 'fire' | 'other';
}


/**
 * Best-effort parse of the local time portion from an ISO timestamp.
 * Falls back to "??:??:??" rather than throwing — agent UX should
 * never blow up over a malformed timestamp.
 */
export function formatTime(ts: string | undefined): string {
  if (!ts) return '??:??:??';
  try {
    const d = new Date(ts);
    if (Number.isNaN(d.getTime())) return '??:??:??';
    const hh = String(d.getHours()).padStart(2, '0');
    const mm = String(d.getMinutes()).padStart(2, '0');
    const ss = String(d.getSeconds()).padStart(2, '0');
    return `${hh}:${mm}:${ss}`;
  } catch {
    return '??:??:??';
  }
}


/**
 * Pull a human label from a payload. Falls back through common
 * patterns: name → title → email → id → "<unknown>".
 */
export function payloadLabel(payload: Record<string, unknown> | undefined): string {
  if (!payload) return '<unknown>';
  const candidates = ['name', 'title', 'order_number', 'event_key', 'email', 'subject'];
  for (const key of candidates) {
    const v = payload[key];
    if (typeof v === 'string' && v.trim()) return v;
  }
  return '<unknown>';
}


/**
 * Pull an entity id from a payload. Many emitters use {entity}_id;
 * fall back to plain `id`.
 */
export function payloadId(
  payload: Record<string, unknown> | undefined,
  entityHint?: string,
): string | number | null {
  if (!payload) return null;
  if (entityHint && typeof payload[`${entityHint}_id`] !== 'undefined') {
    const v = payload[`${entityHint}_id`];
    if (typeof v === 'number' || typeof v === 'string') return v;
  }
  if (typeof payload.id === 'number' || typeof payload.id === 'string') return payload.id;
  // Fallback: any *_id field
  for (const k of Object.keys(payload)) {
    if (k.endsWith('_id') && (typeof payload[k] === 'number' || typeof payload[k] === 'string')) {
      return payload[k] as string | number;
    }
  }
  return null;
}


/**
 * Map an event type like ``order.created`` to {entity, op}.
 * Unknown shapes return {entity: rawType, op: 'other'}.
 */
export function classifyEvent(eventType: string): {
  entity: string;
  op: RenderedLine['op'];
} {
  const parts = eventType.split('.');
  if (parts.length < 2) return { entity: eventType, op: 'other' };

  const entity = parts[0];
  const verb = parts.slice(1).join('.');

  if (verb === 'created' || verb === 'create') return { entity, op: 'create' };
  if (verb === 'updated' || verb === 'update' || verb === 'changed') return { entity, op: 'update' };
  if (verb === 'deleted' || verb === 'delete' || verb === 'removed') return { entity, op: 'delete' };
  if (verb === 'fired' || verb === 'fire' || verb === 'triggered') return { entity, op: 'fire' };
  return { entity, op: 'other' };
}


function symbol(op: RenderedLine['op']): string {
  switch (op) {
    case 'create': return '+';
    case 'update': return '~';
    case 'delete': return '-';
    case 'fire':   return '⚡';
    default:       return '·';
  }
}


/** Build the right-hand "by whom" suffix from common payload fields. */
function actorSuffix(payload: Record<string, unknown> | undefined): string {
  if (!payload) return '';
  const agent = payload.agent || payload.fired_by_agent || payload.created_by_agent;
  if (typeof agent === 'string' && agent.trim()) return `by ${agent} (agent)`;
  const chain = payload.chain || payload.chain_name || payload.fired_by_chain;
  if (typeof chain === 'string' && chain.trim()) return `fired by chain "${chain}"`;
  const user = payload.user_email || payload.created_by;
  if (typeof user === 'string' && user.trim()) return `by ${user}`;
  return '';
}


/** Compose a one-line render for an event. */
export function renderWatchEvent(event: WatchEvent): RenderedLine {
  const time = formatTime(event.ts);
  const { entity, op } = classifyEvent(event.type);
  const sym = symbol(op);
  const id = payloadId(event.payload, entity);
  const label = payloadLabel(event.payload);
  const suffix = actorSuffix(event.payload);

  // Capitalize entity for the headline
  const entityName = entity.charAt(0).toUpperCase() + entity.slice(1);
  const idStr = id !== null ? `#${id}` : '';
  const labelStr = label !== '<unknown>' ? `(${label})` : '';
  const head = [entityName, idStr, labelStr].filter(Boolean).join(' ');

  // For update, include before→after if available
  let detail = suffix;
  if (op === 'update' && event.payload) {
    const changedField = ['price', 'status', 'name', 'category'].find(
      (k) => k in (event.payload as Record<string, unknown>),
    );
    if (changedField) {
      const v = (event.payload as Record<string, unknown>)[changedField];
      const prev = (event.payload as Record<string, unknown>)[`prev_${changedField}`] ??
        (event.payload as Record<string, unknown>)[`old_${changedField}`];
      if (prev !== undefined) {
        detail = `${changedField}: ${prev} → ${v}`;
      } else {
        detail = `${changedField}: ${v}`;
      }
    }
  }

  const plain = `[${time}] ${sym} ${head}${detail ? '  ' + detail : ''}`;
  // ANSI-light version — green for create, yellow for update, red for delete
  const colorOpen =
    op === 'create' ? '\x1b[32m' :
    op === 'update' ? '\x1b[33m' :
    op === 'delete' ? '\x1b[31m' :
    op === 'fire'   ? '\x1b[36m' : '';
  const colorClose = colorOpen ? '\x1b[0m' : '';
  const line = `\x1b[2m[${time}]\x1b[0m ${colorOpen}${sym}\x1b[0m ${head}${detail ? '  \x1b[2m' + detail + '\x1b[0m' : ''}`;
  void colorClose;

  return { line, plain, op };
}
