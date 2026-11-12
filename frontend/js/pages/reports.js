import { h, mount, loading, fmt, table, toast, field, emptyState } from '../core/ui.js';
import { initPortal } from '../core/layout.js';
import { schoolApi as api } from '../core/api.js';
import { barChart, legend, COLORS } from '../core/charts.js';

await initPortal({ portal: 'school', api, title: 'Reports' });
const page = document.getElementById('page');
const iso = (d) => d.toISOString().slice(0, 10);
const to = new Date(); const from = new Date(Date.now() - 29 * 86400000);
const fromI = h('input', { type: 'date', value: iso(from) }); const toI = h('input', { type: 'date', value: iso(to) });
const out = h('div');
const q = () => ({ from: fromI.value, to: toI.value });
mount(page, h('h1', null, 'SMS reports'),
  h('div', { class: 'card mb' }, h('div', { class: 'row' }, h('div', null, field('From', fromI)), h('div', null, field('To', toI)),
    h('button', { class: 'btn', onclick: run }, 'Apply'),
    h('button', { class: 'btn secondary', onclick: () => api.download('/reports/export', { ...q(), format: 'csv' }, 'sms-report.csv').catch((e) => toast(e.message, 'bad')) }, 'Export CSV'),
    h('button', { class: 'btn secondary', onclick: () => api.download('/reports/export', { ...q(), format: 'xlsx' }, 'sms-report.xlsx').catch((e) => toast(e.message, 'bad')) }, 'Export Excel'))), out);

async function run() {
  loading(out);
  try {
    const r = await api.get('/reports/summary', q()); const t = r.totals;
    const stat = (l, v, s) => h('div', { class: 'card stat' }, h('div', { class: 'label' }, l), h('div', { class: 'value' }, v), s ? h('div', { class: 'sub' }, s) : null);
    mount(out,
      h('div', { class: 'cards mb' }, stat('Messages submitted', fmt.num(t.messages)), stat('Recipients', fmt.num(t.recipients)), stat('Accepted by provider', fmt.num(t.accepted), 'Handed to your SMS provider'),
        stat('Delivered', fmt.num(t.delivered), 'Confirmed by delivery receipt'), stat('Failed', fmt.num(t.failed + t.uncertain)), stat('Pending', fmt.num(t.queued)),
        stat('Delivery rate', fmt.pct(t.deliveryRate), 'Delivered ÷ accepted'), stat('Segments used', fmt.num(t.segments)), stat('Estimated expenditure', fmt.money(t.cost))),
      h('div', { class: 'card mb' }, h('h2', null, 'Daily activity'),
        r.daily.length ? [barChart(r.daily.map((d) => ({ label: d.date, values: [d.accepted, d.delivered, d.failed] })), [{ name: 'Accepted', color: COLORS.info }, { name: 'Delivered', color: COLORS.ok }, { name: 'Failed', color: COLORS.bad }]), legend([{ name: 'Accepted by provider', color: COLORS.info }, { name: 'Delivered (confirmed)', color: COLORS.ok }, { name: 'Failed', color: COLORS.bad }])] : emptyState('📊', 'No messages in this period')),
      h('div', { class: 'card' }, h('h2', null, 'Daily breakdown'), table([{ label: 'Date', key: 'date' }, { label: 'Messages', render: (d) => fmt.num(d.messages) }, { label: 'Accepted', render: (d) => fmt.num(d.accepted) }, { label: 'Delivered', render: (d) => fmt.num(d.delivered) }, { label: 'Failed', render: (d) => fmt.num(d.failed) }, { label: 'Segments', render: (d) => fmt.num(d.segments) }, { label: 'Est. cost', render: (d) => fmt.money(d.cost) }], r.daily, { empty: emptyState('', 'No data') })),
      h('p', { class: 'hint' }, 'Costs are estimates based on the rate per segment saved in Settings when each message was sent. Your SMS provider\'s own statement is the final record.'));
  } catch (e) { mount(out, h('div', { class: 'alert bad' }, e.message)); }
}
run();
