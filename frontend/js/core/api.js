// Fetch wrapper: JSON, CSRF header, session-expiry redirect, honest offline errors (never queues or fakes sends).
let csrf = sessionStorage.getItem('rt_csrf') || '';
export const setCsrf = (t) => { csrf = t || ''; if (t) sessionStorage.setItem('rt_csrf', t); else sessionStorage.removeItem('rt_csrf'); };

export class ApiError extends Error {
  constructor(status, body) { super((body && body.error && body.error.message) || 'Request failed'); this.status = status; this.code = body && body.error && body.error.code; this.details = body && body.error && body.error.details; }
}

export function createApi(base, loginUrl) {
  async function request(method, path, { body, form, query, raw } = {}) {
    if (!navigator.onLine) throw new ApiError(0, { error: { code: 'OFFLINE', message: 'You are offline. Reconnect to the internet and try again. Nothing was sent.' } });
    let url = base + path;
    if (query) { const qs = new URLSearchParams(Object.entries(query).filter(([, v]) => v !== '' && v !== undefined && v !== null)); if ([...qs].length) url += '?' + qs; }
    const headers = { Accept: 'application/json' };
    if (method !== 'GET') headers['X-CSRF-Token'] = csrf;
    let payload;
    if (form) payload = form; else if (body !== undefined) { headers['Content-Type'] = 'application/json'; payload = JSON.stringify(body); }
    let res;
    const ctrl = new AbortController();
    const timer = setTimeout(() => ctrl.abort(), 30000);
    try { res = await fetch(url, { method, headers, body: payload, credentials: 'same-origin', signal: ctrl.signal }); }
    catch (e) { throw new ApiError(0, { error: { code: 'NETWORK', message: e && e.name === 'AbortError' ? 'The server took too long to respond. Please try again.' : 'Could not reach the server. Check your connection and try again.' } }); }
    finally { clearTimeout(timer); }
    if (raw) return res;
    let data = null;
    try { data = await res.json(); } catch { /* empty */ }
    if (!res.ok) {
      if (res.status === 401 && path !== '/auth/login') {
        setCsrf('');
        const reason = data && data.error && data.error.code === 'SESSION_EXPIRED' ? '?reason=expired' : '';
        location.href = loginUrl + reason;
        throw new ApiError(401, data);
      }
      if (res.status === 403 && data && data.error && data.error.code === 'PASSWORD_CHANGE_REQUIRED') { location.href = `/change-password.html?realm=${base.includes('/admin') ? 'admin' : 'school'}`; }
      throw new ApiError(res.status, data);
    }
    return data;
  }
  return {
    get: (p, query) => request('GET', p, { query }),
    post: (p, body) => request('POST', p, { body }),
    put: (p, body) => request('PUT', p, { body }),
    patch: (p, body) => request('PATCH', p, { body }),
    del: (p, body) => request('DELETE', p, { body }),
    upload: (p, form) => request('POST', p, { form }),
    /** Download a file from an authenticated GET endpoint. */
    async download(p, query, filename) {
      const res = await request('GET', p, { query, raw: true });
      if (!res.ok) { let d = null; try { d = await res.json(); } catch { /* */ } throw new ApiError(res.status, d); }
      const blob = await res.blob();
      const a = document.createElement('a'); a.href = URL.createObjectURL(blob); a.download = filename; document.body.append(a); a.click(); a.remove();
      setTimeout(() => URL.revokeObjectURL(a.href), 5000);
    },
    setCsrf,
  };
}
export const schoolApi = createApi('/api/school', '/login.html');
export const adminApi = createApi('/api/admin', '/admin/login.html');
