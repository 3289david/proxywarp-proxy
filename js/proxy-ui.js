'use strict';

const ProxyUI = {

  init() {
    this.tickClock();
    setInterval(() => this.tickClock(), 10000);
    this.initFromParams();
    this.checkPuterAuth();

    document.addEventListener('keydown', (e) => {
      if ((e.ctrlKey || e.metaKey) && e.key === 'l') {
        e.preventDefault();
        document.getElementById('addr-input')?.select();
      }
      if ((e.ctrlKey || e.metaKey) && e.key === 'r') {
        e.preventDefault();
        doRefresh();
      }
      if ((e.ctrlKey || e.metaKey) && e.key === 't') {
        e.preventDefault();
        showNewTab();
      }
    });
  },

  tickClock() {
    const now  = new Date();
    const time = now.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });
    const date = now.toLocaleDateString([], { weekday: 'long', month: 'long', day: 'numeric' });
    const el = document.getElementById('nt-time');
    const dl = document.getElementById('nt-date');
    const sb = document.getElementById('sb-time');
    if (el) el.textContent = time;
    if (dl) dl.textContent = date;
    if (sb) sb.textContent = time;
  },

  initFromParams() {
    const p = new URLSearchParams(location.search);
    let url = p.get('url');
    if (!url) return;

    try { url = p.get('enc') === '1' ? atob(url) : decodeURIComponent(url); } catch(_) {}

    if (p.get('cookies') === '1') ck('opt-cookies', true);
    if (p.get('scripts') === '0') ck('opt-scripts', false);
    if (p.get('ads')     === '1') ck('opt-ads',     true);

    setTimeout(() => ProxyEngine.navigate(url), 80);
  },

  setLoading(on, url) {
    show('loading',    on);
    show('newtab',     false);
    show('err-screen', false);
    if (on && url) {
      let d = url; try { d = new URL(url).hostname; } catch(_) {}
      txt('load-text', 'Fetching ' + d + '...');
      document.getElementById('proxy-frame').style.display = 'none';
    } else {
      const icon = document.getElementById('icon-refresh');
      if (icon) icon.style.animation = '';
    }
  },

  showError(url, msg) {
    show('loading', false);
    show('newtab',  false);
    show('err-screen', true);
    document.getElementById('proxy-frame').style.display = 'none';
    let d = url; try { d = new URL(url).hostname; } catch(_) {}
    txt('err-title', 'Could not load ' + d);
    txt('err-msg',   friendly(msg));
  },

  updateAddr(url) {
    const input = document.getElementById('addr-input');
    if (input) input.value = url;
    let d = 'Unknown'; try { d = new URL(url).hostname; } catch(_) {}
    txt('sb-domain', d);
    document.title = d + ' — ProxyWarp';

    const lock = document.getElementById('addr-lock');
    if (lock) lock.style.color = url.startsWith('https') ? 'var(--text-3)' : 'rgba(255,180,0,0.5)';
  },

  _prog: null, _pval: 0,

  startProgress() {
    let bar = document.getElementById('progress');
    if (!bar) {
      bar = document.createElement('div');
      bar.id = 'progress'; bar.className = 'progress'; bar.style.width = '0%';
      document.body.appendChild(bar);
    }
    this._pval = 0;
    clearInterval(this._prog);
    this._prog = setInterval(() => {
      this._pval = Math.min(90, this._pval + (90 - this._pval) * 0.08);
      const b = document.getElementById('progress');
      if (b) b.style.width = this._pval + '%';
    }, 100);
  },

  stopProgress() {
    clearInterval(this._prog);
    const b = document.getElementById('progress');
    if (b) { b.style.width = '100%'; setTimeout(() => b.remove(), 300); }
  },

  async checkPuterAuth() {
    try {
      if (await puter.auth.isSignedIn()) {
        const u = await puter.auth.getUser();
        txt('sb-user', u.username);
        await this.loadPrefs();
      }
    } catch(_) {}
  },

  async loadPrefs() {
    try {
      const raw = await puter.kv.get('proxywarp_prefs');
      if (!raw) return;
      const pr = JSON.parse(raw);
      const m = { allowCookies:'opt-cookies', sendReferrer:'opt-referrer',
        enableScripts:'opt-scripts', blockAds:'opt-ads',
        loadImages:'opt-images', spoofUA:'opt-ua', encodeUrl:'opt-encode' };
      for (const [k, id] of Object.entries(m))
        if (pr[k] !== undefined) ck(id, pr[k]);
    } catch(_) {}
  },

  toast(msg) {
    const t = document.createElement('div');
    Object.assign(t.style, {
      position:'fixed', bottom:'34px', left:'50%', transform:'translateX(-50%)',
      background:'var(--bg-2)', border:'1px solid var(--border-hi)',
      borderRadius:'5px', padding:'7px 14px', fontSize:'11px', color:'var(--text)',
      zIndex:'9999', pointerEvents:'none',
    });
    t.textContent = msg;
    document.body.appendChild(t);
    setTimeout(() => t.remove(), 2200);
  },
};

/* ── Helpers ── */
function show(id, on) {
  const el = document.getElementById(id);
  if (!el) return;
  if (on) el.style.display = '';  // restore natural display
  else el.style.display = 'none';
}
function txt(id, t) { const el = document.getElementById(id); if (el) el.textContent = t; }
function ck(id, v)  { const el = document.getElementById(id); if (el) el.checked = v; }

function friendly(msg) {
  if (!msg) return 'Unknown error.';
  if (/fetch|network/i.test(msg)) return 'Network error — Puter could not reach this server.';
  if (msg.includes('403')) return 'Access denied (403). This site blocked proxy access.';
  if (msg.includes('404')) return 'Page not found (404).';
  if (/timeout|timed/i.test(msg)) return 'Request timed out.';
  return msg;
}

/* ── Proxy controls ── */
function navigateTo() {
  const raw = document.getElementById('addr-input')?.value?.trim();
  if (!raw) return;
  const looksLikeUrl = /^https?:\/\//i.test(raw) || /^[\w-]+\.[\w.]+/.test(raw);
  const url = looksLikeUrl
    ? (/^https?:\/\//i.test(raw) ? raw : 'https://' + raw)
    : 'https://duckduckgo.com/html/?q=' + encodeURIComponent(raw);
  ProxyEngine.navigate(url);
}

function histBack()    { ProxyEngine.back(); }
function histForward() { ProxyEngine.forward(); }

function doRefresh() {
  if (ProxyEngine.currentUrl) ProxyEngine.navigate(ProxyEngine.currentUrl, false);
  else showNewTab();
}

function showNewTab() {
  show('newtab', true);
  show('loading', false);
  show('err-screen', false);
  document.getElementById('proxy-frame').style.display = 'none';
  const ai = document.getElementById('addr-input');
  if (ai) ai.value = '';
  txt('sb-domain', 'New tab');
  document.title = 'ProxyWarp';
  setTimeout(() => document.getElementById('nt-input')?.focus(), 50);
}

function toggleOpts() {
  document.getElementById('opts-drawer')?.classList.toggle('open');
}

async function savePrefs() {
  try {
    if (!await puter.auth.isSignedIn()) await puter.auth.signIn();
    const prefs = {
      allowCookies:  !!document.getElementById('opt-cookies')?.checked,
      sendReferrer:  !!document.getElementById('opt-referrer')?.checked,
      enableScripts: !!document.getElementById('opt-scripts')?.checked,
      blockAds:      !!document.getElementById('opt-ads')?.checked,
      loadImages:    !!document.getElementById('opt-images')?.checked,
      spoofUA:       !!document.getElementById('opt-ua')?.checked,
      encodeUrl:     !!document.getElementById('opt-encode')?.checked,
    };
    await puter.kv.set('proxywarp_prefs', JSON.stringify(prefs));
    ProxyUI.toast('Preferences saved');
  } catch(e) { ProxyUI.toast('Error: ' + e.message); }
}

function clearHist() {
  ProxyEngine.history = [];
  ProxyEngine.historyIndex = -1;
  ProxyEngine.updateNavBtns();
  ProxyUI.toast('History cleared');
}

/* ── New tab search ── */
function ntSearch(e) {
  e.preventDefault();
  const raw = document.getElementById('nt-input')?.value?.trim();
  if (!raw) return;
  const looksLikeUrl = /^https?:\/\//i.test(raw) || /^[\w-]+\.[\w.]+/.test(raw);
  const url = looksLikeUrl
    ? (/^https?:\/\//i.test(raw) ? raw : 'https://' + raw)
    : 'https://duckduckgo.com/html/?q=' + encodeURIComponent(raw);
  ProxyEngine.navigate(url);
}

function ntNav(url) { ProxyEngine.navigate(url); }

/* ── Boot ── */
document.addEventListener('DOMContentLoaded', () => ProxyUI.init());
