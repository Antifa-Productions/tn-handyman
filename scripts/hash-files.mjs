#!/usr/bin/env node
/**
 * hash-files.mjs
 *
 * Walks the /public/ build output, computes a SHA1 revision for every
 * file that should be precached, and writes /public/sw-precache.json:
 *
 *   [
 *     { "url": "/css/style.css", "revision": "a3f9e12c..." },
 *     ...
 *   ]
 *
 * The service worker fetches this file during install and passes it
 * to workbox.precaching.precacheAndRoute().
 *
 * Files excluded from the manifest: the worker itself, the manifest
 * itself (chicken-and-egg), and anything that should never be
 * precached (redirects, form backends, etc.).
 */

import { createHash } from 'node:crypto';
import { createReadStream } from 'node:fs';
import { readdir, readFile, stat, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));

const PUBLIC_DIR = path.resolve(__dirname, '..', 'public');
const OUTPUT_FILE = path.join(PUBLIC_DIR, 'sw-precache.json');

/** URL prefix for all site assets (root-relative, HTTPS assumed). */
const URL_BASE = '/';

/** Files/directories never included in the precache manifest. */
const EXCLUDE = new Set([
  // The worker and its own manifest must not precache themselves
  'sw.js',
  'sw-precache.json',
  // Diagnostics / non-cacheable pages
  'sw-check.html',
]);

/** Extensions never precached. */
const EXCLUDE_EXT = new Set(['.txt', '.md']);

/** Max file size eligible for precaching (bytes) — 5 MB guard. */
const MAX_PRECACHE_BYTES = 5 * 1024 * 1024;

/**
 * Recursively collect files under dir, returning site-relative paths
 * using forward slashes and POSIX separators.
 */
async function walk(dir) {
  const entries = await readdir(dir, { withFileTypes: true });
  const files = [];
  for (const entry of entries) {
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) {
      files.push(...(await walk(full)));
    } else if (entry.isFile()) {
      files.push(full);
    }
  }
  return files;
}

/**
 * Stream a file and compute its SHA1 hex digest.
 * Streaming avoids loading large images fully into memory.
 */
function sha1File(filePath) {
  return new Promise((resolve, reject) => {
    const hash = createHash('sha1');
    const stream = createReadStream(filePath);
    stream.on('data', (chunk) => hash.update(chunk));
    stream.on('end', () => resolve(hash.digest('hex')));
    stream.on('error', reject);
  });
}

/** Map an absolute filesystem path to the site URL it will be served at. */
function toUrl(absolutePath) {
  const relative = path.relative(PUBLIC_DIR, absolutePath);
  return URL_BASE + relative.split(path.sep).join('/');
}

async function main() {
  const allFiles = await walk(PUBLIC_DIR);

  const manifest = [];

  for (const filePath of allFiles) {
    const url = toUrl(filePath);
    const base = path.basename(url);
    const ext = path.extname(url).toLowerCase();

    if (EXCLUDE.has(base) || EXCLUDE_EXT.has(ext)) continue;
    if (url.startsWith('/images/png/icon-')) continue; // duplicate icon variants

    const info = await stat(filePath);
    if (info.size > MAX_PRECACHE_BYTES) {
      console.warn(`[warn] skipping (too large): ${url}`);
      continue;
    }

    const revision = await sha1File(filePath);
    manifest.push({ url, revision });
  }

  // Stable ordering: diffable output, deterministic builds
  manifest.sort((a, b) => a.url.localeCompare(b.url));

  const json = JSON.stringify(manifest, null, 2) + '\n';
  await writeFile(OUTPUT_FILE, json, 'utf8');

  console.log(`[hash-files] wrote ${manifest.length} entries to sw-precache.json`);
  for (const entry of manifest) {
    console.log(`           ${entry.url}  (${entry.revision.slice(0, 8)})`);
  }
}

main().catch((err) => {
  console.error('[hash-files] failed:', err);
  process.exit(1);
});
