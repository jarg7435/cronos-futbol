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

    async sync() {
        console.log('[OfflineManager] Sincronizando eventos pendientes…');
    }
}

// Exponer globalmente y auto-inicializar
window.OfflineManager = OfflineManager;
window._cronosOffline = new OfflineManager();
window._cronosOffline.init().catch(e =>
    console.warn('[OfflineManager] init error:', e)
);
