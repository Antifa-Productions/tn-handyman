#!/usr/bin/env node

/**
 * validate-manifest.mjs
 *
 * Validates /public/manifest.webmanifest against the core requirements
 * of the W3C Web App Manifest spec (plus a few practical checks the
 * spec leaves as "should"):
 *
 *   - File parses as JSON with a .webmanifest extension
 *   - Required members present: name, start_url, display, icons
 *   - Icons: correct type values, sizes syntactically valid, files
 *     actually exist on disk, at least one 192px and one 512px icon,
 *     at least one purpose:"maskable" entry
 *   - URLs are same-origin, absolute, and use root-relative paths
 *   - scope (if present) contains start_url
 *   - shortcuts and screenshots reference existing files
 *
 * Exits non-zero on failure so the GitHub Actions job halts.
 */

import {
    access,
    readFile
} from 'node:fs/promises';
import path from 'node:path';
import {
    fileURLToPath
} from 'node:url';

const __dirname = path.dirname(fileURLToPath(
    import.meta.url));
const PUBLIC_DIR = path.resolve(__dirname, '..', 'public');
const MANIFEST_PATH = path.join(PUBLIC_DIR, 'manifest.webmanifest');

const ALLOWED_DISPLAY = [
    'fullscreen', 'standalone', 'minimal-ui', 'browser',
];
const ALLOWED_ORIENTATIONS = [
    'any', 'natural', 'landscape', 'landscape-primary', 'landscape-secondary',
    'portrait', 'portrait-primary', 'portrait-secondary',
];
const VALID_ICON_TYPES = new Set([
    'image/png', 'image/jpeg', 'image/webp', 'image/svg+xml', 'image/x-icon',
]);
const SIZE_RE = /^(\d+)x(\d+)(\s+\d+x\d+)*$/; // "192x192" or multiple sizes

let errors = 0;
let warnings = 0;

function error(msg) {
    console.error(`::error::[manifest] ${msg}`);
    errors++;
}

function warn(msg) {
    console.warn(`::warning::[manifest] ${msg}`);
    warnings++;
}

function ok(msg) {
    console.log(`[manifest] OK: ${msg}`);
}

/** Root-relative URL (/foo/bar), no protocol/host, no ../ escapes. */
function isValidRelativeUrl(url) {
    if (typeof url !== 'string' || !url.startsWith('/')) return false;
    if (url.includes('..')) return false;
    if (/^[a-z]+:\/\//i.test(url)) return false; // no absolute http(s)://
    return true;
}

/** Resolve a manifest URL to a filesystem path under /public. */
function toFilePath(url) {
    return path.join(PUBLIC_DIR, url);
}

async function fileExists(filePath) {
    try {
        await access(filePath);
        return true;
    } catch {
        return false;
    }
}

/** Validate a shared image-object list (icons or screenshots). */
async function validateImageObjects(list, context, opts = {}) {
    if (!Array.isArray(list) || list.length === 0) {
        error(`${context} must be a non-empty array`);
        return;
    }

    let foundMaskable = false;
    const seenSizes = new Set();

    for (const [index, img] of list.entries()) {
        const label = `${context}[${index}]`;

        if (!isValidRelativeUrl(img.src)) {
            error(`${label}.src "${img.src}" must be a root-relative path (start with /)`);
            continue;
        }
        if (!(await fileExists(toFilePath(img.src)))) {
            error(`${label}.src "${img.src}" does not exist in /public`);
            continue;
        }

        if (typeof img.type === 'string' && !VALID_ICON_TYPES.has(img.type)) {
            warn(`${label}.type "${img.type}" is not a widely-supported icon MIME type`);
        }

        if (typeof img.sizes === 'string') {
            if (!SIZE_RE.test(img.sizes)) {
                warn(`${label}.sizes "${img.sizes}" is not valid "WxH" syntax`);
            } else {
                img.sizes
                    .split(/\s+/)
                    .map((s) => parseInt(s, 10))
                    .forEach((dim) => seenSizes.add(dim));
            }
        } else if (img.sizes !== undefined) {
            warn(`${label}.sizes should be a string like "192x192"`);
        } else if (!opts.allowMissingSizes) {
            // SVG icons may legitimately omit sizes
            if (img.type !== 'image/svg+xml') {
                warn(`${label} has no sizes member`);
            }
        }

        if (img.purpose === 'maskable') {
            foundMaskable = true;
        }
    }

    if (seenSizes.size > 0) {
        if (opts.requireSizes) {
            for (const dim of opts.requireSizes) {
                if (![...seenSizes].some((s) => s >= dim)) {
                    error(`No ${context} entry found with size >= ${dim}px ` +
                        `(install UI and Android home screen require ${dim}px)`);
                }
            }
        }
    }

    if (opts.requireMaskable && !foundMaskable) {
        error(`${context} contains no purpose:"maskable" entry`);
    }
}

async function main() {
    // ---- File extension sanity ----
    if (!MANIFEST_PATH.endsWith('.webmanifest')) {
        // Defensive: this script points at a fixed path, but keep the
        // check in case someone reuses it for a manifest.json variant.
        warn('File is not named *.webmanifest — spec-recommended extension');
    }

    // ---- Parse ----
    let manifest;
    try {
        const raw = await readFile(MANIFEST_PATH, 'utf8');
        manifest = JSON.parse(raw);
    } catch (err) {
        error(`Could not read or parse ${MANIFEST_PATH}: ${err.message}`);
        process.exit(1);
    }

    if (typeof manifest !== 'object' || manifest === null || Array.isArray(manifest)) {
        error('Manifest root must be a JSON object');
        process.exit(1);
    }

    // ---- Required members ----
    if (typeof manifest.name !== 'string' || manifest.name.trim() === '') {
        error('Missing or empty "name"');
    } else {
        ok(`name: "${manifest.name}"`);
    }

    if (typeof manifest.short_name !== 'string' || manifest.short_name.trim() === '') {
        warn('No "short_name" — home-screen label will fall back to full name');
    }

    if (manifest.description === undefined) {
        warn('No "description" member (recommended for app listing)');
    }

    if (typeof manifest.start_url !== 'string' || !isValidRelativeUrl(manifest.start_url)) {
        error('"start_url" must be a root-relative path like "/"');
    } else {
        ok(`start_url: "${manifest.start_url}"`);
    }

    if (!ALLOWED_DISPLAY.includes(manifest.display)) {
        error(`"display" must be one of: ${ALLOWED_DISPLAY.join(', ')} ` +
            `(got "${manifest.display}")`);
    } else {
        ok(`display: "${manifest.display}"`);
    }

    if (
        manifest.orientation !== undefined &&
        !ALLOWED_ORIENTATIONS.includes(manifest.orientation)
    ) {
        error(`"orientation" "${manifest.orientation}" is not a valid value`);
    }

    // ---- Color members (spec: only defined color values) ----
    const COLOR_RE = /^(#[0-9a-f]{3}|#[0-9a-f]{6}|#[0-9a-f]{8})$/i;
    for (const member of['theme_color', 'background_color']) {
        const value = manifest[member];
        if (value === undefined) {
            warn(`No "${member}" (recommended for splash/status bar rendering)`);
        } else if (!COLOR_RE.test(String(value))) {
            // CSS color keywords are legal per spec but opaque to naive
            // clients; hexadecimal is the universally safe form.
            warn(`"${member}" "${value}" is not a hex color — some UAs may ignore it`);
        }
    }

    // ---- scope must contain start_url ----
    if (manifest.scope !== undefined) {
        if (!isValidRelativeUrl(manifest.scope)) {
            error('"scope" must be a root-relative path');
        } else {
            // Both root-relative; scope contains start_url if scope is a
            // prefix of start_url (directory-wise)
            const normScope = manifest.scope.replace(/\/$/, '') + '/';
            const normStart = manifest.start_url.replace(/\/$/, '');
            if (!normStart.startsWith(normScope)) {
                error(`"scope" (${manifest.scope}) does not contain "start_url" (${manifest.start_url})`);
            } else {
                ok(`scope: "${manifest.scope}" contains start_url`);
            }
        }
    }

    // ---- Icons ----
    await validateImageObjects(manifest.icons, 'icons', {
        requireSizes: [192, 512],
        requireMaskable: true,
    });

    // ---- Shortcuts ----
    if (manifest.shortcuts !== undefined) {
        if (!Array.isArray(manifest.shortcuts)) {
            error('"shortcuts" must be an array');
        } else {
            for (const [index, sc] of manifest.shortcuts.entries()) {
                const label = `shortcuts[${index}]`;
                if (typeof sc.name !== 'string' || sc.name.trim() === '') {
                    error(`${label} is missing "name"`);
                }
                if (typeof sc.url !== 'string' || !isValidRelativeUrl(sc.url)) {
                    error(`${label}.url "${sc.url}" must be a root-relative path`);
                }
                if (sc.icons !== undefined) {
                    await validateImageObjects(sc.icons, `${label}.icons`, {
                        allowMissingSizes: true,
                    });
                }
            }
        }
    }

    // ---- Screenshots ----
    if (manifest.screenshots !== undefined) {
        await validateImageObjects(manifest.screenshots, 'screenshots', {
            allowMissingSizes: true,
        });
    }

    // ---- Summary ----
    if (errors > 0) {
        console.error(`\n[manifest] FAILED with ${errors} error(s), ${warnings} warning(s).`);
        process.exit(1);
    }
    console.log(`\n[manifest] PASSED (${warnings} warning(s)).`);
}

main().catch((err) => {
    console.error(`::error::[manifest] unexpected failure: ${err.message}`);
    process.exit(1);
});
