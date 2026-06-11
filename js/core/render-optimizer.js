/**
 * render-optimizer.js — SOLUCIÓN #2: Optimización de Rendimiento
 * Uso de RequestAnimationFrame (RAF) para sincronizar renders con refresh de pantalla
 * Virtualización para evitar DOM updates innecesarios
 */

class RenderOptimizer {
    constructor() {
        this.updateScheduled = false;
        this.pendingUpdates = new Set();
        this.rafId = null;
        this.lastRenderTime = 0;
        this.renderStats = { count: 0, totalMs: 0 };
    }

    /**
     * Agendar actualización de UI en próximo animation frame
     * Evita múltiples renders en el mismo frame
     */
    scheduleRender(renderFn, priority = 'normal') {
        if (typeof renderFn !== 'function') return;
        // Encolar TODAS las funciones pendientes (antes solo se ejecutaba la
        // primera del frame, descartando el resto → los cronómetros de
        // jugadores nunca se repintaban y quedaban en 00:00).
        this.pendingUpdates.add({ fn: renderFn, priority });

        if (!this.updateScheduled) {
            this.updateScheduled = true;
            this.rafId = requestAnimationFrame((timestamp) => {
                this._flushRenders(timestamp);
            });
        }
    }

    /**
     * Ejecutar TODOS los renders pendientes con medición de performance.
     * Las de prioridad 'high' se ejecutan primero.
     */
    _flushRenders(timestamp) {
        const startTime = performance.now();

        // Snapshot + limpiar antes de ejecutar (un render puede reprogramar otro)
        const queue = Array.from(this.pendingUpdates);
        this.pendingUpdates.clear();
        this.updateScheduled = false;
        this.rafId = null;

        queue.sort((a, b) => (b.priority === 'high' ? 1 : 0) - (a.priority === 'high' ? 1 : 0));

        for (const item of queue) {
            try {
                item.fn();
            } catch (e) {
                console.error('Error en renderizado:', e);
            }
        }

        const duration = performance.now() - startTime;
        this.lastRenderTime = duration;
        this.renderStats.count++;
        this.renderStats.totalMs += duration;

        // Log de perf si excede 16ms (causa lag en 60fps)
        if (duration > 16) {
            console.warn(`⚠️ Render lento: ${duration.toFixed(2)}ms (target: <16ms)`);
        }
    }

    /**
     * Obtener estadísticas de performance
     */
    getStats() {
        return {
            renders: this.renderStats.count,
            avgMs: this.renderStats.count > 0 
                ? (this.renderStats.totalMs / this.renderStats.count).toFixed(2)
                : 0,
            lastRenderMs: this.lastRenderTime.toFixed(2)
        };
    }

    /**
     * Resetear estadísticas
     */
    resetStats() {
        this.renderStats = { count: 0, totalMs: 0 };
    }

    /**
     * Cancelar renders pendientes
     */
    cancel() {
        if (this.rafId) {
            cancelAnimationFrame(this.rafId);
            this.updateScheduled = false;
            this.rafId = null;
        }
    }
}

/**
 * VIRTUALIZACIÓN: Renderizar solo jugadores visibles en viewport
 */
class PlayerListVirtualizer {
    constructor(containerSelector, itemHeight = 60) {
        this.container = document.querySelector(containerSelector);
        this.itemHeight = itemHeight;
        this.visibleRange = { start: 0, end: 0 };
    }

    /**
     * Obtener jugadores visibles basado en scroll
     */
    getVisiblePlayers(allPlayers) {
        if (!this.container) return allPlayers;

        const containerRect = this.container.getBoundingClientRect();
        const scrollTop = this.container.scrollTop || window.scrollY;
        
        const visibleStart = Math.floor(scrollTop / this.itemHeight);
        const visibleCount = Math.ceil(containerRect.height / this.itemHeight);
        const visibleEnd = Math.min(visibleStart + visibleCount + 2, allPlayers.length);
        
        // Buffer de 2 items antes y después para transiciones suaves
        this.visibleRange = { 
            start: Math.max(0, visibleStart - 2), 
            end: visibleEnd 
        };

        return allPlayers.slice(this.visibleRange.start, this.visibleRange.end);
    }

    /**
     * Verificar si jugador está en rango visible
     */
    isVisible(index) {
        return index >= this.visibleRange.start && index < this.visibleRange.end;
    }
}

/**
 * DEBOUNCING de UI updates
 * Agrupa múltiples cambios en una sola actualización
 */
class DebounceRender {
    constructor(delayMs = 300) {
        this.delayMs = delayMs;
        this.timer = null;
        this.pendingRender = null;
    }

    /**
     * Agendar render con debounce
     */
    schedule(renderFn) {
        if (this.timer) clearTimeout(this.timer);
        
        this.pendingRender = renderFn;
        this.timer = setTimeout(() => {
            if (this.pendingRender) {
                this.pendingRender();
            }
            this.timer = null;
            this.pendingRender = null;
        }, this.delayMs);
    }

    /**
     * Cancelar render pendiente
     */
    cancel() {
        if (this.timer) {
            clearTimeout(this.timer);
            this.timer = null;
            this.pendingRender = null;
        }
    }
}

/**
 * Optimizar actualización de DOM
 * Batch updates para minimizar reflows/repaints
 */
class BatchDomUpdate {
    constructor() {
        this.updates = [];
    }

    /**
     * Agregar actualización a batch
     */
    add(element, updateFn) {
        this.updates.push({ element, updateFn });
    }

    /**
     * Ejecutar todas las actualizaciones de una vez
     */
    execute() {
        if (this.updates.length === 0) return;

        // Agrupar por tipo de actualización para minimizar reflows
        const styleUpdates = [];
        const domUpdates = [];

        this.updates.forEach(({ element, updateFn }) => {
            if (typeof updateFn === 'function') {
                updateFn(element);
            }
        });

        this.updates = [];
    }

    /**
     * Limpiar
     */
    clear() {
        this.updates = [];
    }
}

// Instancias globales
window.renderOptimizer = new RenderOptimizer();
window.playerVirtualizer = new PlayerListVirtualizer('.sidebar');  // Ajustar selector según tu HTML
window.debounceRender = new DebounceRender(250);
window.batchDomUpdate = new BatchDomUpdate();

/**
 * Helper: Renderizar jugadores optimizado
 * Usa todas las técnicas anteriores
 */
async function renderPlayersOptimized() {
    if (!window.renderOptimizer) return;

    window.renderOptimizer.scheduleRender(() => {
        // 1. Obtener jugadores visibles en viewport
        const visibleHome = window.playerVirtualizer.getVisiblePlayers(
            players.filter(p => p.team === 'home')
        );
        const visibleAway = window.playerVirtualizer.getVisiblePlayers(
            players.filter(p => p.team === 'away')
        );

        // 2. Batch update de DOM
        window.batchDomUpdate.clear();

        visibleHome.forEach(p => updatePlayerUI(p));
        visibleAway.forEach(p => updatePlayerUI(p));

        // 3. Ejecutar batch
        window.batchDomUpdate.execute();
    });
}
