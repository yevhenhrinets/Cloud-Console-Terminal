// missions-store.js — Надежное хранилище поручений (Missions) с фиксацией времени выполнения и таймзоны
// Архитектура: Offline-First + Упорядоченная очередь мутаций (Ops Queue) + Монотонный замок выполнения + Единый облачный источник истины (Supabase REST)
// Гарантия: если на другом устройстве дата добавления ниже даты выполнения (created_at <= completed_at), задача НИКОГДА не вернётся в невыполненные.

(function(window) {
    const STORAGE_KEY = 'cloud_missions_store';
    const OPS_QUEUE_KEY = 'cloud_missions_ops_queue';
    const COMPLETION_LOCKS_KEY = 'cloud_missions_completion_locks_v1';
    const DELETED_KEY = 'cloud_missions_deleted';
    const LAST_SYNC_KEY = 'cloud_missions_last_sync';

    function getFormattedTimezone(dateInput = new Date()) {
        const d = dateInput instanceof Date ? dateInput : new Date(dateInput);
        if (isNaN(d.getTime())) return '';

        const dateStr = d.toLocaleDateString('ru-RU', {
            day: '2-digit',
            month: '2-digit',
            year: 'numeric'
        });
        const timeStr = d.toLocaleTimeString('ru-RU', {
            hour: '2-digit',
            minute: '2-digit',
            second: '2-digit'
        });

        const offsetMin = -d.getTimezoneOffset();
        const sign = offsetMin >= 0 ? '+' : '-';
        const absMin = Math.abs(offsetMin);
        const hours = String(Math.floor(absMin / 60)).padStart(2, '0');
        const mins = String(absMin % 60).padStart(2, '0');
        const offsetStr = `GMT${sign}${hours}:${mins}`;

        let tzName = '';
        try {
            tzName = Intl.DateTimeFormat().resolvedOptions().timeZone || '';
        } catch (e) {
            tzName = '';
        }

        const tzLabel = tzName ? `${offsetStr}, ${tzName}` : offsetStr;
        return `${dateStr} ${timeStr} (${tzLabel})`;
    }

    function formatTimeAgo(dateInput, nowMs = Date.now()) {
        if (!dateInput) return '';
        const ts = dateInput instanceof Date ? dateInput.getTime() : new Date(dateInput).getTime();
        if (!Number.isFinite(ts) || ts <= 0) return '';

        const diffSec = Math.max(0, Math.floor((nowMs - ts) / 1000));
        if (diffSec < 60) return 'только что';

        const diffMin = Math.floor(diffSec / 60);
        if (diffMin < 60) return `${diffMin} мин. назад`;

        const diffHours = Math.floor(diffMin / 60);
        if (diffHours < 24) return `${diffHours} ч. назад`;

        const diffDays = Math.floor(diffHours / 24);
        if (diffDays < 30) return `${diffDays} дн. назад`;

        const diffMonths = Math.floor(diffDays / 30);
        if (diffMonths < 12) return `${diffMonths} мес. назад`;

        const diffYears = Math.floor(diffDays / 365);
        return `${diffYears} г. назад`;
    }

    function toTimeMs(val) {
        if (!val) return 0;
        const ms = val instanceof Date ? val.getTime() : new Date(val).getTime();
        return Number.isFinite(ms) ? ms : 0;
    }

    function isCancelledStatus(raw) {
        return String(raw && raw.status || '').toLowerCase() === 'cancelled';
    }

    function isClosedMission(raw) {
        if (!raw) return false;
        return Boolean(isCancelledStatus(raw) || raw.status === 'completed' || raw.completed_at);
    }

    function normalizeRecord(raw) {
        const cancelled = isCancelledStatus(raw);
        const isClosed = cancelled || Boolean(raw.completed_at || raw.status === 'completed');
        const createdAt = raw.created_at || new Date().toISOString();
        const completedAt = isClosed ? (raw.completed_at || new Date().toISOString()) : null;
        return {
            id: String(raw.id),
            title: String(raw.title || ''),
            position: Number(raw.position) > 0 ? Number(raw.position) : 1,
            status: cancelled ? 'cancelled' : (isClosed ? 'completed' : 'pending'),
            created_at: createdAt,
            created_display: raw.created_display || getFormattedTimezone(createdAt),
            completed_at: completedAt,
            completed_display: isClosed ? (raw.completed_display || getFormattedTimezone(completedAt)) : null,
            created_by: raw.created_by || 'guest'
        };
    }

    function toDbRow(m) {
        const cancelled = isCancelledStatus(m);
        const isClosed = cancelled || Boolean(m.completed_at || m.status === 'completed');
        const createdAt = m.created_at || new Date().toISOString();
        return {
            id: String(m.id),
            title: String(m.title || ''),
            position: Number(m.position) > 0 ? Number(m.position) : 1,
            status: cancelled ? 'cancelled' : (isClosed ? 'completed' : 'pending'),
            created_at: createdAt,
            created_display: m.created_display || getFormattedTimezone(createdAt),
            completed_at: isClosed ? m.completed_at : null,
            completed_display: isClosed ? (m.completed_display || getFormattedTimezone(m.completed_at)) : null,
            created_by: m.created_by || 'guest'
        };
    }

    function rowDiffersFromDb(localNorm, remoteRaw) {
        if (!remoteRaw) return true;
        const r = normalizeRecord(remoteRaw);
        return (
            localNorm.status !== r.status ||
            Number(localNorm.position) !== Number(r.position) ||
            String(localNorm.title) !== String(r.title) ||
            String(localNorm.created_at || '') !== String(r.created_at || '') ||
            String(localNorm.completed_at || '') !== String(r.completed_at || '')
        );
    }

    function sortActiveList(list) {
        return list
            .filter(m => !isClosedMission(m))
            .sort((a, b) => {
                const posA = (a.position === null || a.position === undefined || Number(a.position) <= 0) ? 999999 : Number(a.position);
                const posB = (b.position === null || b.position === undefined || Number(b.position) <= 0) ? 999999 : Number(b.position);
                if (posA !== posB) return posA - posB;
                return new Date(a.created_at || 0).getTime() - new Date(b.created_at || 0).getTime();
            });
    }

    function isOfflineNetworkError(err) {
        if (typeof navigator !== 'undefined' && navigator.onLine === false) return true;
        const msg = String(err && (err.message || err) || '').toLowerCase();
        return (
            msg.includes('failed to fetch') ||
            msg.includes('networkerror') ||
            msg.includes('network request failed') ||
            msg.includes('load failed') ||
            msg.includes('err_internet_disconnected') ||
            (err && err.name === 'TypeError' && !err.status)
        );
    }

    class MissionsStoreClass {
        constructor() {
            this.missions = [];
            this.pendingOps = [];
            this.completionLocks = {};
            this.opSeqCounter = 0;
            this.isSyncingWithSupabase = false;
            this._activeSyncPromise = null;
            this._syncRequestedAgain = false;
            this.syncStatus = (typeof navigator !== 'undefined' && navigator.onLine === false) ? 'offline' : 'local';
            this.lastError = null;
            this.lastSyncTime = localStorage.getItem(LAST_SYNC_KEY) || null;
            this.remoteCount = null;
            this.init();
        }

        loadCompletionLocks() {
            try {
                const raw = localStorage.getItem(COMPLETION_LOCKS_KEY);
                const parsed = raw ? JSON.parse(raw) : {};
                return (parsed && typeof parsed === 'object' && !Array.isArray(parsed)) ? parsed : {};
            } catch (e) {
                return {};
            }
        }

        saveCompletionLocks(map) {
            this.completionLocks = (map && typeof map === 'object') ? map : {};
            try {
                localStorage.setItem(COMPLETION_LOCKS_KEY, JSON.stringify(this.completionLocks));
            } catch (e) {}
        }

        recordCompletionLock(mission) {
            if (!mission || !mission.id) return;
            if (!isClosedMission(mission) || !mission.completed_at) return;

            const locks = this.loadCompletionLocks();
            const id = String(mission.id);
            const newCompletedMs = toTimeMs(mission.completed_at);
            const prev = locks[id];
            const prevCompletedMs = prev ? toTimeMs(prev.completed_at) : 0;
            const resolvedStatus = isCancelledStatus(mission) ? 'cancelled' : 'completed';

            if (!prev || newCompletedMs >= prevCompletedMs) {
                locks[id] = {
                    id,
                    status: resolvedStatus,
                    title: String(mission.title || (prev && prev.title) || ''),
                    created_at: mission.created_at || (prev && prev.created_at) || new Date().toISOString(),
                    completed_at: mission.completed_at,
                    completed_display: mission.completed_display || getFormattedTimezone(mission.completed_at)
                };
                this.saveCompletionLocks(locks);
            }
        }

        removeCompletionLock(id) {
            const locks = this.loadCompletionLocks();
            const key = String(id);
            if (locks[key]) {
                delete locks[key];
                this.saveCompletionLocks(locks);
            }
        }

        syncLocksFromList(list) {
            const locks = this.loadCompletionLocks();
            let changed = false;
            (list || []).forEach(m => {
                if (!m || !m.id) return;
                if (!isClosedMission(m) || !m.completed_at) return;
                const id = String(m.id);
                const compMs = toTimeMs(m.completed_at);
                const prev = locks[id];
                const resolvedStatus = isCancelledStatus(m) ? 'cancelled' : 'completed';
                if (!prev || compMs >= toTimeMs(prev.completed_at)) {
                    locks[id] = {
                        id,
                        status: resolvedStatus,
                        title: String(m.title || (prev && prev.title) || ''),
                        created_at: m.created_at || (prev && prev.created_at) || new Date().toISOString(),
                        completed_at: m.completed_at,
                        completed_display: m.completed_display || getFormattedTimezone(m.completed_at)
                    };
                    changed = true;
                }
            });
            if (changed) this.saveCompletionLocks(locks);
            else this.completionLocks = locks;
            return locks;
        }

        // Если дата добавления записи ниже/равна дате выполнения/отмены и не было явного более позднего возврата —
        // задача НЕ имеет права возвращаться в невыполненные (pending).
        enforceCompletionWatermark(list, locksOverride = null) {
            const locks = locksOverride || this.loadCompletionLocks();
            const healedIds = new Set();

            const result = (list || []).map(item => {
                const norm = normalizeRecord(item);
                const lock = locks[norm.id];
                if (!lock || !lock.completed_at) {
                    if (norm.completed_at) this.recordCompletionLock(norm);
                    return norm;
                }

                const lockCompletedMs = toTimeMs(lock.completed_at);
                const itemCreatedMs = toTimeMs(norm.created_at);
                const lockStatus = lock.status === 'cancelled' ? 'cancelled' : 'completed';

                if (norm.status === 'pending') {
                    // Критическая гарантия: если дата добавления <= дате закрытия — в невыполненные больше не возвращаем!
                    if (itemCreatedMs <= lockCompletedMs) {
                        norm.status = lockStatus;
                        norm.completed_at = lock.completed_at;
                        norm.completed_display = lock.completed_display || getFormattedTimezone(lock.completed_at);
                        healedIds.add(norm.id);
                    } else {
                        // Явный ручной restore на другом устройстве (created_at > completed_at) снимает блокировку
                        this.removeCompletionLock(norm.id);
                    }
                } else {
                    const normCompletedMs = toTimeMs(norm.completed_at);
                    if (lockCompletedMs > normCompletedMs) {
                        norm.status = lockStatus;
                        norm.completed_at = lock.completed_at;
                        norm.completed_display = lock.completed_display || getFormattedTimezone(lock.completed_at);
                        healedIds.add(norm.id);
                    }
                }
                return norm;
            });

            return { list: result, healedIds };
        }

        init() {
            this.completionLocks = this.loadCompletionLocks();

            // 1. Загружаем отложенную очередь оффлайн-операций и очищаем устаревший legacy-ключ DELETED_KEY
            try {
                const opsRaw = localStorage.getItem(OPS_QUEUE_KEY);
                const parsedOps = opsRaw ? JSON.parse(opsRaw) : [];
                this.pendingOps = Array.isArray(parsedOps) ? parsedOps : [];

                const legacyBulkDeletes = this.pendingOps.filter(o => o && o.type === 'delete' && !o.userInitiated);
                if (legacyBulkDeletes.length > 3) {
                    this.pendingOps = this.pendingOps.filter(o => !(o && o.type === 'delete' && !o.userInitiated));
                    this.saveOpsQueue();
                }

                this.opSeqCounter = this.pendingOps.reduce((max, op) => Math.max(max, Number(op.seq) || 0), 0);
            } catch (e) {
                this.pendingOps = [];
            }

            try {
                localStorage.removeItem(DELETED_KEY);
            } catch (e) {}

            // 2. Загружаем локальный кэш поручений и применяем защиту от отката выполненных задач
            const saved = localStorage.getItem(STORAGE_KEY);
            if (saved) {
                try {
                    const parsed = JSON.parse(saved);
                    if (Array.isArray(parsed)) {
                        const normalized = parsed.map(normalizeRecord);
                        this.syncLocksFromList(normalized);
                        this.missions = this.enforceCompletionWatermark(normalized).list;
                        this.reindexActiveMissions();
                    }
                } catch (e) {
                    console.error('Ошибка парсинга заданий из localStorage:', e);
                    this.missions = [];
                }
            } else {
                this.missions = [];
            }

            // 3. Автоматические слушатели сети, фокуса и других вкладок
            if (typeof window !== 'undefined') {
                window.addEventListener('online', () => {
                    this.trySyncSupabase(false).catch(() => {});
                });

                window.addEventListener('offline', () => {
                    this.syncStatus = 'offline';
                    this.notify();
                });

                window.addEventListener('focus', () => {
                    if (navigator.onLine !== false) {
                        this.trySyncSupabase(false).catch(() => {});
                    }
                });

                document.addEventListener('visibilitychange', () => {
                    if (document.visibilityState === 'visible' && navigator.onLine !== false) {
                        this.trySyncSupabase(false).catch(() => {});
                    } else if (document.visibilityState === 'hidden' && navigator.onLine !== false) {
                        this.flushPendingWithKeepalive();
                    }
                });

                window.addEventListener('pagehide', () => {
                    if (navigator.onLine !== false) {
                        this.flushPendingWithKeepalive();
                    }
                });

                window.addEventListener('storage', (event) => {
                    if (event.key === COMPLETION_LOCKS_KEY) {
                        this.completionLocks = this.loadCompletionLocks();
                    }
                    if (event.key === STORAGE_KEY && event.newValue) {
                        try {
                            const parsed = JSON.parse(event.newValue);
                            if (Array.isArray(parsed)) {
                                this.missions = this.enforceCompletionWatermark(parsed.map(normalizeRecord)).list;
                                this.notify();
                            }
                        } catch (e) {}
                    } else if (event.key === OPS_QUEUE_KEY && event.newValue) {
                        try {
                            const parsedOps = JSON.parse(event.newValue);
                            if (Array.isArray(parsedOps)) {
                                this.pendingOps = parsedOps;
                                this.notify();
                            }
                        } catch (e) {}
                    }
                });
            }

            // 4. Немедленная начальная синхронизация с Supabase при открытии страницы
            this.trySyncSupabase(false).catch(err => {
                console.warn('Начальная синхронизация поручений:', err);
            });
        }

        saveLocal() {
            try {
                this.syncLocksFromList(this.missions);
                localStorage.setItem(STORAGE_KEY, JSON.stringify(this.missions));
                this.notify();
            } catch (e) {
                console.error('Ошибка сохранения заданий в localStorage:', e);
            }
        }

        saveOpsQueue() {
            try {
                localStorage.setItem(OPS_QUEUE_KEY, JSON.stringify(this.pendingOps));
            } catch (e) {
                console.error('Ошибка сохранения очереди операций в localStorage:', e);
            }
        }

        enqueueOp(type, payload) {
            const now = Date.now();
            const op = {
                opId: 'op_' + now + '_' + (++this.opSeqCounter) + '_' + Math.random().toString(36).slice(2, 6),
                seq: this.opSeqCounter,
                ts: now,
                type,
                userInitiated: true,
                payload
            };
            this.pendingOps.push(op);
            this.saveOpsQueue();
            return op;
        }

        getPendingOpsCount() {
            return Array.isArray(this.pendingOps) ? this.pendingOps.length : 0;
        }

        notify() {
            window.dispatchEvent(new CustomEvent('missions:updated', {
                detail: {
                    missions: this.missions,
                    active: this.getActiveMissions(),
                    all: this.getAllMissions(),
                    syncStatus: this.syncStatus,
                    lastError: this.lastError,
                    lastSyncTime: this.lastSyncTime,
                    remoteCount: this.remoteCount,
                    pendingOpsCount: this.getPendingOpsCount()
                }
            }));
        }

        formatError(err) {
            if (!err) return null;
            const now = new Date().toLocaleTimeString('ru-RU');
            return {
                message: err.message || String(err),
                code: err.code || err.status || 'ERROR',
                details: err.details || '',
                hint: err.hint || '',
                status: err.status || 0,
                time: now
            };
        }

        getFormattedTimezone(date) {
            return getFormattedTimezone(date);
        }

        formatTimeAgo(dateInput, nowMs) {
            return formatTimeAgo(dateInput, nowMs);
        }

        getActiveMissions() {
            return sortActiveList(this.missions);
        }

        getCompletedMissions() {
            return this.missions
                .filter(m => isClosedMission(m))
                .sort((a, b) => {
                    const ta = new Date(a.completed_at || 0).getTime();
                    const tb = new Date(b.completed_at || 0).getTime();
                    if (tb !== ta) return tb - ta;
                    const ca = new Date(a.created_at || 0).getTime();
                    const cb = new Date(b.created_at || 0).getTime();
                    if (cb !== ca) return cb - ca;
                    return String(b.id).localeCompare(String(a.id));
                });
        }

        getAllMissions() {
            return [...this.missions].sort((a, b) => {
                const aDone = isClosedMission(a);
                const bDone = isClosedMission(b);
                if (!aDone && bDone) return -1;
                if (aDone && !bDone) return 1;
                if (!aDone && !bDone) {
                    const posA = (a.position === null || a.position === undefined || Number(a.position) <= 0) ? 999999 : Number(a.position);
                    const posB = (b.position === null || b.position === undefined || Number(b.position) <= 0) ? 999999 : Number(b.position);
                    if (posA !== posB) return posA - posB;
                    return new Date(a.created_at || 0).getTime() - new Date(b.created_at || 0).getTime();
                }
                const ta = new Date(a.completed_at || 0).getTime();
                const tb = new Date(b.completed_at || 0).getTime();
                if (tb !== ta) return tb - ta;
                const ca = new Date(a.created_at || 0).getTime();
                const cb = new Date(b.created_at || 0).getTime();
                if (cb !== ca) return cb - ca;
                return String(b.id).localeCompare(String(a.id));
            });
        }

        getCompletedStartNumber() {
            return this.getActiveMissions().length + 1;
        }

        // Хронологическое воспроизведение отложенных оффлайн-операций поверх актуального состояния из облака
        applyOpsInOrder(remoteList, opsList) {
            const workingMap = new Map();
            (remoteList || []).forEach(r => {
                const norm = normalizeRecord(r);
                workingMap.set(norm.id, norm);
                if (norm.completed_at) {
                    this.recordCompletionLock(norm);
                }
            });

            const locks = this.loadCompletionLocks();
            const deletedIds = new Set();
            const dirtyIds = new Set();

            const reindexWorking = () => {
                const active = sortActiveList(Array.from(workingMap.values()));
                active.forEach((m, idx) => {
                    m.position = idx + 1;
                });
            };

            const sortedOps = [...opsList].sort((a, b) => (a.ts - b.ts) || ((a.seq || 0) - (b.seq || 0)));

            for (const op of sortedOps) {
                const p = op.payload || {};
                if (op.type === 'add') {
                    const id = String(p.id);
                    if (deletedIds.has(id)) continue;
                    const createdAt = p.created_at || new Date(op.ts).toISOString();
                    const existing = workingMap.get(id);
                    const lock = locks[id];

                    // Если задача уже закрыта (выполнена/отменена) позже даты её добавления — никогда не возвращаем в pending
                    if (lock && toTimeMs(createdAt) <= toTimeMs(lock.completed_at)) {
                        if (existing) {
                            existing.status = lock.status === 'cancelled' ? 'cancelled' : 'completed';
                            existing.completed_at = lock.completed_at;
                            existing.completed_display = lock.completed_display || getFormattedTimezone(lock.completed_at);
                        }
                        continue;
                    }

                    if (!existing) {
                        const active = sortActiveList(Array.from(workingMap.values()));
                        const isStart = p.placement === 'start' || p.placement === 'top' || p.placement === 'beginning';
                        let pos = 1;
                        if (isStart) {
                            active.forEach((item, idx) => {
                                item.position = idx + 2;
                                dirtyIds.add(item.id);
                            });
                            pos = 1;
                        } else {
                            pos = active.length > 0 ? Math.max(...active.map(m => Number(m.position) || 0)) + 1 : 1;
                        }
                        workingMap.set(id, {
                            id,
                            title: String(p.title || ''),
                            position: pos,
                            status: 'pending',
                            created_at: createdAt,
                            created_display: p.created_display || getFormattedTimezone(createdAt),
                            completed_at: null,
                            completed_display: null,
                            created_by: p.created_by || 'guest'
                        });
                        dirtyIds.add(id);
                    }
                } else if (op.type === 'complete' || op.type === 'cancel') {
                    const id = String(p.id);
                    const targetStatus = (op.type === 'cancel' || p.status === 'cancelled') ? 'cancelled' : 'completed';
                    const completedAt = p.completed_at || new Date(op.ts).toISOString();
                    const completedDisplay = p.completed_display || getFormattedTimezone(completedAt);
                    let target = workingMap.get(id);

                    // Если локально закрыли запись, которая уже есть или создавалась из локального стора
                    if (!target) {
                        const localMatch = (this.missions || []).find(m => String(m.id) === id);
                        if (localMatch && !deletedIds.has(id)) {
                            target = normalizeRecord(localMatch);
                            workingMap.set(id, target);
                        }
                    }

                    if (target) {
                        const targetCompMs = toTimeMs(target.completed_at);
                        const opCompMs = toTimeMs(completedAt);
                        if (!target.completed_at || opCompMs >= targetCompMs) {
                            target.completed_at = completedAt;
                            target.completed_display = completedDisplay;
                            target.status = targetStatus;
                        }
                        this.recordCompletionLock(target);
                        dirtyIds.add(id);
                        reindexWorking();
                    }
                } else if (op.type === 'restore') {
                    const id = String(p.id);
                    const target = workingMap.get(id);
                    if (target) {
                        const restoreIso = p.restored_at || p.created_at || new Date(op.ts).toISOString();
                        const restoreMs = toTimeMs(restoreIso);
                        const targetCompMs = toTimeMs(target.completed_at);

                        // Применяем только если ручной restore произошёл ПОСЛЕ последнего завершения/отмены
                        if (!target.completed_at || restoreMs > targetCompMs) {
                            const active = sortActiveList(Array.from(workingMap.values()));
                            target.completed_at = null;
                            target.completed_display = null;
                            target.status = 'pending';
                            target.created_at = p.created_at || restoreIso;
                            target.created_display = p.created_display || getFormattedTimezone(target.created_at);
                            target.position = active.length > 0 ? Math.max(...active.map(m => Number(m.position) || 0)) + 1 : 1;
                            this.removeCompletionLock(id);
                            dirtyIds.add(id);
                        }
                    }
                } else if (op.type === 'delete') {
                    const id = String(p.id);
                    workingMap.delete(id);
                    deletedIds.add(id);
                    this.removeCompletionLock(id);
                    reindexWorking();
                } else if (op.type === 'reorder') {
                    const orderedIds = Array.isArray(p.orderedIds) ? p.orderedIds.map(String) : [];
                    if (orderedIds.length > 0) {
                        const active = sortActiveList(Array.from(workingMap.values()));
                        const orderedSet = new Set(orderedIds);
                        const orderedQueue = orderedIds.filter(id => {
                            const item = workingMap.get(id);
                            return item && !isClosedMission(item);
                        });

                        let queueCursor = 0;
                        const mergedActive = active.map(item => {
                            if (orderedSet.has(item.id) && queueCursor < orderedQueue.length) {
                                return workingMap.get(orderedQueue[queueCursor++]);
                            }
                            return item;
                        });

                        const placedSet = new Set(mergedActive.map(m => m.id));
                        orderedQueue.forEach(id => {
                            if (!placedSet.has(id) && workingMap.has(id)) {
                                mergedActive.push(workingMap.get(id));
                            }
                        });

                        mergedActive.forEach((item, idx) => {
                            if (item.position !== idx + 1) {
                                item.position = idx + 1;
                                dirtyIds.add(item.id);
                            }
                        });
                    }
                }
            }

            reindexWorking();

            const watermarked = this.enforceCompletionWatermark(Array.from(workingMap.values()));
            watermarked.healedIds.forEach(id => dirtyIds.add(id));

            return {
                mergedList: watermarked.list,
                deletedIds: Array.from(deletedIds),
                dirtyIds
            };
        }

        async fetchRemoteMissions() {
            if (window.supabaseDirectApi) {
                return await window.supabaseDirectApi.select('missions', 'select=*&order=position.asc');
            }
            if (window.supabaseClient) {
                const { data, error } = await window.supabaseClient.from('missions').select('*').order('position', { ascending: true });
                if (error) throw error;
                return data;
            }
            throw new Error('Supabase API недоступен');
        }

        async deleteRemoteMission(id) {
            if (window.supabaseDirectApi) {
                return await window.supabaseDirectApi.delete('missions', id);
            }
            if (window.supabaseClient) {
                const { error } = await window.supabaseClient.from('missions').delete().eq('id', id);
                if (error) throw error;
                return true;
            }
        }

        async upsertRemoteMissions(rows, reqOpts = {}) {
            if (!rows || rows.length === 0) return [];
            if (window.supabaseDirectApi) {
                return await window.supabaseDirectApi.upsert('missions', rows, reqOpts);
            }
            if (window.supabaseClient) {
                const { data, error } = await window.supabaseClient.from('missions').upsert(rows, { onConflict: 'id' }).select();
                if (error) throw error;
                return data;
            }
        }

        flushPendingWithKeepalive() {
            try {
                if (!this.pendingOps || this.pendingOps.length === 0) return;
                if (!window.supabaseDirectApi) return;
                const touchedIds = new Set();
                this.pendingOps.forEach(op => {
                    if (op && op.payload && op.payload.id) touchedIds.add(String(op.payload.id));
                    if (op && op.payload && Array.isArray(op.payload.orderedIds)) {
                        op.payload.orderedIds.forEach(id => touchedIds.add(String(id)));
                    }
                });
                const rows = this.missions.filter(m => touchedIds.has(String(m.id))).map(toDbRow);
                if (rows.length > 0) {
                    window.supabaseDirectApi.upsert('missions', rows, { keepalive: true }).catch(() => {});
                }
            } catch (e) {}
        }

        // =========================================================================
        // СЕРИАЛИЗОВАННАЯ ДВУСТОРОННЯЯ СИНХРОНИЗАЦИЯ (Cloud-Authoritative + Monotonic Lock)
        // =========================================================================
        async trySyncSupabase(throwOnError = false) {
            if (typeof navigator !== 'undefined' && navigator.onLine === false) {
                this.syncStatus = 'offline';
                this.lastError = null;
                this.notify();
                if (throwOnError) {
                    throw new Error('Нет подключения к интернету. Изменения сохранены локально и отправятся при подключении.');
                }
                return false;
            }

            if (this._activeSyncPromise) {
                this._syncRequestedAgain = true;
                return this._activeSyncPromise;
            }

            this._activeSyncPromise = this._executeSyncCycle(throwOnError)
                .finally(() => {
                    const needAgain = this._syncRequestedAgain;
                    this._syncRequestedAgain = false;
                    this._activeSyncPromise = null;
                    if (needAgain && (typeof navigator === 'undefined' || navigator.onLine !== false)) {
                        setTimeout(() => {
                            this.trySyncSupabase(false).catch(() => {});
                        }, 30);
                    }
                });

            return this._activeSyncPromise;
        }

        async _executeSyncCycle(throwOnError = false) {
            this.isSyncingWithSupabase = true;
            this.syncStatus = 'syncing';
            this.notify();

            try {
                const opsSnapshot = [...this.pendingOps].sort((a, b) => (a.ts - b.ts) || ((a.seq || 0) - (b.seq || 0)));

                // 1. Загружаем актуальное состояние из Supabase
                const remoteRecords = await this.fetchRemoteMissions();
                if (!Array.isArray(remoteRecords)) {
                    throw new Error('Supabase вернул пустой или некорректный ответ');
                }

                const remoteById = new Map();
                remoteRecords.forEach(r => {
                    if (r && r.id) remoteById.set(String(r.id), normalizeRecord(r));
                });

                if (opsSnapshot.length === 0) {
                    const normalizedRemote = remoteRecords.map(normalizeRecord);
                    this.syncLocksFromList(normalizedRemote);

                    // Очищаем замки для записей, которые были окончательно удалены с другого устройства
                    const currentLocks = this.loadCompletionLocks();
                    let locksTrimmed = false;
                    Object.keys(currentLocks).forEach(lockId => {
                        if (!remoteById.has(lockId)) {
                            delete currentLocks[lockId];
                            locksTrimmed = true;
                        }
                    });
                    if (locksTrimmed) this.saveCompletionLocks(currentLocks);

                    // Если удалённая база содержит задачу в pending, но created_at <= completed_at известного замка — лечим её в БД!
                    const { list: safeList, healedIds } = this.enforceCompletionWatermark(normalizedRemote, currentLocks);
                    if (healedIds.size > 0) {
                        const healRows = safeList.filter(m => healedIds.has(m.id)).map(toDbRow);
                        if (healRows.length > 0) {
                            await this.upsertRemoteMissions(healRows);
                        }
                    }

                    this.remoteCount = safeList.length;

                    if (this.pendingOps.length === 0) {
                        this.missions = safeList;
                        this.saveLocal();
                    } else {
                        this._syncRequestedAgain = true;
                    }
                } else {
                    const { mergedList, deletedIds, dirtyIds } = this.applyOpsInOrder(remoteRecords, opsSnapshot);
                    const remoteIdSet = new Set(remoteRecords.map(r => String(r.id)));

                    for (const delId of deletedIds) {
                        if (remoteIdSet.has(String(delId))) {
                            await this.deleteRemoteMission(delId);
                        }
                    }

                    // Отправляем в БД ТОЛЬКО изменённые текущей очередью или исправленные замком строки
                    // Дополнительно защищаем уже выполненные в облаке строки: если в облаке запись уже выполнена
                    // и created_at <= completed_at без явного более позднего restore, никогда не откатываем её в pending!
                    const explicitRestoreTimeById = new Map();
                    opsSnapshot.forEach(op => {
                        if (op && op.type === 'restore' && op.payload && op.payload.id) {
                            const rMs = toTimeMs(op.payload.restored_at || op.payload.created_at || op.ts);
                            const idKey = String(op.payload.id);
                            if (rMs > (explicitRestoreTimeById.get(idKey) || 0)) {
                                explicitRestoreTimeById.set(idKey, rMs);
                            }
                        }
                    });

                    mergedList.forEach(m => {
                        const rem = remoteById.get(m.id);
                        if (rem && isClosedMission(rem) && m.status === 'pending') {
                            const remCompMs = toTimeMs(rem.completed_at);
                            const restoreMs = explicitRestoreTimeById.get(m.id) || 0;
                            if (!(restoreMs > remCompMs && toTimeMs(m.created_at) > remCompMs)) {
                                m.status = isCancelledStatus(rem) ? 'cancelled' : 'completed';
                                m.completed_at = rem.completed_at;
                                m.completed_display = rem.completed_display || getFormattedTimezone(rem.completed_at);
                                this.recordCompletionLock(m);
                            }
                        }
                    });

                    const changedRows = mergedList
                        .filter(m => dirtyIds.has(m.id) || rowDiffersFromDb(m, remoteById.get(m.id)))
                        .map(toDbRow);

                    if (changedRows.length > 0) {
                        await this.upsertRemoteMissions(changedRows, { keepalive: true });
                    }

                    const flushedIds = new Set(opsSnapshot.map(o => o.opId));
                    this.pendingOps = this.pendingOps.filter(o => !flushedIds.has(o.opId));
                    this.saveOpsQueue();

                    if (this.pendingOps.length === 0) {
                        this.missions = mergedList;
                        this.remoteCount = mergedList.length;
                        this.saveLocal();
                    } else {
                        this.remoteCount = mergedList.length;
                        this._syncRequestedAgain = true;
                    }
                }

                this.syncStatus = this.pendingOps.length > 0 ? 'local' : 'synced';
                this.lastError = null;
                this.lastSyncTime = new Date().toLocaleTimeString('ru-RU');
                localStorage.setItem(LAST_SYNC_KEY, this.lastSyncTime);
                this.isSyncingWithSupabase = false;
                this.notify();

                return {
                    success: true,
                    count: this.missions.length,
                    remoteCount: this.remoteCount,
                    time: this.lastSyncTime
                };
            } catch (err) {
                this.isSyncingWithSupabase = false;
                if (isOfflineNetworkError(err)) {
                    this.syncStatus = 'offline';
                    this.lastError = null;
                } else {
                    console.error('Ошибка синхронизации с Supabase:', err);
                    this.lastError = this.formatError(err);
                    this.syncStatus = 'error';
                }
                this.notify();
                if (throwOnError) throw err;
                return false;
            }
        }

        async addMission(title, createdBy = 'guest', placement = 'end') {
            const cleanTitle = (title || '').trim();
            if (!cleanTitle) throw new Error('Текст поручения не может быть пустым');

            const isStart = placement === 'start' || placement === 'top' || placement === 'beginning';
            const normalizedPlacement = isStart ? 'start' : 'end';

            const active = this.getActiveMissions();
            const now = new Date();
            const targetPosition = isStart
                ? 1
                : (active.length > 0 ? Math.max(...active.map(m => Number(m.position) || 0)) + 1 : 1);

            const newMission = {
                id: 'm_' + now.getTime() + '_' + Math.random().toString(36).substring(2, 7),
                title: cleanTitle,
                position: targetPosition,
                status: 'pending',
                created_at: now.toISOString(),
                created_display: getFormattedTimezone(now),
                completed_at: null,
                completed_display: null,
                created_by: createdBy || 'guest'
            };

            if (isStart) {
                active.forEach((m, idx) => {
                    m.position = idx + 2;
                });
                this.missions.unshift(newMission);
            } else {
                this.missions.push(newMission);
            }

            this.enqueueOp('add', {
                id: newMission.id,
                title: newMission.title,
                placement: normalizedPlacement,
                created_at: newMission.created_at,
                created_display: newMission.created_display,
                created_by: newMission.created_by
            });

            this.saveLocal();
            await Promise.race([
                this.trySyncSupabase(false).catch(() => {}),
                new Promise(r => setTimeout(r, 1400))
            ]);

            return newMission;
        }

        async completeMission(id) {
            const mission = this.missions.find(m => String(m.id) === String(id));
            if (!mission) throw new Error('Поручение с таким ID не найдено');

            const createdMs = toTimeMs(mission.created_at);
            // Гарантируем строгую монотонность (completed_at >= created_at) даже при небольшом рассинхроне часов устройств
            const completedMs = Math.max(Date.now(), createdMs > 0 ? createdMs + 1000 : Date.now());
            const completedDate = new Date(completedMs);
            mission.completed_at = completedDate.toISOString();
            mission.completed_display = getFormattedTimezone(completedDate);
            mission.status = 'completed';

            this.recordCompletionLock(mission);
            this.reindexActiveMissions();

            this.enqueueOp('complete', {
                id: String(mission.id),
                completed_at: mission.completed_at,
                completed_display: mission.completed_display,
                status: 'completed'
            });

            this.saveLocal();
            await Promise.race([
                this.trySyncSupabase(false).catch(() => {}),
                new Promise(r => setTimeout(r, 1400))
            ]);

            return mission;
        }

        async cancelMission(id) {
            const mission = this.missions.find(m => String(m.id) === String(id));
            if (!mission) throw new Error('Поручение с таким ID не найдено');

            const createdMs = toTimeMs(mission.created_at);
            const cancelledMs = Math.max(Date.now(), createdMs > 0 ? createdMs + 1000 : Date.now());
            const cancelledDate = new Date(cancelledMs);
            mission.completed_at = cancelledDate.toISOString();
            mission.completed_display = getFormattedTimezone(cancelledDate);
            mission.status = 'cancelled';

            this.recordCompletionLock(mission);
            this.reindexActiveMissions();

            this.enqueueOp('cancel', {
                id: String(mission.id),
                completed_at: mission.completed_at,
                completed_display: mission.completed_display,
                status: 'cancelled'
            });

            this.saveLocal();
            await Promise.race([
                this.trySyncSupabase(false).catch(() => {}),
                new Promise(r => setTimeout(r, 1400))
            ]);

            return mission;
        }

        async restoreMission(id) {
            const mission = this.missions.find(m => String(m.id) === String(id));
            if (!mission) throw new Error('Поручение не найдено');

            const prevCompletedMs = toTimeMs(mission.completed_at);
            const restoreMs = Math.max(Date.now(), prevCompletedMs > 0 ? prevCompletedMs + 1000 : Date.now());
            const restoreDate = new Date(restoreMs);
            const nowIso = restoreDate.toISOString();
            const active = this.getActiveMissions();

            mission.completed_at = null;
            mission.completed_display = null;
            mission.status = 'pending';
            // Обновляем дату добавления на момент явного ручного возврата (> старого completed_at),
            // чтобы второе устройство с более старым created_at понимало, что это явный новый возврат.
            mission.created_at = nowIso;
            mission.created_display = getFormattedTimezone(restoreDate);
            mission.position = active.length > 0 ? Math.max(...active.map(m => Number(m.position) || 0)) + 1 : 1;

            this.removeCompletionLock(mission.id);

            this.enqueueOp('restore', {
                id: String(mission.id),
                restored_at: nowIso,
                created_at: mission.created_at,
                created_display: mission.created_display
            });

            this.saveLocal();
            await Promise.race([
                this.trySyncSupabase(false).catch(() => {}),
                new Promise(r => setTimeout(r, 1400))
            ]);

            return mission;
        }

        async deleteMission(id) {
            const index = this.missions.findIndex(m => String(m.id) === String(id));
            if (index === -1) return false;

            const [removed] = this.missions.splice(index, 1);
            const strId = String(removed.id);

            this.removeCompletionLock(strId);
            this.reindexActiveMissions();

            this.enqueueOp('delete', {
                id: strId
            });

            this.saveLocal();
            await Promise.race([
                this.trySyncSupabase(false).catch(() => {}),
                new Promise(r => setTimeout(r, 1400))
            ]);

            return true;
        }

        reindexActiveMissions() {
            const active = this.getActiveMissions();
            active.forEach((item, idx) => {
                item.position = idx + 1;
            });
        }

        async reorderActiveMissions(orderedIds) {
            if (!Array.isArray(orderedIds)) return;

            const cleanIds = orderedIds.map(String);
            cleanIds.forEach((id, index) => {
                const mission = this.missions.find(m => String(m.id) === id);
                if (mission) {
                    mission.position = index + 1;
                }
            });

            this.enqueueOp('reorder', {
                orderedIds: cleanIds
            });

            this.saveLocal();
            await Promise.race([
                this.trySyncSupabase(false).catch(() => {}),
                new Promise(r => setTimeout(r, 1400))
            ]);
        }
    }

    window.MissionsStore = new MissionsStoreClass();
})(window);
