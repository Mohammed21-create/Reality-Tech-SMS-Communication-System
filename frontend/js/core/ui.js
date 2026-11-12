// Small DOM helpers. All text is inserted with textContent / createTextNode, never innerHTML (XSS-safe).
export function h(tag, attrs, ...children) {
  const el = document.createElement(tag);
  for (const [k, v] of Object.entries(attrs || {})) {
    if (v === false || v === null || v === undefined) continue;
    if (k === 'class') el.className = v;
    else if (k === 'dataset') Object.assign(el.dataset, v);
    else if (k.startsWith('on') && typeof v === 'function') el.addEventListener(k.slice(2).toLowerCase(), v);
    else if (k === 'value') el.value = v;
    else if (k === 'checked' || k === 'disabled' || k === 'selected' || k === 'required' || k === 'multiple') el[k] = !!v;
    else el.setAttribute(k, v === true ? '' : v);
  }
  append(el, children);
  return el;
}
function append(el, children) {
  for (const c of children.flat(Infinity)) {
    if (c === null || c === undefined || c === false) continue;
    el.append(c instanceof Node ? c : document.createTextNode(String(c)));
  }
}
export const $ = (sel, root = document) => root.querySelector(sel);
export const $$ = (sel, root = document) => [...root.querySelectorAll(sel)];
export const clear = (el) => { while (el.firstChild) el.removeChild(el.firstChild); return el; };
export function mount(el, ...children) { clear(el); append(el, children); return el; }

export const fmt = {
  num: (n) => (n === null || n === undefined ? '-' : Number(n).toLocaleString()),
  money: (n, cur = 'GHS') => `${cur} ${Number(n || 0).toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`,
  date: (d) => (d ? new Date(d).toLocaleDateString(undefined, { year: 'numeric', month: 'short', day: 'numeric' }) : '-'),
  dateTime: (d) => (d ? new Date(d).toLocaleString(undefined, { year: 'numeric', month: 'short', day: 'numeric', hour: '2-digit', minute: '2-digit' }) : '-'),
  pct: (n) => (n === null || n === undefined ? '-' : `${n}%`),
};

export function toast(message, kind = '') {
  let box = document.getElementById('toasts');
  if (!box) { box = h('div', { id: 'toasts', role: 'status', 'aria-live': 'polite' }); document.body.append(box); }
  const t = h('div', { class: `toast ${kind}` }, message);
  box.append(t);
  setTimeout(() => t.remove(), kind === 'bad' ? 7000 : 4000);
}

export function loading(el, text = 'Loading…') { return mount(el, h('div', { class: 'loading' }, h('span', { class: 'spinner' }), ' ', text)); }
export const emptyState = (icon, title, text) => h('div', { class: 'empty' }, h('div', { class: 'icon' }, icon), h('h3', null, title), text ? h('p', null, text) : null);

/** Modal dialog built on <dialog>. Returns {close, body, dialog}. */
export function modal({ title, body, footer, wide = false, onClose }) {
  const dlg = h('dialog', { class: wide ? 'wide' : '' });
  const close = () => { dlg.close(); };
  dlg.append(
    h('div', { class: 'dlg-head' }, h('h2', null, title), h('button', { class: 'btn ghost sm', type: 'button', 'aria-label': 'Close', onclick: close }, '✕')),
    h('div', { class: 'dlg-body' }, body),
    footer ? h('div', { class: 'dlg-foot' }, footer) : null,
  );
  dlg.addEventListener('close', () => { dlg.remove(); if (onClose) onClose(); });
  document.body.append(dlg);
  dlg.showModal();
  return { close, dialog: dlg, body: dlg.querySelector('.dlg-body') };
}

/** Promise-based confirmation dialog. opts.typeToConfirm = 'SEND' requires typing that word. */
export function confirmDialog({ title = 'Are you sure?', message, confirmText = 'Confirm', danger = false, typeToConfirm = '', details }) {
  return new Promise((resolve) => {
    let done = false;
    const input = typeToConfirm ? h('input', { type: 'text', autocomplete: 'off', placeholder: `Type ${typeToConfirm}` }) : null;
    const ok = h('button', { class: `btn ${danger ? 'danger' : ''}`, type: 'button', disabled: !!typeToConfirm }, confirmText);
    if (input) input.addEventListener('input', () => { ok.disabled = input.value.trim().toUpperCase() !== typeToConfirm; });
    const cancel = h('button', { class: 'btn secondary', type: 'button' }, 'Cancel');
    const m = modal({
      title,
      body: h('div', { class: 'stack' }, h('p', null, message), details || null, input ? h('div', null, h('label', null, `To continue, type ${typeToConfirm}`), input) : null),
      footer: [cancel, ok],
      onClose: () => { if (!done) resolve(false); },
    });
    cancel.addEventListener('click', () => m.close());
    ok.addEventListener('click', () => { done = true; resolve(true); m.close(); });
  });
}

export function badge(text, kind = '') { return h('span', { class: `badge ${kind}` }, text); }
const STATUS_KIND = { active: 'ok', completed: 'ok', delivered: 'ok', accepted: 'info', sending: 'info', preparing: 'info', queued: 'info', scheduled: 'warn', pending: 'warn', trial: 'warn', suspended: 'bad', failed: 'bad', cancelled: '', deactivated: 'bad', uncertain: 'warn', inactive: '' };
export const statusBadge = (s) => badge(String(s).replace(/_/g, ' '), STATUS_KIND[s] || '');

/** Data table. columns: [{label, render(row)|key, class}] */
export function table(columns, rows, { empty } = {}) {
  if (!rows.length) return empty || emptyState('📭', 'Nothing here yet');
  return h('div', { class: 'table-wrap' }, h('table', null,
    h('thead', null, h('tr', null, columns.map((c) => h('th', { class: c.class || '' }, c.label)))),
    h('tbody', null, rows.map((r) => h('tr', null, columns.map((c) => h('td', { class: c.class || '' }, typeof c.render === 'function' ? c.render(r) : r[c.key])))))));
}

export function pager(pagination, onPage) {
  const { page, pages, total } = pagination;
  return h('div', { class: 'pager' },
    h('span', { class: 'muted small' }, `${fmt.num(total)} total · page ${page} of ${pages}`),
    h('div', { class: 'row' },
      h('button', { class: 'btn secondary sm', type: 'button', disabled: page <= 1, onclick: () => onPage(page - 1) }, '← Previous'),
      h('button', { class: 'btn secondary sm', type: 'button', disabled: page >= pages, onclick: () => onPage(page + 1) }, 'Next →')));
}

export function debounce(fn, ms = 350) { let t; return (...a) => { clearTimeout(t); t = setTimeout(() => fn(...a), ms); }; }

/** Run an async action on a button with a busy state; shows errors as toasts. */
export async function withBusy(btn, fn) {
  const label = btn.textContent; btn.disabled = true; btn.textContent = 'Please wait…';
  try { return await fn(); } catch (e) { toast(e.message || 'Something went wrong', 'bad'); return undefined; } finally { btn.disabled = false; btn.textContent = label; }
}

export function field(label, input, hint) { return h('div', { class: 'field' }, h('label', null, label), input, hint ? h('div', { class: 'hint' }, hint) : null); }
export const progress = (parts) => h('div', { class: 'progress' }, parts.filter((p) => p.pct > 0).map((p) => { const s = h('span', { class: p.cls, title: p.title || '' }); s.style.width = `${p.pct}%`; return s; }));
