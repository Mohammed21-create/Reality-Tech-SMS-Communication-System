import { $, toast, withBusy } from '../core/ui.js';
import { createApi, setCsrf } from '../core/api.js';
import { watchOnline } from '../core/pwa.js';

watchOnline();
const realm = new URLSearchParams(location.search).get('realm') === 'admin' ? 'admin' : 'school';
const api = createApi(realm === 'admin' ? '/api/admin' : '/api/school', realm === 'admin' ? '/admin/login.html' : '/login.html');
api.get('/auth/me').then((me) => { setCsrf(me.csrfToken); if (!me.user.mustChangePassword) $('#forced').classList.add('hidden'); }).catch(() => {});

$('#pw-form').addEventListener('submit', (e) => {
  e.preventDefault();
  const next = $('#new').value;
  if (next !== $('#confirm').value) return toast('The new passwords do not match', 'bad');
  return withBusy($('#pw-btn'), async () => {
    try {
      const r = await api.post('/auth/change-password', { currentPassword: $('#current').value, newPassword: next });
      setCsrf(r.csrfToken);
      toast('Password changed', 'ok');
      setTimeout(() => { location.href = realm === 'admin' ? '/admin/index.html' : '/school/index.html'; }, 600);
    } catch (err) { toast(err.message, 'bad'); }
  });
});
