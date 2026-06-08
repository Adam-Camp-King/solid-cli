/**
 * Import an ESM-only package from this CommonJS bundle.
 *
 * The CLI compiles with `module: CommonJS`, under which tsc rewrites a plain
 * `await import('pkg')` into `require('pkg')`. For ESM-only packages (ora-style
 * `"type": "module"` with no `require` export condition) that `require()` throws
 * `ERR_REQUIRE_ESM` on Node < 20.19 — which is exactly what broke `solid audit`
 * (lighthouse) and the startup update check (update-notifier) on older Node.
 *
 * Routing the dynamic import through a `Function` hides it from the TypeScript
 * CommonJS transform, so a *real* ESM `import()` survives to runtime. Importing
 * ESM from CommonJS is always allowed; only `require()` of ESM is not — so this
 * works on every supported Node version. Keep ESM-only deps loading through here
 * rather than reintroducing a bare `import()`/`require()` of them.
 */
const dynamicEsmImport = new Function('specifier', 'return import(specifier)') as <T = unknown>(
  specifier: string,
) => Promise<T>;

export function importESM<T = unknown>(specifier: string): Promise<T> {
  return dynamicEsmImport<T>(specifier);
}
