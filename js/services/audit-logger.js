/**
 * audit-logger.js — SOLUCIÓN #7: Registro Centralizado de Auditoría
 * Registra TODAS las acciones importantes con contexto completo:
 * - Quién (usuario UID + email)
 * - Qué (tipo de acción)
 * - Cuándo (timestamp de cliente + servidor)
 * - Dónde (IP + user agent del cliente)
 * - Cambios (antes → después)
 */

class AuditLogger {
    constructor() {
        this.matchId = null;
        this.currentUser = null;
        this.actionQueue = [];  // Encolar acciones si offline
        this.isOnline = navigator.onLine;
    }

    init(matchId) {
        this.matchId = matchId;
        this.currentUser = window._cronosCurrentUser || {};
        
        // Escuchar cambios de conectividad
        window.addEventListener('online', () => { this.isOnline = true; this.flushQueue(); });
        window.addEventListener('offline', () => { this.isOnline = false; });
    }

    /**
     * Registrar acción de jugador (gol, tarjeta, lesión, sustitución)
     * Llamado DESPUÉS de la acción local, envía al servidor para validación + auditoría
     */
    async logPlayerAction(playerId, playerName, playerNumber, action, value, changeDetails = {}) {
        if (!this.matchId || !playerId) return;

        const auditEntry = {
            matchId: this.matchId,
            playerId,
            playerName,
            playerNumber,
            action,           // 'goal', 'yellow_card', 'red_card', 'injury', 'substitute'
            value,
            userId: this.currentUser.uid,
            userEmail: this.currentUser.email,
            role: this.currentUser.role,
            timestamp: new Date().toISOString(),
            
            // Cambios registrados (antes → después)
            changes: changeDetails,  // ej: { goals: { before: 2, after: 3 } }
            
            // Contexto del cliente
            clientTimestamp: Date.now(),
            deviceInfo: {
                userAgent: navigator.userAgent,
                language: navigator.language,
                platform: navigator.platform,
                online: this.isOnline
            }
        };

        if (this.isOnline) {
            await this._sendAuditLog(auditEntry);
        } else {
            this._queueAuditLog(auditEntry);
        }
    }

    /**
     * Registrar cambio de sustitución (más complejo)
     */
    async logSubstitution(outPlayerId, outPlayerName, inPlayerId, inPlayerName, subId) {
        if (!this.matchId) return;

        const subEntry = {
            matchId: this.matchId,
            type: 'substitution',
            outPlayerId,
            outPlayerName,
            inPlayerId,
            inPlayerName,
            substitutionId: subId,
            userId: this.currentUser.uid,
            userEmail: this.currentUser.email,
            timestamp: new Date().toISOString(),
            clientTimestamp: Date.now(),
            deviceInfo: {
                userAgent: navigator.userAgent,
                platform: navigator.platform
            }
        };

        if (this.isOnline) {
            await this._sendAuditLog(subEntry);
        } else {
            this._queueAuditLog(subEntry);
        }
    }

    /**
     * Registrar cambio de formación/táctica
     */
    async logFormationChange(formationId, formationName, teamId) {
        if (!this.matchId) return;

        const formEntry = {
            matchId: this.matchId,
            type: 'formation_change',
            formationId,
            formationName,
            teamId,
            userId: this.currentUser.uid,
            userEmail: this.currentUser.email,
            timestamp: new Date().toISOString(),
            clientTimestamp: Date.now()
        };

        if (this.isOnline) {
            await this._sendAuditLog(formEntry);
        } else {
            this._queueAuditLog(formEntry);
        }
    }

    /**
     * Enviar log al servidor (Cloud Function validada)
     */
    async _sendAuditLog(entry) {
        const fa = window._cronos_auth;
        if (!fa || !fa.functions) return;

        try {
            const { httpsCallable } = await import('https://www.gstatic.com/firebasejs/10.12.2/firebase-functions.js');
            const logAuditEntry = httpsCallable(fa.functions, 'logAuditEntry');
            
            const result = await logAuditEntry(entry);
            return result.data;
        } catch (e) {
            // Si falla: encolar para reintentar luego
            this._queueAuditLog(entry);
        }
    }

    /**
     * Encolar acción offline
     */
    _queueAuditLog(entry) {
        this.actionQueue.push(entry);
        // Guardar en IndexedDB para persistencia
        if (window.OfflineManager) {
            window.OfflineManager.saveEvent({
                type: 'audit_log',
                data: entry
            }).catch(() => {});
        }
    }

    /**
     * Vaciar cola cuando vuelve conexión
     */
    async flushQueue() {
        if (!this.isOnline || this.actionQueue.length === 0) return;

        const pending = [...this.actionQueue];
        this.actionQueue = [];

        for (const entry of pending) {
            await this._sendAuditLog(entry);
        }
    }

    /**
     * Obtener historial de auditoría de un jugador
     */
    async getPlayerAuditTrail(playerId) {
        const fa = window._cronos_auth;
        if (!fa || !fa.db) return [];

        try {
            const { query, collection, where, getDocs } = await import('https://www.gstatic.com/firebasejs/10.12.2/firebase-firestore.js');
            
            const q = query(
                collection(fa.db, 'audit_logs'),
                where('matchId', '==', this.matchId),
                where('playerId', '==', playerId)
            );
            
            const snap = await getDocs(q);
            return snap.docs.map(doc => doc.data());
        } catch (e) {
            return [];
        }
    }

    /**
     * Obtener historial de auditoría del partido completo
     */
    async getMatchAuditTrail(limit = 50) {
        const fa = window._cronos_auth;
        if (!fa || !fa.db) return [];

        try {
            const { query, collection, where, orderBy, getDocs, limit: fbLimit } = 
                await import('https://www.gstatic.com/firebasejs/10.12.2/firebase-firestore.js');
            
            const q = query(
                collection(fa.db, 'audit_logs'),
                where('matchId', '==', this.matchId),
                orderBy('timestamp', 'desc'),
                fbLimit(limit)
            );
            
            const snap = await getDocs(q);
            return snap.docs.map(doc => doc.data());
        } catch (e) {
            return [];
        }
    }
}

// Instancia global única
window.auditLogger = new AuditLogger();
