'use strict';

/* ─── Why some famous sites still block us ────────────────────────────────
 * browser.js (HeyPuter) is a full service-worker proxy — it intercepts every
 * sub-request (CSS, JS, XHR, images). We use puter.net.fetch() which only
 * fetches the initial document; Puter's server IPs are also known data-center
 * ranges some sites (Google, Cloudflare-protected) actively block.
 * What we CAN fix: send a complete, realistic browser header set, follow
 * redirects to the real final URL, rewrite meta-refresh, handle srcset, etc.
 * ─────────────────────────────────────────────────────────────────────── */

/* ─── Ad / Tracker domains ── */
const AD_DOMAINS = new Set([
  'doubleclick.net','googleadservices.com','googlesyndication.com',
  'adnxs.com','connect.facebook.net','scorecardresearch.com','quantserve.com',
  'taboola.com','outbrain.com','criteo.com','adsrvr.org','pubmatic.com',
  'openx.net','rubiconproject.com','appnexus.com','media.net','yieldmo.com',
  'indexexchange.com','smartadserver.com','amazon-adsystem.com','adroll.com',
  'moatads.com','revcontent.com','advertising.com',
  'google-analytics.com','analytics.google.com','hotjar.com','fullstory.com',
  'segment.com','segment.io','mixpanel.com','amplitude.com','heap.io',
  'mouseflow.com','clicktale.com','pixel.facebook.com',
]);

/* ─── Realistic browser headers sent with every request ── */
const BROWSER_HEADERS = {
  'Accept':           'text/html,application/xhtml+xml,application/xml;q=0.9,image/avif,image/webp,image/apng,*/*;q=0.8',
  'Accept-Language':  'en-US,en;q=0.9',
  'Accept-Encoding':  'gzip, deflate, br',
  'Cache-Control':    'no-cache',
  'Pragma':           'no-cache',
  'Upgrade-Insecure-Requests': '1',
  'Sec-Fetch-Dest':   'document',
  'Sec-Fetch-Mode':   'navigate',
  'Sec-Fetch-Site':   'none',
  'Sec-Fetch-User':   '?1',
  'DNT':              '1',
};

const SPOOFED_UA = 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/125.0.0.0 Safari/537.36';

/* ─── State ── */
const ProxyEngine = {
  history: [],
  historyIndex: -1,
  currentUrl: null,

  getOptions() {
    const g = id => document.getElementById(id)?.checked ?? false;
    return {
      allowCookies:  g('opt-cookies'),
      sendReferrer:  g('opt-referrer'),
      enableScripts: document.getElementById('opt-scripts')?.checked ?? true,
      blockAds:      g('opt-ads'),
      loadImages:    document.getElementById('opt-images')?.checked ?? true,
      spoofUA:       g('opt-ua'),
    };
  },

  pushHistory(url) {
    if (this.historyIndex < this.history.length - 1)
      this.history = this.history.slice(0, this.historyIndex + 1);
    this.history.push(url);
    this.historyIndex++;
    this.updateNavBtns();
  },

  back() {
    if (this.historyIndex > 0) {
      this.historyIndex--;
      this.navigate(this.history[this.historyIndex], false);
    }
  },

  forward() {
    if (this.historyIndex < this.history.length - 1) {
      this.historyIndex++;
      this.navigate(this.history[this.historyIndex], false);
    }
  },

  updateNavBtns() {
    const b = document.getElementById('btn-back');
    const f = document.getElementById('btn-fwd');
    if (b) b.disabled = this.historyIndex <= 0;
    if (f) f.disabled = this.historyIndex >= this.history.length - 1;
  },

  async navigate(rawUrl, addToHistory = true) {
    let url = rawUrl.trim();
    if (!url) return;
    try { const d = atob(url); if (d.startsWith('http')) url = d; } catch(_) {}
    if (!/^https?:\/\//i.test(url)) url = 'https://' + url;

    this.currentUrl = url;
    if (addToHistory) this.pushHistory(url);

    ProxyUI.updateAddr(url);
    ProxyUI.setLoading(true, url);
    ProxyUI.startProgress();

    try {
      const { html, finalUrl } = await this.fetchViaProxy(url);
      if (finalUrl && finalUrl !== url) {
        this.currentUrl = finalUrl;
        ProxyUI.updateAddr(finalUrl);
        if (addToHistory) this.pushHistory(finalUrl);
      }
      const rewritten = this.rewriteHtml(html, finalUrl || url);
      this.renderContent(rewritten);
      ProxyUI.setLoading(false);
      ProxyUI.stopProgress();
    } catch (err) {
      console.error('[ProxyWarp]', err);
      ProxyUI.setLoading(false);
      ProxyUI.stopProgress();
      ProxyUI.showError(url, err.message);
    }
  },

  async fetchViaProxy(url) {
    const opts = this.getOptions();

    const headers = {
      ...BROWSER_HEADERS,
      'User-Agent': opts.spoofUA ? SPOOFED_UA : SPOOFED_UA, // always send realistic UA
    };

    if (opts.sendReferrer) {
      try { headers['Referer'] = new URL(url).origin; } catch(_) {}
    }

    const response = await puter.net.fetch(url, {
      method: 'GET',
      headers,
      credentials: opts.allowCookies ? 'include' : 'omit',
      redirect: 'follow',
    });

    /* Track the final URL after redirect chain */
    const finalUrl = response.url && response.url !== url ? response.url : url;

    if (!response.ok && response.status !== 304) {
      const text = await response.text().catch(() => '');
      if (!text) throw new Error(`HTTP ${response.status} from ${new URL(url).hostname}. This site may actively block proxy access.`);
      return { html: text, finalUrl };
    }

    const html = await response.text();
    return { html, finalUrl };
  },

  rewriteHtml(html, baseUrl) {
    const opts = this.getOptions();
    try {
      const parser = new DOMParser();
      const doc = parser.parseFromString(html, 'text/html');

      /* Remove security headers that break rendering in iframe */
      doc.querySelectorAll(
        'meta[http-equiv="Content-Security-Policy"],' +
        'meta[http-equiv="X-Frame-Options"],' +
        'meta[http-equiv="X-Content-Type-Options"]'
      ).forEach(m => m.remove());

      /* Handle <meta http-equiv="refresh"> redirects */
      doc.querySelectorAll('meta[http-equiv="refresh"]').forEach(m => {
        const content = m.getAttribute('content') || '';
        const match = content.match(/url=(.+)/i);
        if (match) {
          try {
            const target = new URL(match[1].replace(/['";]/g, '').trim(), baseUrl).href;
            m.setAttribute('content', `0;url=proxy.html?url=${encodeURIComponent(target)}`);
          } catch(_) {}
        }
      });

      /* Set a <base> so relative resources load from the right origin */
      let base = doc.querySelector('base');
      if (!base) { base = doc.createElement('base'); doc.head.prepend(base); }
      base.href = baseUrl;

      /* Inject interceptor before anything else runs */
      const s = doc.createElement('script');
      s.textContent = this.interceptorScript(baseUrl);
      doc.head.prepend(s);

      /* Rewrite <a href> */
      doc.querySelectorAll('a[href]').forEach(a => {
        const rw = this.toProxyUrl(a.getAttribute('href'), baseUrl);
        if (rw) a.setAttribute('href', rw);
        a.setAttribute('target', '_self'); // keep inside proxy frame
      });

      /* Rewrite <form action> */
      doc.querySelectorAll('form[action]').forEach(f => {
        const rw = this.toProxyUrl(f.getAttribute('action'), baseUrl);
        if (rw) f.setAttribute('action', rw);
      });

      /* Rewrite <img src> + srcset */
      if (!opts.loadImages) {
        doc.querySelectorAll('img,picture,source').forEach(el => el.remove());
      } else {
        doc.querySelectorAll('img[src]').forEach(img => {
          const src = img.getAttribute('src');
          if (src && !src.startsWith('data:'))
            try { img.setAttribute('src', new URL(src, baseUrl).href); } catch(_) {}
        });
        doc.querySelectorAll('[srcset]').forEach(el => {
          el.setAttribute('srcset', this.rewriteSrcset(el.getAttribute('srcset'), baseUrl));
        });
      }

      /* Rewrite stylesheet <link href> to absolute */
      doc.querySelectorAll('link[rel="stylesheet"][href], link[rel="preload"][href]').forEach(l => {
        try { l.setAttribute('href', new URL(l.getAttribute('href'), baseUrl).href); } catch(_) {}
      });

      /* Rewrite <script src> to absolute; optionally remove */
      doc.querySelectorAll('script[src]').forEach(s => {
        try {
          const abs = new URL(s.getAttribute('src'), baseUrl).href;
          if (opts.blockAds && this.isAdUrl(abs)) { s.remove(); return; }
          if (!opts.enableScripts) { s.remove(); return; }
          s.setAttribute('src', abs);
        } catch(_) {}
      });

      /* Remove inline scripts if JS disabled */
      if (!opts.enableScripts) {
        doc.querySelectorAll('script:not([src])').forEach(s => s.remove());
        doc.querySelectorAll('[onload],[onclick],[onerror],[onsubmit]').forEach(el => {
          ['onload','onclick','onerror','onsubmit','onfocus','onblur','onmouseover'].forEach(attr => el.removeAttribute(attr));
        });
      }

      /* Remove <video>/<audio> src to absolute */
      doc.querySelectorAll('video[src], audio[src], source[src]').forEach(el => {
        try { el.setAttribute('src', new URL(el.getAttribute('src'), baseUrl).href); } catch(_) {}
      });

      /* Ad blocking */
      if (opts.blockAds) this.removeAds(doc);

      return doc.documentElement.outerHTML;
    } catch(e) {
      console.warn('[ProxyWarp] DOM rewrite failed, regex fallback:', e);
      return this.regexRewrite(html, baseUrl, opts);
    }
  },

  toProxyUrl(href, base) {
    if (!href) return null;
    const skip = ['#','javascript:','mailto:','tel:','data:','blob:'];
    if (skip.some(p => href.startsWith(p))) return null;
    try {
      return `proxy.html?url=${encodeURIComponent(new URL(href, base).href)}`;
    } catch(_) { return null; }
  },

  rewriteSrcset(srcset, base) {
    return srcset.replace(/([^\s,]+)(\s+[\d.]+[wx])?/g, (match, url, descriptor) => {
      try {
        return new URL(url, base).href + (descriptor || '');
      } catch(_) { return match; }
    });
  },

  isAdUrl(url) {
    try {
      const host = new URL(url).hostname;
      for (const d of AD_DOMAINS) if (host.includes(d)) return true;
    } catch(_) {}
    return false;
  },

  removeAds(doc) {
    doc.querySelectorAll('script[src],link[href],iframe[src],img[src]').forEach(el => {
      const src = el.src || el.href || el.getAttribute('src') || el.getAttribute('href') || '';
      if (this.isAdUrl(src)) el.remove();
    });
    const SEL = '.ad,.ads,.advert,.advertisement,.ad-container,.ad-slot,.ad-banner,' +
      '[class*="adsbygoogle"],[id*="google_ads"],.sponsored,.promo-block';
    try { doc.querySelectorAll(SEL).forEach(el => el.remove()); } catch(_) {}
  },

  /* Injected into every proxied page — intercepts navigation before it escapes */
  interceptorScript(baseUrl) {
    return `(function(){
  var BASE='${baseUrl}',
      PROXY=location.origin+'/proxy.html';
  function toProxy(href){
    if(!href||/^(#|javascript:|mailto:|tel:|data:|blob:)/.test(href))return null;
    try{return PROXY+'?url='+encodeURIComponent(new URL(href,BASE).href);}catch(e){return null;}
  }
  /* Intercept clicks */
  document.addEventListener('click',function(e){
    var a=e.target.closest('a[href]');
    if(!a)return;
    var p=toProxy(a.getAttribute('href'));
    if(p){e.preventDefault();e.stopPropagation();window.parent.postMessage({pw:'nav',url:new URL(a.getAttribute('href'),BASE).href},'*');}
  },true);
  /* Intercept form submits */
  document.addEventListener('submit',function(e){
    var f=e.target;
    if(!f.action)return;
    var p=toProxy(f.action);
    if(p){e.preventDefault();window.parent.postMessage({pw:'nav',url:new URL(f.action,BASE).href},'*');}
  },true);
  /* Intercept history pushState / replaceState */
  var orig={push:history.pushState,replace:history.replaceState};
  history.pushState=function(a,b,url){
    orig.push.apply(this,arguments);
    if(url)window.parent.postMessage({pw:'nav',url:new URL(url,BASE).href},'*');
  };
  history.replaceState=function(a,b,url){
    orig.replace.apply(this,arguments);
  };
})();`;
  },

  regexRewrite(html, baseUrl, opts) {
    html = html.replace(/<meta[^>]+http-equiv=["']Content-Security-Policy["'][^>]*>/gi,'');
    html = html.replace(/\shref=(["'])([^"']+)\1/gi,(_,q,u)=>{
      if(/^(#|javascript:|mailto:|tel:)/.test(u)) return ` href=${q}${u}${q}`;
      try{ return ` href=${q}proxy.html?url=${encodeURIComponent(new URL(u,baseUrl).href)}${q}`; }
      catch(_){ return ` href=${q}${u}${q}`; }
    });
    html = html.replace(/\saction=(["'])([^"']+)\1/gi,(_,q,u)=>{
      try{ return ` action=${q}proxy.html?url=${encodeURIComponent(new URL(u,baseUrl).href)}${q}`; }
      catch(_){ return ` action=${q}${u}${q}`; }
    });
    if(!opts.enableScripts) html = html.replace(/<script[\s\S]*?<\/script>/gi,'');
    return html;
  },

  renderContent(html) {
    const frame = document.getElementById('proxy-frame');
    if (frame._blobUrl) URL.revokeObjectURL(frame._blobUrl);
    const blob = new Blob([html], { type: 'text/html' });
    frame._blobUrl = URL.createObjectURL(blob);
    frame.style.display = 'block';
    frame.src = frame._blobUrl;
    ['newtab','loading','err-screen'].forEach(id => {
      const el = document.getElementById(id);
      if (el) el.style.display = 'none';
    });
  },
};

window.addEventListener('message', e => {
  if (e.data?.pw === 'nav') ProxyEngine.navigate(e.data.url);
});
