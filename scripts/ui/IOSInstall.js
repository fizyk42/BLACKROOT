const IOS_RE = /iPad|iPhone|iPod/;

function isIOS() {
  return IOS_RE.test(navigator.userAgent) || (navigator.platform === 'MacIntel' && navigator.maxTouchPoints > 1);
}

function isStandalone() {
  return window.matchMedia?.('(display-mode: standalone)').matches || navigator.standalone === true;
}

function addStyle() {
  if (document.getElementById('br-ios-install-style')) return;
  const style = document.createElement('style');
  style.id = 'br-ios-install-style';
  style.textContent = `
    .br-ios-install-btn { margin-top: 10px !important; border-color: rgba(210,225,235,.42) !important; }
    .br-ios-install-btn::after { content: 'iPhone / iPad'; float: right; opacity: .5; font-size: .7em; }
    #br-ios-installer { position: fixed; inset: 0; z-index: 10000; display: none; place-items: center; padding: 20px; background: rgba(0,0,0,.82); backdrop-filter: blur(10px); -webkit-backdrop-filter: blur(10px); }
    #br-ios-installer.open { display: grid; }
    .br-ios-card { width: min(520px, 92vw); max-height: 88vh; overflow: auto; background: #090c0f; border: 1px solid rgba(230,240,245,.2); box-shadow: 0 24px 80px rgba(0,0,0,.65); padding: 26px; color: #e8edef; font-family: system-ui, -apple-system, sans-serif; }
    .br-ios-card h2 { margin: 0 0 6px; font-size: 28px; letter-spacing: .04em; }
    .br-ios-card .sub { opacity: .62; margin-bottom: 22px; }
    .br-ios-step { display: grid; grid-template-columns: 34px 1fr; gap: 12px; align-items: start; margin: 14px 0; }
    .br-ios-num { width: 30px; height: 30px; border: 1px solid rgba(255,255,255,.24); border-radius: 50%; display: grid; place-items: center; font-weight: 800; }
    .br-ios-step b { display: block; margin-bottom: 3px; }
    .br-ios-step span { opacity: .72; line-height: 1.35; }
    .br-ios-actions { display: flex; gap: 10px; margin-top: 22px; flex-wrap: wrap; }
    .br-ios-actions button { flex: 1 1 180px; min-height: 46px; border: 1px solid rgba(255,255,255,.25); background: #111820; color: #fff; font-weight: 800; letter-spacing: .04em; }
    .br-ios-actions button.primary { background: #e8edef; color: #07090b; }
    .br-ios-installed { padding: 16px; border: 1px solid rgba(140,220,170,.28); background: rgba(80,150,100,.08); line-height: 1.45; }
    @media (max-width: 680px) { .br-ios-card { padding: 20px; } .br-ios-card h2 { font-size: 23px; } }
  `;
  document.head.appendChild(style);
}

function ensureManifest() {
  if (!document.querySelector('link[rel="manifest"]')) {
    const link = document.createElement('link');
    link.rel = 'manifest';
    link.href = 'manifest.webmanifest';
    document.head.appendChild(link);
  }
}

function makeModal() {
  if (document.getElementById('br-ios-installer')) return document.getElementById('br-ios-installer');
  const wrap = document.createElement('div');
  wrap.id = 'br-ios-installer';
  wrap.setAttribute('role', 'dialog');
  wrap.setAttribute('aria-modal', 'true');
  wrap.innerHTML = `
    <div class="br-ios-card">
      <h2>INSTALL BLACKROOT ON iOS</h2>
      <div class="sub">Full-screen iPhone / iPad web app with BLACKROOT touch controls.</div>
      <div class="br-ios-content"></div>
      <div class="br-ios-actions">
        <button type="button" class="primary" data-ios-action="share">OPEN SHARE MENU</button>
        <button type="button" data-ios-action="close">CLOSE</button>
      </div>
    </div>`;
  document.body.appendChild(wrap);
  wrap.addEventListener('click', async (e) => {
    const action = e.target?.dataset?.iosAction;
    if (action === 'close' || e.target === wrap) wrap.classList.remove('open');
    if (action === 'share') {
      try {
        if (navigator.share) await navigator.share({ title: 'BLACKROOT', text: 'Install BLACKROOT on iPhone or iPad', url: location.href });
      } catch (_) {}
    }
  });
  return wrap;
}

function fillModal(modal) {
  const content = modal.querySelector('.br-ios-content');
  const share = modal.querySelector('[data-ios-action="share"]');
  if (isStandalone()) {
    content.innerHTML = `<div class="br-ios-installed"><b>BLACKROOT is installed.</b><br>Launch it from your Home Screen for the full-screen iOS experience.</div>`;
    share.style.display = 'none';
    return;
  }
  share.style.display = '';
  if (!isIOS()) {
    content.innerHTML = `<div class="br-ios-installed"><b>Open this page on an iPhone or iPad.</b><br>Then tap INSTALL ON iOS and follow the Apple Home Screen installation steps.</div>`;
    return;
  }
  content.innerHTML = `
    <div class="br-ios-step"><div class="br-ios-num">1</div><div><b>Open in Safari</b><span>Apple installs Home Screen web apps through Safari.</span></div></div>
    <div class="br-ios-step"><div class="br-ios-num">2</div><div><b>Tap Share</b><span>Use the Share button in Safari. You can also tap OPEN SHARE MENU below.</span></div></div>
    <div class="br-ios-step"><div class="br-ios-num">3</div><div><b>Choose “Add to Home Screen”</b><span>Scroll the share sheet if you do not see it immediately.</span></div></div>
    <div class="br-ios-step"><div class="br-ios-num">4</div><div><b>Tap Add</b><span>BLACKROOT will appear on your Home Screen and launch full screen like an installed game.</span></div></div>`;
}

export function installIOSInstallerUI() {
  addStyle();
  ensureManifest();
  const modal = makeModal();

  const addButton = () => {
    const nav = document.querySelector('#mainmenu .menu-nav');
    if (!nav || nav.querySelector('[data-action="install-ios"]')) return false;
    const button = document.createElement('button');
    button.className = 'mbtn br-ios-install-btn';
    button.dataset.action = 'install-ios';
    button.textContent = isStandalone() ? 'iOS INSTALLED' : 'INSTALL ON iOS';
    button.addEventListener('click', (e) => {
      e.preventDefault();
      e.stopPropagation();
      fillModal(modal);
      modal.classList.add('open');
    });
    nav.appendChild(button);
    return true;
  };

  if (!addButton()) {
    const observer = new MutationObserver(() => { if (addButton()) observer.disconnect(); });
    observer.observe(document.documentElement, { childList: true, subtree: true });
  }

  if ('serviceWorker' in navigator && /^https?:$/.test(location.protocol)) {
    navigator.serviceWorker.register('./service-worker.js').catch(() => {});
  }
}
