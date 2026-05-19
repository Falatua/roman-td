// Roman TD — Cloudflare Worker leaderboard proxy.
//
// This Worker exists for one reason: some players' networks / DNS /
// browser environments mis-handle requests to *.supabase.co (we've seen
// real PGRST125 "Invalid path" responses where the same URL works fine
// from other machines). Proxying through a workers.dev hostname makes
// the traffic look like a generic Cloudflare Worker request, which
// every network treats as standard cloud infrastructure.
//
// What it does:
//   1. Accept any GET/POST/OPTIONS request on /rest/v1/scores
//   2. Forward it to the real Supabase project
//   3. Return the response with permissive CORS so the game's fetch
//      from https://falatua.github.io/ works without preflight pain
//
// Free tier limits: 100,000 requests/day. The leaderboard fires at
// most 1 request per 15-second poll + 1 submit per game-over, so even
// a heavily-active day comes nowhere near the cap.
//
// Deploy via the Cloudflare dashboard (no CLI needed):
//   1. Sign in at https://dash.cloudflare.com
//   2. Workers & Pages → Create application → Create Worker
//   3. Name it `roman-td-leaderboard` (or anything you like)
//   4. Replace the default code with the contents of this file
//   5. Click "Deploy"
//   6. Copy the deployed URL (e.g. https://roman-td-leaderboard.YOURNAME.workers.dev)
//   7. Add it to GitHub Actions secrets as `VITE_LEADERBOARD_PROXY_URL`
//   8. Push any commit to trigger a redeploy — the bundle will route
//      through the Worker on next build.

const SUPABASE_PROJECT_URL = 'https://cqenkgkhfbhegkmvniow.supabase.co';

// CORS headers — permissive because the only thing the Worker proxies
// is read/write against a public-by-design anon-key leaderboard.
const CORS_HEADERS = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Methods': 'GET, POST, OPTIONS',
  'Access-Control-Allow-Headers': 'apikey, authorization, content-type, prefer, range',
  'Access-Control-Expose-Headers': 'content-range, content-location',
  'Access-Control-Max-Age': '86400',
};

export default {
  async fetch(request) {
    // CORS preflight — answered instantly without touching Supabase.
    if (request.method === 'OPTIONS') {
      return new Response(null, { status: 204, headers: CORS_HEADERS });
    }

    // Build the upstream URL: same path + query, just swap the host.
    const incomingUrl = new URL(request.url);
    const upstreamUrl = `${SUPABASE_PROJECT_URL}${incomingUrl.pathname}${incomingUrl.search}`;

    // Clone headers and strip ones that don't make sense on the upstream
    // hop. `host` would be the Worker hostname, which would confuse
    // Cloudflare's Supabase routing. `cf-*` is Cloudflare-internal.
    const fwdHeaders = new Headers(request.headers);
    fwdHeaders.delete('host');
    fwdHeaders.delete('cf-connecting-ip');
    fwdHeaders.delete('cf-ipcountry');
    fwdHeaders.delete('cf-ray');
    fwdHeaders.delete('cf-visitor');
    fwdHeaders.delete('x-forwarded-for');
    fwdHeaders.delete('x-forwarded-proto');
    fwdHeaders.delete('x-real-ip');

    // Forward the request. Pass-through method + headers + body.
    let upstreamResp;
    try {
      upstreamResp = await fetch(upstreamUrl, {
        method: request.method,
        headers: fwdHeaders,
        body: request.method === 'GET' || request.method === 'HEAD' ? undefined : request.body,
      });
    } catch (err) {
      return new Response(
        JSON.stringify({ proxy_error: 'fetch_failed', message: String(err) }),
        { status: 502, headers: { ...CORS_HEADERS, 'content-type': 'application/json' } }
      );
    }

    // Mirror the upstream response, but force our CORS headers on top.
    // (Supabase already sets some CORS headers, but we want predictable
    // behavior across browsers so we overwrite.)
    const respHeaders = new Headers(upstreamResp.headers);
    for (const [k, v] of Object.entries(CORS_HEADERS)) respHeaders.set(k, v);
    return new Response(upstreamResp.body, {
      status: upstreamResp.status,
      statusText: upstreamResp.statusText,
      headers: respHeaders,
    });
  },
};
