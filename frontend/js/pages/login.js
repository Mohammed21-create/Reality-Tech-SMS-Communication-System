import { $, toast, withBusy } from '../core/ui.js';
import { createApi, setCsrf } from '../core/api.js';
import { initPwa, watchOnline } from '../core/pwa.js';

const realm = document.body.dataset.realm; // 'school' | 'admin'
const api = createApi(realm === 'admin' ? '/api/admin' : '/api/school', realm === 'admin' ? '/admin/login.html' : '/login.html');
watchOnline(); initPwa(null);
const params = new URLSearchParams(location.search);
const msg = $('#msg');
if (params.get('reason') === 'idle') { msg.textContent = 'You were signed out because of inactivity.'; msg.classList.remove('hidden'); }
if (params.get('reason') === 'expired') { msg.textContent = 'Your session expired. Please sign in again.'; msg.classList.remove('hidden'); }

$('#login-form').addEventListener('submit', (e) => {
  e.preventDefault();
  withBusy($('#login-btn'), async () => {
    try {
      const r = await api.post('/auth/login', { email: $('#email').value, password: $('#password').value });
      setCsrf(r.csrfToken);
      if (r.user.mustChangePassword) location.href = `/change-password.html?realm=${realm}`;
      else location.href = realm === 'admin' ? '/admin/index.html' : '/school/index.html';
    } catch (err) { toast(err.message, 'bad'); $('#password').value = ''; $('#password').focus(); }
  });
});
