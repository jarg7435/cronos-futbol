/**
 * Chronos Fútbol - OfflineManager v8.0
 * Gestiona el almacenamiento local seguro (IndexedDB) y la sincronización.
 */

export default class OfflineManager {
    constructor(dbName = 'chronos-futbol-db', version = 1) {
        this.dbName = dbName;
        this.version = version;
        this.db = null;
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
                window.addEventListener('online', () => { this.isOnline = true; this.sync(); });
                window.addEventListener('offline', () => { this.isOnline = false; });
                resolve();
            };
            request.onerror = () => reject(request.error);
        });
    }

    async saveEvent(event) {
        const data = { ...event, timestamp: Date.now(), synced: false };
        const tx = this.db.transaction('events', 'readwrite');
        tx.objectStore('events').add(data);
        if (this.isOnline) this.sync();
    }

    async sync() {
        // Lógica de sincronización con Firestore
        console.log("Sincronizando eventos pendientes...");
    }
}
