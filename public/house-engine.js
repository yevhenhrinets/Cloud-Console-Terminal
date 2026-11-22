// house-engine.js — единый движок для всех Домов (16×16 = 4 подквадрата 8×8)
// Без мерцания при входе и скролле, с удержанием 1.5 сек до начала перетаскивания,
// свободным панорамированием поверх объектов до истечения 1.5 сек и надёжной синхронизацией с БД.

(function () {
    const HOLD_TO_DRAG_MS = 1500;
    const MOVE_CANCEL_THRESHOLD_PX = 10;

    let tilePx = 44;
    let lastTilePx = 0;
    let lastViewportW = 0;
    let lastViewportH = 0;
    let justDraggedUntil = 0;
    let roomsState = [];
    let initialized = false;
    let activeDragSession = null;
    let panSession = null;

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
                const cCol = Math.max(0, Math.min(room.gridW - item.w, candidate.col));
                const cRow = Math.max(0, Math.min(room.gridH - item.h, candidate.row));
                if (canPlaceItem(room, item.id, cCol, cRow, item.w, item.h, accepted)) {
                    if (item.col !== cCol || item.row !== cRow) changed = true;
                    accepted.push({ id: item.id, col: cCol, row: cRow, w: item.w, h: item.h });
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
                    if (target.col !== pos.col || target.row !== pos.row) changed = true;
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

    function buildLegacyMergedMap(roomCfg, sourceGetter) {
        const legacies = Array.isArray(roomCfg.legacyRooms) ? roomCfg.legacyRooms : [];
        if (legacies.length === 0) return { layout: null, maxTs: 0 };

        const merged = {};
        let maxTs = 0;
        let foundAny = false;

        for (const leg of legacies) {
            const res = sourceGetter(leg);
            if (!res || !res.layout || typeof res.layout !== 'object') continue;
            foundAny = true;
            if (Number(res.ts || 0) > maxTs) maxTs = Number(res.ts || 0);
            const offCol = Number(leg.offsetCol) || 0;
            const offRow = Number(leg.offsetRow) || 0;
            Object.keys(res.layout).forEach(itemId => {
                const pos = res.layout[itemId];
                if (pos && Number.isInteger(pos.col) && Number.isInteger(pos.row)) {
                    merged[itemId] = {
                        col: pos.col + offCol,
                        row: pos.row + offRow
                    };
                }
            });
        }

        return foundAny ? { layout: merged, maxTs } : { layout: null, maxTs: 0 };
    }

    function loadRoomLayoutState(roomCfg) {
        const boardEl = document.getElementById(roomCfg.boardId);
        const gridOverlay = boardEl ? boardEl.querySelector('.drag-grid-overlay') : null;
        const targetBox = boardEl ? boardEl.querySelector('.drag-target-box') : null;
        const domItems = boardEl ? Array.from(boardEl.querySelectorAll('.room-item')) : [];

        let saved = null;
        try {
            const raw = localStorage.getItem(roomCfg.storageKey);
            if (raw) {
                const parsed = JSON.parse(raw);
                if (parsed && typeof parsed === 'object' && Object.keys(parsed).length > 0) {
                    saved = parsed;
                }
            }
        } catch (e) {
            saved = null;
        }

        const room = {
            id: roomCfg.id,
            storageKey: roomCfg.storageKey,
            tsKey: roomCfg.tsKey,
            legacyRooms: Array.isArray(roomCfg.legacyRooms) ? roomCfg.legacyRooms : [],
            quadrants: roomCfg.quadrants !== false,
            gridW: Number(roomCfg.gridW) || 16,
            gridH: Number(roomCfg.gridH) || 16,
            boardEl,
            gridOverlay,
            targetBox,
            items: []
        };

        if (room.quadrants && boardEl) {
            ensureQuadrantsOverlay(boardEl, roomCfg.quadrantLabels || null);
        }

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

        if (saved) {
            applyLayoutMap(room, saved);
        } else {
            // Миграция локального legacy-расположения (например house2_kitchen_v2 + house2_hall_v2 -> 16×16)
            const localLegacy = buildLegacyMergedMap(roomCfg, (leg) => {
                try {
                    const raw = localStorage.getItem(leg.storageKey);
                    if (!raw) return null;
                    const layout = JSON.parse(raw);
                    const ts = Number(localStorage.getItem(leg.tsKey) || 0);
                    return { layout, ts };
                } catch (e) {
                    return null;
                }
            });
            if (localLegacy.layout) {
                applyLayoutMap(room, localLegacy.layout);
                saveRoomLayoutLocalOnly(room, localLegacy.maxTs || 0);
            }
        }

        return room;
    }

    function ensureQuadrantsOverlay(boardEl, labels) {
        if (!boardEl || boardEl.querySelector('.house-quadrants-overlay')) return;
        const lbl = labels || {};
        const overlay = document.createElement('div');
        overlay.className = 'house-quadrants-overlay';
        overlay.setAttribute('aria-hidden', 'true');
        overlay.innerHTML = `
            <div class="house-quad quad-kitchen">
                <div class="house-quad-door-v" title="Проход Кухня ↔ Зал"></div>
                <div class="house-quad-door-h" title="Проход Кухня ↔ Комната"></div>
                <span class="house-quad-tag" style="left: 8px; bottom: 8px;">${lbl.kitchen || '🍳 Кухня (8×8)'}</span>
            </div>
            <div class="house-quad quad-hall">
                <div class="house-quad-door-h" title="Проход Зал ↔ Коридор"></div>
                <span class="house-quad-tag" style="right: 8px; bottom: 8px;">${lbl.hall || '🛋️ Зал (8×8)'}</span>
            </div>
            <div class="house-quad quad-room">
                <div class="house-quad-door-v" title="Проход Комната ↔ Коридор"></div>
                <span class="house-quad-tag" style="left: 8px; top: 8px;">${lbl.room || '🛏️ Комната (8×8)'}</span>
            </div>
            <div class="house-quad quad-corridor">
                <span class="house-quad-tag" style="right: 8px; top: 8px;">${lbl.corridor || '🚶 Коридор (8×8)'}</span>
            </div>
        `;
        boardEl.prepend(overlay);
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

            const allRoomIds = [];
            roomsState.forEach(r => {
                allRoomIds.push(r.id);
                (r.legacyRooms || []).forEach(leg => allRoomIds.push(leg.id));
            });

            const remoteMap = typeof window.HouseLayoutSync.fetchAllHouseLayoutsFromDb === 'function'
                ? await window.HouseLayoutSync.fetchAllHouseLayoutsFromDb(allRoomIds)
                : {};

            for (const room of roomsState) {
                if (pending && pending[room.id]) continue;

                const localTs = Number(localStorage.getItem(room.tsKey) || 0);
                const remoteUnified = remoteMap[room.id];
                const remoteUnifiedTs = (remoteUnified && remoteUnified.updatedAt)
                    ? new Date(remoteUnified.updatedAt).getTime()
                    : 0;

                // Проверяем и legacy-комнаты (если с прошлого раза сохранение шло в room_kitchen + room_hall)
                const remoteLegacy = buildLegacyMergedMap(room, (leg) => {
                    const entry = remoteMap[leg.id];
                    if (!entry || !entry.layout) return null;
                    return {
                        layout: entry.layout,
                        ts: entry.updatedAt ? new Date(entry.updatedAt).getTime() : 0
                    };
                });

                let chosenLayout = null;
                let chosenTs = 0;
                let migratedFromLegacy = false;

                if (remoteLegacy.layout && (!remoteUnified || remoteLegacy.maxTs > remoteUnifiedTs)) {
                    chosenLayout = remoteLegacy.layout;
                    chosenTs = remoteLegacy.maxTs || Date.now();
                    migratedFromLegacy = true;
                } else if (remoteUnified && remoteUnified.layout) {
                    chosenLayout = remoteUnified.layout;
                    chosenTs = remoteUnifiedTs || Date.now();
                }

                if (chosenLayout && (!localTs || !chosenTs || chosenTs >= localTs)) {
                    const changed = applyLayoutMap(room, chosenLayout);
                    const savedPayload = saveRoomLayoutLocalOnly(room, chosenTs || Date.now());
                    if (changed) {
                        room.items.forEach(item => applyItemGeometry(item));
                    }
                    if (migratedFromLegacy && savedPayload) {
                        window.HouseLayoutSync.saveAndSyncHouseLayout(room.id, savedPayload);
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

    function layoutAllBoards(force = false) {
        // Никогда не пересчитываем макет во время перетаскивания или панорамирования
        if ((activeDragSession && activeDragSession.isDragging) || panSession) return;

        const viewport = document.getElementById('house-viewport');
        if (!viewport || roomsState.length === 0) return;

        const style = getComputedStyle(viewport);
        const padY = parseFloat(style.paddingTop) + parseFloat(style.paddingBottom);
        const availH = Math.max(240, viewport.clientHeight - padY);
        const availW = Math.max(240, viewport.clientWidth - 32);

        // Игнорируем мелкое дрожание высоты экрана при скролле на телефоне (адресная строка)
        if (!force && lastViewportW > 0 &&
            Math.abs(availW - lastViewportW) < 24 &&
            Math.abs(availH - lastViewportH) < 120) {
            return;
        }
        lastViewportW = availW;
        lastViewportH = availH;

        const subH = Math.floor((availH - 42) / 8);
        const subW = Math.floor((Math.max(availW, 320) - 24) / 8);
        const nextTilePx = Math.max(38, Math.min(54, Math.min(subH, subW)));

        if (!force && nextTilePx === lastTilePx) return;
        lastTilePx = nextTilePx;
        tilePx = nextTilePx;

        roomsState.forEach(room => {
            if (!room.boardEl) return;
            room.boardEl.style.width = (tilePx * room.gridW) + 'px';
            room.boardEl.style.height = (tilePx * room.gridH) + 'px';
            room.boardEl.style.backgroundSize = `${tilePx}px ${tilePx}px`;

            if (room.gridOverlay) {
                room.gridOverlay.style.backgroundSize = `${tilePx}px ${tilePx}px`;
            }

            room.items.forEach(item => applyItemGeometry(item));
        });
    }

    function jumpToQuadrant(quadKey, smooth = true) {
        const viewport = document.getElementById('house-viewport');
        const room = roomsState[0];
        if (!viewport || !room || !room.boardEl) return;

        const halfW = (room.gridW / 2) * tilePx;
        const halfH = (room.gridH / 2) * tilePx;

        let targetOffsetX = 0;
        let targetOffsetY = 0;
        if (quadKey === 'hall') {
            targetOffsetX = halfW;
        } else if (quadKey === 'room') {
            targetOffsetY = halfH;
        } else if (quadKey === 'corridor') {
            targetOffsetX = halfW;
            targetOffsetY = halfH;
        }

        const vpRect = viewport.getBoundingClientRect();
        const boardRect = room.boardEl.getBoundingClientRect();
        const boardLeftInScroll = (boardRect.left - vpRect.left) + viewport.scrollLeft;
        const boardTopInScroll = (boardRect.top - vpRect.top) + viewport.scrollTop;

        const targetLeft = Math.max(0, boardLeftInScroll + targetOffsetX - Math.max(0, (viewport.clientWidth - halfW) / 2));
        const targetTop = Math.max(0, boardTopInScroll + targetOffsetY - Math.max(0, (viewport.clientHeight - halfH - 56) / 2));

        viewport.scrollTo({
            left: targetLeft,
            top: targetTop,
            behavior: smooth ? 'smooth' : 'auto'
        });
    }

    function jumpToRoom(targetKey) {
        if (targetKey === 'section-kitchen' || targetKey === 'kitchen') {
            jumpToQuadrant('kitchen', true);
            return;
        }
        if (targetKey === 'section-hall' || targetKey === 'hall') {
            jumpToQuadrant('hall', true);
            return;
        }
        if (targetKey === 'room' || targetKey === 'corridor') {
            jumpToQuadrant(targetKey, true);
            return;
        }
        const el = document.getElementById(targetKey);
        if (el && typeof el.scrollIntoView === 'function') {
            el.scrollIntoView({ behavior: 'smooth', block: 'nearest', inline: 'center' });
        }
    }

    window.jumpToQuadrant = jumpToQuadrant;
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
        activeDragSession.holdUnlocked = true;
        activeDragSession.item.el.classList.remove('is-holding');
        activeDragSession.item.el.classList.add('is-dragging');

        const viewport = document.getElementById('house-viewport');
        if (viewport) viewport.classList.add('is-dragging-item');

        if (activeDragSession.room.gridOverlay) {
            activeDragSession.room.gridOverlay.classList.add('visible');
        }
        if (typeof navigator !== 'undefined' && typeof navigator.vibrate === 'function') {
            try { navigator.vibrate(35); } catch (e) {}
        }
        updateDragVisuals(clientX, clientY);
    }

    function handleDragMove(clientX, clientY) {
        if (!activeDragSession) return false;
        activeDragSession.lastX = clientX;
        activeDragSession.lastY = clientY;
        const dx = clientX - activeDragSession.startX;
        const dy = clientY - activeDragSession.startY;
        const dist = Math.hypot(dx, dy);

        if (dist >= MOVE_CANCEL_THRESHOLD_PX) {
            activeDragSession.movedPastTap = true;
        }

        // КЛЮЧЕВОЕ ПРАВИЛО: Пока не прошло 1.5с неподвижного удержания, любое движение >= 10px
        // немедленно отменяет удержание и позволяет свободно прокручивать/двигать экран!
        if (!activeDragSession.isDragging) {
            if (dist >= MOVE_CANCEL_THRESHOLD_PX) {
                const canceledSession = activeDragSession;
                finishDragSession(false, false);
                return canceledSession;
            }
            return false;
        }

        updateDragVisuals(clientX, clientY);
        return false;
    }

    function finishDragSession(commit, allowTouchTap = false) {
        if (!activeDragSession) return;
        const s = activeDragSession;
        activeDragSession = null;

        clearTimeout(s.holdTimer);
        s.item.el.classList.remove('is-holding', 'is-dragging', 'is-blocked');
        const viewport = document.getElementById('house-viewport');
        if (viewport) viewport.classList.remove('is-dragging-item');

        if (s.room.gridOverlay) s.room.gridOverlay.classList.remove('visible');
        if (s.room.targetBox) s.room.targetBox.classList.remove('visible', 'blocked');

        if (s.isDragging) {
            justDraggedUntil = Date.now() + 450;
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
            holdUnlocked: false,
            isDragging: false,
            movedPastTap: false,
            holdTimer: setTimeout(() => {
                if (activeDragSession && activeDragSession.mode === mode && !activeDragSession.movedPastTap) {
                    enterDragMode(activeDragSession.lastX, activeDragSession.lastY);
                }
            }, HOLD_TO_DRAG_MS)
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

        // 1. Touch-обработчики:
        // До 1.5с удержания НЕ блокируем нативный скролл — пользователь может свободно свайпать по фигурам.
        // Только после 1.5с неподвижного удержания перехватываем палец и перетаскиваем объект.
        document.addEventListener('touchstart', (e) => {
            if (!e.touches || e.touches.length !== 1) return;
            const target = e.target;
            if (!target || !target.closest) return;
            const itemEl = target.closest('.room-item');
            if (!itemEl || !target.closest('.appliance-object')) return;
            const item = itemEl._houseRoomItem;
            if (!item) return;

            const t = e.touches[0];
            startItemSession('touch', item, t.clientX, t.clientY, t.identifier);
        }, { capture: true, passive: true });

        document.addEventListener('touchmove', (e) => {
            if (!activeDragSession || activeDragSession.mode !== 'touch') return;
            const t = findTrackedTouch(e.touches, activeDragSession.touchId) ||
                      findTrackedTouch(e.changedTouches, activeDragSession.touchId);
            if (!t) return;

            if (activeDragSession.isDragging) {
                if (e.cancelable) e.preventDefault();
                e.stopPropagation();
            }
            handleDragMove(t.clientX, t.clientY);
        }, { capture: true, passive: false });

        document.addEventListener('touchend', (e) => {
            if (!activeDragSession || activeDragSession.mode !== 'touch') return;
            const t = findTrackedTouch(e.changedTouches, activeDragSession.touchId);
            if (!t) return;

            if (activeDragSession.isDragging) {
                if (e.cancelable) e.preventDefault();
                finishDragSession(true, false);
                return;
            }

            const moved = Math.hypot(t.clientX - activeDragSession.startX, t.clientY - activeDragSession.startY) >= MOVE_CANCEL_THRESHOLD_PX;
            const isLinkTap = !moved && !activeDragSession.movedPastTap && activeDragSession.item.el.tagName === 'A';
            if (isLinkTap && e.cancelable) e.preventDefault();
            finishDragSession(false, isLinkTap);
        }, { capture: true, passive: false });

        document.addEventListener('touchcancel', (e) => {
            if (!activeDragSession || activeDragSession.mode !== 'touch') return;
            const t = findTrackedTouch(e.changedTouches, activeDragSession.touchId);
            if (!t) return;
            finishDragSession(Boolean(activeDragSession.isDragging && activeDragSession.canDrop), false);
        }, { capture: true });

        // 2. Pointer-обработчики (мышь / стилус):
        // Если мышь нажала на объект и сдвинулась >= 10px ДО 1.5с удержания — плавно панорамируем экран!
        document.addEventListener('pointerdown', (e) => {
            if (e.pointerType === 'touch') return;
            if (e.button !== undefined && e.button !== 0) return;

            const target = e.target;
            const itemEl = target && target.closest ? target.closest('.room-item') : null;
            if (itemEl && target.closest('.appliance-object') && itemEl._houseRoomItem) {
                startItemSession('pointer', itemEl._houseRoomItem, e.clientX, e.clientY, e.pointerId);
                return;
            }

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
                const canceled = handleDragMove(e.clientX, e.clientY);
                if (canceled && viewport) {
                    panSession = {
                        pointerId: e.pointerId,
                        startX: canceled.startX,
                        startY: canceled.startY,
                        startScrollLeft: viewport.scrollLeft,
                        startScrollTop: viewport.scrollTop
                    };
                    viewport.classList.add('is-panning');
                    viewport.scrollLeft = panSession.startScrollLeft - (e.clientX - panSession.startX);
                    viewport.scrollTop = panSession.startScrollTop - (e.clientY - panSession.startY);
                }
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
        layoutAllBoards(true);
        initInteractions();
        syncAllRoomsWithDatabase();

        setTimeout(() => {
            if (navigator.onLine !== false) syncAllRoomsWithDatabase();
        }, 600);

        if (window.supabaseClient && window.supabaseClient.auth && typeof window.supabaseClient.auth.onAuthStateChange === 'function') {
            window.supabaseClient.auth.onAuthStateChange((event) => {
                if (event === 'INITIAL_SESSION' || event === 'SIGNED_IN' || event === 'TOKEN_REFRESHED') {
                    syncAllRoomsWithDatabase();
                }
            });
        }

        const hash = String(window.location.hash || '').replace(/^#/, '').toLowerCase();
        if (hash === 'hall' || hash === 'kitchen' || hash === 'room' || hash === 'corridor') {
            setTimeout(() => jumpToQuadrant(hash, false), 40);
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
            navigator.serviceWorker.register('/service-worker.js?v=20261122_1', { updateViaCache: 'none' })
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
    window.addEventListener('pagehide', () => {
        if (window.HouseLayoutSync && typeof window.HouseLayoutSync.flushPendingHouseLayouts === 'function') {
            window.HouseLayoutSync.flushPendingHouseLayouts();
        }
    });
    window.addEventListener('resize', () => layoutAllBoards(false));
    if (window.visualViewport) {
        window.visualViewport.addEventListener('resize', () => layoutAllBoards(false));
    }

    window.HouseEngine = {
        HOLD_TO_DRAG_MS,
        MOVE_CANCEL_THRESHOLD_PX,
        getRoomsState: () => roomsState,
        canPlaceItem,
        applyLayoutMap,
        layoutAllBoards,
        jumpToQuadrant,
        syncAllRoomsWithDatabase
    };
})();
