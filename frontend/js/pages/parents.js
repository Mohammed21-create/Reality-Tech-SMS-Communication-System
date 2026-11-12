import { h, mount, loading, fmt, table, pager, modal, confirmDialog, toast, debounce, withBusy, field, statusBadge, emptyState, $ } from '../core/ui.js';
import { initPortal } from '../core/layout.js';
import { schoolApi as api, ApiError } from '../core/api.js';

await initPortal({ portal: 'school', api, title: 'Parents' });
const page = document.getElementById('page');
const state = { page: 1, q: '', status: '', selected: new Set() };
const list = h('div');

mount(page,
  h('div', { class: 'row between mb' }, h('h1', null, 'Parent contacts'),
    h('div', { class: 'row' },
      h('button', { class: 'btn', onclick: () => editParent() }, '+ Add parent'),
      h('button', { class: 'btn secondary', onclick: importDialog }, 'Import CSV / Excel'),
      h('button', { class: 'btn secondary', onclick: () => api.download('/parents/export', { format: 'csv' }, 'parents.csv').catch((e) => toast(e.message, 'bad')) }, 'Export CSV'),
      h('button', { class: 'btn secondary', onclick: () => api.download('/parents/export', { format: 'xlsx' }, 'parents.xlsx').catch((e) => toast(e.message, 'bad')) }, 'Export Excel'),
      h('button', { class: 'btn secondary', onclick: showDuplicates }, 'Find duplicates'))),
  h('div', { class: 'toolbar' },
    h('input', { class: 'search', type: 'search', placeholder: 'Search by name or phone…', 'aria-label': 'Search parents', oninput: debounce((e) => { state.q = e.target.value; state.page = 1; load(); }) }),
    (() => { const s = h('select', { 'aria-label': 'Status filter', style: null, onchange: (e) => { state.status = e.target.value; state.page = 1; load(); } }, h('option', { value: '' }, 'All statuses'), h('option', { value: 'active' }, 'Active'), h('option', { value: 'inactive' }, 'Inactive')); s.classList.add('grow'); s.style.maxWidth = '180px'; return s; })(),
    h('button', { class: 'btn danger sm', id: 'bulk-del', onclick: bulkDelete }, 'Delete selected')),
  list);
$('#bulk-del').classList.add('hidden');

async function load() {
  loading(list);
  try {
    const r = await api.get('/parents', { page: state.page, q: state.q, status: state.status, limit: 25 });
    const all = h('input', { type: 'checkbox', 'aria-label': 'Select all on page', onchange: (e) => { r.items.forEach((p) => (e.target.checked ? state.selected.add(p.id) : state.selected.delete(p.id))); updateBulk(); load2(r); } });
    void all;
    load2(r);
  } catch (e) { mount(list, h('div', { class: 'alert bad' }, e.message)); }
}
function load2(r) {
  mount(list,
    table([
      { label: '', render: (p) => h('input', { type: 'checkbox', 'aria-label': `Select ${p.fullName}`, checked: state.selected.has(p.id), onchange: (e) => { e.target.checked ? state.selected.add(p.id) : state.selected.delete(p.id); updateBulk(); } }) },
      { label: 'Name', render: (p) => h('strong', null, p.fullName) },
      { label: 'Phone numbers', render: (p) => p.phones.map((x) => h('div', { class: 'mono small' }, x.number)) },
      { label: 'Status', render: (p) => statusBadge(p.status) },
      { label: 'Notes', render: (p) => p.notes || '' },
      { label: '', class: 'actions', render: (p) => [h('button', { class: 'btn secondary sm', onclick: () => editParent(p) }, 'Edit'), ' ', h('button', { class: 'btn ghost sm', onclick: () => removeOne(p) }, 'Delete')] },
    ], r.items, { empty: emptyState('👪', state.q ? 'No parents match your search' : 'No parents yet', state.q ? 'Try a different name or number.' : 'Add parents one by one or import a CSV / Excel file.') }),
    pager(r.pagination, (p) => { state.page = p; load(); }));
}
function updateBulk() { const b = $('#bulk-del'); b.classList.toggle('hidden', !state.selected.size); b.textContent = `Delete selected (${state.selected.size})`; }

async function removeOne(p) {
  if (!(await confirmDialog({ title: 'Delete parent?', message: `Delete ${p.fullName}? They will stop receiving messages. This cannot be undone.`, confirmText: 'Delete', danger: true }))) return;
  try { await api.del(`/parents/${p.id}`); toast('Parent deleted', 'ok'); load(); } catch (e) { toast(e.message, 'bad'); }
}
async function bulkDelete() {
  const n = state.selected.size;
  if (!(await confirmDialog({ title: `Delete ${n} parents?`, message: 'This cannot be undone.', confirmText: 'Delete', danger: true }))) return;
  try { await api.post('/parents/bulk-delete', { ids: [...state.selected] }); state.selected.clear(); updateBulk(); toast('Deleted', 'ok'); load(); } catch (e) { toast(e.message, 'bad'); }
}

function editParent(p) {
  const phones = (p ? p.phones.map((x) => x.number) : ['']);
  const name = h('input', { value: p ? p.fullName : '', maxlength: 120, required: true });
  const notes = h('input', { value: p ? p.notes : '', maxlength: 500 });
  const status = h('select', null, h('option', { value: 'active', selected: !p || p.status === 'active' }, 'Active'), h('option', { value: 'inactive', selected: p && p.status === 'inactive' }, 'Inactive'));
  const phoneBox = h('div', { class: 'stack' });
  const renderPhones = () => mount(phoneBox, phones.map((v, i) => h('div', { class: 'row' },
    h('input', { class: 'grow', value: v, placeholder: '0241234567 or +447700900123', inputmode: 'tel', 'aria-label': `Phone ${i + 1}`, oninput: (e) => { phones[i] = e.target.value; } }),
    phones.length > 1 ? h('button', { class: 'btn ghost sm', type: 'button', onclick: () => { phones.splice(i, 1); renderPhones(); } }, 'Remove') : null)),
  phones.length < 3 ? h('button', { class: 'btn secondary sm', type: 'button', onclick: () => { phones.push(''); renderPhones(); } }, '+ Add another number') : null);
  renderPhones();
  const save = h('button', { class: 'btn', type: 'button' }, 'Save');
  const m = modal({ title: p ? 'Edit parent' : 'Add parent', body: h('div', null, field('Full name', name), field('Phone numbers', phoneBox, 'Ghana numbers (024…, 233…) and international numbers (+44…) are supported.'), h('div', { class: 'form-grid' }, field('Notes (optional)', notes), field('Status', status))), footer: [h('button', { class: 'btn secondary', type: 'button', onclick: () => m.close() }, 'Cancel'), save] });
  save.addEventListener('click', () => withBusy(save, async () => {
    const body = { fullName: name.value, phones: phones.filter((x) => x.trim()), notes: notes.value, status: status.value };
    try {
      if (p) await api.put(`/parents/${p.id}`, body); else await api.post('/parents', body);
    } catch (e) {
      if (e instanceof ApiError && e.code === 'DUPLICATE_PHONE') {
        const ok = await confirmDialog({ title: 'Duplicate number', message: `This number already belongs to: ${(e.details || []).map((d) => d.fullName).join(', ')}. Save anyway?`, confirmText: 'Save anyway' });
        if (!ok) return;
        if (p) await api.put(`/parents/${p.id}`, { ...body, allowDuplicate: true }); else await api.post('/parents', { ...body, allowDuplicate: true });
      } else throw e;
    }
    toast('Parent saved', 'ok'); m.close(); load();
  }));
}

function importDialog() {
  const file = h('input', { type: 'file', accept: '.csv,.xlsx' });
  const result = h('div', { class: 'mt' });
  const go = h('button', { class: 'btn', type: 'button' }, 'Upload and import');
  const m = modal({ wide: true, title: 'Import parents', body: h('div', null,
    h('p', null, 'Upload a .csv or .xlsx file. The first row must contain headers: ', h('strong', null, 'Name'), ' and ', h('strong', null, 'Phone'), ' (optional: Phone 2, Notes).'),
    h('p', null, h('button', { class: 'btn secondary sm', type: 'button', onclick: () => api.download('/parents/template', {}, 'parents-template.csv').catch((e) => toast(e.message, 'bad')) }, 'Download template')),
    field('File', file, 'Numbers that already exist, duplicates inside the file, and invalid numbers are skipped and reported.'), result), footer: [h('button', { class: 'btn secondary', type: 'button', onclick: () => m.close() }, 'Close'), go] });
  go.addEventListener('click', () => withBusy(go, async () => {
    if (!file.files[0]) return toast('Choose a file first', 'bad');
    const fd = new FormData(); fd.append('file', file.files[0]);
    const r = await api.upload('/parents/import', fd);
    mount(result, h('div', { class: `alert ${r.imported ? 'ok' : 'warn'}` }, `Imported ${fmt.num(r.imported)} of ${fmt.num(r.totalRows)} rows · ${fmt.num(r.duplicates)} duplicates skipped · ${fmt.num(r.invalid)} invalid`),
      r.errors.length || r.duplicateRows.length ? table([{ label: 'Row', key: 'row' }, { label: 'Problem', key: 'reason' }], [...r.errors, ...r.duplicateRows].slice(0, 100)) : null);
    load();
  }));
}

async function showDuplicates() {
  const body = h('div'); loading(body);
  modal({ wide: true, title: 'Duplicate phone numbers', body });
  try {
    const r = await api.get('/parents/duplicates');
    mount(body, table([{ label: 'Phone', render: (d) => h('span', { class: 'mono' }, d.phone) }, { label: 'Used by', render: (d) => d.parents.map((p) => p.fullName).join(', ') }, { label: 'Times', key: 'count' }], r.duplicates, { empty: emptyState('✅', 'No duplicate numbers found') }));
  } catch (e) { mount(body, h('div', { class: 'alert bad' }, e.message)); }
}
load();
