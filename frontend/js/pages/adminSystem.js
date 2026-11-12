import { h, mount, loading, fmt, table, toast, withBusy, field, badge, $ } from '../core/ui.js';
import { initPortal } from '../core/layout.js';
import { adminApi as api } from '../core/api.js';

await initPortal({ portal: 'admin', api, title: 'System & settings' });
const page = document.getElementById('page');
const health = h('div'); const settingsBox = h('div');
mount(page, h('div', { class: 'row between mb' }, h('h1', null, 'System health'), h('button', { class: 'btn secondary', onclick: loadHealth }, 'Refresh')), health, h('h1', { class: 'mt' }, 'Platform settings'), settingsBox);
const stat = (l, v, s, kind) => h('div', { class: 'card stat' }, h('div', { class: 'label' }, l), h('div', { class: 'value' }, v), s ? h('div', { class: 'sub' }, s) : null, kind ? badge(kind === 'ok' ? 'healthy' : 'problem', kind) : null);

async function loadHealth() {
  loading(health);
  try {
    const d = await api.get('/system/health');
    const qrows = Object.entries(d.queues || {}).filter(([, v]) => typeof v === 'object').map(([k, v]) => ({ name: k, ...v }));
    mount(health,
      h('div', { class: 'cards mb' },
        stat('MongoDB', d.mongo.ok ? `${d.mongo.latencyMs} ms` : 'Down', d.mongo.error, d.mongo.ok ? 'ok' : 'bad'),
        stat('Redis / queues', d.redis.ok ? `${d.redis.latencyMs} ms` : 'Down', d.redis.ok ? `${d.redis.usedMemoryMb ?? '?'} MB used${d.redis.maxMemoryMb ? ` of ${d.redis.maxMemoryMb} MB` : ''}` : d.redis.error, d.redis.ok ? 'ok' : 'bad'),
        stat('Web memory', `${d.server.rssMb} MB`, `heap ${d.server.heapUsedMb} MB · load ${d.server.loadAvg.join(' / ')}`),
        stat('Uptime', `${Math.floor(d.uptimeSeconds / 3600)}h ${Math.floor((d.uptimeSeconds % 3600) / 60)}m`, `Node ${d.node}`),
        stat('Database size', d.storage ? `${d.storage.dataSizeMb} MB` : '-', d.storage ? `storage ${d.storage.storageSizeMb} MB · indexes ${d.storage.indexSizeMb} MB` : ''),
        stat('Active sessions', fmt.num(d.activeSessions)), stat('Failed messages (24h)', fmt.num(d.failedMessages24h)),
        d.fairScheduler ? stat('Waiting batches', fmt.num(d.fairScheduler.pendingBatches), `${d.fairScheduler.schoolsWithPendingBatches} school(s) with work waiting`) : null),
      h('div', { class: 'card' }, h('h2', null, 'Background queues'), table([{ label: 'Queue', key: 'name' }, { label: 'Waiting', render: (q) => fmt.num(q.waiting) }, { label: 'Active', render: (q) => fmt.num(q.active) }, { label: 'Delayed', render: (q) => fmt.num(q.delayed) }, { label: 'Failed', render: (q) => fmt.num(q.failed) }, { label: 'Completed (retained)', render: (q) => fmt.num(q.completed) }], qrows),
        h('p', { class: 'hint' }, 'sms-dead is the dead-letter queue: batches that failed every retry. Their recipients are marked failed and can be retried by the school. If "Waiting" on sms-send keeps growing, add worker instances.')));
  } catch (e) { mount(health, h('div', { class: 'alert bad' }, e.message)); }
}

async function loadSettings() {
  const { settings: s } = await api.get('/settings');
  const maint = h('input', { type: 'checkbox', checked: s.maintenanceMode });
  const f = { maintenanceMessage: h('input', { value: s.maintenanceMessage, maxlength: 300 }), perSchoolMaxInflight: h('input', { type: 'number', min: 1, max: 20, value: s.perSchoolMaxInflight }), maxRecipientsPerMessage: h('input', { type: 'number', min: 1, value: s.maxRecipientsPerMessage }), defaultTrialDays: h('input', { type: 'number', min: 1, max: 365, value: s.defaultTrialDays }) };
  const save = h('button', { class: 'btn', type: 'button' }, 'Save settings');
  save.addEventListener('click', () => withBusy(save, async () => { await api.put('/settings', { maintenanceMode: maint.checked, ...Object.fromEntries(Object.entries(f).map(([k, el]) => [k, el.value])) }); toast('Platform settings saved', 'ok'); }));
  mount(settingsBox, h('div', { class: 'card' }, h('label', { class: 'check mb' }, maint, ' Maintenance mode (pauses new sends for all schools)'), field('Maintenance message shown to schools', f.maintenanceMessage),
    h('div', { class: 'form-grid' }, field('Max parallel batches per school', f.perSchoolMaxInflight, 'Fairness control: stops one school monopolising the workers.'), field('Max recipients per message', f.maxRecipientsPerMessage), field('Default trial length (days)', f.defaultTrialDays)), save));
}
loadHealth(); loadSettings();
void $;
