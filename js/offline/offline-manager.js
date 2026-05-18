/**
 * Chronos Fútbol - OfflineManager v8.0
 * Gestiona el almacenamiento local seguro (IndexedDB) y la sincronización.
 *
 * FIXED: eliminado 'export default' — se usa como script normal (window.OfflineManager)
 */

class OfflineManager {
    constructor(dbName, version) {
        this.dbName  = dbName  || 'chronos-futbol-db';
        this.version = version || 1;
        this.db      = null;
        this.isOnline = navigator.onLine;
    }

    async init() {
        return new Promise((resolve, reject) => {
            const request = indexedDB.open(this.dbName, this.version);

            request.onupgradeneeded = (e) => {
                const db = e.target.result;
                if (!db.objectStoreNames.contains('events')) {
                    db.createObjectStore('events', { keyPath: 'id', autoIncrement: true });
                }
            };

            request.onsuccess = (e) => {
                this.db = e.target.result;
                window.addEventListener('online',  () => { this.isOnline = true;  this.sync(); });
                window.addEventListener('offline', () => { this.isOnline = false; });
                resolve();
            };

            request.onerror = () => reject(request.error);
        });
    }

    async saveEvent(event) {
        if (!this.db) return;
        const data = { ...event, timestamp: Date.now(), synced: false };
        const tx   = this.db.transaction('events', 'readwrite');
        tx.objectStore('events').add(data);
        if (this.isOnline) this.sync();
    }

    // ── Obtener todos los eventos no sincronizados ───────────────────
    async _getPending() {
        return new Promise((resolve, reject) => {
            const tx    = this.db.transaction('events', 'readonly');
            const store = tx.objectStore('events');
            const req   = store.getAll();
            req.onsuccess = () => resolve((req.result || []).filter(e => !e.synced));
            req.onerror   = () => reject(req.error);
        });
    }

    // ── Marcar un evento como sincronizado en IndexedDB ───────────────
    async _markSynced(id) {
        return new Promise((resolve) => {
            const tx    = this.db.transaction('events', 'readwrite');
            const store = tx.objectStore('events');
            const req   = store.get(id);
            req.onsuccess = () => {
                if (req.result) {
                    const updated = { ...req.result, synced: true, syncedAt: Date.now() };
                    store.put(updated);
                }
                resolve();
            };
            req.onerror = () => resolve(); // no bloquear si falla
        });
    }

    // ── Sincronizar eventos pendientes con Firestore ──────────────────
    async sync() {
        if (!this.db || !this.isOnline) return;

        const pending = await this._getPending().catch(() => []);
        if (!pending.length) return;

        console.log(`[OfflineManager] Sincronizando ${pending.length} evento(s) pendiente(s)…`);

        const fa = window._cronos_auth;
        if (!fa || !fa.db) {
            console.warn('[OfflineManager] Firebase no disponible — reintentando más tarde.');
            return;
        }

        try {
            const { doc, setDoc, serverTimestamp } =
                await import('https://www.gstatic.com/firebasejs/10.12.2/firebase-firestore.js');

            let synced = 0;
            for (const event of pending) {
                try {
                    const docId = 'offline_' + (event.id || Date.now()) + '_' +
                                  Math.random().toString(36).substr(2, 4);
                    await setDoc(doc(fa.db, 'offline_events', docId), {
                        ...event,
                        syncedAt:  serverTimestamp(),
                        deviceTs:  event.timestamp || null,
                        userUid:   window._cronosCurrentUser?.uid   || null,
                        userEmail: window._cronosCurrentUser?.email || null,
                    });
                    await this._markSynced(event.id);
                    synced++;
                } catch (itemErr) {
                    // Si un evento falla individualmente, continuar con los demás
                    console.warn('[OfflineManager] Error sincronizando evento', event.id, itemErr.message);
                    // Detener si es un error de red (no tiene sentido seguir)
                    if (!this.isOnline) break;
                }
            }

            if (synced > 0) {
                console.log(`[OfflineManager] ✅ ${synced}/${pending.length} evento(s) sincronizado(s).`);
                // Notificar a la UI si hay un listener registrado
                if (typeof window._onOfflineSyncComplete === 'function') {
                    window._onOfflineSyncComplete(synced);
                }
            }
        } catch (err) {
            console.warn('[OfflineManager] Error general en sync:', err.message);
        }
    }
}

// Exponer globalmente y auto-inicializar
window.OfflineManager = OfflineManager;
window._cronosOffline = new OfflineManager();
window._cronosOffline.init().catch(e =>
    console.warn('[OfflineManager] init error:', e)
);
