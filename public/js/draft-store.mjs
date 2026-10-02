/**
 * draft-store.mjs — single-record IndexedDB persistence for form drafts.
 * DB: tn-handyman-drafts, Store: drafts (keyPath: 'id')
 */

const DB_NAME = 'tn-handyman-drafts';
const STORE_NAME = 'drafts';
const DRAFT_ID = 'contact-form';

function openDB() {
    return new Promise((resolve, reject) => {
        const req = indexedDB.open(DB_NAME, 1);
        req.onupgradeneeded = () => {
            const db = req.result;
            if (!db.objectStoreNames.contains(STORE_NAME)) {
                db.createObjectStore(STORE_NAME, {
                    keyPath: 'id'
                });
            }
        };
        req.onsuccess = () => resolve(req.result);
        req.onerror = () => reject(req.error);
    });
}

/** Load the draft record. Resolves to the draft object or null. */
export async function loadDraft() {
    const db = await openDB();
    return new Promise((resolve, reject) => {
        const tx = db.transaction(STORE_NAME, 'readonly');
        const req = tx.objectStore(STORE_NAME).get(DRAFT_ID);
        req.onsuccess = () => resolve(req.result || null);
        req.onerror = () => reject(req.error);
        tx.oncomplete = () => db.close();
    });
}

/**
 * Save the draft.
 * @param {Object} data - Serializable field values, e.g. { name, email, message, ... }
 */
export async function saveDraft(data) {
    const db = await openDB();
    return new Promise((resolve, reject) => {
        const tx = db.transaction(STORE_NAME, 'readwrite');
        tx.objectStore(STORE_NAME).put({
            id: DRAFT_ID,
            data,
            savedAt: Date.now(),
        });
        tx.oncomplete = () => {
            db.close();
            resolve(true);
        };
        tx.onerror = () => reject(tx.error);
    });
}

/** Delete the draft after successful submission. */
export async function clearDraft() {
    const db = await openDB();
    return new Promise((resolve, reject) => {
        const tx = db.transaction(STORE_NAME, 'readwrite');
        tx.objectStore(STORE_NAME).delete(DRAFT_ID);
        tx.oncomplete = () => {
            db.close();
            resolve(true);
        };
        tx.onerror = () => reject(tx.error);
    });
}
