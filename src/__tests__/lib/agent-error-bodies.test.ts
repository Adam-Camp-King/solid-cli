/**
 * Agent-facing failures carry what the server said (reason, message, detail,
 * approval_url, preview_id) instead of collapsing to "Request failed".
 * Plus: --token honoured like SOLID_TOKEN, company derived from the token,
 * spinners silent under --json, and page public URLs computed per routing.
 */
import {
  classifyError,
  extractServerError,
  isFieldValidationError,
  isRetryable,
  toErrorEnvelope,
} from '../../lib/error-codes';
import { detectErrorBody, handleApiError } from '../../lib/api-client';
import {
  primarySite,
  publicUrlForPage,
  resolveSiteRef,
  siteCanonicalOrigin,
} from '../../lib/page-url';

const APPROVAL_BODY = {
  ok: false,
  verb: 'asset.delete',
  error: {
    reason: 'approval_required',
    message: 'Deleting an asset needs the owner to approve.',
    approval_url: 'https://api.solidnumber.com/actions/approve/prop_abc',
  },
  preview_id: 'prop_abc',
};

const RESULT_ERROR_BODY = {
  ok: false,
  result: { status: 'ERROR', error: 'unsupported_media_type', detail: 'image/heic is not accepted' },
};

/** What the response interceptor throws for a 200 carrying an error body. */
function synthetic200(body: Record<string, unknown>) {
  const be = detectErrorBody(body)!;
  return {
    isAxiosError: true,
    __solid_body: body,
    config: { method: 'POST', url: '/api/v1/agent/cli-dispatch' },
    response: { status: 400, data: { ...body, detail: be.message } },
    message: be.message,
  };
}

describe('extractServerError', () => {
  it('reads the verb envelope with an object error', () => {
    const f = extractServerError(APPROVAL_BODY);
    expect(f.reason).toBe('approval_required');
    expect(f.message).toMatch(/owner to approve/);
    expect(f.approval_url).toBe('https://api.solidnumber.com/actions/approve/prop_abc');
    expect(f.preview_id).toBe('prop_abc');
  });

  it('reads result.error + result.detail', () => {
    const f = extractServerError(RESULT_ERROR_BODY);
    expect(f.reason).toBe('unsupported_media_type');
    expect(f.message).toBe('image/heic is not accepted');
  });

  it('reads FastAPI string and object detail', () => {
    expect(extractServerError({ detail: 'slug exists' }).message).toBe('slug exists');
    const f = extractServerError({ detail: { reason: 'custom_code_rejected', message: 'script tags are not allowed', lines: [3] } });
    expect(f.reason).toBe('custom_code_rejected');
    expect(f.message).toBe('script tags are not allowed');
    expect(f.detail).toEqual({ reason: 'custom_code_rejected', message: 'script tags are not allowed', lines: [3] });
  });
});

describe('detectErrorBody — no more bare "Request failed"', () => {
  it('uses the object error message', () => {
    const r = detectErrorBody(APPROVAL_BODY)!;
    expect(r.message).not.toBe('Request failed');
    expect(r.message).toMatch(/owner to approve/);
  });

  it('uses result.detail for {ok:false,result:{error,detail}}', () => {
    const r = detectErrorBody(RESULT_ERROR_BODY)!;
    expect(r.message).toMatch(/image\/heic is not accepted/);
    expect(r.message).toMatch(/unsupported_media_type/);
  });
});

describe('APPROVAL_REQUIRED', () => {
  it('classifies from a 200 ok:false body and carries link + next', () => {
    const c = classifyError({ status: 400, data: APPROVAL_BODY });
    expect(c.code).toBe('APPROVAL_REQUIRED');
    expect(c.approval_url).toMatch(/actions\/approve\/prop_abc$/);
    expect(c.preview_id).toBe('prop_abc');
    expect(c.next).toMatch(/owner/);
    expect(isRetryable('APPROVAL_REQUIRED')).toBe(false);
  });

  it('flows through handleApiError into the JSON envelope', () => {
    const e = handleApiError(synthetic200(APPROVAL_BODY));
    expect(e.code).toBe('APPROVAL_REQUIRED');
    expect(e.message).toMatch(/owner to approve/);
    const env = toErrorEnvelope(
      { code: e.code as 'APPROVAL_REQUIRED', reason: e.reason, approval_url: e.approval_url, preview_id: e.preview_id, next: e.next },
      e.status,
      e.message,
    );
    expect(env.error).toMatchObject({
      code: 'APPROVAL_REQUIRED',
      retryable: false,
      reason: 'approval_required',
      approval_url: 'https://api.solidnumber.com/actions/approve/prop_abc',
      preview_id: 'prop_abc',
    });
    expect(env.error.next).toBeTruthy();
    expect(env.error.fix).toBeUndefined();
  });

  it('also fires on a real 403 carrying the same body', () => {
    const e = handleApiError({
      isAxiosError: true,
      config: { method: 'POST', url: '/x' },
      response: { status: 403, data: APPROVAL_BODY },
      message: 'x',
    });
    expect(e.code).toBe('APPROVAL_REQUIRED');
    expect(e.approval_url).toBeTruthy();
  });
});

describe('reason/detail pass-through for every command', () => {
  it('result.error body → BAD_REQUEST with reason and message', () => {
    const e = handleApiError(synthetic200(RESULT_ERROR_BODY));
    expect(e.code).toBe('BAD_REQUEST');
    expect(e.reason).toBe('unsupported_media_type');
    expect(e.message).toMatch(/image\/heic/);
  });

  it('4xx with object error no longer stringifies to JSON soup', () => {
    const e = handleApiError({
      isAxiosError: true,
      config: { method: 'POST', url: '/x' },
      response: { status: 400, data: { ok: false, error: { reason: 'bad_mime', message: 'Upload a PNG' } } },
      message: 'x',
    });
    expect(e.message).toBe('bad_mime: Upload a PNG');
    expect(e.reason).toBe('bad_mime');
  });
});

describe('422 hint only for real field validation', () => {
  it('custom_code_rejected does not point at verbs describe', () => {
    const data = { detail: { reason: 'custom_code_rejected', message: 'inline scripts are blocked' } };
    expect(isFieldValidationError(data)).toBe(false);
    const c = classifyError({ status: 422, data });
    expect(c.code).toBe('VALIDATION_FAILED');
    expect(c.hint).not.toMatch(/verbs describe/);
    expect(c.reason).toBe('custom_code_rejected');
  });

  it('FastAPI missing-field array keeps the verbs describe hint', () => {
    const data = { detail: [{ loc: ['body', 'asset_id'], msg: 'Field required', type: 'missing' }] };
    expect(isFieldValidationError(data)).toBe(true);
    expect(classifyError({ status: 422, data }).hint).toMatch(/verbs describe/);
  });
});

describe('--token counts as logged in, company derives from the token', () => {
  it('ConfigManager honours the flag token and a derived company', () => {
    jest.isolateModules(() => {
      jest.doMock('fs', () => ({
        existsSync: jest.fn(() => false),
        readFileSync: jest.fn(() => '{}'),
        writeFileSync: jest.fn(),
        mkdirSync: jest.fn(),
        chmodSync: jest.fn(),
      }));
      const saved = { key: process.env.SOLID_API_KEY, tok: process.env.SOLID_TOKEN, c1: process.env.SOLID_COMPANY_ID, c2: process.env.SOLID_COMPANY_OVERRIDE };
      delete process.env.SOLID_API_KEY; delete process.env.SOLID_TOKEN;
      delete process.env.SOLID_COMPANY_ID; delete process.env.SOLID_COMPANY_OVERRIDE;
      try {
        const { config } = jest.requireActual('../../lib/config');
        expect(config.isLoggedIn()).toBe(false);
        config.setFlagToken('tok_from_flag');
        expect(config.isLoggedIn()).toBe(true);
        expect(config.effectiveToken).toBe('tok_from_flag');
        expect(config.companyId).toBeUndefined();
        config.setDerivedCompanyId(61);
        expect(config.companyId).toBe(61);
      } finally {
        if (saved.key !== undefined) process.env.SOLID_API_KEY = saved.key;
        if (saved.tok !== undefined) process.env.SOLID_TOKEN = saved.tok;
        if (saved.c1 !== undefined) process.env.SOLID_COMPANY_ID = saved.c1;
        if (saved.c2 !== undefined) process.env.SOLID_COMPANY_OVERRIDE = saved.c2;
        jest.dontMock('fs');
      }
    });
  });
});

describe('spinner suppression', () => {
  it('is silent when --json is anywhere on argv', () => {
    const { spinnersSuppressed } = jest.requireActual('../../lib/spinner');
    const argv = process.argv;
    try {
      process.argv = ['node', 'solid', 'pages', 'get', '300', '--json'];
      expect(spinnersSuppressed()).toBe(true);
      process.argv = ['node', 'solid', 'pages', 'get', '300'];
      expect(spinnersSuppressed()).toBe(false); // jest carve-out keeps human mode
    } finally {
      process.argv = argv;
    }
  });
});

describe('page public URL', () => {
  const sites = [
    { id: 7, slug: 'main', site_type: 'company', canonical_url: 'https://acme.solidnumber.com/' },
    { id: 9, slug: 'store', site_type: 'creator_store', canonical_host: 'shop.acme.com' },
    { id: 11, slug: 'bare', site_type: 'landing' },
  ];

  it('page on a site → canonical + /slug; home → origin', () => {
    expect(publicUrlForPage({ slug: 'about', site_id: 7 }, sites)).toMatchObject({ url: 'https://acme.solidnumber.com/about', url_basis: 'site' });
    expect(publicUrlForPage({ slug: 'home', site_id: 7 }, sites).url).toBe('https://acme.solidnumber.com');
    expect(publicUrlForPage({ slug: 'x', site_id: 9 }, sites).url).toBe('https://shop.acme.com/x');
  });

  it('page with no site → /p/<slug> on the primary site', () => {
    expect(publicUrlForPage({ slug: 'promo', site_id: null }, sites)).toMatchObject({
      url: 'https://acme.solidnumber.com/p/promo',
      url_basis: 'company_permalink',
    });
  });

  it('says why when the URL cannot be computed', () => {
    const r = publicUrlForPage({ slug: 'x', site_id: 11 }, sites);
    expect(r.url).toBeNull();
    expect(r.url_unavailable_reason).toMatch(/no canonical address/);
    const r2 = publicUrlForPage({ slug: 'x', site_id: null }, []);
    expect(r2.url).toBeNull();
    expect(r2.url_unavailable_reason).toMatch(/not attached/);
  });

  it('resolves --site by id or slug and picks the primary', () => {
    expect(resolveSiteRef('9', sites).site?.id).toBe(9);
    expect(resolveSiteRef('store', sites).site?.id).toBe(9);
    expect(resolveSiteRef('nope', sites).error).toMatch(/7=main/);
    expect(primarySite(sites)?.id).toBe(7);
    expect(primarySite([{ id: 1, site_type: 'landing' }, { id: 2, site_type: 'landing' }])).toBeUndefined();
    expect(siteCanonicalOrigin({ addresses: [{ is_canonical: true, is_active: true, url: 'https://a.b/' }] })).toBe('https://a.b');
  });
});
