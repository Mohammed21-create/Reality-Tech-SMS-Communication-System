import { h, mount, loading, fmt, table, pager, debounce, statusBadge, emptyState, modal } from '../core/ui.js';
import { initPortal } from '../core/layout.js';
import { adminApi as api } from '../core/api.js';

await initPortal({ portal: 'admin', api, title: 'Activity & security' });
const page = document.getElementById('page');
const state = { page: 1, action: '', status: '', from: '', to: '' };
const list = h('div');
const sel = h('select', { 'aria-label': 'Result', onchange: (e) => { state.status = e.target.value; state.page = 1; load(); } }, h('option', { value: '' }, 'All results'), h('option', { value: 'success' }, 'Success'), h('option', { value: 'failure' }, 'Failures'));
sel.style.maxWidth = '160px';
const from = h('input', { type: 'date', 'aria-label': 'From', onchange: (e) => { state.from = e.target.value; load(); } }); const to = h('input', { type: 'date', 'aria-label': 'To', onchange: (e) => { state.to = e.target.value; load(); } });
from.style.maxWidth = to.style.maxWidth = '170px';
mount(page, h('h1', null, 'Activity & security logs'), h('p', { class: 'muted' }, 'Sign-ins, failed attempts, school changes, password resets and SMS actions across the platform. Try the filter "auth." for sign-in activity.'),
  h('div', { class: 'toolbar' }, h('input', { class: 'search', type: 'search', placeholder: 'Action prefix, e.g. auth. or school.', 'aria-label': 'Action filter', oninput: debounce((e) => { state.action = e.target.value; state.page = 1; load(); }) }), sel, from, to), list);
async function load() {
  loading(list);
  try {
    const r = await api.get('/logs', { ...state, limit: 30 });
    mount(list, table([{ label: 'When', render: (l) => fmt.dateTime(l.at) }, { label: 'Action', render: (l) => h('span', { class: 'mono small' }, l.action) }, { label: 'Result', render: (l) => statusBadge(l.status === 'success' ? 'completed' : 'failed') },
      { label: 'Who', render: (l) => `${l.actorEmail || l.actorType}` }, { label: 'School', render: (l) => l.school || '-' }, { label: 'IP', render: (l) => h('span', { class: 'mono small' }, l.ip || '') },
      { label: '', render: (l) => (l.meta ? h('button', { class: 'btn ghost sm', onclick: () => modal({ title: l.action, body: h('pre', { class: 'mono small' }, JSON.stringify(l.meta, null, 2)) }) }, 'Details') : null) }], r.items, { empty: emptyState('🛡️', 'No log entries match') }), pager(r.pagination, (p) => { state.page = p; load(); }));
  } catch (e) { mount(list, h('div', { class: 'alert bad' }, e.message)); }
}
load();
