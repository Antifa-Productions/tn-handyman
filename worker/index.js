/**
 * T&N Handyman - consolidated Worker.
 * Static assets + security headers + dynamic CORS + www consolidation
 * + nonce-based CSP so Cloudflare's edge-injected scripts/styles are authorized.
 *
 * Nonces now cover BOTH script-src and style-src. Note that a nonce cannot
 * authorize inline style="" ATTRIBUTES (those need 'unsafe-hashes' plus a
 * per-declaration hash), so style-src-attr stays locked to 'none'. External
 * stylesheets remain covered by 'self'.
 */

const ALLOWED_ORIGINS = new Set([
  'https://tandnhandymanvt.com',
  'https://www.tandnhandymanvt.com',
]);

const PERMISSIONS_POLICY =
  'accelerometer=(), autoplay=(), camera=(), display-capture=(), encrypted-media=(), ' +
  'fullscreen=(self), geolocation=(), gyroscope=(), magnetometer=(), microphone=(), ' +
  'midi=(), payment=(), picture-in-picture=(), usb=(), xr-spatial-tracking=(), interest-cohort=()';

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
    'img-src \'self\' data:',
    'manifest-src \'self\'',
    'media-src \'none\'',
    // Nonce authorizes our scripts AND Cloudflare's edge-injected bootstrap:
    // Cloudflare reads the nonce from this header and stamps it onto the
    // scripts it appends to the HTML.
    'script-src \'self\' \'nonce-' + nonce + '\'',
    'script-src-attr \'none\'',
    // Same nonce authorizes <style> elements; external sheets come from 'self'.
    'style-src \'self\' \'nonce-' + nonce + '\'',
    'style-src-attr \'none\'',
    'worker-src \'self\' blob:',
    'upgrade-insecure-requests',
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
 * Stamp a nonce onto every <script> and <style> OPENING tag.
 * Deliberately tight: only opening tags, so attribute values and text
 * content are never corrupted. Case-insensitive on the tag name.
 */
function stampNonce(html, nonce) {
  let out = html;

  // <script src="..."> — add nonce after the opening tag name.
  out = out.replace(/<script(\s[^>]*)?>/gi, (match, attrs) => {
    if (attrs && /\snonce\s*=/i.test(attrs)) return match; // already stamped
    return '<script nonce="' + nonce + '"' + (attrs || '') + '>';
  });

  // <style> — add nonce similarly.
  out = out.replace(/<style(\s[^>]*)?>/gi, (match, attrs) => {
    if (attrs && /\snonce\s*=/i.test(attrs)) return match; // already stamped
    return '<style nonce="' + nonce + '"' + (attrs || '') + '>';
  });

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

    const origin = request.headers.get('origin');
    const originAllowed = origin !== null && ALLOWED_ORIGINS.has(origin);

    // ---- CORS preflight: answer directly, don't hit the asset store ----
    if (request.method === 'OPTIONS') {
      const preflight = new Response(null, { status: 204 });
      if (originAllowed) {
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
    
    // Safety check: If the asset response has no body (e.g., 304 Not Modified),
    // we cannot rewrite it. Just pass it through with headers.
    if (!assetResponse.body) {
      const res = new Response(null, assetResponse);
      
      // Apply static headers even for empty responses
      res.headers.set('Strict-Transport-Security',
        'max-age=63072000; includeSubDomains; preload');
      res.headers.set('Referrer-Policy', 'no-referrer');
      res.headers.set('X-Content-Type-Options', 'nosniff');
      res.headers.set('X-XSS-Protection', '0');
      res.headers.set('X-Frame-Options', 'DENY');
      res.headers.set('Cross-Origin-Opener-Policy', 'same-origin');
      res.headers.set('Cross-Origin-Resource-Policy', 'same-origin');
      res.headers.set('Permissions-Policy', PERMISSIONS_POLICY);
      
      if (originAllowed) {
        res.headers.set('Access-Control-Allow-Origin', origin);
        if (!/\borigin\b/i.test(res.headers.get('Vary') || '')) {
          res.headers.append('Vary', 'Origin');
        }
      } else {
        res.headers.delete('Access-Control-Allow-Origin');
      }
      
      const contentType = res.headers.get('content-type') || '';
      if (contentType.startsWith('text/html')) {
        res.headers.set('Content-Security-Policy',
          "default-src 'none'; frame-ancestors 'none'; base-uri 'none'");
      } else {
        res.headers.set('Content-Security-Policy',
          "default-src 'none'; frame-ancestors 'none'; base-uri 'none'");
      }
      
      return res;
    }

    const res = new Response(assetResponse.body, assetResponse);

    // Dynamic CORS: echo Origin only when allowlisted; otherwise strip ACAO.
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

    // ---- HTML: buffer, stamp nonces, re-serve ----
    const isHtml = contentType.startsWith('text/html');
    const hasBody = request.method === 'GET' &&
      res.status !== 204 && res.status !== 304;

    if (isHtml && hasBody) {
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
      // Avoid content-length / content-encoding mismatch after rewrite.
      res.headers.set('Content-Length', String(body.byteLength));
      res.headers.delete('Content-Encoding');

      return new Response(body, res);
    }

    // ---- HTML without a rewritable body (HEAD/204/304): static CSP ----
    if (isHtml) {
      res.headers.set('Content-Security-Policy',
        "default-src 'none'; frame-ancestors 'none'; base-uri 'none'");
      res.headers.set('Cache-Control', 'public, max-age=0, must-revalidate');
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
      res.headers.set('Cache-Control', 'public, max-age=3600');
    } else {
      // JSON, txt, misc: conservative default.
      res.headers.set('Cache-Control', 'public, max-age=3600');
    }

    return res;
  },
};
