import { h, mount, loading, fmt, table, pager, modal, confirmDialog, toast, debounce, withBusy, field, statusBadge, emptyState, badge } from '../core/ui.js';
import { initPortal } from '../core/layout.js';
import { adminApi as api } from '../core/api.js';
import { barChart, legend, COLORS } from '../core/charts.js';

await initPortal({ portal: 'admin', api, title: 'Schools' });
const page = document.getElementById('page');
const state = { page: 1, q: '', status: '' };
const list = h('div');
const statusSel = h('select', { 'aria-label': 'Status filter', onchange: (e) => { state.status = e.target.value; state.page = 1; load(); } }, h('option', { value: '' }, 'All statuses'), ['pending', 'active', 'suspended', 'deactivated'].map((s) => h('option', { value: s }, s)));
statusSel.style.maxWidth = '200px';
mount(page, h('div', { class: 'row between mb' }, h('h1', null, 'Schools'), h('button', { class: 'btn', onclick: () => editSchool() }, '+ Register school')),
  h('div', { class: 'toolbar' }, h('input', { class: 'search', type: 'search', placeholder: 'Search schools…', 'aria-label': 'Search schools', oninput: debounce((e) => { state.q = e.target.value; state.page = 1; load(); }) }), statusSel), list);

async function load() {
  loading(list);
  try {
    const r = await api.get('/schools', { page: state.page, q: state.q, status: state.status, limit: 20 });
    mount(list, table([
      { label: 'School', render: (s) => h('a', { href: '#', onclick: (e) => { e.preventDefault(); openSchool(s.id); } }, h('strong', null, s.name)) },
      { label: 'Status', render: (s) => statusBadge(s.status) }, { label: 'Plan', render: (s) => `${s.subscription.plan} · ${s.subscription.status}` },
      { label: 'Parents', render: (s) => fmt.num(s.parents) }, { label: 'Messages', render: (s) => fmt.num(s.messages) }, { label: 'Delivered', render: (s) => fmt.num(s.delivered) },
      { label: 'Registered', render: (s) => fmt.date(s.createdAt) },
      { label: '', class: 'actions', render: (s) => h('button', { class: 'btn secondary sm', onclick: () => openSchool(s.id) }, 'Manage') },
    ], r.items, { empty: emptyState('🏫', 'No schools found', 'Register your first school to get started.') }), pager(r.pagination, (p) => { state.page = p; load(); }));
  } catch (e) { mount(list, h('div', { class: 'alert bad' }, e.message)); }
}

function credentialsDialog(title, email, pw) {
  const m = modal({ title, body: h('div', { class: 'stack' }, h('div', { class: 'alert warn' }, 'Copy this temporary password now. It is shown only once and the user must change it at first sign-in.'),
    h('div', null, h('label', null, 'Email'), h('input', { readonly: true, value: email })), h('div', null, h('label', null, 'Temporary password'), h('input', { readonly: true, value: pw, class: 'mono', onfocus: (e) => e.target.select() }))),
  footer: [h('button', { class: 'btn secondary', onclick: () => navigator.clipboard.writeText(pw).then(() => toast('Copied', 'ok')) }, 'Copy password'), h('button', { class: 'btn', onclick: () => m.close() }, 'Done')] });
}

function editSchool(s) {
  const f = { name: h('input', { value: s ? s.name : '', maxlength: 150 }), contactEmail: h('input', { type: 'email', value: s ? s.contactEmail : '' }), contactPhone: h('input', { value: s ? s.contactPhone : '' }), address: h('input', { value: s ? s.address : '' }), region: h('input', { value: s ? s.region : '' }) };
  const plan = h('select', null, ['trial', 'standard', 'premium'].map((p) => h('option', { value: p, selected: s && s.subscription.plan === p }, p)));
  const subStatus = h('select', null, ['trial', 'active', 'past_due', 'expired', 'cancelled'].map((p) => h('option', { value: p, selected: s && s.subscription.status === p }, p)));
  const adminName = h('input', { maxlength: 120 }); const adminEmail = h('input', { type: 'email' });
  const status = h('select', null, h('option', { value: 'active' }, 'Activate now'), h('option', { value: 'pending' }, 'Leave pending'));
  const save = h('button', { class: 'btn', type: 'button' }, s ? 'Save changes' : 'Register school');
  const m = modal({ wide: true, title: s ? 'Edit school' : 'Register a school', body: h('div', null,
    h('div', { class: 'form-grid' }, field('School name', f.name), field('Region / city', f.region), field('Contact email', f.contactEmail), field('Contact phone', f.contactPhone)), field('Address', f.address),
    s ? h('div', { class: 'form-grid' }, field('Plan', plan), field('Subscription status', subStatus)) : h('div', null, h('h3', null, 'School administrator'), h('div', { class: 'form-grid' }, field('Administrator name', adminName), field('Administrator email', adminEmail)), field('Account status', status))),
  footer: [h('button', { class: 'btn secondary', onclick: () => m.close() }, 'Cancel'), save] });
  save.addEventListener('click', () => withBusy(save, async () => {
    const body = Object.fromEntries(Object.entries(f).map(([k, el]) => [k, el.value]));
    if (s) { await api.patch(`/schools/${s.id}`, { ...body, plan: plan.value, subscriptionStatus: subStatus.value }); toast('School updated', 'ok'); m.close(); load(); return; }
    const r = await api.post('/schools', { ...body, adminName: adminName.value, adminEmail: adminEmail.value, status: status.value });
    m.close(); load(); credentialsDialog('School registered', r.admin.email, r.admin.temporaryPassword);
  }));
}

async function openSchool(id) {
  const body = h('div'); loading(body);
  const m = modal({ wide: true, title: 'School', body });
  const draw = async () => {
    const d = await api.get(`/schools/${id}`); const s = d.school;
    const usage = await api.get(`/schools/${id}/usage`);
    const act = (label, status, cls = 'secondary', needReason = true) => h('button', { class: `btn ${cls} sm`, onclick: async () => {
      let reason = '';
      if (needReason) { const input = h('input', { placeholder: 'Reason (required)', maxlength: 300 }); const ok = await new Promise((res) => { const mm = modal({ title: label, body: field('Reason', input), footer: [h('button', { class: 'btn secondary', onclick: () => { mm.close(); } }, 'Cancel'), h('button', { class: 'btn danger', onclick: () => { res(true); mm.close(); } }, label)], onClose: () => res(false) }); }); if (!ok) return; reason = input.value; }
      try { await api.post(`/schools/${id}/status`, { status, reason }); toast('Status updated', 'ok'); draw(); load(); } catch (e) { toast(e.message, 'bad'); }
    } }, label);
    const u = d.usage;
    mount(body, h('div', { class: 'stack' },
      h('div', { class: 'row between' }, h('div', null, h('h2', null, s.name), statusBadge(s.status), ' ', badge(`${s.subscription.plan} · ${s.subscription.status}`), s.statusReason ? h('div', { class: 'small muted' }, `Reason: ${s.statusReason}`) : null),
        h('div', { class: 'row' }, s.status !== 'active' ? act('Activate', 'active', '', false) : null, s.status === 'active' ? act('Suspend', 'suspended', 'danger') : null, s.status !== 'deactivated' ? act('Deactivate', 'deactivated', 'secondary') : null, h('button', { class: 'btn secondary sm', onclick: () => { m.close(); editSchool(s); } }, 'Edit'))),
      h('div', { class: 'cards' }, [['Parents', s.parents], ['Messages', u.messages || 0], ['Recipients', u.recipients || 0], ['Accepted', u.accepted || 0], ['Delivered', u.delivered || 0], ['Failed', u.failed || 0], ['Segments', u.segments || 0]].map(([l, v]) => h('div', { class: 'card stat' }, h('div', { class: 'label' }, l), h('div', { class: 'value' }, fmt.num(v))))),
      h('div', { class: 'small' }, 'SMS provider: ', d.provider ? [badge(d.provider.provider), ' ', badge(d.provider.isActive ? 'on' : 'off', d.provider.isActive ? 'ok' : 'warn'), d.provider.lastTestAt ? badge(d.provider.lastTestOk ? 'last test OK' : 'last test failed', d.provider.lastTestOk ? 'ok' : 'bad') : null] : 'not configured yet', h('span', { class: 'muted' }, ' (credentials are never visible to Reality Tech staff)')),
      usage.daily.length ? [h('h3', null, 'Usage - last 30 days'), barChart(usage.daily.map((x) => ({ label: x.date, values: [x.accepted, x.delivered, x.failed] })), [{ name: 'Accepted', color: COLORS.info }, { name: 'Delivered', color: COLORS.ok }, { name: 'Failed', color: COLORS.bad }], { height: 160 }), legend([{ name: 'Accepted', color: COLORS.info }, { name: 'Delivered', color: COLORS.ok }, { name: 'Failed', color: COLORS.bad }])] : null,
      h('div', { class: 'row between' }, h('h3', null, 'Administrators'), h('button', { class: 'btn secondary sm', onclick: addAdmin }, '+ Add administrator')),
      table([{ label: 'Name', key: 'name' }, { label: 'Email', key: 'email' }, { label: 'Last sign-in', render: (a) => (a.lastLoginAt ? fmt.dateTime(a.lastLoginAt) : 'never') }, { label: '', render: (a) => [a.locked ? badge('locked', 'bad') : null, a.mustChangePassword ? badge('must change password', 'warn') : null] },
        { label: '', class: 'actions', render: (a) => h('button', { class: 'btn secondary sm', onclick: async () => { if (!(await confirmDialog({ title: 'Reset password?', message: `Create a new temporary password for ${a.email}? They will be signed out.`, confirmText: 'Reset password', danger: true }))) return; try { const r = await api.post(`/schools/${id}/reset-admin-password`, { userId: a.id }); credentialsDialog('Password reset', r.email, r.temporaryPassword); draw(); } catch (e) { toast(e.message, 'bad'); } } }, 'Reset password') }], d.admins)));
    async function addAdmin() {
      const n = h('input', { maxlength: 120 }); const e = h('input', { type: 'email' }); const b = h('button', { class: 'btn', type: 'button' }, 'Add');
      const mm = modal({ title: 'Add administrator', body: h('div', null, field('Name', n), field('Email', e)), footer: [b] });
      b.addEventListener('click', () => withBusy(b, async () => { const r = await api.post(`/schools/${id}/admins`, { name: n.value, email: e.value }); mm.close(); credentialsDialog('Administrator added', r.admin.email, r.admin.temporaryPassword); draw(); }));
    }
  };
  try { await draw(); } catch (e) { mount(body, h('div', { class: 'alert bad' }, e.message)); }
}
await load();
const open = new URLSearchParams(location.search).get('open'); if (open) openSchool(open);
