import { h, mount, loading, fmt, table, pager, modal, confirmDialog, toast, debounce, withBusy, field, $ } from '../core/ui.js';
import { initPortal } from '../core/layout.js';
import { schoolApi as api, ApiError } from '../core/api.js';

await initPortal({ portal: 'school', api, title: 'Send SMS' });
const page = document.getElementById('page');
loading(page);
const [prov, st] = await Promise.all([api.get('/provider'), api.get('/settings')]);
const settings = st.settings;
let idempotencyKey = crypto.randomUUID();
const selected = new Map();
let lastPreview = null; let previewSeq = 0;

if (!prov.config || !settings.preferredSenderId) {
  mount(page, h('h1', null, 'Send SMS'), h('div', { class: 'alert warn' }, !prov.config ? 'You need to choose your SMS provider and enter your API key before you can send. ' : 'You need to set your SMS sender ID before you can send. ', h('a', { href: '/school/settings.html' }, 'Go to Settings')));
} else build();

function build() {
  const text = h('textarea', { maxlength: 1000, placeholder: 'Dear Parent, this is to inform you that…', 'aria-label': 'Message text' });
  const sig = h('input', { type: 'checkbox', checked: settings.appendSignatureByDefault });
  const audAll = h('input', { type: 'radio', name: 'aud', value: 'all', checked: true });
  const audSel = h('input', { type: 'radio', name: 'aud', value: 'selected' });
  const pickBtn = h('button', { class: 'btn secondary sm hidden', type: 'button', onclick: pickParents }, 'Choose parents');
  const selInfo = h('span', { class: 'muted small' });
  const schedOn = h('input', { type: 'checkbox' });
  const when = h('input', { type: 'datetime-local', class: 'hidden' });
  const info = h('div'); const bubble = h('div', { class: 'bubble muted' }, 'Your message preview appears here.');
  const sendBtn = h('button', { class: 'btn', type: 'button', disabled: true }, 'Review & send');

  const audience = () => (audSel.checked ? { type: 'selected', parentIds: [...selected.keys()] } : { type: 'all' });
  const refreshSel = () => { selInfo.textContent = audSel.checked ? `${selected.size} selected` : ''; pickBtn.classList.toggle('hidden', !audSel.checked); };
  const doPreview = debounce(async () => {
    const seq = ++previewSeq;
    if (!text.value.trim() || (audSel.checked && !selected.size)) { lastPreview = null; sendBtn.disabled = true; mount(info, h('p', { class: 'muted' }, 'Type a message' + (audSel.checked && !selected.size ? ' and choose parents' : '') + ' to see recipients, segments and cost.')); return; }
    try {
      const p = await api.post('/messages/preview', { body: text.value, includeSignature: sig.checked, audience: audience() });
      if (seq !== previewSeq) return;
      lastPreview = p; sendBtn.disabled = !navigator.onLine || p.recipients === 0;
      mount(bubble, p.finalText); bubble.classList.remove('muted');
      mount(info, h('div', { class: 'cards' },
        h('div', { class: 'card stat' }, h('div', { class: 'label' }, 'Recipients'), h('div', { class: 'value' }, fmt.num(p.recipients))),
        h('div', { class: 'card stat' }, h('div', { class: 'label' }, 'SMS segments each'), h('div', { class: 'value' }, p.segmentsPerMessage), h('div', { class: 'sub' }, `${p.encoding} · ${p.characters} characters`)),
        h('div', { class: 'card stat' }, h('div', { class: 'label' }, 'Estimated cost'), h('div', { class: 'value' }, fmt.money(p.estimatedCost, p.currency)), h('div', { class: 'sub' }, `${fmt.num(p.totalSegments)} segments in total`))),
        p.encoding === 'UCS-2' ? h('div', { class: 'alert warn mt' }, 'This message contains special characters (such as emoji or curly quotes), so each SMS segment holds fewer characters and costs more.') : null,
        h('p', { class: 'hint' }, p.note));
    } catch (e) { if (seq === previewSeq) { lastPreview = null; sendBtn.disabled = true; mount(info, h('div', { class: 'alert bad' }, e.message)); } }
  }, 400);

  [text, sig, audAll, audSel].forEach((e) => e.addEventListener(e === text ? 'input' : 'change', () => { refreshSel(); doPreview(); }));
  schedOn.addEventListener('change', () => { when.classList.toggle('hidden', !schedOn.checked); sendBtn.textContent = schedOn.checked ? 'Review & schedule' : 'Review & send'; });

  function pickParents() {
    const body = h('div'); const state = { q: '', page: 1 };
    const box = h('div');
    const draw = async () => {
      loading(box);
      const r = await api.get('/parents', { q: state.q, page: state.page, limit: 10, status: 'active' });
      mount(box, table([
        { label: '', render: (p) => h('input', { type: 'checkbox', 'aria-label': `Select ${p.fullName}`, checked: selected.has(p.id), onchange: (e) => { e.target.checked ? selected.set(p.id, p.fullName) : selected.delete(p.id); cnt.textContent = `${selected.size} selected`; } }) },
        { label: 'Name', key: 'fullName' }, { label: 'Phone', render: (p) => p.phones.map((x) => x.number).join(', ') },
      ], r.items), pager(r.pagination, (pg) => { state.page = pg; draw(); }));
    };
    const cnt = h('strong', null, `${selected.size} selected`);
    mount(body, h('div', { class: 'toolbar' }, h('input', { class: 'search', type: 'search', placeholder: 'Search…', oninput: debounce((e) => { state.q = e.target.value; state.page = 1; draw(); }) }), cnt), box);
    const m = modal({ wide: true, title: 'Choose parents', body, footer: [h('button', { class: 'btn secondary', type: 'button', onclick: () => { selected.clear(); cnt.textContent = '0 selected'; draw(); } }, 'Clear'), h('button', { class: 'btn', type: 'button', onclick: () => m.close() }, 'Done')], onClose: () => { refreshSel(); doPreview(); } });
    draw();
  }

  sendBtn.addEventListener('click', async () => {
    if (!lastPreview) return;
    const p = lastPreview; const scheduled = schedOn.checked;
    let scheduledAt;
    if (scheduled) {
      if (!when.value) return toast('Choose a date and time to schedule', 'bad');
      scheduledAt = new Date(when.value).toISOString();
    }
    const ok = await confirmDialog({
      title: scheduled ? 'Schedule this message?' : 'Send this message?', confirmText: scheduled ? 'Schedule' : 'Send now', typeToConfirm: p.recipients >= 20 ? 'SEND' : '',
      message: scheduled ? `This will be sent on ${fmt.dateTime(scheduledAt)} to ${fmt.num(p.recipients)} recipient(s).` : `This will be sent to ${fmt.num(p.recipients)} recipient(s) right away. SMS cannot be recalled once sent.`,
      details: h('div', { class: 'stack' }, h('div', { class: 'bubble' }, p.finalText), h('div', { class: 'small muted' }, `Sender ID: ${p.senderId} · ${p.segmentsPerMessage} segment(s) each · estimated cost ${fmt.money(p.estimatedCost, p.currency)}`)),
    });
    if (!ok) return;
    await withBusy(sendBtn, async () => {
      try {
        const r = await api.post('/messages', { body: text.value, includeSignature: sig.checked, audience: audience(), scheduledAt, confirm: true, idempotencyKey, expectedRecipients: p.recipients });
        toast(scheduled ? 'Message scheduled' : 'Message queued. It is being sent in the background.', 'ok');
        idempotencyKey = crypto.randomUUID();
        location.href = `/school/messages.html?open=${r.message.id}`;
      } catch (e) {
        if (e instanceof ApiError && e.code === 'RECIPIENT_COUNT_CHANGED') { toast('The recipient list changed. Please review again.', 'bad'); doPreview(); } else throw e;
      }
    });
  });
  window.addEventListener('offline', () => { sendBtn.disabled = true; }); window.addEventListener('online', () => doPreview());

  mount(page, h('h1', null, 'Send SMS'),
    h('div', { class: 'grid-2' },
      h('div', { class: 'card stack' },
        h('h2', null, 'Compose'),
        field('Message', text), h('label', { class: 'check' }, sig, ` Add signature: "${settings.signature || '(none set)'}"`),
        h('div', { class: 'field' }, h('label', null, 'Send to'),
          h('div', { class: 'stack' }, h('label', { class: 'check' }, audAll, ' All active parents'), h('div', { class: 'row' }, h('label', { class: 'check' }, audSel, ' Selected parents'), pickBtn, selInfo))),
        h('div', { class: 'field' }, h('label', { class: 'check' }, schedOn, ' Schedule for later'), when, h('div', { class: 'hint' }, 'Times use your device\'s time zone.')),
        sendBtn),
      h('div', { class: 'stack' }, h('div', { class: 'card' }, h('h2', null, 'Preview'), bubble), h('div', { class: 'card' }, h('h2', null, 'Recipients & cost'), info))));
  mount(info, h('p', { class: 'muted' }, 'Type a message to see recipients, segments and cost.'));
}
void $;
