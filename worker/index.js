/**
 * T&N Handyman - consolidated Worker.
 * Static assets + security headers + dynamic CORS + www consolidation
 * + nonce-based CSP for scripts only (Cloudflare edge-injected scripts)
 * + no-transform to prevent any intermediary modification.
 * + X-Robots-Tag: allows search indexing and AI answer-engine input,
 *   while prohibiting AI model training on site content.
 *
 * CSP notes:
 * - No 'sandbox' directive: it overrides normal document semantics and
 *   conflicts with modal/dialog usage; equivalent protections come from
 *   frame-ancestors 'none', base-uri 'none', and default-src 'none'.
 * - No 'require-trusted-types-for': the site's vanilla JS performs direct
 *   DOM manipulation, which Trusted Types enforcement would break.
 * - Styles are authorized via 'self' only — no nonce. A style nonce caused
 *   FOUC (page loads unstyled until reload) when cached HTML carrying an
 *   expired nonce collided with a fresh response. External stylesheets
 *   (same-origin) are fully covered by 'self'.
 * - Element-level fallbacks (script-src-elem, style-src-elem) are included
 *   so browsers that support them enforce identical rules at the parser
 *   level, independent of the broader src directives.
 *
 * The full nonce CSP is served on ALL HTML responses (GET and HEAD alike);
 * only GET bodies are rewritten with the nonce, since HEAD has none.
 */

const ALLOWED_ORIGINS = new Set([
  'https://tandnhandymanvt.com',
  'https://www.tandnhandymanvt.com',
]);

// Verified Permissions-Policy directives only. Entries dropped from the
// proposed list because they are not registered policy directives:
//   aria-notify, ch-ua-high-entropy-values, language-model, local-network
//   (superseded by local-network-access), loopback-network,
//   on-device-speech-recognition.
const PERMISSIONS_POLICY =
  'accelerometer=(), ' +
  'ambient-light-sensor=(), ' +
  'attribution-reporting=(), ' +
  'autoplay=(), ' +
  'bluetooth=(), ' +
  'browsing-topics=(), ' +
  'camera=(), ' +
  'captured-surface-control=(), ' +
  'compute-pressure=(), ' +
  'cross-origin-isolated=(), ' +
  'deferred-fetch=(), ' +
  'deferred-fetch-minimal=(), ' +
  'display-capture=(), ' +
  'encrypted-media=(), ' +
  'fullscreen=(self), ' +
  'gamepad=(), ' +
  'geolocation=(), ' +
  'gyroscope=(), ' +
  'hid=(), ' +
  'identity-credentials-get=(), ' +
  'idle-detection=(), ' +
  'language-detector=(), ' +
  'local-fonts=(), ' +
  'local-network-access=(), ' +
  'magnetometer=(), ' +
  'microphone=(), ' +
  'midi=(), ' +
  'otp-credentials=(), ' +
  'payment=(), ' +
  'picture-in-picture=(), ' +
  'private-state-token-issuance=(), ' +
  'private-state-token-redemption=(), ' +
  'publickey-credentials-create=(), ' +
  'publickey-credentials-get=(), ' +
  'screen-wake-lock=(), ' +
  'serial=(), ' +
  'speaker-selection=(), ' +
  'storage-access=(), ' +
  'summarizer=(), ' +
  'translator=(), ' +
  'unload=(), ' +
  'usb=(), ' +
  'web-share=(), ' +
  'window-management=(), ' +
  'xr-spatial-tracking=()';

// Prefixes that receive the long-lived cache directive.
const IMMUTABLE_PREFIXES = [
  'text/css',
  'text/javascript',
  'application/javascript',
  'image/',
  'font/',
  'application/font',
  'application/manifest+json',
];

/** Build the CSP string, parametrized with a per-response nonce. */
function buildCsp(nonce) {
  return [
    'base-uri \'none\'',
    'child-src \'none\'',
    'connect-src \'self\' https://formspree.io',
    'default-src \'none\'',
    'font-src \'self\'',
    'form-action \'self\' https://formspree.io',
    'frame-ancestors \'none\'',
    'frame-src \'none\'',
    'img-src \'self\' data:',
    'manifest-src \'self\'',
    'media-src \'none\'',
    'object-src \'none\'',
    'prefetch-src \'self\'',
    // Nonce authorizes our scripts AND Cloudflare's edge-injected
    // bootstrap: Cloudflare reads the nonce from this header and stamps
    // it onto the scripts it appends to the HTML.
    // No 'sandbox' (conflicts with modal/dialog semantics and duplicates
    // protections already enforced by the directives below); no
    // 'require-trusted-types-for' (vanilla JS does direct DOM writes).
    'script-src \'self\' \'nonce-' + nonce + '\'',
    'script-src-attr \'none\'',
    'script-src-elem \'self\' \'nonce-' + nonce + '\'',
    'style-src \'self\'',
    'style-src-attr \'none\'',
    'style-src-elem \'self\'',
    'upgrade-insecure-requests',
    'worker-src \'self\' blob:',
  ].join('; ');
}

/** Cryptographically random base64 nonce (RFC 8299 guidance). */
function makeNonce() {
  const bytes = new Uint8Array(16);
  crypto.getRandomValues(bytes);
  let binary = '';
  for (const b of bytes) binary += String.fromCharCode(b);
  return btoa(binary);
}

/**
 * Stamp a nonce onto every <script> OPENING tag.
 * Deliberately tight: only opening tags, so attribute values and text
 * content are never corrupted. Case-insensitive on the tag name.
 */
function stampNonce(html, nonce) {
  return html.replace(/<script(\s[^>]*)?>/gi, (match, attrs) => {
    if (attrs && /\snonce\s*=/i.test(attrs)) return match; // already stamped
    return '<script nonce="' + nonce + '"' + (attrs || '') + '>';
  });
}

export default {
  async fetch(request, env) {
    const url = new URL(request.url);

    // ---- Consolidate on apex: www -> root, preserving path/query ----
    if (url.hostname === 'www.tandnhandymanvt.com') {
      url.hostname = 'tandnhandymanvt.com';
      return Response.redirect(url.toString(), 301);
    }

    // ---- CORS preflight: answer directly, don't hit the asset store ----
    if (request.method === 'OPTIONS') {
      const origin = request.headers.get('origin');
      const preflight = new Response(null, {
        status: 204
      });
      if (origin !== null && ALLOWED_ORIGINS.has(origin)) {
        preflight.headers.set('Access-Control-Allow-Origin', origin);
        preflight.headers.set('Vary', 'Origin');
        preflight.headers.set('Access-Control-Allow-Methods', 'GET, HEAD, OPTIONS');
        preflight.headers.set('Access-Control-Allow-Headers', 'Content-Type');
        preflight.headers.set('Access-Control-Max-Age', '86400');
      }
      return preflight;
    }

    // ---- Serve asset and apply security policy ----
    const assetResponse = await env.ASSETS.fetch(request);

    // HEAD/304 responses arrive with the body stripped (by design).
    // Headers (including content-type) survive, so HTML classification
    // works even when there's no body to rewrite.
    const rewritable = request.method === 'GET' &&
      assetResponse.status !== 204 && assetResponse.status !== 304 &&
      assetResponse.body !== null;

    const res = new Response(rewritable ? assetResponse.body : null, {
      status: assetResponse.status,
      statusText: assetResponse.statusText,
      headers: assetResponse.headers,
    });

    // Dynamic CORS: echo Origin only when allowlisted; otherwise strip ACAO.
    const origin = request.headers.get('origin');
    const originAllowed = origin !== null && ALLOWED_ORIGINS.has(origin);
    if (originAllowed) {
      res.headers.set('Access-Control-Allow-Origin', origin);
      // De-duplicate Vary so repeated runs don't stack copies.
      if (!/\borigin\b/i.test(res.headers.get('Vary') || '')) {
        res.headers.append('Vary', 'Origin');
      }
      res.headers.set('Access-Control-Allow-Methods', 'GET, HEAD, OPTIONS');
      res.headers.set('Access-Control-Allow-Headers', 'Content-Type');
      res.headers.set('Access-Control-Max-Age', '86400');
    } else {
      res.headers.delete('Access-Control-Allow-Origin');
    }

    const contentType = res.headers.get('content-type') || '';

    res.headers.set('Strict-Transport-Security',
      'max-age=63072000; includeSubDomains; preload');
    res.headers.set('Referrer-Policy', 'no-referrer');
    res.headers.set('X-Content-Type-Options', 'nosniff');
    res.headers.set('X-XSS-Protection', '0');
    res.headers.set('X-Frame-Options', 'DENY');
    res.headers.set('Cross-Origin-Opener-Policy', 'same-origin');
    res.headers.set('Cross-Origin-Resource-Policy', 'same-origin');
    res.headers.set('Permissions-Policy', PERMISSIONS_POLICY);

    // Robots policy: permit search-engine indexing and retrieval by AI
    // answer engines (ai-input), but prohibit use of content for AI model
    // training (ai-train). Applied to all responses — the directives apply
    // to any resource type crawlers may fetch, not just HTML.
    res.headers.set('X-Robots-Tag',
      'ai-input=yes, search=yes, ai-train=no');

    // ---- HTML: full nonce CSP on ALL methods; body stamped only on GET ----
    const isHtml = contentType.startsWith('text/html');
    if (isHtml) {
      const nonce = makeNonce();
      res.headers.set('Content-Security-Policy', buildCsp(nonce));
      res.headers.set('Cache-Control',
        'public, max-age=0, must-revalidate, no-transform');

      if (rewritable) {
        const charsetMatch = contentType.match(/charset=([\w-]+)/i);
        const charset = charsetMatch ? charsetMatch[1] : 'utf-8';

        let html;
        try {
          const decoder = new TextDecoder(charset);
          const buf = await res.arrayBuffer();
          html = decoder.decode(buf);
        } catch {
          const buf = await res.arrayBuffer();
          html = new TextDecoder('utf-8').decode(buf);
        }

        const encoder = new TextEncoder();
        const body = encoder.encode(stampNonce(html, nonce));
        // Avoid content-length / content-encoding mismatch after rewrite.
        res.headers.set('Content-Length', String(body.byteLength));
        res.headers.delete('Content-Encoding');

        return new Response(body, res);
      }

      // HEAD: no body to stamp — the CSP header above is the contract.
      return res;
    }

    // ---- Non-HTML: static CSP (no nonce needed) ----
    res.headers.set('Content-Security-Policy',
      "default-src 'none'; frame-ancestors 'none'; base-uri 'none'");

    // ---- Cache-Control policy ----
    if (IMMUTABLE_PREFIXES.some((type) => contentType.startsWith(type))) {
      // CSS/JS/images/fonts/manifest. Safe to raise to a year IF filenames
      // carry a content hash (e.g. style_12.a3f9c1.css); otherwise keep
      // this conservative so edits aren't masked by stale caches.
      res.headers.set('Cache-Control',
        'public, max-age=3600, no-transform');
    } else {
      // JSON, txt, misc: conservative default.
      res.headers.set('Cache-Control',
        'public, max-age=3600, no-transform');
    }

    return res;
  },
};
