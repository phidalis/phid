# PWA Add-on (Sportycash)

This folder contains files to enable Progressive Web App (PWA) features for the site.

Files added:
- `manifest.json` — app metadata and icon references.
- `sw.js` — basic service worker that caches core assets and serves an offline fallback.

What you need to do:
1. Add icons referenced in `manifest.json` under `icons/` (create `icons/icon-192.png` and `icons/icon-512.png`).
2. Ensure `manifest.json` and `sw.js` are served from the site root.
3. Update your HTML files to include `<link rel="manifest" href="/manifest.json">` and register the service worker (already added by script in each HTML file).

Local testing:
1. Serve the folder over HTTP (PWA features require a secure context). To test locally, run a simple static server (Node.js example):

```bash
npm install -g http-server
http-server -c-1 . -p 8080
```

2. Open `http://localhost:8080` in Chrome/Edge, open DevTools → Application, and verify the manifest and service worker are registered.

Deploying to production:
- Host the site on HTTPS (Netlify, Vercel, GitHub Pages, or your own HTTPS server).
- Confirm `manifest.json` and `sw.js` are accessible at `https://yourdomain/manifest.json` and `https://yourdomain/sw.js`.
- Test installability on mobile: open site in browser, use "Add to Home screen" prompt or browser UI.
