// house-engine.js — единый движок для объединённого Дома (Кухня + Зал на одной странице)
// Поддерживает: разные размеры сеток комнат (например 7×7 и 7×9), плавный скролл пальцем и тачпадом,
// гарантированное перетаскивание объектов на смартфонах (capture-phase Touch API), синхронизацию с БД.

(function () {
    let tilePx = 44;
    let justDraggedUntil = 0;
    let roomsState = [];
    let initialized = false;
    let activeDragSession = null;

    function logActionDirect(cmd, desc) {
        if (typeof window.recordCommandAction === 'function') {
            window.recordCommandAction(cmd, desc);
            return;
        }
        try {
            const list = JSON.parse(localStorage.getItem('terminal_actions_history') || '[]');
            const cmdName = String(cmd).trim().split(/\s+/)[0] || '';
            list.unshift({
                id: 'act_' + Date.now() + '_' + Math.random().toString(36).substr(2, 5),
                raw_text: String(cmd).trim(),
                command: cmdName,
                parameters: { raw_args: String(cmd).trim().slice(cmdName.length).trim() },
                output: desc || '',
                status: 'success',
                created_at: new Date().toISOString(),
                created_by: 'local'
            });
            if (list.length > 200) list.length = 200;
            localStorage.setItem('terminal_actions_history', JSON.stringify(list));
        } catch (e) {
            console.warn('logActionDirect error:', e);
        }
    }

    function recordNav(url, cmd, desc) {
        logActionDirect(cmd, desc);
    }

    function onApplianceClick(e, url, cmd, desc) {
        if (Date.now() < justDraggedUntil) {
            if (e && e.preventDefault) e.preventDefault();
            return false;
        }
        if (e && (e.ctrlKey || e.metaKey || e.shiftKey)) {
            logActionDirect(cmd, desc);
            return true;
        }
        if (e && e.preventDefault) e.preventDefault();
        logActionDirect(cmd, desc);
        setTimeout(() => {
            window.location.href = url;
        }, 120);
        return false;
    }

    window.recordNav = recordNav;
    window.onApplianceClick = onApplianceClick;

    function rectanglesOverlap(a, b) {
        return a.col < b.col + b.w &&
               a.col + a.w > b.col &&
               a.row < b.row + b.h &&
               a.row + a.h > b.row;
    }

    function canPlaceItem(room, id, col, row, w, h, list = room.items) {
        if (col < 0 || row < 0 || col + w > room.gridW || row + h > room.gridH) return false;
        const candidate = { col, row, w, h };
        for (const other of list) {
            if (other.id === id) continue;
            if (rectanglesOverlap(candidate, other)) return false;
        }
        return true;
    }

    function applyLayoutMap(room, savedMap) {
        if (!savedMap || typeof savedMap !== 'object') return false;
        const accepted = [];
        let changed = false;

        for (const item of room.items) {
            const candidate = savedMap[item.id];
            if (candidate && Number.isInteger(candidate.col) && Number.isInteger(candidate.row)) {
                if (canPlaceItem(room, item.id, candidate.col, candidate.row, item.w, item.h, accepted)) {
                    if (item.col !== candidate.col || item.row !== candidate.row) changed = true;
                    accepted.push({ id: item.id, col: candidate.col, row: candidate.row, w: item.w, h: item.h });
                    continue;
                }
            }
            accepted.push({ id: item.id, col: item.col, row: item.row, w: item.w, h: item.h });
        }

        const finalPositions = [];
        for (const entry of accepted) {
            if (canPlaceItem(room, entry.id, entry.col, entry.row, entry.w, entry.h, finalPositions)) {
                finalPositions.push(entry);
            } else {
                const orig = room.items.find(i => i.id === entry.id);
                if (orig && canPlaceItem(room, orig.id, orig.col, orig.row, orig.w, orig.h, finalPositions)) {
                    finalPositions.push({ id: orig.id, col: orig.col, row: orig.row, w: orig.w, h: orig.h });
                }
            }
        }

        if (finalPositions.length === room.items.length) {
            finalPositions.forEach(pos => {
                const target = room.items.find(i => i.id === pos.id);
                if (target) {
                    target.col = pos.col;
                    target.row = pos.row;
                }
            });
        }
        return changed;
    }

    function getCurrentLayoutPayload(room) {
        const payload = {};
        room.items.forEach(item => {
            payload[item.id] = { col: item.col, row: item.row };
        });
        return payload;
    }

    function loadRoomLayoutState(roomCfg) {
        const boardEl = document.getElementById(roomCfg.boardId);
        const gridOverlay = boardEl ? boardEl.querySelector('.drag-grid-overlay') : null;
        const targetBox = boardEl ? boardEl.querySelector('.drag-target-box') : null;
        const domItems = boardEl ? Array.from(boardEl.querySelectorAll('.room-item')) : [];

        let saved = {};
        try {
            saved = JSON.parse(localStorage.getItem(roomCfg.storageKey) || '{}') || {};
        } catch (e) {
            saved = {};
        }

        const room = {
            id: roomCfg.id,
            storageKey: roomCfg.storageKey,
            tsKey: roomCfg.tsKey,
            gridW: Number(roomCfg.gridW) || 7,
            gridH: Number(roomCfg.gridH) || 7,
            boardEl,
            gridOverlay,
            targetBox,
            items: []
        };

        room.items = domItems.map(el => {
            const id = el.dataset.id;
            const w = Number(el.dataset.w) || 2;
            const h = Number(el.dataset.h) || 2;
            const def = (roomCfg.defaults && roomCfg.defaults[id]) || {
                col: Number(el.dataset.col) || 0,
                row: Number(el.dataset.row) || 0
            };
            const itemObj = { id, el, w, h, col: def.col, row: def.row, room };
            el._houseRoomItem = itemObj;
            return itemObj;
        });

        applyLayoutMap(room, saved);
        return room;
    }

    function saveRoomLayoutLocalOnly(room, customTs = null) {
        try {
            const payload = getCurrentLayoutPayload(room);
            localStorage.setItem(room.storageKey, JSON.stringify(payload));
            localStorage.setItem(room.tsKey, String(customTs !== null ? customTs : Date.now()));
            return payload;
        } catch (e) {
            return null;
        }
    }

    function saveRoomLayoutState(room) {
        const payload = saveRoomLayoutLocalOnly(room, Date.now());
        if (payload && window.HouseLayoutSync && typeof window.HouseLayoutSync.saveAndSyncHouseLayout === 'function') {
            window.HouseLayoutSync.saveAndSyncHouseLayout(room.id, payload);
        }
    }

    async function syncAllRoomsWithDatabase() {
        if (!window.HouseLayoutSync || roomsState.length === 0) return;
        try {
            if (typeof navigator !== 'undefined' && navigator.onLine === false) return;
            await window.HouseLayoutSync.flushPendingHouseLayouts();
            const pending = window.HouseLayoutSync.getPendingHouseLayouts();

            for (const room of roomsState) {
                if (pending && pending[room.id]) continue;
                const remote = await window.HouseLayoutSync.fetchRoomLayoutFromDb(room.id);
                if (remote && remote.layout) {
                    const localTs = Number(localStorage.getItem(room.tsKey) || 0);
                    const remoteTs = remote.updatedAt ? new Date(remote.updatedAt).getTime() : 0;
                    if (!localTs || !remoteTs || remoteTs >= localTs) {
                        const changed = applyLayoutMap(room, remote.layout);
                        saveRoomLayoutLocalOnly(room, remoteTs || Date.now());
                        if (changed) {
                            room.items.forEach(item => applyItemGeometry(item));
                        }
                    }
                }
            }
        } catch (e) {
            console.warn('syncAllRoomsWithDatabase error:', e);
        }
    }

    function applyItemGeometry(item, pxLeft, pxTop) {
        item.el.style.left = (pxLeft !== undefined ? pxLeft : item.col * tilePx) + 'px';
        item.el.style.top = (pxTop !== undefined ? pxTop : item.row * tilePx) + 'px';
        item.el.style.width = (item.w * tilePx) + 'px';
        item.el.style.height = (item.h * tilePx) + 'px';
    }

    function layoutAllBoards() {
        const viewport = document.getElementById('house-viewport');
        if (!viewport || roomsState.length === 0) return;

        const style = getComputedStyle(viewport);
        const padY = parseFloat(style.paddingTop) + parseFloat(style.paddingBottom);
        const availH = Math.max(240, viewport.clientHeight - padY);
        const availW = Math.max(240, viewport.clientWidth - 40);

        const maxGridH = Math.max(...roomsState.map(r => r.gridH));
        // Достаточно крупная плитка, чтобы удобно перетаскивать пальцем на смартфоне (минимум ~42px)
        const byHeight = Math.floor((availH - 54) / maxGridH);
        const byMobileSingleRoom = Math.floor((Math.max(availW, 320) - 24) / 7);
        tilePx = Math.max(40, Math.min(58, Math.max(byHeight, Math.min(byMobileSingleRoom, 50))));

        roomsState.forEach(room => {
            if (!room.boardEl) return;
            room.boardEl.style.width = (tilePx * room.gridW) + 'px';
            room.boardEl.style.height = (tilePx * room.gridH) + 'px';
            room.boardEl.style.backgroundSize = `${tilePx}px ${tilePx}px`;

            if (room.gridOverlay) {
                room.gridOverlay.style.backgroundImage =
                    'linear-gradient(to right, rgba(56, 189, 248, 0.25) 1px, transparent 1px), ' +
                    'linear-gradient(to bottom, rgba(56, 189, 248, 0.25) 1px, transparent 1px)';
                room.gridOverlay.style.backgroundSize = `${tilePx}px ${tilePx}px`;
            }

            room.items.forEach(item => applyItemGeometry(item));
        });
    }

    function jumpToRoom(roomSectionId) {
        const el = document.getElementById(roomSectionId);
        if (el && typeof el.scrollIntoView === 'function') {
            el.scrollIntoView({ behavior: 'smooth', block: 'nearest', inline: 'center' });
        }
    }
    window.jumpToRoom = jumpToRoom;

    function findTrackedTouch(touchList, id) {
        if (!touchList) return null;
        for (let i = 0; i < touchList.length; i++) {
            if (touchList[i].identifier === id) return touchList[i];
        }
        return null;
    }

    function triggerLinkTap(item) {
        const href = item.el.getAttribute('href');
        if (!href) return;
        justDraggedUntil = 0;
        if (typeof item.el.onclick === 'function') {
            item.el.onclick({ preventDefault: () => {} });
        } else {
            window.location.href = href;
        }
    }

    function updateDragVisuals(clientX, clientY) {
        const s = activeDragSession;
        if (!s) return;

        const room = s.room;
        const rect = room.boardEl.getBoundingClientRect();
        const maxLeft = (room.gridW - s.item.w) * tilePx;
        const maxTop = (room.gridH - s.item.h) * tilePx;

        const rawLeft = Math.max(0, Math.min(maxLeft, (clientX - rect.left) - s.grabOffsetX));
        const rawTop = Math.max(0, Math.min(maxTop, (clientY - rect.top) - s.grabOffsetY));

        applyItemGeometry(s.item, rawLeft, rawTop);

        s.targetCol = Math.max(0, Math.min(room.gridW - s.item.w, Math.round(rawLeft / tilePx)));
        s.targetRow = Math.max(0, Math.min(room.gridH - s.item.h, Math.round(rawTop / tilePx)));
        s.canDrop = canPlaceItem(room, s.item.id, s.targetCol, s.targetRow, s.item.w, s.item.h);

        if (room.targetBox) {
            room.targetBox.style.left = (s.targetCol * tilePx) + 'px';
            room.targetBox.style.top = (s.targetRow * tilePx) + 'px';
            room.targetBox.style.width = (s.item.w * tilePx) + 'px';
            room.targetBox.style.height = (s.item.h * tilePx) + 'px';
            room.targetBox.classList.add('visible');
            room.targetBox.classList.toggle('blocked', !s.canDrop);
        }
        s.item.el.classList.toggle('is-blocked', !s.canDrop);
    }

    function enterDragMode(clientX, clientY) {
        if (!activeDragSession || activeDragSession.isDragging) return;
        activeDragSession.isDragging = true;
        activeDragSession.item.el.classList.add('is-dragging');
        if (activeDragSession.room.gridOverlay) {
            activeDragSession.room.gridOverlay.classList.add('visible');
        }
        updateDragVisuals(clientX, clientY);
    }

    function handleDragMove(clientX, clientY) {
        if (!activeDragSession) return;
        activeDragSession.lastX = clientX;
        activeDragSession.lastY = clientY;
        const dx = clientX - activeDragSession.startX;
        const dy = clientY - activeDragSession.startY;
        if (Math.hypot(dx, dy) >= 6) {
            activeDragSession.movedPastTap = true;
        }
        if (!activeDragSession.isDragging && Math.hypot(dx, dy) >= 5) {
            clearTimeout(activeDragSession.holdTimer);
            enterDragMode(clientX, clientY);
        } else if (activeDragSession.isDragging) {
            updateDragVisuals(clientX, clientY);
        }
    }

    function finishDragSession(commit, allowTouchTap = false) {
        if (!activeDragSession) return;
        const s = activeDragSession;
        activeDragSession = null;

        clearTimeout(s.holdTimer);
        s.item.el.classList.remove('is-holding', 'is-dragging', 'is-blocked');
        if (s.room.gridOverlay) s.room.gridOverlay.classList.remove('visible');
        if (s.room.targetBox) s.room.targetBox.classList.remove('visible', 'blocked');

        if (s.isDragging) {
            justDraggedUntil = Date.now() + 400;
            if (commit && s.canDrop) {
                s.item.col = s.targetCol;
                s.item.row = s.targetRow;
                saveRoomLayoutState(s.room);
            }
            applyItemGeometry(s.item);
        } else {
            applyItemGeometry(s.item);
            if (allowTouchTap && s.mode === 'touch' && !s.movedPastTap) {
                triggerLinkTap(s.item);
            }
        }
    }

    function startItemSession(mode, item, clientX, clientY, pointerOrTouchId) {
        if (activeDragSession) finishDragSession(false, false);

        const room = item.room;
        const rect = room.boardEl.getBoundingClientRect();
        const grabOffsetX = clientX - (rect.left + item.col * tilePx);
        const grabOffsetY = clientY - (rect.top + item.row * tilePx);

        item.el.classList.add('is-holding');
        activeDragSession = {
            mode,
            item,
            room,
            touchId: mode === 'touch' ? pointerOrTouchId : null,
            pointerId: mode === 'pointer' ? pointerOrTouchId : null,
            startX: clientX,
            startY: clientY,
            lastX: clientX,
            lastY: clientY,
            grabOffsetX,
            grabOffsetY,
            origCol: item.col,
            origRow: item.row,
            targetCol: item.col,
            targetRow: item.row,
            canDrop: true,
            isDragging: false,
            movedPastTap: false,
            holdTimer: setTimeout(() => {
                if (activeDragSession && activeDragSession.mode === mode) {
                    enterDragMode(activeDragSession.lastX, activeDragSession.lastY);
                }
            }, 120)
        };
    }

    function initInteractions() {
        const viewport = document.getElementById('house-viewport');

        document.addEventListener('dragstart', e => {
            if (e.target && e.target.closest && e.target.closest('.room-item')) {
                e.preventDefault();
            }
        });

        document.addEventListener('contextmenu', e => {
            if (e.target && e.target.closest && e.target.closest('.room-item')) {
                e.preventDefault();
            }
        });

        // 1. Статические capture-phase Touch-обработчики для 100% работы на телефонах:
        // если палец коснулся фигуры прибора — сразу блокируем нативный скролл и тянем прибор;
        // если коснулся пустого пола/фона — НЕ блокируем, позволяем плавный панорамный скролл!
        document.addEventListener('touchstart', (e) => {
            if (!e.touches || e.touches.length !== 1) return;
            const target = e.target;
            if (!target || !target.closest) return;
            const itemEl = target.closest('.room-item');
            if (!itemEl || !target.closest('.appliance-object')) return;
            const item = itemEl._houseRoomItem;
            if (!item) return;

            if (e.cancelable) e.preventDefault();
            e.stopPropagation();

            const t = e.touches[0];
            startItemSession('touch', item, t.clientX, t.clientY, t.identifier);
        }, { capture: true, passive: false });

        document.addEventListener('touchmove', (e) => {
            if (!activeDragSession || activeDragSession.mode !== 'touch') return;
            if (e.cancelable) e.preventDefault();
            e.stopPropagation();
            const t = findTrackedTouch(e.touches, activeDragSession.touchId) ||
                      findTrackedTouch(e.changedTouches, activeDragSession.touchId);
            if (t) handleDragMove(t.clientX, t.clientY);
        }, { capture: true, passive: false });

        document.addEventListener('touchend', (e) => {
            if (!activeDragSession || activeDragSession.mode !== 'touch') return;
            const t = findTrackedTouch(e.changedTouches, activeDragSession.touchId);
            if (!t) return;
            if (e.cancelable) e.preventDefault();
            finishDragSession(true, true);
        }, { capture: true, passive: false });

        document.addEventListener('touchcancel', (e) => {
            if (!activeDragSession || activeDragSession.mode !== 'touch') return;
            const t = findTrackedTouch(e.changedTouches, activeDragSession.touchId);
            if (!t) return;
            finishDragSession(Boolean(activeDragSession.isDragging && activeDragSession.canDrop), false);
        }, { capture: true });

        // 2. Pointer-обработчики для десктопа (мышь / стилус), тач пропускается в Touch API выше
        let panSession = null;

        document.addEventListener('pointerdown', (e) => {
            if (e.pointerType === 'touch') return;
            if (e.button !== undefined && e.button !== 0) return;

            const target = e.target;
            const itemEl = target && target.closest ? target.closest('.room-item') : null;
            if (itemEl && target.closest('.appliance-object') && itemEl._houseRoomItem) {
                startItemSession('pointer', itemEl._houseRoomItem, e.clientX, e.clientY, e.pointerId);
                return;
            }

            // Перетаскивание пустого фона мышкой для панорамирования без колеса мыши
            if (viewport && target && target.closest && target.closest('.house-viewport') && !target.closest('.top-nav')) {
                panSession = {
                    pointerId: e.pointerId,
                    startX: e.clientX,
                    startY: e.clientY,
                    startScrollLeft: viewport.scrollLeft,
                    startScrollTop: viewport.scrollTop
                };
                viewport.classList.add('is-panning');
            }
        });

        window.addEventListener('pointermove', (e) => {
            if (activeDragSession && activeDragSession.mode === 'pointer' && e.pointerId === activeDragSession.pointerId) {
                handleDragMove(e.clientX, e.clientY);
                return;
            }
            if (panSession && e.pointerId === panSession.pointerId && viewport) {
                viewport.scrollLeft = panSession.startScrollLeft - (e.clientX - panSession.startX);
                viewport.scrollTop = panSession.startScrollTop - (e.clientY - panSession.startY);
            }
        });

        function endPointerOrPan(e, isCancel) {
            if (activeDragSession && activeDragSession.mode === 'pointer' && e.pointerId === activeDragSession.pointerId) {
                finishDragSession(isCancel ? Boolean(activeDragSession.isDragging && activeDragSession.canDrop) : true, false);
            }
            if (panSession && e.pointerId === panSession.pointerId) {
                panSession = null;
                if (viewport) viewport.classList.remove('is-panning');
            }
        }

        window.addEventListener('pointerup', (e) => endPointerOrPan(e, false));
        window.addEventListener('pointercancel', (e) => endPointerOrPan(e, true));
    }

    function initHousePage() {
        if (initialized) return;
        initialized = true;

        const cfg = window.HOUSE_CONFIG || {};
        if (cfg.navCmd) {
            logActionDirect(cfg.navCmd, cfg.navDesc || 'Переход в Дом');
        }

        roomsState = (cfg.rooms || []).map(loadRoomLayoutState);
        layoutAllBoards();
        initInteractions();
        syncAllRoomsWithDatabase();

        if (window.location.hash === '#hall') {
            setTimeout(() => jumpToRoom('section-hall'), 60);
        } else if (window.location.hash === '#kitchen') {
            setTimeout(() => jumpToRoom('section-kitchen'), 60);
        }
    }

    document.addEventListener('DOMContentLoaded', initHousePage);

    if ('serviceWorker' in navigator) {
        let swRefreshing = false;
        navigator.serviceWorker.addEventListener('controllerchange', () => {
            if (swRefreshing) return;
            swRefreshing = true;
            window.location.reload();
        });
        window.addEventListener('load', () => {
            navigator.serviceWorker.register('/service-worker.js?v=20261121_2', { updateViaCache: 'none' })
                .then((reg) => {
                    if (reg && typeof reg.update === 'function') reg.update().catch(() => {});
                })
                .catch(() => {});
        });
    }

    window.addEventListener('online', syncAllRoomsWithDatabase);
    window.addEventListener('focus', () => {
        if (navigator.onLine !== false) syncAllRoomsWithDatabase();
    });
    document.addEventListener('visibilitychange', () => {
        if (document.visibilityState === 'visible' && navigator.onLine !== false) {
            syncAllRoomsWithDatabase();
        }
    });
    window.addEventListener('resize', layoutAllBoards);
    if (window.visualViewport) {
        window.visualViewport.addEventListener('resize', layoutAllBoards);
    }

    // Экспортируем для отладки/тестов при необходимости
    window.HouseEngine = {
        getRoomsState: () => roomsState,
        canPlaceItem,
        layoutAllBoards,
        syncAllRoomsWithDatabase
    };
})();
