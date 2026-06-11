import {
  chatEmbedSnippet,
  formEmbedSnippet,
  formEmbedSnippetReact,
  paylinkEmbedSnippet,
} from '../../lib/embed-snippets';

const API = 'https://api.solidnumber.com';

describe('chatEmbedSnippet', () => {
  it('emits the widget script tag bound to the integration', () => {
    const s = chatEmbedSnippet(API, 'abc123');
    expect(s).toBe(
      '<script src="https://api.solidnumber.com/static/chat-widget/solid-chat.js" data-integration-id="abc123"></script>',
    );
  });

  it('strips a trailing slash from the api base', () => {
    expect(chatEmbedSnippet(`${API}/`, 7)).toContain(`${API}/static/chat-widget/`);
  });
});

describe('formEmbedSnippet', () => {
  const form = {
    id: 12,
    title: 'Get a Quote',
    submit_button_text: 'Request quote',
    fields: [
      { name: 'name', label: 'Your name', type: 'text', required: true },
      { name: 'email', label: 'Email', type: 'email', required: true },
      { name: 'details', label: 'Details', type: 'textarea' },
      { name: 'service', label: 'Service', type: 'select', options: ['Repair', 'Install'] },
    ],
  };

  it('posts {data, attribution} to the public submit endpoint', () => {
    const s = formEmbedSnippet(API, form);
    expect(s).toContain(`${API}/api/v1/public/forms/12/submit`);
    expect(s).toContain('JSON.stringify({ data: data, attribution:');
    expect(s).toContain("method: 'POST'");
  });

  it('renders every configured field with type and required flags', () => {
    const s = formEmbedSnippet(API, form);
    expect(s).toContain('<input name="name" type="text" required>');
    expect(s).toContain('<input name="email" type="email" required>');
    expect(s).toContain('<textarea name="details" rows="4"></textarea>');
    expect(s).toContain('<option value="Repair">Repair</option>');
    expect(s).toContain('Request quote');
    expect(s).toContain('Get a Quote');
  });

  it('falls back to name/email/message when the form declares no fields', () => {
    const s = formEmbedSnippet(API, { id: 3 });
    expect(s).toContain('<input name="name"');
    expect(s).toContain('<input name="email" type="email" required>');
    expect(s).toContain('<textarea name="message"');
  });

  it('escapes HTML in user-controlled text', () => {
    const s = formEmbedSnippet(API, { id: 4, title: '<script>alert(1)</script>' });
    expect(s).not.toContain('<script>alert');
    expect(s).toContain('&lt;script&gt;');
  });

  it('honors redirect_url and resets on success', () => {
    const s = formEmbedSnippet(API, form);
    expect(s).toContain('res.redirect_url');
    expect(s).toContain('f.reset()');
  });
});

describe('formEmbedSnippetReact', () => {
  it('emits a component posting to the same endpoint', () => {
    const s = formEmbedSnippetReact(API, { id: 12, fields: [{ name: 'email', type: 'email', required: true }] });
    expect(s).toContain('export function SolidForm()');
    expect(s).toContain(`${API}/api/v1/public/forms/12/submit`);
    expect(s).toContain('<input name="email" type="email" required />');
  });
});

describe('paylinkEmbedSnippet', () => {
  it('emits an anchor to the hosted checkout with the label', () => {
    const s = paylinkEmbedSnippet('https://app.solidnumber.com/pay/lnk_9', 'Pay $50 deposit');
    expect(s).toBe(
      '<a href="https://app.solidnumber.com/pay/lnk_9" class="solid-pay-button" target="_blank" rel="noopener">Pay $50 deposit</a>',
    );
  });

  it('defaults the label and escapes it', () => {
    expect(paylinkEmbedSnippet('https://x/pay/1')).toContain('>Pay now<');
    expect(paylinkEmbedSnippet('https://x/pay/1', '<b>x</b>')).toContain('&lt;b&gt;x&lt;/b&gt;');
  });
});
