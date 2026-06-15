/**
 * ProxyWarp — Proxy Engine
 * Core request routing and HTML rewriting via puter.net.fetch()
 */

'use strict';

/* ─── Ad / Tracker Block List ─── */
const AD_DOMAINS = new Set([
  'doubleclick.net','googleadservices.com','googlesyndication.com',
  'adnxs.com','ads.yahoo.com','facebook.com/plugins','connect.facebook.net',
  'scorecardresearch.com','omtrdc.net','quantserve.com','taboola.com',
  'outbrain.com','revcontent.com','adroll.com','criteo.com','adsrvr.org',
  'moatads.com','Amazon-adsystem.com','amazon-adsystem.com',
  'pubmatic.com','openx.net','rubiconproject.com','appnexus.com',
  'advertising.com','media.net','yieldmo.com','indexexchange.com',
  'smartadserver.com','bing.com/ads','yahoo.com/ads','twitter.com/ads',
  'pixel.facebook.com','analytics.google.com','google-analytics.com',
  'hotjar.com','fullstory.com','segment.com','segment.io','mixpanel.com',
  'amplitude.com','heap.io','mouseflow.com','clicktale.com',
]);

/* ─── Spoofed User-Agent ─── */
const SPOOFED_UA =
  'Mozilla/5.0 (Windows NT 10.0; Win64; x64) ' +
  'AppleWebKit/537.36 (KHTML, like Gecko) ' +
  'Chrome/124.0.0.0 Safari/537.36';

/* ─── Proxy State ─── */
const ProxyEngine = {
  history: [],
  historyIndex: -1,
  currentUrl: null,

  getOptions() {
    return {
      allowCookies:   document.getElementById('opt-cookies')?.checked  ?? false,
      sendReferrer:   document.getElementById('opt-referrer')?.checked ?? false,
      enableScripts:  document.getElementById('opt-scripts')?.checked  ?? true,
      blockAds:       document.getElementById('opt-ads')?.checked      ?? false,
      loadImages:     document.getElementById('opt-images')?.checked   ?? true,
      spoofUA:        document.getElementById('opt-ua')?.checked       ?? false,
      encodeUrl:      document.getElementById('opt-encode')?.checked   ?? false,
    };
  },

  /** Push a URL into the internal history stack */
  pushHistory(url) {
    if (this.historyIndex < this.history.length - 1) {
      this.history = this.history.slice(0, this.historyIndex + 1);
    }
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
    const back = document.getElementById('btn-back');
    const fwd  = document.getElementById('btn-fwd');
    if (back) back.disabled = this.historyIndex <= 0;
    if (fwd)  fwd.disabled  = this.historyIndex >= this.history.length - 1;
  },

  /** Main navigate method */
  async navigate(rawUrl, addToHistory = true) {
    let url = rawUrl.trim();
    if (!url) return;

    // Decode if it came from a Base64 encoded parameter
    try {
      const decoded = atob(url);
      if (decoded.startsWith('http')) url = decoded;
    } catch (_) { /* not base64 */ }

    // Ensure protocol
    if (!/^https?:\/\//i.test(url)) url = 'https://' + url;

    this.currentUrl = url;
    if (addToHistory) this.pushHistory(url);

    ProxyUI.updateAddr(url);
    ProxyUI.setLoading(true, url);
    ProxyUI.startProgress();

    try {
      const html = await this.fetchViaProxy(url);
      const rewritten = this.rewriteHtml(html, url);
      this.renderContent(rewritten, url);
      ProxyUI.setLoading(false);
      ProxyUI.stopProgress();
    } catch (err) {
      console.error('[ProxyWarp] Fetch error:', err);
      ProxyUI.setLoading(false);
      ProxyUI.stopProgress();
      ProxyUI.showError(url, err.message);
    }
  },

  /** Fetch a URL through puter.net.fetch() — routes via Puter's cloud servers */
  async fetchViaProxy(url) {
    const opts = this.getOptions();
    const headers = {};

    if (!opts.sendReferrer) {
      headers['Referer'] = '';
    }

    if (opts.spoofUA) {
      headers['User-Agent'] = SPOOFED_UA;
    }

    // Use puter.net.fetch for CORS-free, proxy-routed requests
    // This routes through Puter's cloud infrastructure — masking the client IP
    const response = await puter.net.fetch(url, {
      method: 'GET',
      headers,
      credentials: opts.allowCookies ? 'include' : 'omit',
      redirect: 'follow',
    });

    if (!response.ok && response.status !== 304) {
      // Still try to get body even for error responses
      const text = await response.text().catch(() => '');
      if (!text) throw new Error(`HTTP ${response.status}: ${response.statusText}`);
      return text;
    }

    return await response.text();
  },

  /** Rewrite all URLs in HTML so navigation stays within the proxy */
  rewriteHtml(html, baseUrl) {
    const opts = this.getOptions();

    try {
      const parser = new DOMParser();
      const doc = parser.parseFromString(html, 'text/html');

      // Inject proxy base meta (prevents relative URL breakage)
      const base = doc.querySelector('base') || doc.createElement('base');
      base.href = baseUrl;
      doc.head.insertBefore(base, doc.head.firstChild);

      // Remove CSP meta tags that would block our rewriting
      doc.querySelectorAll('meta[http-equiv="Content-Security-Policy"]').forEach(m => m.remove());
      doc.querySelectorAll('meta[http-equiv="X-Frame-Options"]').forEach(m => m.remove());

      // Inject our proxy navigation interceptor script
      const interceptScript = doc.createElement('script');
      interceptScript.textContent = this.buildInterceptorScript(baseUrl);
      doc.head.appendChild(interceptScript);

      // Rewrite <a href>
      doc.querySelectorAll('a[href]').forEach(a => {
        const href = a.getAttribute('href');
        const rewritten = this.rewriteAttrUrl(href, baseUrl);
        if (rewritten) a.setAttribute('href', rewritten);
      });

      // Rewrite <form action>
      doc.querySelectorAll('form[action]').forEach(form => {
        const action = form.getAttribute('action');
        const rewritten = this.rewriteAttrUrl(action, baseUrl);
        if (rewritten) form.setAttribute('action', rewritten);
      });

      // Rewrite <img src> if images enabled
      if (!opts.loadImages) {
        doc.querySelectorAll('img').forEach(img => img.remove());
      } else {
        doc.querySelectorAll('img[src]').forEach(img => {
          const src = img.getAttribute('src');
          if (src && !src.startsWith('data:')) {
            try {
              img.setAttribute('src', new URL(src, baseUrl).href);
            } catch (_) {}
          }
        });
      }

      // Block ads/trackers
      if (opts.blockAds) {
        this.removeAdElements(doc, baseUrl);
      }

      // Remove scripts if disabled
      if (!opts.enableScripts) {
        doc.querySelectorAll('script').forEach(s => s.remove());
        doc.querySelectorAll('[onload],[onclick],[onmouseover],[onerror]').forEach(el => {
          ['onload','onclick','onmouseover','onerror','onsubmit','onfocus','onblur'].forEach(attr => {
            el.removeAttribute(attr);
          });
        });
      }

      // Rewrite stylesheet links to absolute
      doc.querySelectorAll('link[rel="stylesheet"][href]').forEach(link => {
        try {
          link.href = new URL(link.getAttribute('href'), baseUrl).href;
        } catch (_) {}
      });

      // Fix script srcs to absolute
      doc.querySelectorAll('script[src]').forEach(s => {
        try {
          const absUrl = new URL(s.getAttribute('src'), baseUrl).href;
          if (opts.blockAds && this.isAdUrl(absUrl)) {
            s.remove();
          } else {
            s.setAttribute('src', absUrl);
          }
        } catch (_) {}
      });

      return doc.documentElement.outerHTML;

    } catch (err) {
      // Fallback: raw regex rewriting if DOM parsing fails
      console.warn('[ProxyWarp] DOM rewrite failed, using regex fallback:', err);
      return this.regexRewriteHtml(html, baseUrl, opts);
    }
  },

  rewriteAttrUrl(href, baseUrl) {
    if (!href) return null;
    if (href.startsWith('#') || href.startsWith('javascript:') || href.startsWith('mailto:') || href.startsWith('tel:')) {
      return null;
    }
    try {
      const abs = new URL(href, baseUrl).href;
      return `proxy.html?url=${encodeURIComponent(abs)}`;
    } catch (_) {
      return null;
    }
  },

  isAdUrl(url) {
    try {
      const hostname = new URL(url).hostname;
      for (const ad of AD_DOMAINS) {
        if (hostname.includes(ad)) return true;
      }
    } catch (_) {}
    return false;
  },

  removeAdElements(doc, baseUrl) {
    // Remove known ad/tracker scripts by domain
    doc.querySelectorAll('script[src], link[href], iframe[src], img[src]').forEach(el => {
      const src = el.src || el.href || el.getAttribute('src') || el.getAttribute('href') || '';
      if (this.isAdUrl(src)) el.remove();
    });

    // Remove common ad container class names / ids
    const AD_SELECTORS = [
      '.ad', '.ads', '.advert', '.advertisement', '.ad-container', '.ad-wrapper',
      '#ad', '#ads', '#advert', '#advertisement',
      '[class*="adsbygoogle"]', '[id*="google_ads"]',
      '.sponsored', '.promo-block', '.banner-ad',
    ];
    try {
      doc.querySelectorAll(AD_SELECTORS.join(',')).forEach(el => el.remove());
    } catch (_) {}
  },

  /** Builds a script injected into proxied pages that intercepts link clicks */
  buildInterceptorScript(baseUrl) {
    return `
(function() {
  const PROXY_BASE = '${location.origin}${location.pathname.replace('proxy.html', '')}proxy.html';
  const PAGE_BASE  = '${baseUrl}';

  function toProxyUrl(href) {
    if (!href || href.startsWith('#') || href.startsWith('javascript:') ||
        href.startsWith('mailto:') || href.startsWith('tel:')) return null;
    try {
      const abs = new URL(href, PAGE_BASE).href;
      return PROXY_BASE + '?url=' + encodeURIComponent(abs);
    } catch(_) { return null; }
  }

  // Intercept all link clicks
  document.addEventListener('click', function(e) {
    const a = e.target.closest('a[href]');
    if (!a) return;
    const proxied = toProxyUrl(a.getAttribute('href'));
    if (proxied) {
      e.preventDefault();
      window.parent.postMessage({ type: 'proxywarp-navigate', url: a.href }, '*');
    }
  }, true);

  // Intercept form submissions
  document.addEventListener('submit', function(e) {
    const form = e.target;
    if (!form.action) return;
    const proxied = toProxyUrl(form.action);
    if (proxied) {
      e.preventDefault();
      window.parent.postMessage({ type: 'proxywarp-navigate', url: new URL(form.action, PAGE_BASE).href }, '*');
    }
  }, true);

  // Override window.location
  try {
    Object.defineProperty(window, 'location', {
      get: function() { return { href: PAGE_BASE, assign: function(u) { window.parent.postMessage({ type: 'proxywarp-navigate', url: u }, '*'); } }; }
    });
  } catch(_) {}
})();
    `;
  },

  /** Regex-based HTML rewriter (fallback) */
  regexRewriteHtml(html, baseUrl, opts) {
    // Remove CSP headers from meta
    html = html.replace(/<meta[^>]+http-equiv=["']Content-Security-Policy["'][^>]*>/gi, '');

    // Rewrite href attributes
    html = html.replace(/\shref=["']([^"']+)["']/gi, (match, url) => {
      if (url.startsWith('#') || url.startsWith('javascript:') || url.startsWith('mailto:')) return match;
      try {
        const abs = new URL(url, baseUrl).href;
        return ` href="proxy.html?url=${encodeURIComponent(abs)}"`;
      } catch(_) { return match; }
    });

    // Rewrite form actions
    html = html.replace(/\saction=["']([^"']+)["']/gi, (match, url) => {
      if (url.startsWith('#')) return match;
      try {
        const abs = new URL(url, baseUrl).href;
        return ` action="proxy.html?url=${encodeURIComponent(abs)}"`;
      } catch(_) { return match; }
    });

    if (!opts.enableScripts) {
      html = html.replace(/<script[\s\S]*?<\/script>/gi, '');
    }

    return html;
  },

  /** Render the proxied HTML into the page */
  renderContent(html, baseUrl) {
    const frame = document.getElementById('proxy-frame');
    const blob = new Blob([html], { type: 'text/html' });
    const blobUrl = URL.createObjectURL(blob);

    // Clean up old blob URL
    if (frame._blobUrl) URL.revokeObjectURL(frame._blobUrl);
    frame._blobUrl = blobUrl;

    frame.style.display = 'block';
    frame.src = blobUrl;

    const newtab = document.getElementById('newtab');
    const loading = document.getElementById('loading');
    const errScr  = document.getElementById('err-screen');
    if (newtab)  newtab.style.display  = 'none';
    if (loading) loading.style.display = 'none';
    if (errScr)  errScr.style.display  = 'none';
  },
};

// Listen for navigation messages from inside the iframe
window.addEventListener('message', (e) => {
  if (e.data?.type === 'proxywarp-navigate') {
    ProxyEngine.navigate(e.data.url);
  }
});
