/* Contact form: validation, AJAX submit, char counter, IndexedDB drafts. */

let draftStore = null;

async function initDraftStore() {
    try {
        // Dynamic import keeps the no-IDB path working entirely offline
        // even if the module fails to load for any reason.
        draftStore = await import('./draft-store.mjs');
    } catch (err) {
        draftStore = null; // Drafts silently disabled
    }
}

(async() => {
    'use strict';

    const form = document.getElementById('contact-form');
    if (!form) return;

    // ---- Field references ----
    const fields = {
        name: document.getElementById('name'),
        email: document.getElementById('email'),
        phone: document.getElementById('phone'),
        serviceType: document.getElementById('service-type'),
        message: document.getElementById('message'),
    };
    const submitBtn = document.getElementById('submit-btn');
    const statusEl = document.getElementById('form-status');
    const draftStatusEl = document.getElementById('draft-status');
    const counterEl = document.getElementById('char-counter');
    const startTime = Date.now();
    document.getElementById('form-started-at').value = startTime;

    const MIN_FILL_SECONDS = 3;
    const MESSAGE_MAX = parseInt(fields.message.getAttribute('maxlength'), 10) || 2000;

    // ---- Character counter ----
    function updateCounter() {
        counterEl.textContent =
            `${fields.message.value.length} / ${MESSAGE_MAX} characters`;
        counterEl.classList.toggle('near-limit',
            fields.message.value.length >= MESSAGE_MAX * 0.9);
    }
    fields.message.addEventListener('input', updateCounter);
    updateCounter();

    // ---- Draft autosave ----
    const DRAFT_FIELDS = ['name', 'email', 'phone', 'serviceType', 'message'];

    function collectDraft() {
        const data = {};
        DRAFT_FIELDS.forEach((key) => {
            if (fields[key]) data[key] = fields[key].value;
        });
        return data;
    }

    function draftIsEmpty(data) {
        return DRAFT_FIELDS.every((key) =>
            !data[key] || String(data[key]).trim() === '');
    }

    function applyDraft(data) {
        DRAFT_FIELDS.forEach((key) => {
            if (fields[key] && data[key] !== undefined) {
                fields[key].value = data[key];
            }
        });
        updateCounter();
    }

    let saveTimer = null;

    function scheduleAutosave() {
        clearTimeout(saveTimer);
        saveTimer = setTimeout(async() => {
            if (!draftStore) return;
            const data = collectDraft();
            if (draftIsEmpty(data)) return;
            try {
                await draftStore.saveDraft(data);
                draftStatusEl.textContent = 'Draft saved.';
                setTimeout(() => {
                    if (draftStatusEl.textContent === 'Draft saved.') {
                        draftStatusEl.textContent = '';
                    }
                }, 2500);
            } catch (err) {
                // Storage quota or private-browsing failure — stay silent.
                // Losing a draft is never worth alarming the user over.
            }
        }, 800); // debounce keystrokes
    }

    DRAFT_FIELDS.forEach((key) => {
        if (fields[key]) fields[key].addEventListener('input', scheduleAutosave);
    });
    fields.serviceType.addEventListener('change', scheduleAutosave);

    // ---- Restore on load (with user consent) ----
    await initDraftStore();
    if (draftStore) {
        let draft = null;
        try {
            draft = await draftStore.loadDraft();
        } catch (err) {
            draft = null;
        }

        if (draft && draft.data && !draftIsEmpty(draft.data)) {
            // Restore immediately so the user sees their text right away,
            // but frame it as an offer so they're never confused about origin.
            applyDraft(draft.data);
            const offer = document.createElement('p');
            offer.className = 'draft-restore';
            offer.textContent =
                'We restored your unsent message from a previous visit. ';
            const keep = document.createElement('button');
            keep.type = 'button';
            keep.className = 'link-btn';
            keep.textContent = 'Keep it';
            const discard = document.createElement('button');
            discard.type = 'button';
            discard.className = 'link-btn';
            discard.textContent = 'Discard';
            keep.addEventListener('click', () => {
                offer.remove();
                scheduleAutosave();
            });
            discard.addEventListener('click', async() => {
                offer.remove();
                form.reset();
                updateCounter();
                try {
                    await draftStore.clearDraft();
                } catch (err) { /* non-fatal */ }
                draftStatusEl.textContent = '';
            });
            offer.append(keep, ' · ', discard);
            form.prepend(offer);
        }
    }

    // ---- Validation ----
    const validators = {
        name(value) {
            if (!value.trim()) return 'Please enter your name.';
            return '';
        },
        email(value) {
            if (!value.trim()) return 'Please enter your email address.';
            const ok = /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(value.trim());
            return ok ? '' : 'Please enter a valid email address.';
        },
        phone(value) {
            if (!value.trim()) return '';
            const ok = /^[+()\-.\s\d]{7,20}$/.test(value.trim());
            return ok ? '' : 'Please enter a valid phone number.';
        },
        message(value) {
            if (!value.trim()) return 'Please tell us what you need done.';
            if (value.trim().length < 10) return 'Please add a little more detail.';
            return '';
        },
    };

    function showError(field, message) {
        const el = document.getElementById(`${field.id}-error`);
        if (el) el.textContent = message;
        field.setAttribute('aria-invalid', message ? 'true' : 'false');
        field.closest('.form-group').classList.toggle('has-error', Boolean(message));
    }

    function validateField(field) {
        const validator = validators[field.id];
        if (!validator) return true;
        const error = validator(field.value);
        showError(field, error);
        return !error;
    }

    function validateAll() {
        let allValid = true;
        let firstInvalid = null;
        Object.values(fields).forEach((field) => {
            if (!validators[field.id]) return;
            if (!validateField(field) && !firstInvalid) {
                firstInvalid = field;
                allValid = false;
            }
        });
        if (firstInvalid) firstInvalid.focus();
        return allValid;
    }

    Object.values(fields).forEach((field) => {
        if (!validators[field.id]) return;
        field.addEventListener('blur', () => validateField(field));
        field.addEventListener('input', () => {
            if (field.closest('.form-group').classList.contains('has-error')) {
                validateField(field);
            }
        });
    });

    // ---- Status messages ----
    function setStatus(type, text) {
        statusEl.className = `form-status ${type}`;
        statusEl.textContent = text;
    }

    function clearStatus() {
        statusEl.className = 'form-status';
        statusEl.textContent = '';
    }

    // ---- Spam checks ----
    function failsSpamChecks() {
        const honeypot = document.getElementById('company');
        if (honeypot && honeypot.value.trim() !== '') return true;
        if ((Date.now() - startTime) / 1000 < MIN_FILL_SECONDS) return true;
        return false;
    }

    // ---- Submission ----
    form.addEventListener('submit', async(event) => {
        event.preventDefault();

        if (failsSpamChecks()) {
            setStatus('success', 'Thanks! Your message has been sent.');
            form.reset();
            if (draftStore) await draftStore.clearDraft().catch(() => {});
            updateCounter();
            return;
        }

        if (!validateAll()) return;

        const fd = new FormData(form);
        fd.set('form_duration_seconds', Math.round((Date.now() - startTime) / 1000));

        submitBtn.disabled = true;
        const originalLabel = submitBtn.textContent;
        submitBtn.textContent = 'Sending…';
        clearStatus();

        try {
            const response = await fetch(form.action, {
                method: 'POST',
                body: fd,
                headers: {
                    'Accept': 'application/json'
                },
            });

            if (response.ok) {
                setStatus('success',
                    'Thanks! Your message has been sent. We\u2019ll get back to you shortly. ' +
                    'Please text photos of the job to (603) 359‑8272 so we can give an accurate estimate.');
                form.reset();
                updateCounter();
                if (draftStore) await draftStore.clearDraft().catch(() => {});
                draftStatusEl.textContent = '';
            } else {
                const data = await response.json().catch(() => null);
                const detail = data && Array.isArray(data.errors) && data.errors[0] ?
                    data.errors[0].message : '';
                setStatus('error',
                    `Sorry, something went wrong sending your message.${detail ? ' ' + detail : ''} ` +
                    'Please try again, or call us at (603) 359\u20118272.');
            }
        } catch (err) {
            setStatus('error',
                'No internet connection detected. Your message wasn\u2019t sent — ' +
                'but your draft is saved locally, so you can try again once you\u2019re back online, ' +
                'or call (603) 359\u20118272.');
        } finally {
            submitBtn.disabled = false;
            submitBtn.textContent = originalLabel;
        }
    });
})();
