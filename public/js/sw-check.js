/**
 * sw-check.js — Service Worker diagnostic panel.
 * Verifies registration, lifecycle state, the installed precache
 * (proving the CI hash step output was consumed), and the deployed
 * sw-precache.json revision manifest.
 */

(() => {
    'use strict';

    const fmt = (...args) => args.join(' ');

    function log(sectionId, cls, ...args) {
        const el = document.getElementById(sectionId);
        const line = document.createElement('p');
        line.textContent = fmt(...args);
        line.className = cls || '';
        el.appendChild(line);
    }

    function result(sectionId, condition, okMsg, failMsg) {
        log(sectionId, condition ? 'ok' : 'fail', condition ? `✔ ${okMsg}` : `✘ ${failMsg}`);
        return condition;
    }

    async function checkSupport() {
        result('support', 'serviceWorker' in navigator,
            'Service Worker API supported',
            'Service Worker API NOT supported');
        result('support', 'indexedDB' in window,
            'IndexedDB supported',
            'IndexedDB NOT supported');
    }

    async function checkRegistration() {
        if (!('serviceWorker' in navigator)) return null;

        const reg = await navigator.serviceWorker.getRegistration('/');
        result('registration', Boolean(reg),
            `Registered at scope: ${reg ? reg.scope : '(none)'}`,
            'No registration found for scope "/"');

        if (reg) {
            const active = reg.active;
            result('registration', Boolean(active),
                `Active worker script URL: ${active ? active.scriptURL : '?'}`,
                'No active worker — stuck in installing/waiting?');

            // A worker in "waiting" means a new version is downloaded
            // but the old one still controls pages until they reload.
            if (reg.waiting) {
                log('registration', 'warn',
                    `! A new worker is WAITING (fresh deploy pending).`,
                    `State: ${reg.waiting.state}`);
            }
        }
        return reg;
    }

    async function checkLifecycle(reg) {
        if (!reg || !navigator.serviceWorker.controller) {
            result('lifecycle', false, '', 'Page is NOT controlled by the SW. Reload after install.');
            return;
        }
        result('lifecycle', true,
            `Page controlled by: ${navigator.serviceWorker.controller.scriptURL}`);

        // Ping the worker through postMessage — verifies it can respond.
        const reply = await new Promise((resolve) => {
            const ch = new MessageChannel();
            ch.port1.onmessage = (e) => resolve(e.data);
            navigator.serviceWorker.controller.postMessage({
                type: 'PING'
            }, [ch.port2]);
            setTimeout(() => resolve(null), 3000);
        });
        result('lifecycle', Boolean(reply && reply.pong),
            'Worker responds to postMessage (PONG)',
            'Worker did not respond to postMessage within 3s');
    }

    async function checkPrecache() {
        // Workbox names its precache: <prefix>-precache-<v2>-<suffix>
        const names = await caches.keys();
        const precacheName = names.find((n) => /precache/i.test(n));

        result('precache', Boolean(precacheName),
            `Workbox precache cache: "${precacheName}"`,
            'No Workbox precache cache found (install may have failed)');

        if (precacheName) {
            const cache = await caches.open(precacheName);
            const keys = await cache.keys();
            result('precache', keys.length > 0,
                `${keys.length} entries installed`,
                'Preache cache is EMPTY — precacheAndRoute got an empty manifest');
            // Show first few entries with their revision salts
            keys.slice(0, 10).forEach((req) => {
                log('precache', '', `  ${new URL(req.url).pathname}`);
            });
            if (keys.length > 10) {
                log('precache', '', `  … and ${keys.length - 10} more`);
            }
        }
    }

    async function checkManifestFile() {
        let manifest = null;
        try {
            const res = await fetch('/sw-precache.json', {
                cache: 'no-store'
            });
            result('manifest-file', res.ok,
                `Fetched sw-precache.json (${res.status})`,
                `Fetch sw-precache.json failed (${res.status})`);
            manifest = await res.json();
        } catch (err) {
            result('manifest-file', false, '', `Fetch threw: ${err.message}`);
            return;
        }

        const countOk = Array.isArray(manifest) && manifest.length > 0;
        result('manifest-file', countOk,
            `${manifest.length} entries in deployed manifest`,
            'Deployed manifest is missing or empty — did the CI hash step run?');

        const revOk = manifest.every((e) => e && typeof e.url === 'string' && /^[0-9a-f]{40}$/.test(e.revision));
        result('manifest-file', revOk,
            'All entries carry valid 40-char SHA1 revisions',
            'Malformed revisions found — hash-files.mjs output corrupted');

        const swRes = await fetch('/sw.js', {
            cache: 'no-store'
        });
        result('manifest-file', swRes.headers.get('cache-control') !== 'max-age=31536000',
            'sw.js is not immutable-cached (good)',
            'WARNING: sw.js appears immutable-cached — updates will be delayed!');
    }

    async function wireControls() {
        document.getElementById('btn-unregister').addEventListener('click', async() => {
            const regs = await navigator.serviceWorker.getRegistrations();
            for (const reg of regs) await reg.unregister();
            const names = await caches.keys();
            for (const name of names) await caches.delete(name);
            log('controls', 'ok', 'All workers unregistered, all caches deleted. Reloading…');
            setTimeout(() => location.reload(), 1200);
        });
    }

    async function main() {
        await checkSupport();
        const reg = await checkRegistration();
        await checkLifecycle(reg);
        await checkPrecache();
        await checkManifestFile();
        await wireControls();
        log('support', '', '— diagnostics complete —');
    }

    main();
})();
