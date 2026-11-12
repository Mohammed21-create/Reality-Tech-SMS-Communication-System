import { h, mount, loading, table, pager, modal, confirmDialog, toast, debounce, withBusy, field, emptyState } from '../core/ui.js';
import { initPortal } from '../core/layout.js';
import { schoolApi as api } from '../core/api.js';

await initPortal({ portal: 'school', api, title: 'Students' });
const page = document.getElementById('page');
const state = { page: 1, q: '' };
const list = h('div');
mount(page,
  h('div', { class: 'row between mb' }, h('h1', null, 'Students'), h('button', { class: 'btn', onclick: () => edit() }, '+ Add student')),
  h('p', { class: 'muted' }, 'Optional: keep a simple student list and link each student to a parent. Messages are always sent to parents.'),
  h('div', { class: 'toolbar' }, h('input', { class: 'search', type: 'search', placeholder: 'Search students…', 'aria-label': 'Search students', oninput: debounce((e) => { state.q = e.target.value; state.page = 1; load(); }) })),
  list);

async function load() {
  loading(list);
  try {
    const r = await api.get('/students', { page: state.page, q: state.q, limit: 25 });
    mount(list, table([
      { label: 'Student', render: (s) => h('strong', null, s.fullName) }, { label: 'Class', key: 'className' }, { label: 'Student no.', key: 'studentNumber' },
      { label: 'Parents', render: (s) => s.parents.map((p) => p.fullName).join(', ') || '-' },
      { label: '', class: 'actions', render: (s) => [h('button', { class: 'btn secondary sm', onclick: () => edit(s) }, 'Edit'), ' ', h('button', { class: 'btn ghost sm', onclick: () => remove(s) }, 'Delete')] },
    ], r.items, { empty: emptyState('🎒', 'No students yet') }), pager(r.pagination, (p) => { state.page = p; load(); }));
  } catch (e) { mount(list, h('div', { class: 'alert bad' }, e.message)); }
}
async function remove(s) {
  if (!(await confirmDialog({ title: 'Delete student?', message: `Delete ${s.fullName}?`, confirmText: 'Delete', danger: true }))) return;
  try { await api.del(`/students/${s.id}`); toast('Deleted', 'ok'); load(); } catch (e) { toast(e.message, 'bad'); }
}
function edit(s) {
  const linked = new Map((s ? s.parents : []).map((p) => [p.id, p.fullName]));
  const name = h('input', { value: s ? s.fullName : '', maxlength: 120 });
  const cls = h('input', { value: s ? s.className : '', maxlength: 60 });
  const num = h('input', { value: s ? s.studentNumber : '', maxlength: 40 });
  const chips = h('div', { class: 'chips' }); const results = h('div', { class: 'stack small' });
  const drawChips = () => mount(chips, [...linked].map(([id, n]) => h('span', { class: 'chip' }, n, h('button', { type: 'button', 'aria-label': `Remove ${n}`, onclick: () => { linked.delete(id); drawChips(); } }, '×'))));
  drawChips();
  const search = h('input', { type: 'search', placeholder: 'Search parent by name or phone to link…', oninput: debounce(async (e) => {
    if (e.target.value.trim().length < 2) return mount(results);
    const r = await api.get('/parents', { q: e.target.value, limit: 6 });
    mount(results, r.items.map((p) => h('div', null, h('button', { class: 'btn secondary sm', type: 'button', disabled: linked.size >= 5, onclick: () => { linked.set(p.id, p.fullName); drawChips(); } }, `+ ${p.fullName} (${p.phones[0].number})`))));
  }) });
  const save = h('button', { class: 'btn', type: 'button' }, 'Save');
  const m = modal({ title: s ? 'Edit student' : 'Add student', body: h('div', null, field('Student name', name), h('div', { class: 'form-grid' }, field('Class', cls), field('Student number', num)), field('Linked parents', h('div', { class: 'stack' }, chips, search, results))), footer: [h('button', { class: 'btn secondary', type: 'button', onclick: () => m.close() }, 'Cancel'), save] });
  save.addEventListener('click', () => withBusy(save, async () => {
    const body = { fullName: name.value, className: cls.value, studentNumber: num.value, parentIds: [...linked.keys()] };
    if (s) await api.put(`/students/${s.id}`, body); else await api.post('/students', body);
    toast('Student saved', 'ok'); m.close(); load();
  }));
}
load();
