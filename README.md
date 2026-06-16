# ProxyWarp

A free, instant web proxy that hides your IP and lets you access any website — no installs, no signups, no tracking.

**Live site:** [proxywarp.com](https://proxywarp.com)

---

## Features

- **IP Hidden** — destination sites only see the proxy server's IP, never yours
- **Zero Logs** — no browsing history, no IP addresses, no search queries stored
- **No Restrictions** — bypass geo-blocks and network filters
- **Charset Support** — automatic encoding detection (UTF-8, Windows-1252, EUC-KR, Shift-JIS, GB2312, and more)
- **100% Free** — no ads, no paywalls, no account required
- **Privacy Headers** — CSP, X-Frame-Options, and other tracking headers are stripped

---

## How It Works

1. You enter a URL into ProxyWarp
2. The proxy server fetches the page on your behalf
3. All links, scripts, images, and API calls are rewritten to stay inside the proxy
4. The page loads in your browser — fully anonymously

The backend is a Node.js HTTP server that:
- Routes requests through an authenticated upstream HTTP proxy
- Rewrites HTML responses to redirect all sub-requests through `/p/<url>`
- Injects a script that intercepts `fetch`, `XMLHttpRequest`, `sendBeacon`, `EventSource`, `history.pushState`, and `history.replaceState`
- Forwards `Range` headers for video seeking support
- Transcodes non-UTF-8 pages using `iconv-lite` with multi-layer charset detection (BOM → Content-Type header → `<meta charset>` → `jschardet` auto-detect)
- Strips privacy-violating response headers

---

## Stack

| Layer | Technology |
|---|---|
| Frontend | HTML, CSS, vanilla JS |
| Proxy engine | Node.js (HTTP/HTTPS server) |
| Unblocking layer | [Scramjet](https://github.com/MercuryWorkshop/scramjet) + [Epoxy](https://github.com/MercuryWorkshop/epoxy-transport) + [Bare Mux](https://github.com/MercuryWorkshop/bare-mux) |
| WebSocket tunnel | [Wisp](https://github.com/MercuryWorkshop/wisp-server-node) |
| Charset detection | `iconv-lite` + `jschardet` |
| Web server | Nginx (reverse proxy to Node.js on port 4000) |

---

## Project Structure

```
/var/www/proxywarp/      ← Frontend (this repo)
├── index.html           ← Homepage / URL input
├── proxy.html           ← Proxy browser frame
├── about.html
├── contact.html
├── donate.html
├── css/style.css
├── js/
│   ├── proxy-engine.js  ← Scramjet/Epoxy integration
│   └── proxy-ui.js      ← UI logic
├── legal/
│   ├── privacy.html
│   ├── terms.html
│   ├── dmca.html
│   └── acceptable-use.html
├── scram/               ← Scramjet service worker assets
├── baremux/             ← Bare Mux transport
├── epoxy/               ← Epoxy WebSocket transport
└── sw.js                ← Service worker

/opt/proxywarp-backend/  ← Backend (not in repo — contains credentials)
└── server.js            ← Node.js proxy server
```

---

## Self-Hosting

### Requirements

- Node.js 18+
- Nginx
- An authenticated HTTP/HTTPS upstream proxy

### Backend Setup

```bash
cd /opt/proxywarp-backend
npm install
node server.js
```

The server listens on `127.0.0.1:4000`. Configure your upstream proxy in `server.js`:

```js
const PROXY_URL = 'http://user:pass@host:port';
```

### Nginx

Point `/p/` and `/wisp/` to the Node.js backend, serve the rest as static files:

```nginx
server {
    listen 443 ssl;
    server_name yourdomain.com;
    root /var/www/proxywarp;

    location ^~ /p/ {
        proxy_pass http://127.0.0.1:4000;
        proxy_http_version 1.1;
        proxy_set_header Host $host;
        proxy_buffering off;
        proxy_read_timeout 30;
    }

    location /wisp/ {
        proxy_pass http://127.0.0.1:4000;
        proxy_http_version 1.1;
        proxy_set_header Upgrade $http_upgrade;
        proxy_set_header Connection "Upgrade";
        proxy_read_timeout 86400;
    }

    location /scramjet/ {
        try_files $uri /index.html;
    }

    location / {
        try_files $uri $uri/ =404;
    }
}
```

> **Important:** Use `location ^~ /p/` (prefix match) rather than a regex location. Without the `^~`, Nginx's `~* \.(css|js|...)$` regex rule intercepts proxy URLs ending in static file extensions and returns 404 instead of forwarding to the backend.

### Systemd Service

```ini
[Unit]
Description=ProxyWarp Backend
After=network.target

[Service]
ExecStart=/usr/bin/node /opt/proxywarp-backend/server.js
WorkingDirectory=/opt/proxywarp-backend
Restart=always
User=www-data

[Install]
WantedBy=multi-user.target
```

```bash
systemctl enable proxywarp-wisp
systemctl start proxywarp-wisp
```

---

## Support

ProxyWarp is free and kept alive by donations.

☕ [Buy Me a Coffee](https://buymeacoffee.com/rukkitofficial) — support the project

Contact: [contact@rukkit.net](mailto:contact@rukkit.net)

---

## Legal

- [Privacy Policy](https://proxywarp.com/legal/privacy.html)
- [Terms of Service](https://proxywarp.com/legal/terms.html)
- [DMCA Policy](https://proxywarp.com/legal/dmca.html)
- [Acceptable Use Policy](https://proxywarp.com/legal/acceptable-use.html)

ProxyWarp does not store browsing history or user data. DMCA takedown requests can be sent to [contact@rukkit.net](mailto:contact@rukkit.net) with "DMCA" in the subject line.

---

*Built by [Rukkit](https://buymeacoffee.com/rukkitofficial)*
