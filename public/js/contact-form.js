/**
 * T&N Handyman — contact-form.js
 * AJAX submission to Formspree, client-side validation, honeypot +
 * time-trap spam protection, character counter, and IndexedDB drafts.
 * Draft persistence lives in /js/draft-store.mjs.
 */

const FORMSPREE_ENDPOINT = 'https://formspree.io/f/moejqzon';
const FORM_LOAD_TIME = Date.now();
const MIN_FILL_MS = 3000; // time-trap: bots submit instantly

const form = document.getElementById('contact-form');
const statusBox = document.getElementById('form-status');
const submitBtn = document.getElementById('submit-btn');
const draftStatus = document.getElementById('draft-status');

const setError = (id, message) => {
    const el = document.getElementById(`${id}-error`);
    const group = document.getElementById(id)?.closest('.form-group');
    if (el) el.textContent = message || '';
    group?.classList.toggle('has-error', Boolean(message));
};

const validators = {
    name: (v) =>
        v.trim().length >= 2 ? '' : 'Please enter your name.',
    _replyto: (v) =>
        /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(v.trim()) ? '' : 'Please enter a valid email address.',
    phone: (v) =>
        v.trim() === '' || /^[+\d][\d\s().-]{6,19}$/.test(v.trim())
            ? ''
            : 'That phone number looks off.',
    service: (v) =>
        v !== '' ? '' : 'Please choose a service.',
    message: (v) =>
        v.trim().length >= 10 ? '' : 'Please describe the job (at least 10 characters).'
};

const runValidation = () => {
    let firstInvalid = null;
    for (const [id, validate] of Object.entries(validators)) {
        const field = document.getElementById(id);
        if (!field) continue;
        const msg = validate(field.value);
        setError(id, msg);
        if (msg && !firstInvalid) firstInvalid = field;
    }
    return firstInvalid;
};

// ---- Character counter ----
const messageField = document.getElementById('message');
const counter = document.getElementById('message-counter');
const MAX_MSG = Number(messageField.getAttribute('maxlength'));

const updateCounter = () => {
    const len = messageField.value.length;
    counter.textContent = `${len} / ${MAX_MSG}`;
    counter.classList.toggle('near-limit', len > MAX_MSG * 0.9);
};
messageField.addEventListener('input', updateCounter);
updateCounter();

// ---- IndexedDB drafts ----
const DRAFT_KEY = 'contact-draft';
const draftFields = ['name', '_replyto', 'phone', 'service', 'message'];
let draftStore = null;

const setDraftStatus = (text) => {
    if (draftStatus) draftStatus.textContent = text;
};

const loadDraft = async () => {
    try {
        const mod = await import('/js/draft-store.mjs');
        draftStore = mod;
        const draft = await draftStore.getDraft(DRAFT_KEY);
        if (!draft) return;

        const hasContent = draftFields.some((id) => {
            const field = document.getElementById(id);
            return field && draft[id] && draft[id].trim() !== '';
        });
        if (!hasContent) return;

        setDraftStatus('A saved draft was found.');
        const restore = document.createElement('button');
        restore.type = 'button';
        restore.className = 'link-btn';
        restore.textContent = 'Restore draft?';
        restore.addEventListener('click', () => {
            draftFields.forEach((id) => {
                const field = document.getElementById(id);
                if (field && draft[id] != null) field.value = draft[id];
            });
            updateCounter();
            setDraftStatus('Draft restored.');
        });
        draftStatus.appendChild(document.createTextNode(' '));
        draftStatus.appendChild(restore);
    } catch {
        // IndexedDB unavailable — drafts silently disabled
    }
};

let draftTimer = null;
form.addEventListener('input', () => {
    if (!draftStore) return;
    clearTimeout(draftTimer);
    draftTimer = setTimeout(async () => {
        const draft = {};
        draftFields.forEach((id) => {
            const field = document.getElementById(id);
            if (field) draft[id] = field.value;
        });
        try {
            await draftStore.saveDraft(DRAFT_KEY, draft);
        } catch { /* ignore */ }
    }, 1000);
});

const clearDraft = async () => {
    try {
        await draftStore?.deleteDraft(DRAFT_KEY);
    } catch { /* ignore */ }
};

loadDraft();

// ---- Submit ----
form.addEventListener('submit', async (event) => {
    event.preventDefault();

    // Spam checks happen before any validation noise
    const honeypot = document.getElementById('company');
    if (honeypot && honeypot.value !== '') return; // silently drop bots

    if (Date.now() - FORM_LOAD_TIME < MIN_FILL_MS) {
        statusBox.className = 'form-status error';
        statusBox.textContent = 'Please take a moment to complete the form.';
        return;
    }

    const firstInvalid = runValidation();
    if (firstInvalid) {
        firstInvalid.focus();
        return;
    }

    const payload = {};
    draftFields.forEach((id) => {
        const field = document.getElementById(id);
        if (field) payload[id] = field.value;
    });

    submitBtn.disabled = true;
    statusBox.className = 'form-status';
    statusBox.textContent = '';

    try {
        const response = await fetch(FORMSPREE_ENDPOINT, {
            method: 'POST',
            headers: {
                'Accept': 'application/json',
                'Content-Type': 'application/json'
            },
            body: JSON.stringify(payload)
        });

        if (response.ok) {
            statusBox.className = 'form-status success';
            statusBox.textContent =
                "Thanks! Your message is on its way — we'll get back to you shortly.";
            form.reset();
            updateCounter();
            clearDraft();
        } else if (response.status === 400 || response.status === 422) {
            const data = await response.json().catch(() => null);
            statusBox.className = 'form-status error';
            statusBox.textContent =
                data?.errors?.map((e) => e.message).join(' ') ||
                'Some fields need attention — please review and try again.';
            runValidation();
        } else {
            throw new Error(`Formspree responded ${response.status}`);
        }
    } catch {
        statusBox.className = 'form-status error';
        statusBox.textContent =
            'Something went wrong sending your message. Please try again, or call/text (603) 359-8272.';
    } finally {
        submitBtn.disabled = false;
    }
});
