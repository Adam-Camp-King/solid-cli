/**
 * Embed snippet builders — pure string generation for `solid embed`.
 *
 * Each builder emits ready-to-paste markup that points an external (often
 * AI-generated) website at the real Solid# backend: the chat widget script,
 * a lead form wired to the public submit endpoint (contact + lead score +
 * drip on submit), and a payment-link button. No HTTP here — the command
 * fetches whatever live data a snippet needs and passes it in, so these are
 * unit-testable and usable from the programmatic client.
 */

export interface FormField {
  name: string;
  label?: string;
  type?: string;
  required?: boolean;
  options?: string[];
}

export interface FormConfig {
  id: number;
  title?: string;
  subtitle?: string;
  fields?: FormField[];
  submit_button_text?: string;
}

const FALLBACK_FIELDS: FormField[] = [
  { name: 'name', label: 'Name', type: 'text', required: true },
  { name: 'email', label: 'Email', type: 'email', required: true },
  { name: 'message', label: 'Message', type: 'textarea' },
];

function esc(s: string): string {
  return s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
}

/** Chat widget — one script tag, config resolves server-side by integration id. */
export function chatEmbedSnippet(apiBase: string, integrationId: string | number): string {
  const base = apiBase.replace(/\/$/, '');
  return `<script src="${base}/static/chat-widget/solid-chat.js" data-integration-id="${integrationId}"></script>`;
}

function fieldInput(f: FormField): string {
  const name = esc(f.name);
  const type = f.type || 'text';
  const req = f.required ? ' required' : '';
  if (type === 'textarea') return `<textarea name="${name}" rows="4"${req}></textarea>`;
  if (type === 'select' && f.options?.length) {
    const opts = f.options.map((o) => `<option value="${esc(o)}">${esc(o)}</option>`).join('');
    return `<select name="${name}"${req}>${opts}</select>`;
  }
  return `<input name="${name}" type="${esc(type)}"${req}>`;
}

/**
 * Lead form — plain HTML + vanilla JS POSTing `{ data, attribution }` to the
 * public submit endpoint. Submissions create/score CRM contacts server-side.
 */
export function formEmbedSnippet(apiBase: string, form: FormConfig): string {
  const base = apiBase.replace(/\/$/, '');
  const fields = form.fields?.length ? form.fields : FALLBACK_FIELDS;
  const formDom = `solid-form-${form.id}`;
  const rows = fields
    .map((f) => `    <label>${esc(f.label || f.name)}${fieldInput(f)}</label>`)
    .join('\n');
  const heading = form.title ? `    <h3>${esc(form.title)}</h3>\n` : '';
  const sub = form.subtitle ? `    <p>${esc(form.subtitle)}</p>\n` : '';

  return `<!-- Solid# form ${form.id} — submissions create CRM contacts with lead scoring -->
<form id="${formDom}" class="solid-form">
${heading}${sub}${rows}
    <button type="submit">${esc(form.submit_button_text || 'Send')}</button>
    <p class="solid-form-status" hidden></p>
</form>
<script>
(function () {
  var f = document.getElementById('${formDom}');
  f.addEventListener('submit', function (e) {
    e.preventDefault();
    var data = {};
    new FormData(f).forEach(function (v, k) { data[k] = v; });
    var status = f.querySelector('.solid-form-status');
    fetch('${base}/api/v1/public/forms/${form.id}/submit', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ data: data, attribution: { referrer: document.referrer, url: location.href } })
    }).then(function (r) { return r.json(); }).then(function (res) {
      if (res.redirect_url) { location.href = res.redirect_url; return; }
      status.hidden = false;
      status.textContent = res.message || 'Thanks — we got it.';
      if (res.success) f.reset();
    }).catch(function () {
      status.hidden = false;
      status.textContent = 'Something went wrong — please try again.';
    });
  });
})();
</script>`;
}

/** React flavor of the lead form — drop into any Next.js / React site. */
export function formEmbedSnippetReact(apiBase: string, form: FormConfig): string {
  const base = apiBase.replace(/\/$/, '');
  const fields = form.fields?.length ? form.fields : FALLBACK_FIELDS;
  const rows = fields
    .map((f) => {
      const label = esc(f.label || f.name);
      const req = f.required ? ' required' : '';
      if ((f.type || 'text') === 'textarea') {
        return `      <label>${label}<textarea name="${esc(f.name)}" rows={4}${req} /></label>`;
      }
      return `      <label>${label}<input name="${esc(f.name)}" type="${esc(f.type || 'text')}"${req} /></label>`;
    })
    .join('\n');

  return `// Solid# form ${form.id} — submissions create CRM contacts with lead scoring
import { useState } from 'react';

export function SolidForm() {
  const [status, setStatus] = useState('');

  async function onSubmit(e) {
    e.preventDefault();
    const form = e.currentTarget;
    const data = Object.fromEntries(new FormData(form));
    try {
      const res = await fetch('${base}/api/v1/public/forms/${form.id}/submit', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ data, attribution: { referrer: document.referrer, url: location.href } }),
      }).then((r) => r.json());
      if (res.redirect_url) { location.href = res.redirect_url; return; }
      setStatus(res.message || 'Thanks — we got it.');
      if (res.success) form.reset();
    } catch {
      setStatus('Something went wrong — please try again.');
    }
  }

  return (
    <form onSubmit={onSubmit} className="solid-form">
${rows}
      <button type="submit">${esc(form.submit_button_text || 'Send')}</button>
      {status && <p>{status}</p>}
    </form>
  );
}`;
}

/** Payment link — checkout happens on the processor-hosted page. */
export function paylinkEmbedSnippet(checkoutUrl: string, label = 'Pay now'): string {
  return `<a href="${esc(checkoutUrl)}" class="solid-pay-button" target="_blank" rel="noopener">${esc(label)}</a>`;
}
