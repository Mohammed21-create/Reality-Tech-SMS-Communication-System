import { h, mount, loading, fmt, toast, withBusy, field, confirmDialog, badge, $ } from '../core/ui.js';
import { initPortal } from '../core/layout.js';
import { schoolApi as api, setCsrf } from '../core/api.js';

const me = await initPortal({ portal: 'school', api, title: 'Settings' });
const page = document.getElementById('page');
const body = h('div');
const tabs = [['profile', 'School profile'], ['provider', 'SMS provider'], ['account', 'My account']];
let active = new URLSearchParams(location.search).get('tab') || 'profile';
const tabBar = h('div', { class: 'tabs', role: 'tablist' });
mount(page, h('h1', null, 'Settings'), tabBar, body);
function drawTabs() {
  mount(tabBar, tabs.map(([k, l]) => h('button', { role: 'tab', class: k === active ? 'active' : '', onclick: () => { active = k; drawTabs(); render(); } }, l)));
}
async function render() { loading(body); try { await ({ profile, provider, account })[active](); } catch (e) { mount(body, h('div', { class: 'alert bad' }, e.message)); } }

async function profile() {
  const { settings: s } = await api.get('/settings');
  const f = {
    displayName: h('input', { value: s.displayName || s.schoolName, maxlength: 150 }), contactPhone: h('input', { value: s.contactPhone, maxlength: 30, inputmode: 'tel' }),
    contactEmail: h('input', { type: 'email', value: s.contactEmail, maxlength: 254 }), address: h('input', { value: s.address, maxlength: 300 }),
    website: h('input', { value: s.website, placeholder: 'https://', maxlength: 200 }), preferredSenderId: h('input', { value: s.preferredSenderId, maxlength: 11, placeholder: 'e.g. ABCSCHOOL' }),
    signature: h('input', { value: s.signature, maxlength: 160, placeholder: '- ABC International School' }),
  };
  const append = h('input', { type: 'checkbox', checked: s.appendSignatureByDefault });
  const save = h('button', { class: 'btn', type: 'button' }, 'Save settings');
  const logoImg = h('img', { class: `logo-preview ${s.hasLogo ? '' : 'hidden'}`, alt: 'School logo', src: s.hasLogo ? `/api/school/settings/logo?t=${Date.now()}` : '' });
  const file = h('input', { type: 'file', accept: 'image/png,image/jpeg,image/webp' });
  save.addEventListener('click', () => withBusy(save, async () => {
    await api.put('/settings', { ...Object.fromEntries(Object.entries(f).map(([k, el]) => [k, el.value])), appendSignatureByDefault: append.checked });
    toast('Settings saved', 'ok');
  }));
  mount(body, h('div', { class: 'grid-2' },
    h('div', { class: 'card' }, h('h2', null, 'School information'),
      h('div', { class: 'form-grid' }, field('School name (shown in messages)', f.displayName), field('Contact phone', f.contactPhone), field('Contact email', f.contactEmail), field('Website (optional)', f.website)),
      field('Address', f.address),
      h('h2', { class: 'mt' }, 'Message settings'),
      field('SMS sender ID', f.preferredSenderId, '3-11 letters or numbers, no spaces. Your SMS provider may need to approve it first.'),
      field('Default message signature', f.signature, 'Added to the end of each message, e.g. "Thank you. - ABC International School".'),
      h('label', { class: 'check mb' }, append, ' Add the signature to new messages by default'), save),
    h('div', { class: 'card' }, h('h2', null, 'School logo'), logoImg, h('p', { class: 'hint' }, 'PNG, JPG or WebP, up to 300 KB.'), file,
      h('div', { class: 'row mt' },
        h('button', { class: 'btn secondary', type: 'button', onclick: (e) => withBusy(e.target, async () => { if (!file.files[0]) throw new Error('Choose an image first'); const fd = new FormData(); fd.append('logo', file.files[0]); await api.upload('/settings/logo', fd); logoImg.src = `/api/school/settings/logo?t=${Date.now()}`; logoImg.classList.remove('hidden'); toast('Logo uploaded', 'ok'); }) }, 'Upload logo'),
        h('button', { class: 'btn ghost', type: 'button', onclick: (e) => withBusy(e.target, async () => { await api.del('/settings/logo'); logoImg.classList.add('hidden'); toast('Logo removed', 'ok'); }) }, 'Remove')))));
}

async function provider() {
  const [{ providers }, { config }] = await Promise.all([api.get('/provider/types'), api.get('/provider')]);
  const sel = h('select', null, !config ? h('option', { value: '' }, 'Choose a provider…') : null, providers.map((p) => h('option', { value: p.id, selected: config && config.provider === p.id }, p.label)));
  const fieldsBox = h('div'); const cost = h('input', { type: 'number', min: 0, step: '0.0001', value: config ? config.costPerSegment : '' });
  const cur = h('input', { value: config ? config.currency : 'GHS', maxlength: 5 });
  const active = h('input', { type: 'checkbox', checked: config ? config.isActive : true });
  const inputs = {};
  const drawFields = () => {
    const p = providers.find((x) => x.id === sel.value); mount(fieldsBox);
    if (!p) return;
    p.fields.forEach((fd) => {
      const hint = config && config.provider === p.id && config.credentialHints[fd.key];
      const el = fd.options ? h('select', null, fd.options.map((o) => h('option', { value: o }, o))) : h('input', { type: fd.secret ? 'password' : 'text', autocomplete: 'off', placeholder: hint ? `${hint} (saved - leave blank to keep)` : '' });
      inputs[fd.key] = el; fieldsBox.append(field(fd.label + (fd.required ? '' : ' (optional)'), el, fd.secret ? 'Stored encrypted. It is never shown again after saving.' : ''));
    });
  };
  sel.addEventListener('change', drawFields); drawFields();
  const result = h('div', { class: 'mt' });
  const save = h('button', { class: 'btn', type: 'button' }, 'Save provider settings');
  save.addEventListener('click', () => withBusy(save, async () => {
    const credentials = Object.fromEntries(Object.entries(inputs).map(([k, el]) => [k, el.value]));
    await api.put('/provider', { provider: sel.value, credentials, costPerSegment: cost.value, currency: cur.value, isActive: active.checked });
    toast('Provider saved. Use "Test connection" to check it.', 'ok'); provider2();
  }));
  const provider2 = () => render();
  const webhook = config && config.webhookUrl ? h('div', { class: 'card mt' }, h('h2', null, 'Delivery reports (webhook)'),
    h('p', { class: 'small' }, 'If your provider supports delivery-report callbacks, paste this private URL into your provider dashboard. Keep it secret.'),
    h('input', { readonly: true, value: config.webhookUrl, class: 'mono', 'aria-label': 'Webhook URL', onfocus: (e) => e.target.select() }),
    h('div', { class: 'row mt' }, h('button', { class: 'btn secondary sm', onclick: () => navigator.clipboard.writeText(config.webhookUrl).then(() => toast('Copied', 'ok')) }, 'Copy'),
      h('button', { class: 'btn ghost sm', onclick: async () => { if (await confirmDialog({ title: 'Create a new URL?', message: 'The old URL will stop working. You must update it in your provider dashboard.', confirmText: 'Create new URL' })) { await api.post('/provider/webhook-token'); toast('New URL created', 'ok'); render(); } } }, 'Regenerate'))) : null;
  mount(body, h('div', { class: 'grid-2' },
    h('div', { class: 'card' }, h('h2', null, 'Your SMS provider'),
      h('p', { class: 'muted small' }, 'Your school uses its own SMS provider account and pays the provider directly. Reality Tech never sees your SMS credit.'),
      field('Provider', sel), fieldsBox, h('div', { class: 'form-grid' }, field('Your cost per SMS segment', cost, 'Used only for estimates.'), field('Currency', cur)),
      h('label', { class: 'check mb' }, active, ' Provider switched on'), save),
    h('div', { class: 'stack' },
      h('div', { class: 'card' }, h('h2', null, 'Connection & balance'),
        config ? h('div', { class: 'stack' },
          h('div', null, 'Last test: ', config.lastTestAt ? [badge(config.lastTestOk ? 'Connected' : 'Failed', config.lastTestOk ? 'ok' : 'bad'), ` ${fmt.dateTime(config.lastTestAt)}`, config.lastTestMessage ? h('div', { class: 'small muted' }, config.lastTestMessage) : null] : 'never'),
          config.lastBalance ? h('div', null, 'Balance: ', h('strong', null, `${fmt.num(config.lastBalance.amount)} ${config.lastBalance.unit}`), h('span', { class: 'small muted' }, ` (checked ${fmt.dateTime(config.lastBalance.checkedAt)})`)) : null,
          h('div', { class: 'row' }, h('button', { class: 'btn secondary', onclick: (e) => withBusy(e.target, async () => { const r = await api.post('/provider/test'); toast(r.message, r.ok ? 'ok' : 'bad'); render(); }) }, 'Test connection'),
            h('button', { class: 'btn secondary', onclick: (e) => withBusy(e.target, async () => { const r = await api.get('/provider/balance'); toast(r.supported ? `Balance: ${fmt.num(r.amount)} ${r.unit}` : r.message, r.supported ? 'ok' : ''); render(); }) }, 'Check balance')), result)
          : h('p', { class: 'muted' }, 'Save your provider settings first.')),
      webhook)));
}

async function account() {
  const cur = h('input', { type: 'password', autocomplete: 'current-password' }); const n1 = h('input', { type: 'password', autocomplete: 'new-password' }); const n2 = h('input', { type: 'password', autocomplete: 'new-password' });
  const btn = h('button', { class: 'btn', type: 'button' }, 'Change password');
  btn.addEventListener('click', () => withBusy(btn, async () => {
    if (n1.value !== n2.value) throw new Error('The new passwords do not match');
    const r = await api.post('/auth/change-password', { currentPassword: cur.value, newPassword: n1.value });
    setCsrf(r.csrfToken); cur.value = n1.value = n2.value = ''; toast('Password changed', 'ok');
  }));
  mount(body, h('div', { class: 'card', style: null }, h('h2', null, 'Signed in as'), h('p', null, `${me.user.name} · ${me.user.email}`), h('h2', { class: 'mt' }, 'Change password'),
    field('Current password', cur), field('New password', n1, 'At least 10 characters with letters and numbers.'), field('Confirm new password', n2), btn));
  body.firstChild.style.maxWidth = '480px';
}
drawTabs(); render();
void $;
