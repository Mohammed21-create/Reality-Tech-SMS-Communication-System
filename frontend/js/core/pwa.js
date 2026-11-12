// Service worker registration + install prompt. The service worker never touches /api requests.
let deferred = null;
export function initPwa(installBtn) {
  if ('serviceWorker' in navigator) window.addEventListener('load', () => navigator.serviceWorker.register('/service-worker.js').catch(() => {}));
  window.addEventListener('beforeinstallprompt', (e) => { e.preventDefault(); deferred = e; if (installBtn) installBtn.classList.remove('hidden'); });
  window.addEventListener('appinstalled', () => { deferred = null; if (installBtn) installBtn.classList.add('hidden'); });
  const ios = /iphone|ipad|ipod/i.test(navigator.userAgent) && !window.navigator.standalone;
  if (installBtn && ios) installBtn.classList.remove('hidden');
  if (installBtn) installBtn.addEventListener('click', async () => {
    if (deferred) { deferred.prompt(); await deferred.userChoice; deferred = null; installBtn.classList.add('hidden'); }
    else alert('To install on iPhone/iPad: tap the Share button, then "Add to Home Screen".');
  });
}
export function watchOnline() {
  const set = () => document.body.classList.toggle('offline', !navigator.onLine);
  window.addEventListener('online', set); window.addEventListener('offline', set); set();
}
