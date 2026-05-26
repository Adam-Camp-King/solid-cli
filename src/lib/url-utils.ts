/**
 * URL utility functions — no CLI deps. Testable in isolation.
 */

import { URL } from 'url';

export function frontendUrlFor(apiUrl: string): string {
  try {
    const u = new URL(apiUrl);
    if (u.hostname === 'localhost' || u.hostname === '127.0.0.1') {
      return `${u.protocol}//${u.hostname}:3000`;
    }
    if (u.hostname.startsWith('api.')) {
      return `${u.protocol}//app.${u.hostname.slice(4)}`;
    }
    return `${u.protocol}//${u.hostname}`;
  } catch {
    return 'https://app.solidnumber.com';
  }
}
