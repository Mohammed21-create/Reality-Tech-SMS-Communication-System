import { h, $, toast } from './ui.js';
import { setCsrf } from './api.js';
import { initPwa, watchOnline } from './pwa.js';

const ICONS = {
  home: 'M3 11l9-8 9 8v9a1 1 0 0 1-1 1h-5v-6H9v6H4a1 1 0 0 1-1-1z',
  users: 'M16 11a4 4 0 1 0-8 0 4 4 0 0 0 8 0zM4 21a8 8 0 0 1 16 0',
  student: 'M12 3L2 8l10 5 10-5zM6 11v5c0 1.5 2.7 3 6 3s6-1.5 6-3v-5',
  send: 'M22 2L11 13M22 2l-7 20-4-9-9-4z',
  list: 'M8 6h13M8 12h13M8 18h13M3 6h.01M3 12h.01M3 18h.01',
  chart: 'M4 20V10M10 20V4M16 20v-7M22 20H2',
  cog: 'M12 15a3 3 0 1 0 0-6 3 3 0 0 0 0 6zM19.4 15a1.7 1.7 0 0 0 .3 1.9l.1.1a2 2 0 1 1-2.8 2.8l-.1-.1a1.7 1.7 0 0 0-1.9-.3 1.7 1.7 0 0 0-1 1.5V21a2 2 0 1 1-4 0v-.1a1.7 1.7 0 0 0-1.1-1.5 1.7 1.7 0 0 0-1.9.3l-.1.1a2 2 0 1 1-2.8-2.8l.1-.1a1.7 1.7 0 0 0 .3-1.9 1.7 1.7 0 0 0-1.5-1H3a2 2 0 1 1 0-4h.1a1.7 1.7 0 0 0 1.5-1.1 1.7 1.7 0 0 0-.3-1.9l-.1-.1a2 2 0 1 1 2.8-2.8l.1.1a1.7 1.7 0 0 0 1.9.3H9a1.7 1.7 0 0 0 1-1.5V3a2 2 0 1 1 4 0v.1a1.7 1.7 0 0 0 1 1.5 1.7 1.7 0 0 0 1.9-.3l.1-.1a2 2 0 1 1 2.8 2.8l-.1.1a1.7 1.7 0 0 0-.3 1.9V9a1.7 1.7 0 0 0 1.5 1H21a2 2 0 1 1 0 4h-.1a1.7 1.7 0 0 0-1.5 1z',
  school: 'M3 21h18M5 21V8l7-5 7 5v13M9 21v-6h6v6',
  shield: 'M12 3l8 3v6c0 5-3.5 8-8 9-4.5-1-8-4-8-9V6z',
  pulse: 'M3 12h4l3-8 4 16 3-8h4',
};
function icon(name) {
  const NS = 'http://www.w3.org/2000/svg';
  const svg = document.createElementNS(NS, 'svg');
  svg.setAttribute('viewBox', '0 0 24 24'); svg.setAttribute('fill', 'none'); svg.setAttribute('stroke', 'currentColor');
  svg.setAttribute('stroke-width', '2'); svg.setAttribute('stroke-linecap', 'round'); svg.setAttribute('stroke-linejoin', 'round'); svg.setAttribute('aria-hidden', 'true');
  const p = document.createElementNS(NS, 'path'); p.setAttribute('d', ICONS[name] || ICONS.home); svg.append(p);
  return svg;
}

export const NAV = {
  school: [
    ['index.html', 'Dashboard', 'home'], ['compose.html', 'Send SMS', 'send'], ['messages.html', 'Message history', 'list'],
    ['parents.html', 'Parents', 'users'], ['students.html', 'Students', 'student'], ['reports.html', 'Reports', 'chart'], ['settings.html', 'Settings', 'cog'],
  ],
  admin: [
    ['index.html', 'Overview', 'home'], ['schools.html', 'Schools', 'school'], ['activity.html', 'Activity & security', 'shield'], ['system.html', 'System & settings', 'pulse'],
  ],
};

/**
 * Authenticates the page and wraps the existing <main class="page"> in the app shell.
 * @returns {Promise<{user, csrfToken, idleTimeoutMinutes}>}
 */
export async function initPortal({ portal, api, title }) {
  document.body.dataset.portal = portal;
  watchOnline();
  const me = await api.get('/auth/me');
  setCsrf(me.csrfToken);
  const base = portal === 'admin' ? '/admin/' : '/school/';
  const current = location.pathname.split('/').pop() || 'index.html';
  const loginUrl = portal === 'admin' ? '/admin/login.html' : '/login.html';

  const main = $('main.page');
  const logo = h('img', { src: portal === 'school' ? '/api/school/settings/logo' : '/assets/icons/icon-192.png', alt: '' });
  logo.addEventListener('error', () => { logo.src = '/assets/icons/icon-192.png'; }, { once: true });
  const installBtn = h('button', { class: 'btn secondary sm hidden', type: 'button' }, 'Install app');
  const logoutBtn = h('button', { class: 'btn secondary sm', type: 'button', onclick: () => doLogout(api, loginUrl) }, 'Sign out');
  const sidebar = h('aside', { class: 'sidebar', 'aria-label': 'Main navigation' },
    h('div', { class: 'brand' }, logo, h('div', null, portal === 'admin' ? 'Reality Tech' : (me.user.school ? me.user.school.name : 'School'), h('small', null, portal === 'admin' ? 'Platform administration' : 'School Communication'))),
    h('nav', { class: 'nav' }, NAV[portal].map(([href, label, ic]) => h('a', { href: base + href, class: current === href || (current === '' && href === 'index.html') ? 'active' : '', 'aria-current': current === href ? 'page' : null }, icon(ic), label))),
    h('div', { class: 'sidebar-foot' }, h('div', null, me.user.name), h('div', { class: 'small', style: null }, me.user.email)));
  const topbar = h('header', { class: 'topbar' },
    h('button', { class: 'btn secondary sm menu-btn', type: 'button', 'aria-label': 'Open menu', onclick: () => document.body.classList.toggle('nav-open') }, '☰'),
    h('div', { class: 'title' }, title), h('span', { class: 'net', id: 'net-status' }, 'Online'), installBtn, logoutBtn);
  const shell = h('div', { class: 'shell' }, sidebar, h('div', { class: 'scrim', onclick: () => document.body.classList.remove('nav-open') }),
    h('div', { class: 'main-col' }, h('div', { class: 'offline-banner', role: 'alert' }, 'You are offline. Sending and changes are disabled until you reconnect.'), topbar, main));
  document.body.prepend(shell);
  const net = $('#net-status');
  const syncNet = () => { net.textContent = navigator.onLine ? 'Online' : 'Offline'; };
  window.addEventListener('online', syncNet); window.addEventListener('offline', syncNet); syncNet();
  initPwa(installBtn);
  startIdleWatch(api, loginUrl, me.idleTimeoutMinutes);
  return me;
}

async function doLogout(api, loginUrl, reason) {
  try { await api.post('/auth/logout'); } catch { /* ignore */ }
  setCsrf('');
  location.href = loginUrl + (reason ? `?reason=${reason}` : '');
}

/** Sign out after prolonged inactivity; keep the server session alive while the user is active. */
function startIdleWatch(api, loginUrl, idleMinutes = 30) {
  const limit = idleMinutes * 60 * 1000;
  let last = Date.now(); let warned = false; let lastPing = Date.now();
  const bump = () => { last = Date.now(); warned = false; };
  ['mousemove', 'keydown', 'click', 'touchstart', 'scroll'].forEach((e) => window.addEventListener(e, bump, { passive: true }));
  setInterval(() => {
    const idle = Date.now() - last;
    if (idle >= limit) { doLogout(api, loginUrl, 'idle'); return; }
    if (!warned && idle >= limit - 60000) { warned = true; toast('You will be signed out in 1 minute due to inactivity.'); }
    if (idle < 60000 && Date.now() - lastPing > 5 * 60 * 1000 && navigator.onLine) { lastPing = Date.now(); api.get('/auth/me').catch(() => {}); }
  }, 15000);
}
