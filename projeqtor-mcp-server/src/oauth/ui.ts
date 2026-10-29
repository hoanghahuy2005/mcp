/** Framework-free OAuth pages and form helpers. All pages are deliberately uncacheable. */
export interface UiScope { readonly name: string; readonly description?: string; }
export interface UiGrant { readonly grantId: string; readonly clientId: string; readonly clientName: string; readonly scopes: readonly string[]; readonly resource: string; readonly createdAt?: string; }

const esc = (value: unknown): string => String(value ?? '').replace(/[&<>"']/g, ch => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[ch]!);
const attrs = ' method="post"';
function page(title: string, body: string): string {
  return `<!doctype html><html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><link rel="stylesheet" href="/oauth/style.css"><title>${esc(title)} · ProjeQtOr</title></head><body><main><header><p>ProjeQtOr</p></header>${body}</main></body></html>`;
}
export function renderLoginPage(input: { readonly csrfToken: string; readonly error?: boolean | string } ): string {
  return page('Sign in', `<h1>Sign in to ProjeQtOr</h1><p>Use your ProjeQtOr account to continue.</p>${input.error ? '<p class="error" role="alert">Sign-in failed. Check your credentials and try again.</p>' : ''}<form${attrs} action="/oauth/login"><input type="hidden" name="csrf_token" value="${esc(input.csrfToken)}"><label for="username">Username</label><input id="username" name="username" autocomplete="username" required maxlength="200"><label for="password">Password</label><input id="password" name="password" type="password" autocomplete="current-password" required><button type="submit">Sign in</button></form>`);
}
export function renderConsentPage(input: { readonly csrfToken: string; readonly clientName: string; readonly clientId: string; readonly resource: string; readonly scopes: readonly (string | UiScope)[] }): string {
  const items = input.scopes.map(s => typeof s === 'string' ? `<li>${esc(s)}</li>` : `<li><strong>${esc(s.name)}</strong>${s.description ? ` — ${esc(s.description)}` : ''}</li>`).join('');
  return page('Authorize access', `<h1>Authorize access</h1><p><strong>${esc(input.clientName)}</strong> (<code>${esc(input.clientId)}</code>) requests access to:</p><p><strong>Resource:</strong> ${esc(input.resource)}</p><ul>${items}</ul><p>Only approve if you trust this application.</p><form${attrs} action="/oauth/consent"><input type="hidden" name="csrf_token" value="${esc(input.csrfToken)}"><button name="decision" value="approve" type="submit">Approve</button><button class="secondary" name="decision" value="deny" type="submit">Deny</button></form><script src="/oauth/consent.js?v=2" defer></script>`);
}
export function parseConsentDecision(value: unknown): 'approve' | 'deny' | undefined { return value === 'approve' || value === 'deny' ? value : undefined; }
export function renderConnectionsPage(input: { readonly csrfToken: string; readonly grants: readonly UiGrant[] }): string {
  const rows = input.grants.length ? input.grants.map(grant => `<li><h2>${esc(grant.clientName)}</h2><p>Client: <code>${esc(grant.clientId)}</code></p><p>Resource: ${esc(grant.resource)}</p><p>Permissions: ${grant.scopes.map(esc).join(', ')}</p><form${attrs} action="/oauth/connections/revoke"><input type="hidden" name="csrf_token" value="${esc(input.csrfToken)}"><input type="hidden" name="grant_id" value="${esc(grant.grantId)}"><button class="secondary" type="submit">Revoke access</button></form></li>`).join('') : '<li>No connected applications.</li>';
  return page('Connected applications', `<h1>Connected applications</h1><ul>${rows}</ul>`);
}
export function renderRevokeConfirmation(input: { readonly csrfToken: string; readonly clientName: string; readonly grantId: string }): string {
  return page('Revoke access', `<h1>Revoke access?</h1><p>Remove ${esc(input.clientName)}'s access?</p><form${attrs} action="/oauth/connections/revoke/confirm"><input type="hidden" name="csrf_token" value="${esc(input.csrfToken)}"><input type="hidden" name="grant_id" value="${esc(input.grantId)}"><button type="submit">Confirm revoke</button><button class="secondary" type="submit" name="decision" value="cancel">Cancel</button></form>`);
}
export function renderRevokeResult(revoked: boolean): string { return page('Access updated', `<h1>${revoked ? 'Access revoked' : 'Access unchanged'}</h1><p>${revoked ? 'The application can no longer access your account.' : 'No changes were made.'}</p><a href="/oauth/connections">Return to connected applications</a>`); }
export const oauthUiHeaders = Object.freeze({ 'Content-Type': 'text/html; charset=utf-8', 'Cache-Control': 'no-store', 'Pragma': 'no-cache' });
