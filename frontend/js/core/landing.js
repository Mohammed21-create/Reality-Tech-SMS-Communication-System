import { initPwa } from './pwa.js';
initPwa(null);
const retry = document.getElementById('retry');
if (retry) retry.addEventListener('click', () => location.reload());
