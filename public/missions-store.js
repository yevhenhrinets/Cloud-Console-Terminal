// missions-store.js — Надежное хранилище поручений (Missions) с фиксацией времени выполнения и таймзоны
// Архитектура: Offline-First + Упорядоченная очередь мутаций (Ops Queue) + Единый облачный источник истины (Supabase REST)
// Пока интернет есть — ПК и телефон всегда получают абсолютно идентичный снимок из базы данных.
// Без интернета — все действия работают локально и выстраиваются в строгую хронологическую очередь для синхронизации при подключении.

(function(window) {
    const STORAGE_KEY = 'cloud_missions_store';
    const OPS_QUEUE_KEY = 'cloud_missions_ops_queue';
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

    function normalizeRecord(raw) {
        const isDone = Boolean(raw.completed_at || raw.status === 'completed');
        const createdAt = raw.created_at || new Date().toISOString();
        const completedAt = isDone ? (raw.completed_at || new Date().toISOString()) : null;
        return {
            id: String(raw.id),
            title: String(raw.title || ''),
            position: Number(raw.position) > 0 ? Number(raw.position) : 1,
            status: isDone ? 'completed' : 'pending',
            created_at: createdAt,
            created_display: raw.created_display || getFormattedTimezone(createdAt),
            completed_at: completedAt,
            completed_display: isDone ? (raw.completed_display || getFormattedTimezone(completedAt)) : null,
            created_by: raw.created_by || 'guest'
        };
    }

    function toDbRow(m) {
        const isDone = Boolean(m.completed_at || m.status === 'completed');
        const createdAt = m.created_at || new Date().toISOString();
        return {
            id: String(m.id),
            title: String(m.title || ''),
            position: Number(m.position) > 0 ? Number(m.position) : 1,
            status: isDone ? 'completed' : 'pending',
            created_at: createdAt,
            created_display: m.created_display || getFormattedTimezone(createdAt),
            completed_at: isDone ? m.completed_at : null,
            completed_display: isDone ? (m.completed_display || getFormattedTimezone(m.completed_at)) : null,
            created_by: m.created_by || 'guest'
        };
    }

    function sortActiveList(list) {
        return list
            .filter(m => !m.completed_at && m.status !== 'completed')
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

        init() {
            // 1. Загружаем отложенную очередь оффлайн-операций и очищаем устаревший legacy-ключ DELETED_KEY
            try {
                const opsRaw = localStorage.getItem(OPS_QUEUE_KEY);
                const parsedOps = opsRaw ? JSON.parse(opsRaw) : [];
                this.pendingOps = Array.isArray(parsedOps) ? parsedOps : [];

                // Если в очереди скопились массовые старые мигрированные delete-записи без флага userInitiated — очищаем мусор
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

            // 2. Загружаем локальный кэш поручений (без подмешивания фейковых дефолтных записей, чтобы не портить облако)
            const saved = localStorage.getItem(STORAGE_KEY);
            if (saved) {
                try {
                    const parsed = JSON.parse(saved);
                    if (Array.isArray(parsed)) {
                        this.missions = parsed.map(normalizeRecord);
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
                    }
                });

                window.addEventListener('storage', (event) => {
                    if (event.key === STORAGE_KEY && event.newValue) {
                        try {
                            const parsed = JSON.parse(event.newValue);
                            if (Array.isArray(parsed)) {
                                this.missions = parsed.map(normalizeRecord);
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

            // 4. Начальная синхронизация с Supabase (неблокирующая)
            setTimeout(() => {
                this.trySyncSupabase(false).catch(err => {
                    console.warn('Начальная синхронизация поручений:', err);
                });
            }, 80);
        }

        saveLocal() {
            try {
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

        getActiveMissions() {
            return sortActiveList(this.missions);
        }

        getCompletedMissions() {
            return this.missions
                .filter(m => !!m.completed_at || m.status === 'completed')
                .sort((a, b) => new Date(b.completed_at || 0) - new Date(a.completed_at || 0));
        }

        getAllMissions() {
            return [...this.missions].sort((a, b) => {
                const aDone = Boolean(a.completed_at || a.status === 'completed');
                const bDone = Boolean(b.completed_at || b.status === 'completed');
                if (!aDone && bDone) return -1;
                if (aDone && !bDone) return 1;
                if (!aDone && !bDone) {
                    const posA = (a.position === null || a.position === undefined || Number(a.position) <= 0) ? 999999 : Number(a.position);
                    const posB = (b.position === null || b.position === undefined || Number(b.position) <= 0) ? 999999 : Number(b.position);
                    if (posA !== posB) return posA - posB;
                    return new Date(a.created_at || 0).getTime() - new Date(b.created_at || 0).getTime();
                }
                return new Date(b.completed_at || 0) - new Date(a.completed_at || 0);
            });
        }

        // Хронологическое воспроизведение отложенных оффлайн-операций поверх актуального состояния из облака
        applyOpsInOrder(remoteList, opsList) {
            const workingMap = new Map();
            (remoteList || []).forEach(r => {
                const norm = normalizeRecord(r);
                workingMap.set(norm.id, norm);
            });
            const deletedIds = new Set();

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
                    const existing = workingMap.get(id);
                    if (!existing) {
                        const active = sortActiveList(Array.from(workingMap.values()));
                        const isStart = p.placement === 'start' || p.placement === 'top' || p.placement === 'beginning';
                        let pos = 1;
                        if (isStart) {
                            active.forEach((item, idx) => {
                                item.position = idx + 2;
                            });
                            pos = 1;
                        } else {
                            pos = active.length > 0 ? Math.max(...active.map(m => Number(m.position) || 0)) + 1 : 1;
                        }
                        const createdAt = p.created_at || new Date(op.ts).toISOString();
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
                    }
                } else if (op.type === 'complete') {
                    const id = String(p.id);
                    const target = workingMap.get(id);
                    if (target) {
                        const completedAt = p.completed_at || new Date(op.ts).toISOString();
                        target.completed_at = completedAt;
                        target.completed_display = p.completed_display || getFormattedTimezone(completedAt);
                        target.status = 'completed';
                        reindexWorking();
                    }
                } else if (op.type === 'restore') {
                    const id = String(p.id);
                    const target = workingMap.get(id);
                    if (target) {
                        const active = sortActiveList(Array.from(workingMap.values()));
                        target.completed_at = null;
                        target.completed_display = null;
                        target.status = 'pending';
                        target.position = active.length > 0 ? Math.max(...active.map(m => Number(m.position) || 0)) + 1 : 1;
                    }
                } else if (op.type === 'delete') {
                    const id = String(p.id);
                    workingMap.delete(id);
                    deletedIds.add(id);
                    reindexWorking();
                } else if (op.type === 'reorder') {
                    const orderedIds = Array.isArray(p.orderedIds) ? p.orderedIds.map(String) : [];
                    if (orderedIds.length > 0) {
                        const active = sortActiveList(Array.from(workingMap.values()));
                        const orderedSet = new Set(orderedIds);
                        const orderedQueue = orderedIds.filter(id => {
                            const item = workingMap.get(id);
                            return item && !item.completed_at && item.status !== 'completed';
                        });

                        // Слот-сохраняющее слияние: задачи, которые были в переставленном списке,
                        // занимают свои слоты в новом порядке, не затирая новые задачи с другого устройства
                        let queueCursor = 0;
                        const mergedActive = active.map(item => {
                            if (orderedSet.has(item.id) && queueCursor < orderedQueue.length) {
                                return workingMap.get(orderedQueue[queueCursor++]);
                            }
                            return item;
                        });

                        // Если какие-то ID из orderedQueue ещё не размещены (напр. восстановлены/добавлены), дописываем
                        const placedSet = new Set(mergedActive.map(m => m.id));
                        orderedQueue.forEach(id => {
                            if (!placedSet.has(id) && workingMap.has(id)) {
                                mergedActive.push(workingMap.get(id));
                            }
                        });

                        mergedActive.forEach((item, idx) => {
                            item.position = idx + 1;
                        });
                    }
                }
            }

            reindexWorking();
            return {
                mergedList: Array.from(workingMap.values()),
                deletedIds: Array.from(deletedIds)
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

        async upsertRemoteMissions(rows) {
            if (!rows || rows.length === 0) return [];
            if (window.supabaseDirectApi) {
                return await window.supabaseDirectApi.upsert('missions', rows);
            }
            if (window.supabaseClient) {
                const { data, error } = await window.supabaseClient.from('missions').upsert(rows, { onConflict: 'id' }).select();
                if (error) throw error;
                return data;
            }
        }

        // =========================================================================
        // СЕРИАЛИЗОВАННАЯ ДВУСТОРОННЯЯ СИНХРОНИЗАЦИЯ (Cloud-Authoritative + Replay)
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

                if (opsSnapshot.length === 0) {
                    // Нет локальных неотправленных изменений — облако на 100% авторитетно!
                    // Гарантирует абсолютную идентичность на ПК и телефоне.
                    const normalizedRemote = remoteRecords.map(normalizeRecord);
                    this.remoteCount = normalizedRemote.length;

                    // Если за время сетевого запроса появились новые локальные операции, не затираем их
                    if (this.pendingOps.length === 0) {
                        this.missions = normalizedRemote;
                        this.saveLocal();
                    } else {
                        this._syncRequestedAgain = true;
                    }
                } else {
                    // Есть локальные оффлайн/очередные операции — применяем их в строгом хронологическом порядке поверх облака
                    const { mergedList, deletedIds } = this.applyOpsInOrder(remoteRecords, opsSnapshot);
                    const remoteIdSet = new Set(remoteRecords.map(r => String(r.id)));

                    for (const delId of deletedIds) {
                        if (remoteIdSet.has(String(delId))) {
                            await this.deleteRemoteMission(delId);
                        }
                    }

                    if (mergedList.length > 0) {
                        const rowsToUpsert = mergedList.map(toDbRow);
                        await this.upsertRemoteMissions(rowsToUpsert);
                    }

                    // Удаляем из очереди только успешно отправленный снимок операций
                    const flushedIds = new Set(opsSnapshot.map(o => o.opId));
                    this.pendingOps = this.pendingOps.filter(o => !flushedIds.has(o.opId));
                    this.saveOpsQueue();

                    if (this.pendingOps.length === 0) {
                        this.missions = mergedList;
                        this.remoteCount = mergedList.length;
                        this.saveLocal();
                    } else {
                        // За время запроса пользователь успел сделать ещё действия — досылаем следующим проходом
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
            this.trySyncSupabase(false).catch(() => {});

            return newMission;
        }

        async completeMission(id) {
            const mission = this.missions.find(m => String(m.id) === String(id));
            if (!mission) throw new Error('Поручение с таким ID не найдено');

            const now = new Date();
            mission.completed_at = now.toISOString();
            mission.completed_display = getFormattedTimezone(now);
            mission.status = 'completed';

            this.reindexActiveMissions();

            this.enqueueOp('complete', {
                id: String(mission.id),
                completed_at: mission.completed_at,
                completed_display: mission.completed_display
            });

            this.saveLocal();
            this.trySyncSupabase(false).catch(() => {});

            return mission;
        }

        async restoreMission(id) {
            const mission = this.missions.find(m => String(m.id) === String(id));
            if (!mission) throw new Error('Поручение не найдено');

            const active = this.getActiveMissions();
            mission.completed_at = null;
            mission.completed_display = null;
            mission.status = 'pending';
            mission.position = active.length > 0 ? Math.max(...active.map(m => Number(m.position) || 0)) + 1 : 1;

            this.enqueueOp('restore', {
                id: String(mission.id)
            });

            this.saveLocal();
            this.trySyncSupabase(false).catch(() => {});

            return mission;
        }

        async deleteMission(id) {
            const index = this.missions.findIndex(m => String(m.id) === String(id));
            if (index === -1) return false;

            const [removed] = this.missions.splice(index, 1);
            const strId = String(removed.id);

            this.reindexActiveMissions();

            this.enqueueOp('delete', {
                id: strId
            });

            this.saveLocal();
            this.trySyncSupabase(false).catch(() => {});

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
            this.trySyncSupabase(false).catch(() => {});
        }
    }

    window.MissionsStore = new MissionsStoreClass();
})(window);
