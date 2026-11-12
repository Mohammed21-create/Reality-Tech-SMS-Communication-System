import { h, mount, loading, fmt, table, pager, modal, confirmDialog, toast, debounce, withBusy, statusBadge, emptyState, progress, $ } from '../core/ui.js';
import { initPortal } from '../core/layout.js';
import { schoolApi as api } from '../core/api.js';
import { donut, legend, COLORS } from '../core/charts.js';

await initPortal({ portal: 'school', api, title: 'Message history' });
const page = document.getElementById('page');
const state = { page: 1, status: '', q: '' };
const list = h('div');
const statusSel = h('select', { 'aria-label': 'Status filter', onchange: (e) => { state.status = e.target.value; state.page = 1; load(); } }, h('option', { value: '' }, 'All statuses'), ['scheduled', 'preparing', 'sending', 'completed', 'failed', 'cancelled'].map((s) => h('option', { value: s }, s)));
statusSel.style.maxWidth = '200px';
mount(page, h('div', { class: 'row between mb' }, h('h1', null, 'Message history'), h('a', { class: 'btn', href: '/school/compose.html' }, 'New message')),
  h('div', { class: 'toolbar' }, h('input', { class: 'search', type: 'search', placeholder: 'Search message text…', 'aria-label': 'Search messages', oninput: debounce((e) => { state.q = e.target.value; state.page = 1; load(); }) }), statusSel), list);

let timer = null;
async function load(silent) {
  if (!silent) loading(list);
  try {
    const r = await api.get('/messages', { page: state.page, status: state.status, q: state.q, limit: 15 });
    mount(list, table([
      { label: 'Created', render: (m) => fmt.dateTime(m.createdAt) },
      { label: 'Message', render: (m) => h('a', { href: '#', onclick: (e) => { e.preventDefault(); openDetail(m.id); } }, m.body.length > 80 ? m.body.slice(0, 80) + '…' : m.body) },
      { label: 'Status', render: (m) => [statusBadge(m.status), m.scheduledAt && m.status === 'scheduled' ? h('div', { class: 'small muted' }, fmt.dateTime(m.scheduledAt)) : null] },
      { label: 'Recipients', render: (m) => fmt.num(m.counts.total || m.estimatedRecipients) },
      { label: 'Accepted', render: (m) => fmt.num(m.counts.acceptedTotal) },
      { label: 'Delivered', render: (m) => fmt.num(m.counts.delivered) },
      { label: 'Failed', render: (m) => fmt.num(m.counts.failed + m.counts.uncertain) },
    ], r.items, { empty: emptyState('✉️', 'No messages found') }), pager(r.pagination, (p) => { state.page = p; load(); }));
    clearTimeout(timer);
    if (r.items.some((m) => ['preparing', 'sending'].includes(m.status))) timer = setTimeout(() => load(true), 5000);
  } catch (e) { mount(list, h('div', { class: 'alert bad' }, e.message)); }
}

async function openDetail(id) {
  const body = h('div'); loading(body);
  let alive = true; let t;
  const foot = h('div', { class: 'row' });
  const m = modal({ wide: true, title: 'Message details', body, footer: foot, onClose: () => { alive = false; clearTimeout(t); load(true); } });
  const rec = { page: 1, status: '' };
  const recBox = h('div');
  async function draw() {
    const { message: x } = await api.get(`/messages/${id}`);
    const c = x.counts; const total = c.total || 1;
    mount(body, h('div', { class: 'stack' },
      h('div', { class: 'bubble' }, x.finalText),
      h('div', { class: 'row' }, statusBadge(x.status), h('span', { class: 'muted small' }, `Sender ID ${x.senderId} · ${x.encoding} · ${x.segmentsPerMessage} segment(s) · by ${x.createdByName || '-'}`)),
      x.lastError ? h('div', { class: 'alert bad' }, x.lastError) : null,
      x.scheduledAt && x.status === 'scheduled' ? h('div', { class: 'alert warn' }, `Scheduled for ${fmt.dateTime(x.scheduledAt)}`) : null,
      h('div', { class: 'row' }, donut([
        { label: 'Delivered', value: c.delivered, color: COLORS.ok }, { label: 'Accepted, awaiting report', value: c.accepted, color: COLORS.info },
        { label: 'Queued / sending', value: c.queued + c.sending, color: COLORS.warn }, { label: 'Failed', value: c.failed, color: COLORS.bad }, { label: 'Unknown outcome', value: c.uncertain, color: '#8892a6' }], { size: 130 }),
      h('div', { class: 'grow' },
        progress([{ pct: (c.delivered / total) * 100, cls: 'p-ok' }, { pct: (c.accepted / total) * 100, cls: 'p-info' }, { pct: ((c.queued + c.sending) / total) * 100, cls: 'p-warn' }, { pct: ((c.failed + c.uncertain) / total) * 100, cls: 'p-bad' }]),
        legend([{ name: `Delivered ${fmt.num(c.delivered)}`, color: COLORS.ok }, { name: `Accepted, awaiting report ${fmt.num(c.accepted)}`, color: COLORS.info }, { name: `Queued/sending ${fmt.num(c.queued + c.sending)}`, color: COLORS.warn }, { name: `Failed ${fmt.num(c.failed)}`, color: COLORS.bad }, { name: `Unknown ${fmt.num(c.uncertain)}`, color: '#8892a6' }]),
        h('p', { class: 'hint' }, '"Accepted" means your SMS provider took the message. "Delivered" is only shown when the provider confirms it reached the phone.'),
        h('p', { class: 'small' }, `Estimated cost so far: ${fmt.money(x.estimatedCost, x.currency)}`))),
      h('div', { class: 'row' }, h('label', { class: 'small' }, 'Recipients: '), (() => { const s = h('select', { 'aria-label': 'Recipient status', onchange: (e) => { rec.status = e.target.value; rec.page = 1; drawRec(); } }, h('option', { value: '' }, 'All'), ['queued', 'sending', 'accepted', 'delivered', 'failed', 'uncertain'].map((v) => h('option', { value: v, selected: rec.status === v }, v))); s.style.maxWidth = '160px'; return s; })()),
      recBox));
    mount(foot,
      h('button', { class: 'btn secondary', onclick: () => api.download(`/messages/${id}/recipients.csv`, {}, `message-${id}.csv`).catch((e) => toast(e.message, 'bad')) }, 'Export recipients'),
      x.status === 'scheduled' ? h('button', { class: 'btn danger', onclick: cancel }, 'Cancel scheduled message') : null,
      ['completed', 'failed'].includes(x.status) && (c.failed > 0 || c.uncertain > 0) ? h('button', { class: 'btn', onclick: (e) => retry(e.target, c) }, 'Retry failed') : null);
    drawRec();
    if (alive && ['scheduled', 'preparing', 'sending'].includes(x.status)) t = setTimeout(() => alive && draw().catch(() => {}), 5000);
  }
  async function drawRec() {
    const r = await api.get(`/messages/${id}/recipients`, { page: rec.page, status: rec.status, limit: 10 });
    mount(recBox, table([{ label: 'Parent', key: 'parentName' }, { label: 'Phone', render: (x) => h('span', { class: 'mono' }, x.phone) }, { label: 'Status', render: (x) => statusBadge(x.status) }, { label: 'Detail', render: (x) => x.lastError || (x.deliveredAt ? `Delivered ${fmt.dateTime(x.deliveredAt)}` : x.acceptedAt ? `Accepted ${fmt.dateTime(x.acceptedAt)}` : '') }], r.items, { empty: emptyState('', 'No recipients yet') }), pager(r.pagination, (p) => { rec.page = p; drawRec(); }));
  }
  async function cancel() {
    if (!(await confirmDialog({ title: 'Cancel scheduled message?', message: 'It will not be sent.', confirmText: 'Cancel message', danger: true }))) return;
    try { await api.post(`/messages/${id}/cancel`); toast('Cancelled', 'ok'); draw(); } catch (e) { toast(e.message, 'bad'); }
  }
  async function retry(btn, c) {
    const withUnknown = c.uncertain > 0 ? await confirmDialog({ title: 'Include unknown outcomes?', message: `${c.uncertain} message(s) have an unknown outcome (the provider may or may not have sent them). Retrying those could cause duplicates. Include them?`, confirmText: 'Include them' }) : false;
    await withBusy(btn, async () => { const r = await api.post(`/messages/${id}/retry`, { includeUncertain: withUnknown }); toast(r.requeued ? `${r.requeued} message(s) re-queued` : 'Nothing eligible to retry', r.requeued ? 'ok' : ''); draw(); });
  }
  try { await draw(); } catch (e) { mount(body, h('div', { class: 'alert bad' }, e.message)); }
  void m;
}

const open = new URLSearchParams(location.search).get('open');
await load();
if (open) openDetail(open);
void $;
