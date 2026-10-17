/**
 * T&N Handyman - consolidated Worker.
 * Static assets + security headers + dynamic CORS + www consolidation.
 */

const ALLOWED_ORIGINS = new Set([
    'https://tandnhandymanvt.com',
    'https://www.tandnhandymanvt.com',
]);

const CSP = [
    "base-uri 'none'",
    "child-src 'none'",
    "connect-src 'self' https://formspree.io",
    "default-src 'none'",
    "font-src 'self'",
    "form-action 'self' https://formspree.io",
    "frame-ancestors 'none'",
    "img-src 'self' data:",
    "manifest-src 'self'",
    "object-src 'none'",
    "script-src 'self' blob:",
    "script-src-attr 'self'",
    "style-src 'self'",
    "style-src-attr 'none'",
    "worker-src 'self' blob:",
    "upgrade-insecure-requests",
].join('; ');

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

        res.headers.set('Content-Security-Policy', CSP);
        res.headers.set('Strict-Transport-Security',
            'max-age=63072000; includeSubDomains; preload');
        res.headers.set('Referrer-Policy', 'no-referrer');
        res.headers.set('X-Content-Type-Options', 'nosniff');
        res.headers.set('X-XSS-Protection', '0');
        res.headers.set('Cross-Origin-Opener-Policy', 'same-origin');
        res.headers.set('Cross-Origin-Resource-Policy', 'same-origin');
        res.headers.set('Permissions-Policy', PERMISSIONS_POLICY);

        // ---- Cache-Control policy ----
        const contentType = res.headers.get('content-type') || '';
        if (contentType.startsWith('text/html')) {
            // Navigations must always revalidate to pick up new asset references.
            res.headers.set('Cache-Control', 'public, max-age=0, must-revalidate');
        } else if (IMMUTABLE_TYPES.some((type) => contentType.startsWith(type))) {
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
