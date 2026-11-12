import { h, mount, loading, fmt, table, emptyState } from '../core/ui.js';
import { initPortal } from '../core/layout.js';
import { adminApi as api } from '../core/api.js';
import { barChart, legend, COLORS } from '../core/charts.js';

await initPortal({ portal: 'admin', api, title: 'Platform overview' });
const page = document.getElementById('page'); loading(page);
const d = await api.get('/overview');
const stat = (l, v, s) => h('div', { class: 'card stat' }, h('div', { class: 'label' }, l), h('div', { class: 'value' }, v), s ? h('div', { class: 'sub' }, s) : null);
mount(page, h('h1', null, 'Platform overview'),
  h('div', { class: 'cards mb' },
    stat('Schools', fmt.num(d.schools.total), `${d.schools.active || 0} active · ${d.schools.pending || 0} pending · ${d.schools.suspended || 0} suspended`),
    stat('Parent contacts', fmt.num(d.parents)), stat('Messages', fmt.num(d.sms.messages)), stat('Accepted by providers', fmt.num(d.sms.accepted)),
    stat('Delivered (confirmed)', fmt.num(d.sms.delivered)), stat('Failed / unknown', fmt.num(d.sms.failed + d.sms.uncertain)), stat('Queued now', fmt.num(d.sms.queued)), stat('Segments used', fmt.num(d.sms.segments))),
  h('div', { class: 'card mb' }, h('h2', null, 'Platform SMS activity (30 days)'), d.daily.length ? [barChart(d.daily.map((x) => ({ label: x.date, values: [x.accepted, x.delivered, x.failed] })), [{ name: 'Accepted', color: COLORS.info }, { name: 'Delivered', color: COLORS.ok }, { name: 'Failed', color: COLORS.bad }]), legend([{ name: 'Accepted', color: COLORS.info }, { name: 'Delivered', color: COLORS.ok }, { name: 'Failed', color: COLORS.bad }])] : emptyState('📊', 'No SMS activity yet')),
  h('div', { class: 'card' }, h('h2', null, 'Top schools by volume (30 days)'),
    table([{ label: 'School', render: (s) => h('a', { href: `/admin/schools.html?open=${s.schoolId}` }, s.name) }, { label: 'Messages', render: (s) => fmt.num(s.messages) }, { label: 'Accepted', render: (s) => fmt.num(s.accepted) }, { label: 'Delivered', render: (s) => fmt.num(s.delivered) }, { label: 'Failed', render: (s) => fmt.num(s.failed) }], d.topSchools, { empty: emptyState('🏫', 'No activity yet') })));
