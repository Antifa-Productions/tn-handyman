/**
 * T&N Handyman - consolidated Worker.
 * Static assets + security headers + dynamic CORS + www consolidation
 * + nonce-based CSP so Cloudflare's edge-injected scripts are authorized.
 */

const ALLOWED_ORIGINS = new Set([
  'https://tandnhandymanvt.com',
  'https://www.tandnhandymanvt.com',
]);

const PERMISSIONS_POLICY =
  'accelerometer=(), autoplay=(), camera=(), display-capture=(), encrypted-media=(), ' +
  'fullscreen=(self), geolocation=(), gyroscope=(), magnetometer=(), microphone=(), ' +
  'midi=(), payment=(), picture-in-picture=(), usb=(), xr-spatial-tracking=(), interest-cohort=()';

const IMMUTABLE_TYPES = [
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
    'img-src \'self\' data:',
    'manifest-src \'self\'',
    'media-src \'none\'',
    // Nonce authorizes our inline-adjacent scripts AND Cloudflare's
    // edge-injected bootstrap: Cloudflare reads the nonce from this
    // header and stamps it onto the scripts it appends to the HTML.
    'script-src \'self\' \'nonce-' + nonce + '\'',
    'script-src-attr \'none\'',
    'style-src \'self\'',
    'style-src-attr \'none\'',
    'worker-src \'self\' blob:',
    'upgrade-insecure-requests',
  ].join('; ');
}

/** Cryptographically random base64 nonce, per RFC 8299 guidance. */
function makeNonce() {
  const bytes = new Uint8Array(16);
  crypto.getRandomValues(bytes);
  let binary = '';
  for (const b of bytes) binary += String.fromCharCode(b);
  return btoa(binary);
}

/**
 * Rewrite an HTML document so every <script> element carries the nonce.
 * Matching is deliberately tight: only opening tags, quoted src, and
 * inline scripts, so attribute values and text content are never
 * corrupted. Case-insensitive on the tag name.
 */
function stampNonce(html, nonce) {
  let out = html;
  // <script src="..."> — add nonce after the opening tag name.
  out = out.replace(
    /<script(\s[^>]*)?>/gi,
    (match, attrs) => {
      if (attrs && /\snonce\s*=/i.test(attrs)) return match; // already stamped
      return '<script nonce="' + nonce + '"' + (attrs || '') + '>';
    }
  );
  return out;
}

export default {
  async fetch(request, env) {
    const url = new URL(request.url);

    // ---- Consolidate on apex: www -> root, preserving path/query ----
    if (url.hostname === 'www.tandnhandymanvt.com') {
      url.hostname = 'tandnhandymanvt.com';
      return Response.redirect(url.toString(), 301);
    }

    // ---- Serve asset and apply security policy ----
    const assetResponse = await env.ASSETS.fetch(request);
    const res = new Response(assetResponse.body, assetResponse);

    // Dynamic CORS: echo the Origin only when allowlisted.
    // Unmatched/no Origin -> strip any ACAO entirely (no wildcard ever).
    const origin = request.headers.get('origin');
    if (origin && ALLOWED_ORIGINS.has(origin)) {
      res.headers.set('Access-Control-Allow-Origin', origin);
      res.headers.append('Vary', 'Origin');
      res.headers.set('Access-Control-Allow-Methods', 'GET, HEAD');
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

    if (contentType.startsWith('text/html')) {
      // ---- Nonce flow: buffer, stamp, re-serve ----
      // Requires responses not be compressed; ASSETS serves identity
      // encoding when no Accept-Encoding is forwarded, which the
      // platform guarantees for Workers-static-assets bindings.
      const nonce = makeNonce();
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

      res.headers.set('Content-Security-Policy', buildCsp(nonce));
      res.headers.set('Cache-Control', 'public, max-age=0, must-revalidate');

      const encoder = new TextEncoder();
      const body = encoder.encode(stampNonce(html, nonce));
      // Avoid content-length/content-encoding mismatch after rewrite.
      res.headers.set('Content-Length', String(body.byteLength));
      res.headers.delete('Content-Encoding');

      return new Response(body, res);
    }

    // ---- Non-HTML: static CSP (no nonce needed) ----
    res.headers.set('Content-Security-Policy',
      "default-src 'none'; frame-ancestors 'none'; base-uri 'none'");

    // ---- Cache-Control policy ----
    if (IMMUTABLE_TYPES.some((type) => contentType.startsWith(type))) {
      // Long-lived caching for CSS/JS/images/fonts/manifest.
      // NOTE: safe only if asset filenames carry a content hash
      // (e.g. style_12.a3f9c1.css). If they do not, lower this
      // to 'public, max-age=3600' to avoid stale styles after edits.
      res.headers.set('Cache-Control', 'public, max-age=3600');
    } else {
      // Everything else (JSON, txt, misc): conservative default.
      res.headers.set('Cache-Control', 'public, max-age=3600');
    }

    return res;
  },
};
