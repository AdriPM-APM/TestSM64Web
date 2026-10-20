/* Worker for the private SM64 web build.
 *
 * The whole site — engine, wasm and assets — sits behind Sign in with Freebuff,
 * so a stranger cannot load the game even with the URL. Wrapped handler order
 * matters: `auth.wrap` sees /auth/freebuff/* first, then we require a session
 * before any asset is served.
 */
import { createFreebuffAuth } from '@freebuff/auth';

// One instance per isolate: the SDK caches OIDC discovery and signing keys.
let auth;
let app;

function signInPage(siteName) {
  return `<!doctype html><html lang="en"><head><meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1, viewport-fit=cover">
<title>${siteName} — sign in</title>
<style>
  :root{--bg:#0b0e13;--fg:#e9e7e2;--dim:#8b94a3;--accent:#f5c542}
  html,body{margin:0;height:100%;background:radial-gradient(circle at 50% 30%,#18202e,#0b0e13 70%);
    color:var(--fg);font:15px/1.55 system-ui,-apple-system,"Segoe UI",Roboto,sans-serif}
  main{position:fixed;inset:0;display:flex;flex-direction:column;gap:18px;align-items:center;
    justify-content:center;text-align:center;padding:24px}
  h1{margin:0;font-size:clamp(24px,6vw,36px);font-weight:900;letter-spacing:.03em;
    background:linear-gradient(180deg,#fff 20%,var(--accent) 60%,#e08b1a);-webkit-background-clip:text;
    background-clip:text;color:transparent}
  p{margin:0;color:var(--dim);max-width:430px}
  a{display:inline-block;background:linear-gradient(180deg,#ffd964,#e9a91b);color:#2a2100;
    font-weight:800;text-decoration:none;border-radius:999px;padding:13px 30px;
    box-shadow:0 8px 26px rgba(245,197,66,.3)}
</style></head>
<body><main>
  <h1>${siteName}</h1>
  <p>This build is private. Sign in with the account that owns it to play.</p>
  <a href="/auth/freebuff/signin?returnTo=/">Sign in with Freebuff</a>
</main></body></html>`;
}

function setup(env) {
  auth ??= createFreebuffAuth({
    clientId: env.FREEBUFF_CLIENT_ID,
    issuer: env.FREEBUFF_ISSUER,
    baseUrl: env.APP_ORIGIN,
  });

  const a = auth;
  app ??= a.wrap(async (request, env) => {
    const url = new URL(request.url);

    // Never let a session-authenticated response be stored by a shared cache.
    const user = await a.getUser(request);

    if (!user) {
      const wantsHTML = (request.headers.get('accept') || '').includes('text/html');
      if (request.method === 'GET' && wantsHTML) {
        return new Response(signInPage('Super Mario 64'), {
          status: 401,
          headers: { 'content-type': 'text/html; charset=utf-8', 'cache-control': 'private, no-store' },
        });
      }
      return new Response('Sign in required', {
        status: 401,
        headers: { 'content-type': 'text/plain; charset=utf-8', 'cache-control': 'private, no-store' },
      });
    }

    const res = await env.ASSETS.fetch(request);
    const headers = new Headers(res.headers);

    // Private, but cacheable on this one device: the 5.7 MB engine should load
    // from disk on relaunch instead of the network.
    if (url.pathname.endsWith('.wasm.gz') || url.pathname.endsWith('.wasm')) {
      headers.set('cache-control', 'private, max-age=31536000, immutable');
    } else if (url.pathname.endsWith('.js') || url.pathname.endsWith('.html') ||
               url.pathname === '/' || url.pathname.endsWith('.webmanifest')) {
      headers.set('cache-control', 'private, no-cache');
    } else {
      headers.set('cache-control', 'private, max-age=3600');
    }
    headers.set('vary', 'Cookie');
    headers.delete('set-cookie');

    return new Response(res.body, {
      status: res.status,
      statusText: res.statusText,
      headers,
    });
  });

  return app;
}

export default {
  fetch(request, env) {
    return setup(env)(request, env);
  },
};
