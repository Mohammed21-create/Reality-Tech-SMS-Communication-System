import { h, mount, loading, fmt, table, statusBadge, emptyState } from '../core/ui.js';
import { initPortal } from '../core/layout.js';
import { schoolApi as api } from '../core/api.js';
import { barChart, legend, COLORS } from '../core/charts.js';

await initPortal({ portal: 'school', api, title: 'Dashboard' });
const page = document.getElementById('page');
loading(page);
const [d, prov, settings] = await Promise.all([api.get('/dashboard'), api.get('/provider'), api.get('/settings')]);

const stat = (label, value, sub) => h('div', { class: 'card stat' }, h('div', { class: 'label' }, label), h('div', { class: 'value' }, value), sub ? h('div', { class: 'sub' }, sub) : null);
const setup = [];
if (!prov.config) setup.push('Choose your SMS provider and enter your API key');
if (!settings.settings.preferredSenderId) setup.push('Set your SMS sender ID');
if (d.parents === 0) setup.push('Add or import your parents\' phone numbers');

mount(page,
  h('h1', null, 'Dashboard'),
  setup.length ? h('div', { class: 'alert warn mb' }, h('strong', null, 'Finish setting up: '), setup.join(' · '), ' ', h('a', { href: '/school/settings.html' }, 'Open settings')) : null,
  h('div', { class: 'cards mb' },
    stat('Registered parents', fmt.num(d.parents)), stat('Registered students', fmt.num(d.students)),
    stat('Accepted by provider', fmt.num(d.sms.accepted), 'Handed to your SMS provider'),
    stat('Delivered', fmt.num(d.sms.delivered), 'Confirmed by delivery receipt'),
    stat('Failed / unknown', fmt.num(d.sms.failed)), stat('Pending', fmt.num(d.sms.pending), 'Waiting to be sent'),
    stat('Awaiting delivery report', fmt.num(d.sms.awaitingDelivery)), stat('Scheduled messages', fmt.num(d.scheduledMessages)),
    stat('Estimated SMS spend', fmt.money(d.sms.estimatedCost, prov.config ? prov.config.currency : 'GHS'), `${fmt.num(d.sms.segments)} segments`)),
  h('div', { class: 'card mb' }, h('h2', null, 'Last 14 days'),
    d.daily.length ? [barChart(d.daily.map((x) => ({ label: x.date, values: [x.accepted, x.delivered, x.failed] })), [{ name: 'Accepted', color: COLORS.info }, { name: 'Delivered', color: COLORS.ok }, { name: 'Failed', color: COLORS.bad }]),
      legend([{ name: 'Accepted by provider', color: COLORS.info }, { name: 'Delivered (confirmed)', color: COLORS.ok }, { name: 'Failed', color: COLORS.bad }])] : emptyState('📊', 'No messages in the last 14 days')),
  h('div', { class: 'card' }, h('div', { class: 'row between' }, h('h2', null, 'Recent messages'), h('a', { class: 'btn secondary sm', href: '/school/messages.html' }, 'View all')),
    table([
      { label: 'Sent', render: (m) => fmt.dateTime(m.createdAt) },
      { label: 'Message', render: (m) => (m.body.length > 70 ? m.body.slice(0, 70) + '…' : m.body) },
      { label: 'Status', render: (m) => statusBadge(m.status) },
      { label: 'Recipients', render: (m) => fmt.num(m.counts.total || m.estimatedRecipients) },
      { label: 'Delivered', render: (m) => fmt.num(m.counts.delivered) },
    ], d.recent, { empty: emptyState('✉️', 'No messages yet', 'Send your first announcement from "Send SMS".') })));
