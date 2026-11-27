// house-engine.js — единый движок для всех Домов (16×16+ из комнат 8×8)
// Изолированный статичный <canvas> пола (без мерцания при входе и перемещении),
// удержание 750 мс до перетаскивания, панорамирование поверх фигур,
// строгая привязка к аккаунту (поддержка Add house / Add room / Add thing) и надёжная синхронизация с БД.

(function () {
    const HOLD_TO_DRAG_MS = 700;
    const HOLD_VISUAL_DELAY_MS = 180;
    const MOVE_CANCEL_THRESHOLD_PX = 10;
    const DOOR_WIDTH_TILES = 2;

    let tilePx = 44;
    let lastTilePx = 0;
    let lastViewportW = 0;
    let lastViewportH = 0;
    let cachedFloorPatternCanvas = null;
    let justDraggedUntil = 0;
    let roomsState = [];
    let initialized = false;
    let interactionsBound = false;
    let authListenerAttached = false;
    let activeHouseUser = null;
    let activeHouseRecord = null;
    let activeEffectiveCfg = null;
    let activeDragSession = null;
    let panSession = null;
    let touchEmptySession = null;
    let selectedItem = null;

    function escapeHtml(str) {
        return String(str || '').replace(/[&<>"']/g, ch => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[ch]));
    }

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

    function resolveEffectiveHouseConfig() {
        const baseCfg = window.HOUSE_CONFIG || {};
        const params = new URLSearchParams(window.location.search || '');
        const queryHouse = params.get('house');
        if (!queryHouse) return baseCfg;

        const baseRoom = (baseCfg.rooms && baseCfg.rooms[0]) || {};
        const norm = (typeof window.getHouseDefinition === 'function')
            ? window.getHouseDefinition(queryHouse)
            : { id: queryHouse, roomId: `${queryHouse}_square`, name: queryHouse };
        const cleanId = norm.id || queryHouse;
        return {
            ...baseCfg,
            homeId: cleanId,
            isQueryHouse: true,
            navCmd: `go to home ${queryHouse}`,
            navDesc: `Переход в ${norm.name || queryHouse}`,
            rooms: [
                {
                    id: norm.roomId || `${cleanId}_square`,
                    boardId: baseRoom.boardId || 'board-house1',
                    storageKey: `room_layout_${cleanId}_square_v1`,
                    tsKey: `room_layout_${cleanId}_square_v1_ts`,
                    quadrants: true,
                    gridW: 16,
                    gridH: 16,
                    defaults: {}
                }
            ]
        };
    }

    function rectanglesOverlap(a, b) {
        return a.col < b.col + b.w &&
               a.col + a.w > b.col &&
               a.row < b.row + b.h &&
               a.row + a.h > b.row;
    }

    function canItemPassThroughDoor(item) {
        if (!item) return false;
        return Math.min(Number(item.w) || 0, Number(item.h) || 0) <= DOOR_WIDTH_TILES;
    }

    function straddlesQuadrantWall(room, col, row, w, h) {
        if (!room || !room.quadrants) return false;
        const c1 = Math.floor(col / 8);
        const c2 = Math.floor((col + w - 1) / 8);
        const r1 = Math.floor(row / 8);
        const r2 = Math.floor((row + h - 1) / 8);
        return c1 !== c2 || r1 !== r2;
    }

    function getItemQuadrant(room, col, row, w, h) {
        if (!room || !room.quadrants) return 0;
        if (straddlesQuadrantWall(room, col, row, w, h)) return -1;
        const colsPerSide = room.colsPerSide || Math.max(2, Math.round(room.gridW / 8));
        const qCol = Math.floor(col / 8);
        const qRow = Math.floor(row / 8);
        return qRow * colsPerSide + qCol;
    }

    function normalizeRotationDeg(val) {
        const n = Number(val);
        if (!Number.isFinite(n)) return 0;
        return ((Math.round(n / 90) * 90) % 360 + 360) % 360;
    }

    function getRotatedDimensions(baseW, baseH, rotDeg) {
        const rot = normalizeRotationDeg(rotDeg);
        const bw = Number(baseW) || 2;
        const bh = Number(baseH) || 2;
        if (rot === 90 || rot === 270) {
            return { w: bh, h: bw, rot };
        }
        return { w: bw, h: bh, rot };
    }

    function canPlaceItem(room, id, col, row, w, h, list = room.items) {
        if (col < 0 || row < 0 || col + w > room.gridW || row + h > room.gridH) return false;
        const candidate = { col, row, w, h };
        for (const other of list) {
            if (!other || other.id === id || other.hidden) continue;
            if (rectanglesOverlap(candidate, other)) return false;
        }
        return true;
    }

    function canMoveItemTo(room, item, originCol, originRow, targetCol, targetRow, list = room.items) {
        if (!canPlaceItem(room, item.id, targetCol, targetRow, item.w, item.h, list)) {
            return { ok: false, reason: 'overlap_or_bounds' };
        }
        if (!room || !room.quadrants) {
            return { ok: true, reason: '' };
        }
        if (straddlesQuadrantWall(room, targetCol, targetRow, item.w, item.h)) {
            return { ok: false, reason: 'wall' };
        }
        const origQuad = getItemQuadrant(room, originCol, originRow, item.w, item.h);
        const destQuad = getItemQuadrant(room, targetCol, targetRow, item.w, item.h);
        if (origQuad !== -1 && destQuad !== origQuad && !canItemPassThroughDoor(item)) {
            return { ok: false, reason: 'door_size' };
        }
        return { ok: true, reason: '' };
    }

    let dragToastTimer = null;
    function showHouseDragToast(message, undoCallback = null) {
        try {
            let el = document.getElementById('house-drag-toast');
            if (!el) {
                el = document.createElement('div');
                el.id = 'house-drag-toast';
                el.className = 'house-drag-toast';
                document.body.appendChild(el);
            }
            el.innerHTML = '';
            const msgSpan = document.createElement('span');
            msgSpan.textContent = message;
            el.appendChild(msgSpan);

            const hasUndo = typeof undoCallback === 'function';
            el.classList.toggle('has-undo', hasUndo);
            if (hasUndo) {
                const undoBtn = document.createElement('button');
                undoBtn.type = 'button';
                undoBtn.className = 'house-toast-undo-btn';
                undoBtn.textContent = '↩️ Вернуть';
                undoBtn.addEventListener('click', (e) => {
                    e.stopPropagation();
                    clearTimeout(dragToastTimer);
                    el.classList.remove('visible', 'has-undo');
                    undoCallback();
                });
                el.appendChild(undoBtn);
            }

            const bar = document.getElementById('house-item-action-bar');
            el.classList.toggle('above-bar', Boolean(bar && bar.classList.contains('visible')));
            el.classList.add('visible');
            clearTimeout(dragToastTimer);
            dragToastTimer = setTimeout(() => {
                el.classList.remove('visible', 'has-undo');
            }, hasUndo ? 4500 : 2400);
        } catch (e) {}
    }

    function findFreePlacementInRoom(room, item, acceptedList) {
        const prefQ = room.quadrants ? getItemQuadrant(room, item.col, item.row, item.w, item.h) : 0;

        const candidates = [];
        for (let r = 0; r <= room.gridH - item.h; r++) {
            for (let c = 0; c <= room.gridW - item.w; c++) {
                if (!canPlaceItem(room, item.id, c, r, item.w, item.h, acceptedList)) continue;
                if (room.quadrants && straddlesQuadrantWall(room, c, r, item.w, item.h)) continue;
                const q = room.quadrants ? getItemQuadrant(room, c, r, item.w, item.h) : 0;
                const sameQuadPenalty = (prefQ !== -1 && q !== prefQ) ? 1000 : 0;
                const dist = Math.abs(c - item.col) + Math.abs(r - item.row) + sameQuadPenalty;
                candidates.push({ col: c, row: r, dist });
            }
        }
        if (candidates.length === 0) return null;
        candidates.sort((a, b) => a.dist - b.dist);
        return { col: candidates[0].col, row: candidates[0].row };
    }

    function applyLayoutMap(room, savedMap) {
        if (!savedMap || typeof savedMap !== 'object') return false;
        const accepted = [];
        let changed = false;

        if (savedMap.__quadrantLayout && typeof savedMap.__quadrantLayout === 'object' && !room.dynamicRooms) {
            const nextQl = resolveQuadrantLayout(savedMap.__quadrantLayout);
            if (JSON.stringify(nextQl) !== JSON.stringify(room.quadrantLayout)) {
                changed = true;
            }
            room.quadrantLayout = nextQl;
        }

        // Сначала выставляем стили, размеры, rot и hidden у каждого элемента, чтобы размеры w/h при проверке коллизий были актуальными
        for (const item of room.items) {
            const candidate = savedMap[item.id];
            if (candidate && typeof candidate === 'object') {
                if (Number(candidate.baseW) >= 1 && Number(candidate.baseW) <= 8) {
                    if (item.baseW !== Number(candidate.baseW)) changed = true;
                    item.baseW = Number(candidate.baseW);
                    item.customStyled = true;
                }
                if (Number(candidate.baseH) >= 1 && Number(candidate.baseH) <= 8) {
                    if (item.baseH !== Number(candidate.baseH)) changed = true;
                    item.baseH = Number(candidate.baseH);
                    item.customStyled = true;
                }
                if (typeof candidate.color === 'string' && candidate.color) {
                    if (item.color !== candidate.color) changed = true;
                    item.color = candidate.color;
                    item.customStyled = true;
                }
                if (typeof candidate.shape === 'string' && candidate.shape) {
                    if (item.shape !== candidate.shape) changed = true;
                    item.shape = candidate.shape;
                    item.customStyled = true;
                }
                if (candidate.queueId !== undefined && Number.isFinite(Number(candidate.queueId))) {
                    const nextQ = Math.max(0, parseInt(candidate.queueId, 10) || 0);
                    if (item.queueId !== nextQ) changed = true;
                    item.queueId = nextQ;
                }
                const nextRot = normalizeRotationDeg(candidate.rot);
                const nextHidden = Boolean(candidate.hidden);
                const dims = getRotatedDimensions(item.baseW, item.baseH, nextRot);
                if (item.rot !== dims.rot || item.hidden !== nextHidden || item.w !== dims.w || item.h !== dims.h) {
                    changed = true;
                }
                item.rot = dims.rot;
                item.w = dims.w;
                item.h = dims.h;
                item.hidden = nextHidden;
            }
        }

        for (const item of room.items) {
            const candidate = savedMap[item.id];
            if (item.hidden) {
                if (candidate && Number.isInteger(candidate.col) && Number.isInteger(candidate.row)) {
                    const hCol = Math.max(0, Math.min(room.gridW - item.w, candidate.col));
                    const hRow = Math.max(0, Math.min(room.gridH - item.h, candidate.row));
                    if (item.col !== hCol || item.row !== hRow) changed = true;
                    item.col = hCol;
                    item.row = hRow;
                }
                accepted.push({ id: item.id, col: item.col, row: item.row, w: item.w, h: item.h, hidden: true });
                continue;
            }

            if (candidate && Number.isInteger(candidate.col) && Number.isInteger(candidate.row)) {
                const cCol = Math.max(0, Math.min(room.gridW - item.w, candidate.col));
                const cRow = Math.max(0, Math.min(room.gridH - item.h, candidate.row));
                const wallBlocked = room.quadrants && straddlesQuadrantWall(room, cCol, cRow, item.w, item.h);
                if (!wallBlocked && canPlaceItem(room, item.id, cCol, cRow, item.w, item.h, accepted)) {
                    if (item.col !== cCol || item.row !== cRow) changed = true;
                    accepted.push({ id: item.id, col: cCol, row: cRow, w: item.w, h: item.h, hidden: false });
                    continue;
                }
            }
            if (canPlaceItem(room, item.id, item.col, item.row, item.w, item.h, accepted)) {
                accepted.push({ id: item.id, col: item.col, row: item.row, w: item.w, h: item.h, hidden: false });
            } else {
                const fallback = findFreePlacementInRoom(room, item, accepted);
                if (fallback) {
                    changed = true;
                    accepted.push({ id: item.id, col: fallback.col, row: fallback.row, w: item.w, h: item.h, hidden: false });
                } else {
                    accepted.push({ id: item.id, col: item.col, row: item.row, w: item.w, h: item.h, hidden: false });
                }
            }
        }

        const finalPositions = [];
        for (const entry of accepted) {
            if (entry.hidden) {
                finalPositions.push(entry);
                continue;
            }
            if (canPlaceItem(room, entry.id, entry.col, entry.row, entry.w, entry.h, finalPositions)) {
                finalPositions.push(entry);
            } else {
                const orig = room.items.find(i => i.id === entry.id);
                if (orig && canPlaceItem(room, orig.id, orig.col, orig.row, orig.w, orig.h, finalPositions)) {
                    finalPositions.push({ id: orig.id, col: orig.col, row: orig.row, w: orig.w, h: orig.h, hidden: false });
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
            const entry = { col: item.col, row: item.row };
            if (item.rot) entry.rot = item.rot;
            if (item.hidden) entry.hidden = true;
            if (item.color && (item.customStyled || item.isUserThing)) entry.color = item.color;
            if (item.shape && (item.customStyled || item.shape !== 'rect')) entry.shape = item.shape;
            if (item.customStyled && item.baseW) entry.baseW = item.baseW;
            if (item.customStyled && item.baseH) entry.baseH = item.baseH;
            if (item.queueId !== undefined) entry.queueId = Number(item.queueId) || 0;
            payload[item.id] = entry;
        });
        if (room && room.quadrantLayout && !room.dynamicRooms) {
            payload.__quadrantLayout = resolveQuadrantLayout(room.quadrantLayout);
        }
        return payload;
    }

    const DEFAULT_QUADRANT_LAYOUT = {
        kitchen: [0, 0],
        hall: [1, 0],
        room: [0, 1],
        corridor: [1, 1]
    };

    function resolveQuadrantLayout(customLayout) {
        const result = {
            kitchen: [...DEFAULT_QUADRANT_LAYOUT.kitchen],
            hall: [...DEFAULT_QUADRANT_LAYOUT.hall],
            room: [...DEFAULT_QUADRANT_LAYOUT.room],
            corridor: [...DEFAULT_QUADRANT_LAYOUT.corridor]
        };
        if (customLayout && typeof customLayout === 'object') {
            Object.keys(result).forEach(key => {
                const coords = customLayout[key];
                if (Array.isArray(coords) && coords.length === 2 &&
                    (coords[0] === 0 || coords[0] === 1) &&
                    (coords[1] === 0 || coords[1] === 1)) {
                    result[key] = [coords[0], coords[1]];
                }
            });
        }
        return result;
    }

    function buildLegacyMergedMap(roomCfg, sourceGetter) {
        const legacies = Array.isArray(roomCfg.legacyRooms) ? roomCfg.legacyRooms : [];
        if (legacies.length === 0) return { layout: null, maxTs: 0 };

        const resolvedEntries = [];
        for (let idx = 0; idx < legacies.length; idx++) {
            const leg = legacies[idx];
            const res = sourceGetter(leg);
            if (!res || !res.layout || typeof res.layout !== 'object') continue;
            resolvedEntries.push({
                leg,
                layout: res.layout,
                ts: Number(res.ts || 0),
                order: idx
            });
        }
        if (resolvedEntries.length === 0) return { layout: null, maxTs: 0 };

        resolvedEntries.sort((a, b) => (a.ts - b.ts) || (a.order - b.order));

        const merged = {};
        let maxTs = 0;

        for (const entry of resolvedEntries) {
            const { leg, layout, ts } = entry;
            if (ts > maxTs) maxTs = ts;
            const offCol = Number(leg.offsetCol) || 0;
            const offRow = Number(leg.offsetRow) || 0;
            const remap = leg.remapQuadrants && typeof leg.remapQuadrants === 'object' ? leg.remapQuadrants : null;
            Object.keys(layout).forEach(itemId => {
                const pos = layout[itemId];
                if (pos && Number.isInteger(pos.col) && Number.isInteger(pos.row)) {
                    let targetCol = pos.col + offCol;
                    let targetRow = pos.row + offRow;
                    if (remap) {
                        const srcQCol = targetCol < 8 ? 0 : 1;
                        const srcQRow = targetRow < 8 ? 0 : 1;
                        const destCoords = remap[`${srcQCol},${srcQRow}`];
                        if (Array.isArray(destCoords) && destCoords.length === 2) {
                            targetCol = (targetCol - srcQCol * 8) + destCoords[0] * 8;
                            targetRow = (targetRow - srcQRow * 8) + destCoords[1] * 8;
                        }
                    }
                    merged[itemId] = {
                        col: targetCol,
                        row: targetRow,
                        ...(pos.rot ? { rot: normalizeRotationDeg(pos.rot) } : {}),
                        ...(pos.hidden ? { hidden: true } : {})
                    };
                }
            });
        }

        return { layout: merged, maxTs };
    }

    function getScopedKey(baseKey, userId) {
        if (!baseKey) return null;
        const uid = String(userId || '').trim();
        if (!uid || uid === 'guest') return null;
        return `${baseKey}::${uid}`;
    }

    function migrateLegacyUnscopedKeysForRoot(roomCfg, user) {
        if (!user || user.isGuest || !user.id || user.id === 'guest') return;
        const isRoot = typeof window.isRootUser === 'function' ? window.isRootUser(user) : false;
        if (!isRoot) return;

        const keyPairs = [
            { base: roomCfg.storageKey, tsBase: roomCfg.tsKey }
        ];
        if (Array.isArray(roomCfg.legacyRooms)) {
            roomCfg.legacyRooms.forEach(leg => {
                if (leg && leg.storageKey) {
                    keyPairs.push({ base: leg.storageKey, tsBase: leg.tsKey });
                }
            });
        }

        keyPairs.forEach(pair => {
            try {
                if (!pair.base) return;
                const scopedKey = getScopedKey(pair.base, user.id);
                const scopedTsKey = getScopedKey(pair.tsBase, user.id);
                const legacyVal = localStorage.getItem(pair.base);
                if (legacyVal && scopedKey && !localStorage.getItem(scopedKey)) {
                    localStorage.setItem(scopedKey, legacyVal);
                    if (pair.tsBase && scopedTsKey) {
                        const legacyTs = localStorage.getItem(pair.tsBase);
                        if (legacyTs && !localStorage.getItem(scopedTsKey)) {
                            localStorage.setItem(scopedTsKey, legacyTs);
                        }
                    }
                }
                if (legacyVal !== null) localStorage.removeItem(pair.base);
                if (pair.tsBase && localStorage.getItem(pair.tsBase) !== null) {
                    localStorage.removeItem(pair.tsBase);
                }
            } catch (e) {}
        });
    }

    const THING_SVG_PALETTES = {
        brown:  { main: '#B45309', dark: '#92400E', deep: '#78350F', stroke: '#451A03', light: '#D97706' },
        green:  { main: '#22C55E', dark: '#16A34A', deep: '#15803D', stroke: '#14532D', light: '#4ADE80' },
        blue:   { main: '#3B82F6', dark: '#2563EB', deep: '#1D4ED8', stroke: '#1E3A8A', light: '#60A5FA' },
        red:    { main: '#EF4444', dark: '#DC2626', deep: '#B91C1C', stroke: '#7F1D1D', light: '#F87171' },
        yellow: { main: '#EAB308', dark: '#CA8A04', deep: '#A16207', stroke: '#713F12', light: '#FACC15' },
        white:  { main: '#F8FAFC', dark: '#E2E8F0', deep: '#CBD5E1', stroke: '#475569', light: '#FFFFFF' },
        gray:   { main: '#94A3B8', dark: '#64748B', deep: '#475569', stroke: '#1E293B', light: '#CBD5E1' },
        black:  { main: '#334155', dark: '#1E293B', deep: '#0F172A', stroke: '#020617', light: '#475569' },
        orange: { main: '#F97316', dark: '#EA580C', deep: '#C2410C', stroke: '#7C2D12', light: '#FB923C' },
        purple: { main: '#A855F7', dark: '#9333EA', deep: '#7E22CE', stroke: '#581C87', light: '#C084FC' }
    };

    function resolveThingPalette(colorKey, fallbackKey = 'brown') {
        const clean = String(colorKey || '').trim().toLowerCase();
        if (THING_SVG_PALETTES[clean]) return THING_SVG_PALETTES[clean];
        if (/^#[0-9a-f]{6}$/i.test(clean)) {
            return {
                main: clean,
                dark: clean,
                deep: '#1e293b',
                stroke: '#0f172a',
                light: clean
            };
        }
        return THING_SVG_PALETTES[fallbackKey] || THING_SVG_PALETTES.brown;
    }

    function inferTypeFromId(itemId) {
        if (window.UserHousesSync && typeof window.UserHousesSync.inferBuiltinThingType === 'function') {
            return window.UserHousesSync.inferBuiltinThingType(itemId);
        }
        const id = String(itemId || '').toLowerCase();
        if (id.includes('table') || id.includes('desk')) return 'table';
        return 'custom';
    }

    function buildThingInnerSvg(type, opts = {}) {
        const cleanType = String(type || '').toLowerCase();
        const shape = String(opts.shape || 'rect').toLowerCase();
        const pal = opts.color ? resolveThingPalette(opts.color, 'brown') : null;
        const bw = Math.max(1, Number(opts.w) || 2);
        const bh = Math.max(1, Number(opts.h) || 2);
        const aspect = bw === bh ? 'xMidYMid meet' : 'none';

        switch (cleanType) {
            case 'table':
            case 'desk': {
                const tp = pal || THING_SVG_PALETTES.brown;
                if (shape === 'round') {
                    return `<svg xmlns="http://www.w3.org/2000/svg" viewBox="24 24 464 464" preserveAspectRatio="${aspect}" role="img" aria-label="Круглый столик" class="appliance-object">
                        <circle cx="152" cy="152" r="24" fill="${tp.deep}" stroke="${tp.stroke}" stroke-width="6"/>
                        <circle cx="360" cy="152" r="24" fill="${tp.deep}" stroke="${tp.stroke}" stroke-width="6"/>
                        <circle cx="152" cy="360" r="24" fill="${tp.deep}" stroke="${tp.stroke}" stroke-width="6"/>
                        <circle cx="360" cy="360" r="24" fill="${tp.deep}" stroke="${tp.stroke}" stroke-width="6"/>
                        <circle cx="256" cy="256" r="196" fill="${tp.main}" stroke="${tp.deep}" stroke-width="12"/>
                        <circle cx="256" cy="256" r="158" fill="none" stroke="${tp.light}" stroke-width="6" opacity="0.65"/>
                        <circle cx="256" cy="256" r="56" fill="${tp.dark}" opacity="0.35"/>
                    </svg>`;
                }
                if (shape === 'corner') {
                    return `<svg xmlns="http://www.w3.org/2000/svg" viewBox="24 24 464 464" preserveAspectRatio="${aspect}" role="img" aria-label="Угловой стол" class="appliance-object">
                        <rect x="232" y="218" width="224" height="32" rx="6" fill="${tp.dark}" stroke="${tp.stroke}" stroke-width="6"/>
                        <rect x="58" y="424" width="32" height="44" rx="6" fill="${tp.deep}" stroke="${tp.stroke}" stroke-width="5"/>
                        <rect x="196" y="424" width="32" height="44" rx="6" fill="${tp.deep}" stroke="${tp.stroke}" stroke-width="5"/>
                        <rect x="424" y="218" width="32" height="48" rx="6" fill="${tp.deep}" stroke="${tp.stroke}" stroke-width="5"/>
                        <path d="M56 48 H456 A16 16 0 0 1 472 64 V212 A16 16 0 0 1 456 228 H252 Q232 228 232 248 V436 A16 16 0 0 1 216 452 H56 A16 16 0 0 1 40 436 V64 A16 16 0 0 1 56 48 Z" fill="${tp.main}" stroke="${tp.deep}" stroke-width="10" stroke-linejoin="round"/>
                        <path d="M68 68 H444 V82 H82 V424 H68 Z" fill="${tp.light}" opacity="0.65"/>
                        <rect x="108" y="102" width="128" height="72" rx="10" fill="${tp.dark}" opacity="0.45" stroke="${tp.deep}" stroke-width="4"/>
                    </svg>`;
                }
                if (bw < bh) {
                    return `<svg xmlns="http://www.w3.org/2000/svg" viewBox="120 16 272 480" preserveAspectRatio="none" role="img" aria-label="Столик" class="appliance-object">
                        <g transform="rotate(90 256 256)">
                            <rect x="108" y="218" width="28" height="176" rx="6" fill="${tp.deep}"/>
                            <rect x="376" y="218" width="28" height="176" rx="6" fill="${tp.deep}"/>
                            <rect x="70" y="236" width="34" height="178" rx="8" fill="${tp.dark}" stroke="${tp.stroke}" stroke-width="6"/>
                            <rect x="408" y="236" width="34" height="178" rx="8" fill="${tp.dark}" stroke="${tp.stroke}" stroke-width="6"/>
                            <rect x="80" y="220" width="352" height="36" fill="${tp.dark}"/>
                            <rect x="36" y="156" width="440" height="68" rx="14" fill="${tp.main}" stroke="${tp.deep}" stroke-width="8"/>
                            <rect x="52" y="170" width="408" height="12" rx="6" fill="${tp.light}" opacity="0.72"/>
                        </g>
                    </svg>`;
                }
                return `<svg xmlns="http://www.w3.org/2000/svg" viewBox="16 144 480 280" preserveAspectRatio="none" role="img" aria-label="Столик" class="appliance-object">
                    <rect x="108" y="218" width="28" height="176" rx="6" fill="${tp.deep}"/>
                    <rect x="376" y="218" width="28" height="176" rx="6" fill="${tp.deep}"/>
                    <rect x="70" y="236" width="34" height="178" rx="8" fill="${tp.dark}" stroke="${tp.stroke}" stroke-width="6"/>
                    <rect x="408" y="236" width="34" height="178" rx="8" fill="${tp.dark}" stroke="${tp.stroke}" stroke-width="6"/>
                    <rect x="80" y="220" width="352" height="36" fill="${tp.dark}"/>
                    <rect x="36" y="156" width="440" height="68" rx="14" fill="${tp.main}" stroke="${tp.deep}" stroke-width="8"/>
                    <rect x="52" y="170" width="408" height="12" rx="6" fill="${tp.light}" opacity="0.72"/>
                </svg>`;
            }
            case 'stove': {
                const body = pal ? pal.light : '#F8F9FA';
                const top = pal ? pal.dark : '#E5E7EB';
                const border = pal ? pal.stroke : '#CBD5E1';
                return `<svg xmlns="http://www.w3.org/2000/svg" viewBox="48 48 416 448" preserveAspectRatio="${aspect}" class="appliance-object">
                    <rect x="64" y="64" width="384" height="416" rx="24" fill="${body}" stroke="${border}" stroke-width="8"/>
                    <rect x="64" y="64" width="384" height="64" fill="${top}" stroke="${border}" stroke-width="6"/>
                    <circle cx="160" cy="184" r="26" fill="#1F2937"/><circle cx="352" cy="184" r="26" fill="#1F2937"/>
                    <rect x="96" y="256" width="320" height="192" rx="12" fill="#1F2937" stroke="${border}" stroke-width="6"/>
                    <rect x="128" y="288" width="256" height="128" rx="8" fill="#111827"/>
                </svg>`;
            }
            case 'fridge': {
                const body = pal ? pal.main : '#e2e8f0';
                const stroke = pal ? pal.stroke : '#1e293b';
                return `<svg xmlns="http://www.w3.org/2000/svg" viewBox="80 36 352 464" preserveAspectRatio="${aspect}" class="appliance-object">
                    <rect x="96" y="48" width="320" height="416" rx="32" fill="${body}" stroke="${stroke}" stroke-width="12"/>
                    <line x1="96" y1="176" x2="416" y2="176" stroke="${stroke}" stroke-width="12"/>
                    <rect x="344" y="104" width="16" height="48" rx="8" fill="#334155"/>
                    <rect x="344" y="240" width="16" height="80" rx="8" fill="#334155"/>
                </svg>`;
            }
            case 'washer': {
                const body = pal ? pal.main : '#e2e8f0';
                const stroke = pal ? pal.stroke : '#1e293b';
                const ring = pal ? pal.light : '#38bdf8';
                return `<svg xmlns="http://www.w3.org/2000/svg" viewBox="48 48 416 448" preserveAspectRatio="${aspect}" class="appliance-object">
                    <rect x="64" y="64" width="384" height="416" rx="28" fill="${body}" stroke="${stroke}" stroke-width="12"/>
                    <circle cx="256" cy="296" r="108" fill="#0f172a" stroke="${ring}" stroke-width="12"/>
                    <circle cx="256" cy="296" r="76" fill="#0284c7" opacity="0.45"/>
                </svg>`;
            }
            case 'boiler': {
                const body = pal ? pal.main : '#e2e8f0';
                const stroke = pal ? pal.stroke : '#1e293b';
                return `<svg xmlns="http://www.w3.org/2000/svg" viewBox="96 24 320 468" preserveAspectRatio="${aspect}" class="appliance-object">
                    <rect x="112" y="80" width="288" height="360" rx="24" fill="${body}" stroke="${stroke}" stroke-width="12"/>
                    <rect x="144" y="128" width="224" height="128" rx="16" fill="#1e293b"/>
                    <circle cx="200" cy="192" r="28" fill="#334155" stroke="#38bdf8" stroke-width="6"/>
                    <circle cx="256" cy="336" r="16" fill="#ef4444" stroke="${stroke}" stroke-width="8"/>
                </svg>`;
            }
            case 'bed': {
                const base = pal ? pal.main : '#cbd5e1';
                const head = pal ? pal.dark : '#334155';
                const blanket = pal ? pal.light : '#0284c7';
                const blanketOp = pal ? '0.65' : '0.32';
                const stroke = pal ? pal.stroke : '#1e293b';
                if (bw < bh) {
                    // Вертикальная кровать (стандарт X < Y, например 1x2: изголовье сверху, длина по Y)
                    const single = bw === 1;
                    return `<svg xmlns="http://www.w3.org/2000/svg" viewBox="96 20 320 472" preserveAspectRatio="none" role="img" aria-label="Кровать" class="appliance-object">
                        <rect x="128" y="36" width="256" height="52" rx="14" fill="${head}" stroke="${stroke}" stroke-width="12"/>
                        <rect x="136" y="72" width="240" height="396" rx="20" fill="${base}" stroke="${stroke}" stroke-width="12"/>
                        <rect x="156" y="96" width="200" height="348" rx="14" fill="#f8fafc" stroke="${stroke}" stroke-width="10"/>
                        ${single
                            ? `<rect x="180" y="114" width="152" height="78" rx="16" fill="#e2e8f0" stroke="${stroke}" stroke-width="8"/>`
                            : `<rect x="168" y="114" width="80" height="78" rx="12" fill="#e2e8f0" stroke="${stroke}" stroke-width="8"/><rect x="264" y="114" width="80" height="78" rx="12" fill="#e2e8f0" stroke="${stroke}" stroke-width="8"/>`}
                        <path d="M156 218h200v212a14 14 0 0 1-14 14H170a14 14 0 0 1-14-14V218z" fill="${blanket}" opacity="${blanketOp}" stroke="${stroke}" stroke-width="10"/>
                        <rect x="156" y="212" width="200" height="24" rx="6" fill="#bae6fd" opacity="0.75" stroke="${stroke}" stroke-width="8"/>
                    </svg>`;
                }
                if (bw > bh) {
                    // Горизонтальная кровать (X > Y, например 2x1: изголовье слева, длина по X)
                    const single = bh === 1;
                    return `<svg xmlns="http://www.w3.org/2000/svg" viewBox="20 96 472 320" preserveAspectRatio="none" role="img" aria-label="Кровать" class="appliance-object">
                        <g transform="rotate(-90 256 256)">
                            <rect x="128" y="36" width="256" height="52" rx="14" fill="${head}" stroke="${stroke}" stroke-width="12"/>
                            <rect x="136" y="72" width="240" height="396" rx="20" fill="${base}" stroke="${stroke}" stroke-width="12"/>
                            <rect x="156" y="96" width="200" height="348" rx="14" fill="#f8fafc" stroke="${stroke}" stroke-width="10"/>
                            ${single
                                ? `<rect x="180" y="114" width="152" height="78" rx="16" fill="#e2e8f0" stroke="${stroke}" stroke-width="8"/>`
                                : `<rect x="168" y="114" width="80" height="78" rx="12" fill="#e2e8f0" stroke="${stroke}" stroke-width="8"/><rect x="264" y="114" width="80" height="78" rx="12" fill="#e2e8f0" stroke="${stroke}" stroke-width="8"/>`}
                            <path d="M156 218h200v212a14 14 0 0 1-14 14H170a14 14 0 0 1-14-14V218z" fill="${blanket}" opacity="${blanketOp}" stroke="${stroke}" stroke-width="10"/>
                            <rect x="156" y="212" width="200" height="24" rx="6" fill="#bae6fd" opacity="0.75" stroke="${stroke}" stroke-width="8"/>
                        </g>
                    </svg>`;
                }
                // Квадратная кровать (2x2, 3x3): изголовье сверху, две подушки
                return `<svg xmlns="http://www.w3.org/2000/svg" viewBox="32 32 448 448" preserveAspectRatio="xMidYMid meet" role="img" aria-label="Кровать" class="appliance-object">
                    <rect x="56" y="48" width="400" height="58" rx="16" fill="${head}" stroke="${stroke}" stroke-width="12"/>
                    <rect x="64" y="88" width="384" height="368" rx="22" fill="${base}" stroke="${stroke}" stroke-width="12"/>
                    <rect x="88" y="112" width="336" height="320" rx="16" fill="#f8fafc" stroke="${stroke}" stroke-width="10"/>
                    <rect x="112" y="132" width="132" height="84" rx="18" fill="#e2e8f0" stroke="${stroke}" stroke-width="8"/>
                    <rect x="268" y="132" width="132" height="84" rx="18" fill="#e2e8f0" stroke="${stroke}" stroke-width="8"/>
                    <path d="M88 238h336v178a16 16 0 0 1-16 16H104a16 16 0 0 1-16-16V238z" fill="${blanket}" opacity="${blanketOp}" stroke="${stroke}" stroke-width="10"/>
                    <rect x="88" y="232" width="336" height="28" rx="8" fill="#bae6fd" opacity="0.7" stroke="${stroke}" stroke-width="8"/>
                </svg>`;
            }
            case 'sofa': {
                const back = pal ? pal.dark : '#64748b';
                const seat = pal ? pal.main : '#cbd5e1';
                const arm = pal ? pal.light : '#94a3b8';
                const stroke = pal ? pal.stroke : '#1e293b';
                if (bw < bh) {
                    return `<svg xmlns="http://www.w3.org/2000/svg" viewBox="80 16 352 480" preserveAspectRatio="none" class="appliance-object">
                        <g transform="rotate(90 256 256)">
                            <rect x="40" y="110" width="432" height="140" rx="24" fill="${back}" stroke="${stroke}" stroke-width="12"/>
                            <rect x="64" y="210" width="384" height="160" rx="20" fill="${seat}" stroke="${stroke}" stroke-width="12"/>
                            <rect x="24" y="160" width="44" height="220" rx="16" fill="${arm}" stroke="${stroke}" stroke-width="10"/>
                            <rect x="444" y="160" width="44" height="220" rx="16" fill="${arm}" stroke="${stroke}" stroke-width="10"/>
                        </g>
                    </svg>`;
                }
                return `<svg xmlns="http://www.w3.org/2000/svg" viewBox="16 80 480 352" preserveAspectRatio="none" class="appliance-object">
                    <rect x="40" y="110" width="432" height="140" rx="24" fill="${back}" stroke="${stroke}" stroke-width="12"/>
                    <rect x="64" y="210" width="384" height="160" rx="20" fill="${seat}" stroke="${stroke}" stroke-width="12"/>
                    <rect x="24" y="160" width="44" height="220" rx="16" fill="${arm}" stroke="${stroke}" stroke-width="10"/>
                    <rect x="444" y="160" width="44" height="220" rx="16" fill="${arm}" stroke="${stroke}" stroke-width="10"/>
                </svg>`;
            }
            case 'armchair': {
                const seat = pal ? pal.main : '#cbd5e1';
                const back = pal ? pal.dark : '#94a3b8';
                const stroke = pal ? pal.stroke : '#1e293b';
                return `<svg xmlns="http://www.w3.org/2000/svg" viewBox="32 96 448 384" preserveAspectRatio="${aspect}" class="appliance-object">
                    <rect x="96" y="272" width="320" height="144" rx="20" fill="${seat}" stroke="${stroke}" stroke-width="12"/>
                    <rect x="112" y="112" width="288" height="180" rx="24" fill="${back}" stroke="${stroke}" stroke-width="12"/>
                </svg>`;
            }
            case 'closet': {
                const body = pal ? pal.main : '#cbd5e1';
                const stroke = pal ? pal.stroke : '#1e293b';
                return `<svg xmlns="http://www.w3.org/2000/svg" viewBox="64 36 384 440" preserveAspectRatio="${aspect}" class="appliance-object">
                    <rect x="80" y="48" width="352" height="416" rx="16" fill="${body}" stroke="${stroke}" stroke-width="12"/>
                    <line x1="256" y1="48" x2="256" y2="464" stroke="${stroke}" stroke-width="12"/>
                    <rect x="232" y="220" width="12" height="64" rx="6" fill="${stroke}"/>
                    <rect x="268" y="220" width="12" height="64" rx="6" fill="${stroke}"/>
                </svg>`;
            }
            case 'laptop':
                return `<svg xmlns="http://www.w3.org/2000/svg" viewBox="40 56 432 392" preserveAspectRatio="${aspect}" class="appliance-object">
                    <rect x="92" y="72" width="328" height="224" rx="22" fill="${pal ? pal.deep : '#1e293b'}" stroke="#0f172a" stroke-width="12"/>
                    <rect x="112" y="92" width="288" height="184" rx="12" fill="#0f172a"/>
                    <path d="M150 144h110M150 174h160" stroke="${pal ? pal.light : '#38bdf8'}" stroke-width="12" stroke-linecap="round"/>
                    <path d="M56 312h400l24 88H32l24-88z" fill="${pal ? pal.main : '#cbd5e1'}" stroke="#1e293b" stroke-width="12"/>
                </svg>`;
            case 'tv':
                if (bw < bh) {
                    return `<svg xmlns="http://www.w3.org/2000/svg" viewBox="64 32 360 448" preserveAspectRatio="none" class="appliance-object">
                        <g transform="rotate(90 256 256)">
                            <rect x="48" y="80" width="416" height="256" rx="18" fill="${pal ? pal.deep : '#0f172a'}" stroke="${pal ? pal.stroke : '#334155'}" stroke-width="14"/>
                            <rect x="72" y="104" width="368" height="208" rx="8" fill="${pal ? pal.light : '#0284c7'}" opacity="0.3"/>
                            <rect x="196" y="348" width="120" height="24" rx="8" fill="#475569"/>
                        </g>
                    </svg>`;
                }
                return `<svg xmlns="http://www.w3.org/2000/svg" viewBox="32 64 448 360" preserveAspectRatio="${aspect}" class="appliance-object">
                    <rect x="48" y="80" width="416" height="256" rx="18" fill="${pal ? pal.deep : '#0f172a'}" stroke="${pal ? pal.stroke : '#334155'}" stroke-width="14"/>
                    <rect x="72" y="104" width="368" height="208" rx="8" fill="${pal ? pal.light : '#0284c7'}" opacity="0.3"/>
                    <rect x="196" y="348" width="120" height="24" rx="8" fill="#475569"/>
                </svg>`;
            case 'router':
                return `<svg xmlns="http://www.w3.org/2000/svg" viewBox="48 64 416 384" preserveAspectRatio="${aspect}" class="appliance-object">
                    <rect x="128" y="88" width="24" height="144" rx="12" fill="#334155"/>
                    <rect x="360" y="88" width="24" height="144" rx="12" fill="#334155"/>
                    <rect x="64" y="232" width="384" height="144" rx="24" fill="${pal ? pal.main : '#1e293b'}" stroke="#0f172a" stroke-width="12"/>
                    <circle cx="144" cy="304" r="14" fill="#22c55e"/><circle cx="204" cy="304" r="14" fill="#38bdf8"/>
                </svg>`;
            case 'radiator':
                if (bw < bh) {
                    return `<svg xmlns="http://www.w3.org/2000/svg" viewBox="120 48 272 416" preserveAspectRatio="none" class="appliance-object">
                        <g transform="rotate(90 256 256)">
                            <rect x="72" y="152" width="368" height="208" rx="22" fill="${pal ? pal.main : '#e2e8f0'}" stroke="${pal ? pal.stroke : '#1e293b'}" stroke-width="12"/>
                            <line x1="140" y1="168" x2="140" y2="344" stroke="${pal ? pal.deep : '#64748b'}" stroke-width="16"/>
                            <line x1="216" y1="168" x2="216" y2="344" stroke="${pal ? pal.deep : '#64748b'}" stroke-width="16"/>
                            <line x1="292" y1="168" x2="292" y2="344" stroke="${pal ? pal.deep : '#64748b'}" stroke-width="16"/>
                            <line x1="368" y1="168" x2="368" y2="344" stroke="${pal ? pal.deep : '#64748b'}" stroke-width="16"/>
                        </g>
                    </svg>`;
                }
                return `<svg xmlns="http://www.w3.org/2000/svg" viewBox="48 120 416 272" preserveAspectRatio="none" class="appliance-object">
                    <rect x="72" y="152" width="368" height="208" rx="22" fill="${pal ? pal.main : '#e2e8f0'}" stroke="${pal ? pal.stroke : '#1e293b'}" stroke-width="12"/>
                    <line x1="140" y1="168" x2="140" y2="344" stroke="${pal ? pal.deep : '#64748b'}" stroke-width="16"/>
                    <line x1="216" y1="168" x2="216" y2="344" stroke="${pal ? pal.deep : '#64748b'}" stroke-width="16"/>
                    <line x1="292" y1="168" x2="292" y2="344" stroke="${pal ? pal.deep : '#64748b'}" stroke-width="16"/>
                    <line x1="368" y1="168" x2="368" y2="344" stroke="${pal ? pal.deep : '#64748b'}" stroke-width="16"/>
                </svg>`;
            case 'window':
                if (bw > bh) {
                    return `<svg xmlns="http://www.w3.org/2000/svg" viewBox="20 96 472 320" preserveAspectRatio="none" class="appliance-object">
                        <g transform="rotate(-90 256 256)">
                            <rect x="128" y="48" width="224" height="416" rx="14" fill="${pal ? pal.main : '#e2e8f0'}" stroke="${pal ? pal.stroke : '#1e293b'}" stroke-width="12"/>
                            <rect x="150" y="72" width="180" height="176" rx="8" fill="#38bdf8" opacity="0.6" stroke="#1e293b" stroke-width="8"/>
                            <rect x="150" y="264" width="180" height="176" rx="8" fill="#38bdf8" opacity="0.6" stroke="#1e293b" stroke-width="8"/>
                        </g>
                    </svg>`;
                }
                return `<svg xmlns="http://www.w3.org/2000/svg" viewBox="96 20 320 472" preserveAspectRatio="none" class="appliance-object">
                    <rect x="128" y="48" width="224" height="416" rx="14" fill="${pal ? pal.main : '#e2e8f0'}" stroke="${pal ? pal.stroke : '#1e293b'}" stroke-width="12"/>
                    <rect x="150" y="72" width="180" height="176" rx="8" fill="#38bdf8" opacity="0.6" stroke="#1e293b" stroke-width="8"/>
                    <rect x="150" y="264" width="180" height="176" rx="8" fill="#38bdf8" opacity="0.6" stroke="#1e293b" stroke-width="8"/>
                </svg>`;
            case 'conditioner':
                if (bw < bh) {
                    return `<svg xmlns="http://www.w3.org/2000/svg" viewBox="128 32 256 448" preserveAspectRatio="none" class="appliance-object">
                        <g transform="rotate(90 256 256)">
                            <rect x="48" y="144" width="416" height="168" rx="24" fill="${pal ? pal.main : '#f8fafc'}" stroke="${pal ? pal.stroke : '#1e293b'}" stroke-width="12"/>
                            <rect x="88" y="256" width="336" height="28" rx="8" fill="#38bdf8" opacity="0.7"/>
                        </g>
                    </svg>`;
                }
                return `<svg xmlns="http://www.w3.org/2000/svg" viewBox="32 128 448 256" preserveAspectRatio="none" class="appliance-object">
                    <rect x="48" y="144" width="416" height="168" rx="24" fill="${pal ? pal.main : '#f8fafc'}" stroke="${pal ? pal.stroke : '#1e293b'}" stroke-width="12"/>
                    <rect x="88" y="256" width="336" height="28" rx="8" fill="#38bdf8" opacity="0.7"/>
                </svg>`;
            case 'multicooker':
                return `<svg xmlns="http://www.w3.org/2000/svg" viewBox="64 48 384 416" preserveAspectRatio="${aspect}" class="appliance-object">
                    <ellipse cx="256" cy="144" rx="144" ry="44" fill="${pal ? pal.light : '#cbd5e1'}" stroke="#1e293b" stroke-width="12"/>
                    <rect x="96" y="144" width="320" height="272" rx="36" fill="${pal ? pal.main : '#475569'}" stroke="#1e293b" stroke-width="12"/>
                    <rect x="176" y="216" width="160" height="72" rx="12" fill="#0f172a"/>
                </svg>`;
            default: {
                const fill = pal ? pal.main : '#334155';
                const stroke = pal ? pal.light : '#38bdf8';
                const inner = pal ? pal.deep : '#1e293b';
                if (shape === 'round') {
                    return `<svg xmlns="http://www.w3.org/2000/svg" viewBox="32 32 448 448" preserveAspectRatio="${aspect}" class="appliance-object">
                        <circle cx="256" cy="256" r="204" fill="${fill}" stroke="${stroke}" stroke-width="16"/>
                        <circle cx="256" cy="256" r="144" fill="${inner}" stroke="#64748b" stroke-width="8"/>
                    </svg>`;
                }
                return `<svg xmlns="http://www.w3.org/2000/svg" viewBox="32 32 448 448" preserveAspectRatio="${aspect}" class="appliance-object">
                    <rect x="52" y="52" width="408" height="408" rx="44" fill="${fill}" stroke="${stroke}" stroke-width="16"/>
                    <rect x="92" y="92" width="328" height="328" rx="28" fill="${inner}" stroke="#64748b" stroke-width="8"/>
                    <circle cx="256" cy="230" r="64" fill="${stroke}" opacity="0.45"/>
                </svg>`;
            }
        }
    }

    function applyThingQueueBinding(item, houseRecord) {
        if (!item || !item.el) return;
        const qNum = Math.max(0, Number(item.queueId) || 0);
        const displayName = item.name || item.label || item.id || 'Предмет';
        if (qNum > 0) {
            const url = `/dashboard.html?queue=${qNum}`;
            item.el.setAttribute('href', url);
            item.el.setAttribute('draggable', 'false');
            item.el.style.cursor = 'pointer';
            item.el.onclick = (e) => onApplianceClick(
                e,
                url,
                `select ${displayName} ${qNum}`,
                `Выбран предмет ${displayName} (Queue #${qNum}${houseRecord ? ', ' + houseRecord.name : ''})`
            );
        } else {
            item.el.removeAttribute('href');
            item.el.onclick = null;
        }
        const captionEl = item.el.querySelector('.house-thing-caption');
        if (captionEl) {
            captionEl.textContent = `${displayName}${qNum > 0 ? ' #' + qNum : ''}`;
        }
    }

    function createCustomThingElement(thing, houseRecord) {
        const hasQueue = Number(thing.queueId) > 0;
        const tag = hasQueue ? 'a' : 'div';
        const el = document.createElement(tag);
        el.className = 'room-item';
        el.setAttribute('data-user-thing', '1');
        el.dataset.id = thing.id;
        el.dataset.thingType = thing.type || 'custom';
        if (thing.name) el.dataset.name = thing.name;
        if (thing.color) el.dataset.color = thing.color;
        if (thing.shape) el.dataset.shape = thing.shape;
        el.dataset.queueId = String(Number(thing.queueId) || 0);
        el.dataset.w = String(Number(thing.w) || 2);
        el.dataset.h = String(Number(thing.h) || 2);
        el.dataset.col = String(Number(thing.col) || 0);
        el.dataset.row = String(Number(thing.row) || 0);
        if (thing.rot) el.dataset.rot = String(normalizeRotationDeg(thing.rot));
        if (thing.hidden) el.dataset.hidden = '1';
        el.title = `${thing.name} (${el.dataset.w}×${el.dataset.h}${hasQueue ? ', Queue #' + thing.queueId : ''} — удерживайте 0.7с для действий и перемещения)`;

        if (hasQueue) {
            const url = `/dashboard.html?queue=${Number(thing.queueId)}`;
            el.href = url;
            el.setAttribute('draggable', 'false');
            el.onclick = (e) => onApplianceClick(
                e,
                url,
                `select ${thing.name} ${thing.queueId}`,
                `Выбран предмет ${thing.name} (Queue #${thing.queueId}, ${houseRecord ? houseRecord.name : 'Дом'})`
            );
        }

        el.innerHTML = buildThingInnerSvg(thing.type, { color: thing.color, shape: thing.shape, w: thing.w, h: thing.h }) +
            `<span class="house-thing-caption">${escapeHtml(thing.name)}${hasQueue ? ' #' + Number(thing.queueId) : ''}</span>`;
        return el;
    }

    function renderDynamicRoomsOverlay(boardEl, roomsList, colsPerSide, rowsPerSide) {
        if (!boardEl) return;
        const old = boardEl.querySelector('.house-quadrants-overlay');
        if (old) old.remove();

        const overlay = document.createElement('div');
        overlay.className = 'house-quadrants-overlay';
        overlay.setAttribute('aria-hidden', 'true');

        const cellW = 100 / colsPerSide;
        const cellH = 100 / rowsPerSide;
        const roomAtSlot = new Map();
        roomsList.forEach((r, idx) => {
            const slotIdx = (r.slotIndex !== undefined && Number.isInteger(r.slotIndex)) ? r.slotIndex : idx;
            roomAtSlot.set(slotIdx, r);
        });

        let html = '';
        for (let rr = 0; rr < rowsPerSide; rr++) {
            for (let cc = 0; cc < colsPerSide; cc++) {
                const idx = rr * colsPerSide + cc;
                const roomObj = roomAtSlot.get(idx);
                const leftPct = (cc * cellW).toFixed(4);
                const topPct = (rr * cellH).toFixed(4);
                const borderR = cc < (colsPerSide - 1) ? 'border-right: 3px solid rgba(71, 85, 105, 0.78);' : '';
                const borderB = rr < (rowsPerSide - 1) ? 'border-bottom: 3px solid rgba(71, 85, 105, 0.78);' : '';
                const hasRightNeighbor = cc < (colsPerSide - 1) && roomAtSlot.has(idx + 1);
                const hasBottomNeighbor = rr < (rowsPerSide - 1) && roomAtSlot.has(idx + colsPerSide);

                let doorsHtml = '';
                if (roomObj && hasRightNeighbor) {
                    doorsHtml += '<div class="house-quad-door-v" title="Проход шириной 2 плитки"></div>';
                }
                if (roomObj && hasBottomNeighbor) {
                    doorsHtml += '<div class="house-quad-door-h" title="Проход шириной 2 плитки"></div>';
                }

                const tagHtml = roomObj
                    ? `<span class="house-quad-tag" style="left: 8px; bottom: 8px;">🚪 ${escapeHtml(roomObj.name)} (8×8)</span>`
                    : '';

                html += `<div class="house-dyn-quad" style="left:${leftPct}%;top:${topPct}%;width:${cellW.toFixed(4)}%;height:${cellH.toFixed(4)}%;${borderR}${borderB}">
                    ${doorsHtml}
                    ${tagHtml}
                </div>`;
            }
        }
        overlay.innerHTML = html;
        boardEl.prepend(overlay);
    }

    function renderEmptyHouseOverlay(boardEl, houseRecord) {
        if (!boardEl) return;
        const oldQ = boardEl.querySelector('.house-quadrants-overlay');
        if (oldQ) oldQ.remove();
        const oldEmpty = boardEl.querySelector('.house-empty-state');
        if (oldEmpty) oldEmpty.remove();

        const box = document.createElement('div');
        box.className = 'house-empty-state';
        const houseRef = escapeHtml(houseRecord.number || houseRecord.name || '1');
        box.innerHTML = `
            <div class="house-empty-icon">🏠</div>
            <div class="house-empty-title">${escapeHtml(houseRecord.name)} пока пустой</div>
            <div class="house-empty-hint">
                Этот дом привязан только к вашему аккаунту. Чтобы добавить комнаты и мебель, выполните в консоли пошаговые команды:
            </div>
            <div class="house-empty-code">
                Add room ➔ kitchen ➔ to house ➔ ${houseRef}
            </div>
        `;
        boardEl.appendChild(box);
    }

    function prepareBoardForAccount(roomCfg, houseRecord, user) {
        const boardEl = document.getElementById(roomCfg.boardId);
        if (!boardEl) return { ...roomCfg };

        const cfgCopy = {
            ...roomCfg,
            defaults: { ...(roomCfg.defaults || {}) },
            colsPerSide: 2,
            rowsPerSide: 2
        };

        // Удаляем динамически созданные элементы от предыдущей инициализации
        boardEl.querySelectorAll('.room-item[data-user-thing="1"], .house-empty-state').forEach(el => el.remove());

        if (!houseRecord) return cfgCopy;

        const isBuiltin = Boolean(houseRecord.builtin);
        const labelEl = boardEl.closest('.room-section') ? boardEl.closest('.room-section').querySelector('.room-label') : null;
        const userRooms = Array.isArray(houseRecord.rooms) ? houseRecord.rooms : [];
        const userThings = Array.isArray(houseRecord.things) ? houseRecord.things : [];

        if (!isBuiltin) {
            // Для обычного аккаунта (или нового дома) убираем встроенную мебель root-шаблона
            boardEl.querySelectorAll('.room-item:not([data-user-thing="1"])').forEach(el => el.remove());
            cfgCopy.defaults = {};
            cfgCopy.legacyRooms = [];

            const geom = (window.UserHousesSync && typeof window.UserHousesSync.getGridGeometry === 'function')
                ? window.UserHousesSync.getGridGeometry(houseRecord)
                : { colsPerSide: 2, rowsPerSide: 2, gridW: 16, gridH: 16 };

            cfgCopy.colsPerSide = geom.colsPerSide;
            cfgCopy.rowsPerSide = geom.rowsPerSide;
            cfgCopy.gridW = geom.gridW;
            cfgCopy.gridH = geom.gridH;
            cfgCopy.quadrants = userRooms.length > 0;
            cfgCopy.dynamicRooms = userRooms;

            if (userRooms.length === 0) {
                renderEmptyHouseOverlay(boardEl, houseRecord);
                if (labelEl) labelEl.textContent = `🏠 ${houseRecord.name} — пустой дом`;
            } else {
                renderDynamicRoomsOverlay(boardEl, userRooms, geom.colsPerSide, geom.rowsPerSide);
                userThings.forEach(thing => {
                    const el = createCustomThingElement(thing, houseRecord);
                    boardEl.appendChild(el);
                    cfgCopy.defaults[thing.id] = { col: Number(thing.col) || 0, row: Number(thing.row) || 0 };
                });
                if (labelEl) {
                    labelEl.textContent = `🏠 ${houseRecord.name} — ${userRooms.length} комн. (${geom.gridW}×${geom.gridH})`;
                }
            }
            document.title = `Cloud Terminal — ${houseRecord.name}`;
        } else {
            if (houseRecord.quadrantLayout && typeof houseRecord.quadrantLayout === 'object') {
                cfgCopy.quadrantLayout = resolveQuadrantLayout(houseRecord.quadrantLayout);
            }
            // Для встроенного дома root добавляем пользовательские вещи поверх встроенного плана
            userThings.forEach(thing => {
                const el = createCustomThingElement(thing, houseRecord);
                boardEl.appendChild(el);
                cfgCopy.defaults[thing.id] = { col: Number(thing.col) || 0, row: Number(thing.row) || 0 };
            });
            if (labelEl && houseRecord.name) {
                const def = typeof window.getHouseDefinition === 'function' ? window.getHouseDefinition(houseRecord.id) : null;
                const isRenamed = Boolean(def && def.name && houseRecord.name !== def.name);
                if (isRenamed || (activeEffectiveCfg && activeEffectiveCfg.isQueryHouse)) {
                    const icon = houseRecord.number === 2 ? '🏡' : (houseRecord.number === 3 ? '🏘️' : '🏠');
                    labelEl.textContent = `${icon} ${houseRecord.name} — Единый квадрат 16×16 (4 × 8×8)`;
                    document.title = `Cloud Terminal — ${houseRecord.name}`;
                }
            }
        }

        // Инвалидируем кеш размеров пола, если изменилась сетка
        boardEl._floorDrawnKey = '';
        return cfgCopy;
    }

    function updateHouseTopNav(user, cfg, houseRecord, activeRoom) {
        const nav = document.querySelector('.top-nav');
        if (!nav || !user) return;
        const boundHouses = typeof window.getUserBoundHouses === 'function' ? window.getUserBoundHouses(user) : [];
        const currentHouseId = houseRecord ? houseRecord.id : (cfg && cfg.homeId);

        let html = `
            <a href="/terminal.html" onclick="recordNav('/terminal.html', 'go to terminal', 'Переход в консоль')">💻 Консоль</a>
            <a href="/dashboard.html" onclick="recordNav('/dashboard.html', 'go to dashboard', 'Переход в дашборд')">🎛️ Dashboard</a>
            <a href="/missions.html" onclick="recordNav('/missions.html', 'go to missions', 'Переход в поручения')">📋 Поручения</a>
            <span class="top-nav-sep"></span>
        `;

        boundHouses.forEach(h => {
            const isActive = h.id === currentHouseId;
            const icon = h.number === 2 ? '🏡' : (h.number === 3 ? '🏘️' : '🏠');
            const url = h.url || '/house/index.html';
            if (isActive) {
                html += `<a href="${escapeHtml(url)}" class="active">${icon} ${escapeHtml(h.name)}</a>`;
            } else {
                html += `<a href="${escapeHtml(url)}" onclick="recordNav('${escapeHtml(url)}', 'go to home ${escapeHtml(h.number || h.id)}', 'Переход в ${escapeHtml(h.name)}')">${icon} ${escapeHtml(h.name)}</a>`;
            }
        });

        const isBuiltin = !houseRecord || Boolean(houseRecord.builtin);
        const dynRooms = houseRecord && Array.isArray(houseRecord.rooms) ? houseRecord.rooms : [];

        if (isBuiltin) {
            html += `
                <span class="top-nav-sep"></span>
                <button type="button" onclick="jumpToQuadrant('kitchen')">🍳 Кухня</button>
                <button type="button" onclick="jumpToQuadrant('hall')">🛋️ Зал</button>
                <button type="button" onclick="jumpToQuadrant('room')">🛏️ Комната</button>
                <button type="button" onclick="jumpToQuadrant('corridor')">🚶 Коридор</button>
            `;
        } else if (dynRooms.length > 0) {
            html += `<span class="top-nav-sep"></span>`;
            dynRooms.forEach((r, idx) => {
                const slot = Number.isInteger(r.slotIndex) ? r.slotIndex : idx;
                html += `<button type="button" onclick="jumpToQuadrant(${slot})">🚪 ${escapeHtml(r.name)}</button>`;
            });
        }

        html += `<span class="top-nav-sep"></span><span id="global-auth-profile" class="auth-profile-badge"></span>`;
        nav.innerHTML = html;
        if (typeof window.updateGlobalAuthBadge === 'function') {
            window.updateGlobalAuthBadge(user);
        }
    }

    function loadRoomLayoutState(roomCfg, user) {
        const uid = user && !user.isGuest && user.id && user.id !== 'guest' ? String(user.id) : null;
        migrateLegacyUnscopedKeysForRoot(roomCfg, user);

        const scopedStorageKey = getScopedKey(roomCfg.storageKey, uid);
        const scopedTsKey = getScopedKey(roomCfg.tsKey, uid);

        const boardEl = document.getElementById(roomCfg.boardId);
        const gridOverlay = boardEl ? boardEl.querySelector('.drag-grid-overlay') : null;
        const targetBox = boardEl ? boardEl.querySelector('.drag-target-box') : null;
        const domItems = boardEl ? Array.from(boardEl.querySelectorAll('.room-item')) : [];

        let saved = null;
        if (scopedStorageKey) {
            try {
                const raw = localStorage.getItem(scopedStorageKey);
                if (raw) {
                    const parsed = JSON.parse(raw);
                    if (parsed && typeof parsed === 'object' && Object.keys(parsed).length > 0) {
                        saved = parsed;
                    }
                }
            } catch (e) {
                saved = null;
            }
        }

        const quadrantLayout = resolveQuadrantLayout(roomCfg.quadrantLayout);

        const room = {
            id: roomCfg.id,
            storageKey: scopedStorageKey,
            tsKey: scopedTsKey,
            legacyRooms: Array.isArray(roomCfg.legacyRooms) ? roomCfg.legacyRooms : [],
            quadrants: roomCfg.quadrants !== false,
            quadrantLayout,
            colsPerSide: Number(roomCfg.colsPerSide) || 2,
            rowsPerSide: Number(roomCfg.rowsPerSide) || 2,
            gridW: Number(roomCfg.gridW) || 16,
            gridH: Number(roomCfg.gridH) || 16,
            dynamicRooms: Array.isArray(roomCfg.dynamicRooms) ? roomCfg.dynamicRooms : null,
            boardEl,
            gridOverlay,
            targetBox,
            items: []
        };

        if (room.quadrants && boardEl && !room.dynamicRooms) {
            ensureQuadrantsOverlay(boardEl, roomCfg.quadrantLabels || null, quadrantLayout);
        }

        room.items = domItems.map(el => {
            const id = el.dataset.id;
            const isUserThing = el.getAttribute('data-user-thing') === '1';
            const thingType = el.dataset.thingType || inferTypeFromId(id);
            const name = el.dataset.name || undefined;
            const color = el.dataset.color || null;
            const shape = el.dataset.shape || (id === 'hall3_table' ? 'corner' : 'rect');
            const queueIdAttr = el.dataset.queueId !== undefined ? Number(el.dataset.queueId) : undefined;
            const baseW = Number(el.dataset.w) || 2;
            const baseH = Number(el.dataset.h) || 2;
            const rot = normalizeRotationDeg(el.dataset.rot || 0);
            const hidden = el.dataset.hidden === '1';
            const dims = getRotatedDimensions(baseW, baseH, rot);
            const def = (roomCfg.defaults && roomCfg.defaults[id]) || {
                col: Number(el.dataset.col) || 0,
                row: Number(el.dataset.row) || 0
            };
            const itemObj = {
                id,
                el,
                isUserThing,
                thingType,
                name,
                color,
                shape,
                queueId: queueIdAttr,
                baseW,
                baseH,
                w: dims.w,
                h: dims.h,
                rot: dims.rot,
                hidden,
                col: def.col,
                row: def.row,
                room
            };
            el._houseRoomItem = itemObj;
            return itemObj;
        });

        if (saved) {
            applyLayoutMap(room, saved);
        } else if (uid && room.legacyRooms.length > 0) {
            const localLegacy = buildLegacyMergedMap(roomCfg, (leg) => {
                try {
                    const legKey = getScopedKey(leg.storageKey, uid);
                    const legTsKey = getScopedKey(leg.tsKey, uid);
                    const raw = legKey ? localStorage.getItem(legKey) : null;
                    if (!raw) return null;
                    const layout = JSON.parse(raw);
                    const ts = Number((legTsKey ? localStorage.getItem(legTsKey) : 0) || 0);
                    return { layout, ts };
                } catch (e) {
                    return null;
                }
            });
            if (localLegacy.layout) {
                applyLayoutMap(room, localLegacy.layout);
                saveRoomLayoutLocalOnly(room, localLegacy.maxTs || Date.now());
            }
        }

        if (room.quadrants && boardEl && !room.dynamicRooms) {
            ensureQuadrantsOverlay(boardEl, roomCfg.quadrantLabels || null, room.quadrantLayout, true);
        }

        return room;
    }

    function ensureQuadrantsOverlay(boardEl, labels, quadrantLayout, forceRebuild = false) {
        if (!boardEl) return;
        const existing = boardEl.querySelector('.house-quadrants-overlay');
        if (existing) {
            if (!forceRebuild) return;
            existing.remove();
        }
        const lbl = labels || {};
        const layout = resolveQuadrantLayout(quadrantLayout);

        const meta = {
            kitchen: { title: 'Кухня', tag: lbl.kitchen || '🍳 Кухня (8×8)' },
            hall: { title: 'Зал', tag: lbl.hall || '🛋️ Зал (8×8)' },
            room: { title: 'Комната', tag: lbl.room || '🛏️ Комната (8×8)' },
            corridor: { title: 'Коридор', tag: lbl.corridor || '🚶 Коридор (8×8)' }
        };

        const slotDefs = [
            { slot: 'tl', coords: [0, 0], tagStyle: 'left: 8px; bottom: 8px;' },
            { slot: 'tr', coords: [1, 0], tagStyle: 'right: 8px; bottom: 8px;' },
            { slot: 'bl', coords: [0, 1], tagStyle: 'left: 8px; bottom: 8px;' },
            { slot: 'br', coords: [1, 1], tagStyle: 'right: 8px; bottom: 8px;' }
        ];

        const atSlot = {};
        slotDefs.forEach(s => {
            const matchKey = Object.keys(layout).find(k => layout[k][0] === s.coords[0] && layout[k][1] === s.coords[1]);
            atSlot[s.slot] = matchKey || 'corridor';
        });

        const overlay = document.createElement('div');
        overlay.className = 'house-quadrants-overlay';
        overlay.setAttribute('aria-hidden', 'true');
        overlay.innerHTML = slotDefs.map(s => {
            const qKey = atSlot[s.slot];
            let doorsHtml = '';
            if (s.slot === 'tl') {
                doorsHtml += `<div class="house-quad-door-v" title="Проход ${meta[atSlot.tl].title} ↔ ${meta[atSlot.tr].title}"></div>`;
                doorsHtml += `<div class="house-quad-door-h" title="Проход ${meta[atSlot.tl].title} ↔ ${meta[atSlot.bl].title}"></div>`;
            } else if (s.slot === 'tr') {
                doorsHtml += `<div class="house-quad-door-h" title="Проход ${meta[atSlot.tr].title} ↔ ${meta[atSlot.br].title}"></div>`;
            } else if (s.slot === 'bl') {
                doorsHtml += `<div class="house-quad-door-v" title="Проход ${meta[atSlot.bl].title} ↔ ${meta[atSlot.br].title}"></div>`;
            }
            return `
            <div class="house-quad quad-${qKey} quad-slot-${s.slot}">
                ${doorsHtml}
                <span class="house-quad-tag" style="${s.tagStyle}">${meta[qKey].tag}</span>
            </div>`;
        }).join('');
        boardEl.prepend(overlay);
    }

    function saveRoomLayoutLocalOnly(room, customTs = null) {
        try {
            if (!activeHouseUser || activeHouseUser.isGuest || !activeHouseUser.id || activeHouseUser.id === 'guest') {
                return null;
            }
            if (!room || !room.storageKey || !room.tsKey) return null;
            const payload = getCurrentLayoutPayload(room);
            localStorage.setItem(room.storageKey, JSON.stringify(payload));
            localStorage.setItem(room.tsKey, String(customTs !== null ? customTs : Date.now()));
            return payload;
        } catch (e) {
            return null;
        }
    }

    function saveRoomLayoutState(room) {
        if (!activeHouseUser || activeHouseUser.isGuest || !activeHouseUser.id || activeHouseUser.id === 'guest') {
            return;
        }
        const nowTs = Date.now();
        const payload = saveRoomLayoutLocalOnly(room, nowTs);
        if (payload && window.HouseLayoutSync && typeof window.HouseLayoutSync.saveAndSyncHouseLayout === 'function') {
            window.HouseLayoutSync.saveAndSyncHouseLayout(room.id, payload, activeHouseUser, nowTs);
        }
        if (payload && activeHouseRecord && window.UserHousesSync && typeof window.UserHousesSync.updateThingPositionsFromLayout === 'function') {
            window.UserHousesSync.updateThingPositionsFromLayout(activeHouseUser, activeHouseRecord.id, payload);
        }
    }

    async function syncAllRoomsWithDatabase() {
        const syncUser = activeHouseUser;
        if (!syncUser || syncUser.isGuest || !syncUser.id || syncUser.id === 'guest') return;
        if (!window.HouseLayoutSync || roomsState.length === 0) return;
        if (activeDragSession || panSession) return;
        try {
            if (typeof navigator !== 'undefined' && navigator.onLine === false) return;
            await window.HouseLayoutSync.flushPendingHouseLayouts();
            if (!activeHouseUser || activeHouseUser.id !== syncUser.id || roomsState.length === 0) return;

            const pending = window.HouseLayoutSync.getPendingHouseLayouts(syncUser.id);

            const allRoomIds = [];
            roomsState.forEach(r => {
                allRoomIds.push(r.id);
                (r.legacyRooms || []).forEach(leg => allRoomIds.push(leg.id));
            });

            const remoteMap = typeof window.HouseLayoutSync.fetchAllHouseLayoutsFromDb === 'function'
                ? await window.HouseLayoutSync.fetchAllHouseLayoutsFromDb(allRoomIds)
                : {};
            if (!activeHouseUser || activeHouseUser.id !== syncUser.id || roomsState.length === 0) return;

            for (const room of roomsState) {
                if (pending && pending[room.id]) continue;

                const hasLocalSaved = Boolean(room.storageKey && localStorage.getItem(room.storageKey));
                const localTs = Number((room.tsKey ? localStorage.getItem(room.tsKey) : 0) || 0);
                const remoteUnified = remoteMap[room.id];
                const remoteUnifiedTs = remoteUnified
                    ? (Number(remoteUnified.ts) || (remoteUnified.updatedAt ? new Date(remoteUnified.updatedAt).getTime() : 0))
                    : 0;

                // Legacy используем ТОЛЬКО как fallback, если ещё нет сохранённого единого формата (remoteUnified)
                const remoteLegacy = (!remoteUnified || !remoteUnified.layout)
                    ? buildLegacyMergedMap(room, (leg) => {
                        const entry = remoteMap[leg.id];
                        if (!entry || !entry.layout) return null;
                        return {
                            layout: entry.layout,
                            ts: Number(entry.ts) || (entry.updatedAt ? new Date(entry.updatedAt).getTime() : 0)
                        };
                    })
                    : { layout: null, maxTs: 0 };

                let chosenLayout = null;
                let chosenTs = 0;
                let migratedFromLegacy = false;

                if (remoteUnified && remoteUnified.layout) {
                    chosenLayout = remoteUnified.layout;
                    chosenTs = remoteUnifiedTs;
                } else if (remoteLegacy.layout) {
                    chosenLayout = remoteLegacy.layout;
                    chosenTs = remoteLegacy.maxTs || Date.now();
                    migratedFromLegacy = true;
                }

                if (chosenLayout && (!hasLocalSaved || (chosenTs > 0 && chosenTs > localTs))) {
                    const changed = applyLayoutMap(room, chosenLayout);
                    const savedPayload = saveRoomLayoutLocalOnly(room, chosenTs || Date.now());
                    if (changed) {
                        if (room.quadrants && room.boardEl && !room.dynamicRooms) {
                            ensureQuadrantsOverlay(room.boardEl, null, room.quadrantLayout, true);
                        }
                        room.items.forEach(item => applyItemGeometry(item));
                        if (selectedItem && selectedItem.hidden) {
                            clearSelectedItem();
                        }
                    }
                    if (migratedFromLegacy && savedPayload) {
                        window.HouseLayoutSync.saveAndSyncHouseLayout(room.id, savedPayload, syncUser, chosenTs || Date.now());
                    }
                } else if (hasLocalSaved && localTs > chosenTs && window.HouseLayoutSync) {
                    const localPayload = getCurrentLayoutPayload(room);
                    window.HouseLayoutSync.saveAndSyncHouseLayout(room.id, localPayload, syncUser, localTs);
                } else if (!chosenLayout && !hasLocalSaved && window.HouseLayoutSync && Array.isArray(room.items) && room.items.length > 0) {
                    const initTs = Date.now();
                    const initPayload = saveRoomLayoutLocalOnly(room, initTs);
                    if (initPayload) {
                        window.HouseLayoutSync.saveAndSyncHouseLayout(room.id, initPayload, syncUser, initTs);
                    }
                }
            }
        } catch (e) {
            console.warn('syncAllRoomsWithDatabase error:', e);
        }
    }

    function getFloorTilePatternCanvas() {
        if (cachedFloorPatternCanvas) return cachedFloorPatternCanvas;
        try {
            const size = 128;
            const canvas = document.createElement('canvas');
            canvas.width = size;
            canvas.height = size;
            const ctx = canvas.getContext('2d');
            if (!ctx) return null;

            const drawPoly = (pts, fill, stroke, lineW) => {
                ctx.beginPath();
                pts.forEach(([x, y], idx) => {
                    if (idx === 0) ctx.moveTo(x, y);
                    else ctx.lineTo(x, y);
                });
                ctx.closePath();
                if (fill) {
                    ctx.fillStyle = fill;
                    ctx.fill();
                }
                if (stroke && lineW) {
                    ctx.strokeStyle = stroke;
                    ctx.lineWidth = lineW;
                    ctx.stroke();
                }
            };

            ctx.fillStyle = '#526071';
            ctx.fillRect(0, 0, size, size);

            const corners = [[0, 0], [128, 0], [0, 128], [128, 128]];
            corners.forEach(([cx, cy]) => {
                drawPoly(
                    [[cx, cy - 30], [cx + 30, cy], [cx, cy + 30], [cx - 30, cy]],
                    '#2563EB', '#334155', 2.5
                );
                drawPoly(
                    [[cx, cy - 21], [cx + 21, cy], [cx, cy + 21], [cx - 21, cy]],
                    '#3B82F6', null, 0
                );
            });

            drawPoly(
                [[37, 4], [91, 4], [124, 37], [124, 91], [91, 124], [37, 124], [4, 91], [4, 37]],
                '#FFFFFF', '#334155', 2.5
            );
            drawPoly(
                [[40, 10], [88, 10], [118, 40], [118, 88], [88, 118], [40, 118], [10, 88], [10, 40]],
                '#F8FAFC', '#CBD5E1', 1.5
            );

            cachedFloorPatternCanvas = canvas;
            return canvas;
        } catch (e) {
            return null;
        }
    }

    function drawStaticFloorCanvas(room) {
        if (!room || !room.boardEl) return;
        const drawKey = `${room.gridW}x${room.gridH}x${tilePx}`;
        if (room.boardEl._floorDrawnKey === drawKey) return;

        const widthCss = room.gridW * tilePx;
        const heightCss = room.gridH * tilePx;

        let canvas = room.boardEl.querySelector('canvas.house-floor-layer');
        if (!canvas) {
            canvas = document.createElement('canvas');
            canvas.className = 'house-floor-layer';
            canvas.setAttribute('aria-hidden', 'true');
            room.boardEl.prepend(canvas);
        }

        const dpr = Math.min(2, (typeof window !== 'undefined' && window.devicePixelRatio) || 1);
        canvas.style.width = `${widthCss}px`;
        canvas.style.height = `${heightCss}px`;
        canvas.width = Math.round(widthCss * dpr);
        canvas.height = Math.round(heightCss * dpr);

        const ctx = canvas.getContext('2d');
        if (!ctx) return;

        ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
        ctx.fillStyle = '#526071';
        ctx.fillRect(0, 0, widthCss, heightCss);

        const tileCanvas = getFloorTilePatternCanvas();
        if (tileCanvas) {
            for (let r = 0; r < room.gridH; r++) {
                for (let c = 0; c < room.gridW; c++) {
                    ctx.drawImage(tileCanvas, c * tilePx, r * tilePx, tilePx, tilePx);
                }
            }
        }

        room.boardEl._floorDrawnKey = drawKey;
    }

    function applyItemGeometry(item, pxLeft, pxTop) {
        if (!item || !item.el) return;
        item.el.classList.toggle('is-hidden', Boolean(item.hidden));
        item.el.style.transform = '';
        item.el.style.setProperty('--item-rot', `${normalizeRotationDeg(item.rot)}deg`);
        item.el.style.left = (pxLeft !== undefined ? pxLeft : item.col * tilePx) + 'px';
        item.el.style.top = (pxTop !== undefined ? pxTop : item.row * tilePx) + 'px';
        item.el.style.width = (item.w * tilePx) + 'px';
        item.el.style.height = (item.h * tilePx) + 'px';

        const renderSig = item.customStyled ? `${item.thingType || inferTypeFromId(item.id)}|${item.color || ''}|${item.shape || 'rect'}|${item.baseW}x${item.baseH}` : '';
        if (renderSig && item._renderedStyleSig !== renderSig) {
            const oldSvg = item.el.querySelector('.appliance-object');
            const newHtml = buildThingInnerSvg(item.thingType || inferTypeFromId(item.id), {
                color: item.color,
                shape: item.shape,
                w: item.baseW,
                h: item.baseH
            });
            if (oldSvg) {
                oldSvg.outerHTML = newHtml;
            } else {
                item.el.insertAdjacentHTML('afterbegin', newHtml);
            }
            item._renderedStyleSig = renderSig;
        }

        if (item.queueId !== undefined && item._appliedQueueId !== item.queueId) {
            applyThingQueueBinding(item, activeHouseRecord);
            item._appliedQueueId = item.queueId;
        }

        const svgEl = item.el.querySelector('.appliance-object');
        if (svgEl) {
            svgEl.style.width = ((item.baseW || item.w) * tilePx) + 'px';
            svgEl.style.height = ((item.baseH || item.h) * tilePx) + 'px';
        }
    }

    function layoutAllBoards(force = false) {
        if ((activeDragSession && activeDragSession.isDragging) || panSession) return;

        const viewport = document.getElementById('house-viewport');
        if (!viewport || roomsState.length === 0) return;

        const style = getComputedStyle(viewport);
        const padY = parseFloat(style.paddingTop) + parseFloat(style.paddingBottom);
        const availH = Math.max(240, viewport.clientHeight - padY);
        const availW = Math.max(240, viewport.clientWidth - 32);

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

            drawStaticFloorCanvas(room);

            if (room.gridOverlay) {
                room.gridOverlay.style.backgroundSize = `${tilePx}px ${tilePx}px`;
            }

            room.items.forEach(item => applyItemGeometry(item));
        });
    }

    function jumpToQuadrant(quadKeyOrIdx, smooth = true) {
        const viewport = document.getElementById('house-viewport');
        const room = roomsState[0];
        if (!viewport || !room || !room.boardEl) return;

        const halfW = 8 * tilePx;
        const halfH = 8 * tilePx;
        let coords = [0, 0];

        if (typeof quadKeyOrIdx === 'number' || /^\d+$/.test(String(quadKeyOrIdx))) {
            const idx = Number(quadKeyOrIdx);
            const colsPerSide = room.colsPerSide || 2;
            coords = [idx % colsPerSide, Math.floor(idx / colsPerSide)];
        } else {
            const layout = room.quadrantLayout || DEFAULT_QUADRANT_LAYOUT;
            coords = layout[quadKeyOrIdx] || DEFAULT_QUADRANT_LAYOUT[quadKeyOrIdx] || [0, 0];
        }

        const targetOffsetX = coords[0] * halfW;
        const targetOffsetY = coords[1] * halfH;

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

    function getItemDisplayName(item) {
        if (!item || !item.el) return 'Предмет';
        const svgLabel = item.el.querySelector('.appliance-object')?.getAttribute('aria-label');
        const caption = item.el.querySelector('.house-thing-caption')?.textContent;
        if (svgLabel) return svgLabel;
        if (caption) return caption;
        return item.id || 'Предмет';
    }

    function ensureItemActionBar() {
        let bar = document.getElementById('house-item-action-bar');
        if (bar) return bar;
        if (!document.body) return null;

        bar = document.createElement('div');
        bar.id = 'house-item-action-bar';
        bar.className = 'house-item-action-bar';
        bar.innerHTML = `
            <button type="button" id="house-btn-rotate-ccw" class="house-action-btn" title="Повернуть против часовой стрелки (-90°)" aria-label="Повернуть против часовой стрелки">
                <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">
                    <path d="M3 12a9 9 0 1 0 3-6.7L3 8"/>
                    <path d="M3 3v5h5"/>
                </svg>
                <span>-90°</span>
            </button>
            <button type="button" id="house-btn-hide-item" class="house-action-btn house-action-btn-hide" title="Убрать (скрыть) предмет" aria-label="Скрыть предмет">
                <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.1" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">
                    <path d="M17.94 17.94A10.07 10.07 0 0 1 12 20c-7 0-11-8-11-8a18.45 18.45 0 0 1 5.06-5.94"/>
                    <path d="M9.9 4.24A9.12 9.12 0 0 1 12 4c7 0 11 8 11 8a18.5 18.5 0 0 1-2.16 3.19"/>
                    <line x1="1" y1="1" x2="23" y2="23"/>
                </svg>
                <span>Скрыть</span>
            </button>
            <button type="button" id="house-btn-rotate-cw" class="house-action-btn" title="Повернуть по часовой стрелке (+90°)" aria-label="Повернуть по часовой стрелке">
                <span>+90°</span>
                <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">
                    <path d="M21 12a9 9 0 1 1-3-6.7L21 8"/>
                    <path d="M21 3v5h-5"/>
                </svg>
            </button>
        `;

        const stopEvt = (e) => { e.stopPropagation(); };
        bar.addEventListener('touchstart', stopEvt, { passive: true });
        bar.addEventListener('pointerdown', stopEvt);
        bar.addEventListener('mousedown', stopEvt);

        bar.querySelector('#house-btn-rotate-ccw').addEventListener('click', (e) => {
            e.preventDefault();
            e.stopPropagation();
            rotateSelectedItem(-90);
        });
        bar.querySelector('#house-btn-hide-item').addEventListener('click', (e) => {
            e.preventDefault();
            e.stopPropagation();
            hideSelectedItem();
        });
        bar.querySelector('#house-btn-rotate-cw').addEventListener('click', (e) => {
            e.preventDefault();
            e.stopPropagation();
            rotateSelectedItem(90);
        });

        document.body.appendChild(bar);
        return bar;
    }

    function selectRoomItem(item) {
        if (!item || item.hidden) {
            clearSelectedItem();
            return;
        }
        if (selectedItem && selectedItem !== item && selectedItem.el) {
            selectedItem.el.classList.remove('is-selected');
        }
        selectedItem = item;
        if (item.el) {
            item.el.classList.add('is-selected');
        }
        const bar = ensureItemActionBar();
        if (bar) {
            bar.classList.add('visible');
        }
        const toast = document.getElementById('house-drag-toast');
        if (toast && toast.classList.contains('visible')) {
            toast.classList.add('above-bar');
        }
    }

    function clearSelectedItem() {
        if (selectedItem && selectedItem.el) {
            selectedItem.el.classList.remove('is-selected');
        }
        selectedItem = null;
        const bar = document.getElementById('house-item-action-bar');
        if (bar) {
            bar.classList.remove('visible');
        }
        const toast = document.getElementById('house-drag-toast');
        if (toast) {
            toast.classList.remove('above-bar');
        }
    }

    let consoleActionChain = Promise.resolve();

    function enqueueConsoleAction(fn) {
        consoleActionChain = consoleActionChain.then(fn, fn);
        return consoleActionChain;
    }

    function getActiveHouseCmdRef() {
        if (activeHouseRecord) {
            return String(activeHouseRecord.name || activeHouseRecord.number || activeHouseRecord.id || '').trim() || '1';
        }
        const cfg = activeEffectiveCfg || window.HOUSE_CONFIG || {};
        return String(cfg.homeId || '1');
    }

    async function runHouseConsoleCommand(baseCmd, middleSteps, finalPayload, room) {
        if (typeof window.processCommand !== 'function') {
            showHouseDragToast('❌ Модуль консоли не загружен');
            return { style: 'output-error', response: 'Модуль консоли не загружен' };
        }
        const stepsSnapshot = [baseCmd, ...(Array.isArray(middleSteps) ? middleSteps : [])];
        const combinedCommand = stepsSnapshot.length === 1
            ? `${baseCmd} ${finalPayload}`
            : `${baseCmd}: ${stepsSnapshot.slice(1).join(' ➔ ')} ➔ ${finalPayload}`;

        return await window.processCommand(combinedCommand, {
            fromTwoStepBar: true,
            fromHouseUI: true,
            pendingSteps: stepsSnapshot,
            stepPayload: finalPayload,
            houseRuntime: {
                user: activeHouseUser,
                house: activeHouseRecord || { id: (activeEffectiveCfg && activeEffectiveCfg.homeId) || 'house1', name: getActiveHouseCmdRef(), builtin: true, things: [] },
                room: room || roomsState[0] || null
            }
        });
    }

    function findRotationSpot(room, item, newW, newH) {
        if (window.HouseLayoutEngine && typeof window.HouseLayoutEngine.findRotationSpot === 'function') {
            return window.HouseLayoutEngine.findRotationSpot(room, item, newW, newH);
        }
        return { col: item.col, row: item.row };
    }

    function rotateSelectedItem(deltaDeg) {
        const item = selectedItem;
        if (!item || !item.room || item.hidden) return Promise.resolve(false);
        const deltaStr = Number(deltaDeg) > 0 ? '+90' : '-90';
        const houseRef = getActiveHouseCmdRef();

        return enqueueConsoleAction(async () => {
            const res = await runHouseConsoleCommand('rotate thing', [item.id, deltaStr, 'of house'], houseRef, item.room);
            applyItemGeometry(item);
            if (!res || res.style === 'output-error') {
                showHouseDragToast((res && res.response) || '⚠️ Нет свободного места для поворота на 90°');
                return false;
            }
            showHouseDragToast(`↻ «${getItemDisplayName(item)}»: поворот ${deltaStr}° (${item.rot}°)`);
            return true;
        });
    }

    function unhideRoomItem(item) {
        if (!item || !item.room) return Promise.resolve(false);
        const houseRef = getActiveHouseCmdRef();

        return enqueueConsoleAction(async () => {
            const res = await runHouseConsoleCommand('unhide thing', [item.id, 'of house'], houseRef, item.room);
            applyItemGeometry(item);
            if (!res || res.style === 'output-error') {
                showHouseDragToast((res && res.response) || '❌ Не удалось вернуть предмет');
                return false;
            }
            selectRoomItem(item);
            showHouseDragToast(`👁️ «${getItemDisplayName(item)}» возвращён`);
            return true;
        });
    }

    function hideSelectedItem() {
        const item = selectedItem;
        if (!item || !item.room) return Promise.resolve(false);
        const itemName = getItemDisplayName(item);
        const houseRef = getActiveHouseCmdRef();

        return enqueueConsoleAction(async () => {
            const res = await runHouseConsoleCommand('hide thing', [item.id, 'of house'], houseRef, item.room);
            if (!res || res.style === 'output-error') {
                applyItemGeometry(item);
                showHouseDragToast((res && res.response) || '❌ Не удалось скрыть предмет');
                return false;
            }
            clearSelectedItem();
            applyItemGeometry(item);
            showHouseDragToast(`🙈 «${itemName}» скрыт`, () => unhideRoomItem(item));
            return true;
        });
    }

    function restoreHiddenItems() {
        const houseRef = getActiveHouseCmdRef();
        return enqueueConsoleAction(async () => {
            let restored = 0;
            for (const room of roomsState) {
                const res = await runHouseConsoleCommand('unhide thing', ['all', 'of house'], houseRef, room);
                room.items.forEach(item => applyItemGeometry(item));
                if (res && res.houseMutation && Number(res.houseMutation.restoredCount) > 0) {
                    restored += Number(res.houseMutation.restoredCount);
                }
            }
            return restored;
        });
    }

    function moveRoomItemViaConsole(item, targetCol, targetRow) {
        if (!item || !item.room) return Promise.resolve(false);
        const houseRef = getActiveHouseCmdRef();
        return enqueueConsoleAction(async () => {
            const res = await runHouseConsoleCommand('move thing', [item.id, `${targetCol},${targetRow}`, 'of house'], houseRef, item.room);
            applyItemGeometry(item);
            if (!res || res.style === 'output-error') {
                showHouseDragToast((res && res.response) || '❌ Не удалось переместить предмет');
                return false;
            }
            return true;
        });
    }

    function updateDragVisuals(clientX, clientY) {
        const s = activeDragSession;
        if (!s) return;

        const room = s.room;
        const rect = s.boardRect || room.boardEl.getBoundingClientRect();
        const maxLeft = (room.gridW - s.item.w) * tilePx;
        const maxTop = (room.gridH - s.item.h) * tilePx;

        const rawLeft = Math.max(0, Math.min(maxLeft, (clientX - rect.left) - s.grabOffsetX));
        const rawTop = Math.max(0, Math.min(maxTop, (clientY - rect.top) - s.grabOffsetY));

        const dx = rawLeft - s.origLeft;
        const dy = rawTop - s.origTop;
        s.item.el.style.transform = `translate3d(${dx}px, ${dy}px, 0)`;

        s.targetCol = Math.max(0, Math.min(room.gridW - s.item.w, Math.round(rawLeft / tilePx)));
        s.targetRow = Math.max(0, Math.min(room.gridH - s.item.h, Math.round(rawTop / tilePx)));
        const moveCheck = canMoveItemTo(room, s.item, s.origCol, s.origRow, s.targetCol, s.targetRow);
        s.canDrop = moveCheck.ok;
        s.blockReason = moveCheck.reason || '';

        if (room.targetBox) {
            room.targetBox.style.transform = `translate3d(${s.targetCol * tilePx}px, ${s.targetRow * tilePx}px, 0)`;
            if (!s.targetBoxSized) {
                room.targetBox.style.width = (s.item.w * tilePx) + 'px';
                room.targetBox.style.height = (s.item.h * tilePx) + 'px';
                s.targetBoxSized = true;
            }
            room.targetBox.classList.add('visible');
            room.targetBox.classList.toggle('blocked', !s.canDrop);
        }
        s.item.el.classList.toggle('is-blocked', !s.canDrop);
    }

    function enterDragMode(clientX, clientY) {
        if (!activeDragSession || activeDragSession.isDragging) return;
        activeDragSession.isDragging = true;
        activeDragSession.holdUnlocked = true;
        activeDragSession.boardRect = activeDragSession.room.boardEl.getBoundingClientRect();
        activeDragSession.item.el.classList.remove('is-holding');
        activeDragSession.item.el.classList.add('is-dragging');
        selectRoomItem(activeDragSession.item);

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
        clearTimeout(s.holdVisualTimer);
        s.item.el.classList.remove('is-holding', 'is-dragging', 'is-blocked');

        if (s.isDragging) {
            const viewport = document.getElementById('house-viewport');
            if (viewport) viewport.classList.remove('is-dragging-item');
            if (s.room.gridOverlay) s.room.gridOverlay.classList.remove('visible');
            if (s.room.targetBox) s.room.targetBox.classList.remove('visible', 'blocked');

            justDraggedUntil = Date.now() + 450;
            if (commit && s.canDrop && (s.item.col !== s.targetCol || s.item.row !== s.targetRow)) {
                const dx = (s.targetCol - s.origCol) * tilePx;
                const dy = (s.targetRow - s.origRow) * tilePx;
                s.item.el.style.transform = `translate3d(${dx}px, ${dy}px, 0)`;
                moveRoomItemViaConsole(s.item, s.targetCol, s.targetRow);
            } else {
                if (commit && !s.canDrop && s.blockReason === 'door_size') {
                    showHouseDragToast(`🚪 Объект ${s.item.w}×${s.item.h} не проходит в двери (${DOOR_WIDTH_TILES} пл.): ширина или высота должна быть ≤ ${DOOR_WIDTH_TILES}`);
                }
                applyItemGeometry(s.item);
            }
            if (!s.item.hidden) {
                selectRoomItem(s.item);
            }
        } else {
            if (allowTouchTap && s.mode === 'touch' && !s.movedPastTap) {
                triggerLinkTap(s.item);
            } else if (!s.movedPastTap && selectedItem && selectedItem !== s.item) {
                clearSelectedItem();
            }
        }
    }

    function startItemSession(mode, item, clientX, clientY, pointerOrTouchId) {
        if (activeDragSession) finishDragSession(false, false);

        const room = item.room;
        const rect = room.boardEl.getBoundingClientRect();
        const origLeft = item.col * tilePx;
        const origTop = item.row * tilePx;
        const grabOffsetX = clientX - (rect.left + origLeft);
        const grabOffsetY = clientY - (rect.top + origTop);

        const session = {
            mode,
            item,
            room,
            boardRect: rect,
            touchId: mode === 'touch' ? pointerOrTouchId : null,
            pointerId: mode === 'pointer' ? pointerOrTouchId : null,
            startX: clientX,
            startY: clientY,
            lastX: clientX,
            lastY: clientY,
            origLeft,
            origTop,
            grabOffsetX,
            grabOffsetY,
            origCol: item.col,
            origRow: item.row,
            targetCol: item.col,
            targetRow: item.row,
            targetBoxSized: false,
            canDrop: true,
            holdUnlocked: false,
            isDragging: false,
            movedPastTap: false,
            holdVisualTimer: null,
            holdTimer: null
        };

        session.holdVisualTimer = setTimeout(() => {
            if (activeDragSession === session && !session.movedPastTap && !session.isDragging) {
                session.item.el.classList.add('is-holding');
            }
        }, HOLD_VISUAL_DELAY_MS);

        session.holdTimer = setTimeout(() => {
            if (activeDragSession === session && activeDragSession.mode === mode && !activeDragSession.movedPastTap) {
                enterDragMode(activeDragSession.lastX, activeDragSession.lastY);
            }
        }, HOLD_TO_DRAG_MS);

        activeDragSession = session;
    }

    function initInteractions() {
        if (interactionsBound) return;
        interactionsBound = true;
        const viewport = document.getElementById('house-viewport');
        ensureItemActionBar();

        document.addEventListener('keydown', (e) => {
            if (e.key === 'Escape' && selectedItem) {
                clearSelectedItem();
            }
        });

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

        document.addEventListener('touchstart', (e) => {
            if (!e.touches || e.touches.length !== 1) return;
            const target = e.target;
            if (!target || !target.closest) return;
            if (target.closest('.house-item-action-bar') || target.closest('.house-drag-toast') || target.closest('.top-nav')) {
                return;
            }
            const itemEl = target.closest('.room-item');
            if (itemEl && target.closest('.appliance-object') && itemEl._houseRoomItem) {
                touchEmptySession = null;
                const t = e.touches[0];
                startItemSession('touch', itemEl._houseRoomItem, t.clientX, t.clientY, t.identifier);
                return;
            }

            if (selectedItem && target.closest('.house-viewport')) {
                const t = e.touches[0];
                touchEmptySession = {
                    touchId: t.identifier,
                    startX: t.clientX,
                    startY: t.clientY,
                    moved: false
                };
            }
        }, { capture: true, passive: true });

        document.addEventListener('touchmove', (e) => {
            if (touchEmptySession) {
                const t = findTrackedTouch(e.touches, touchEmptySession.touchId) ||
                          findTrackedTouch(e.changedTouches, touchEmptySession.touchId);
                if (t && Math.hypot(t.clientX - touchEmptySession.startX, t.clientY - touchEmptySession.startY) >= MOVE_CANCEL_THRESHOLD_PX) {
                    touchEmptySession.moved = true;
                }
            }
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
            if (touchEmptySession) {
                const te = findTrackedTouch(e.changedTouches, touchEmptySession.touchId);
                if (te) {
                    if (!touchEmptySession.moved && selectedItem) {
                        clearSelectedItem();
                    }
                    touchEmptySession = null;
                }
            }
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
            if (touchEmptySession) {
                const te = findTrackedTouch(e.changedTouches, touchEmptySession.touchId);
                if (te) touchEmptySession = null;
            }
            if (!activeDragSession || activeDragSession.mode !== 'touch') return;
            const t = findTrackedTouch(e.changedTouches, activeDragSession.touchId);
            if (!t) return;
            finishDragSession(Boolean(activeDragSession.isDragging && activeDragSession.canDrop), false);
        }, { capture: true });

        document.addEventListener('pointerdown', (e) => {
            if (e.pointerType === 'touch') return;
            if (e.button !== undefined && e.button !== 0) return;

            const target = e.target;
            if (target && target.closest && (target.closest('.house-item-action-bar') || target.closest('.house-drag-toast'))) {
                return;
            }
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
                    moved: false,
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
                        moved: true,
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
                if (Math.hypot(e.clientX - panSession.startX, e.clientY - panSession.startY) >= MOVE_CANCEL_THRESHOLD_PX) {
                    panSession.moved = true;
                }
                viewport.scrollLeft = panSession.startScrollLeft - (e.clientX - panSession.startX);
                viewport.scrollTop = panSession.startScrollTop - (e.clientY - panSession.startY);
            }
        });

        function endPointerOrPan(e, isCancel) {
            if (activeDragSession && activeDragSession.mode === 'pointer' && e.pointerId === activeDragSession.pointerId) {
                finishDragSession(isCancel ? Boolean(activeDragSession.isDragging && activeDragSession.canDrop) : true, false);
            }
            if (panSession && e.pointerId === panSession.pointerId) {
                const shouldDeselect = !isCancel && !panSession.moved && selectedItem;
                panSession = null;
                if (viewport) viewport.classList.remove('is-panning');
                if (shouldDeselect) clearSelectedItem();
            }
        }

        window.addEventListener('pointerup', (e) => endPointerOrPan(e, false));
        window.addEventListener('pointercancel', (e) => endPointerOrPan(e, true));
    }

    function getOrCreateAuthGate() {
        let gate = document.getElementById('house-auth-gate');
        if (!gate && document.body) {
            gate = document.createElement('div');
            gate.id = 'house-auth-gate';
            gate.className = 'house-auth-gate';
            document.body.appendChild(gate);
        }
        return gate;
    }

    function removeAuthGate() {
        const gate = document.getElementById('house-auth-gate');
        if (gate && gate.parentNode) {
            gate.parentNode.removeChild(gate);
        }
    }

    async function startHouseGoogleAuth(switchExisting = false) {
        const statusEl = document.getElementById('house-auth-status');
        try {
            if (!window.supabaseClient || !window.supabaseClient.auth) {
                if (statusEl) statusEl.textContent = '❌ Модуль авторизации недоступен. Перейдите в консоль для входа.';
                return;
            }
            if (switchExisting && typeof window.performLogout === 'function') {
                await window.performLogout();
            }
            const inIframe = window.self !== window.top;
            let redirectTarget = window.location.href.split('#')[0];
            if (window.location.hostname.includes('google.com')) {
                redirectTarget = 'https://ais-pre-chnak55kwbkbbooyikw4mw-618166997611.europe-west3.run.app/terminal.html';
            }
            const oauthOptions = {
                redirectTo: redirectTarget,
                queryParams: { prompt: 'select_account', access_type: 'offline' }
            };
            if (inIframe) {
                oauthOptions.skipBrowserRedirect = true;
                const { data, error } = await window.supabaseClient.auth.signInWithOAuth({
                    provider: 'google',
                    options: oauthOptions
                });
                if (error) throw error;
                if (data && data.url) {
                    const authWin = window.open(data.url, '_blank');
                    if (statusEl) {
                        statusEl.innerHTML = authWin
                            ? '🔗 Окно выбора аккаунта Google открыто в новой вкладке. После входа страница разблокируется автоматически.'
                            : `⚠️ Всплывающее окно заблокировано. <a href="${data.url}" target="_blank" style="color:#38bdf8;text-decoration:underline;font-weight:bold;">Открыть вход через Google</a>`;
                    }
                }
            } else {
                const { error } = await window.supabaseClient.auth.signInWithOAuth({
                    provider: 'google',
                    options: oauthOptions
                });
                if (error) throw error;
            }
        } catch (err) {
            if (statusEl) statusEl.textContent = '❌ Ошибка входа: ' + (err && err.message ? err.message : String(err));
        }
    }

    function renderAuthGateLoading() {
        if (document.body) document.body.classList.remove('house-access-granted');
        const gate = getOrCreateAuthGate();
        if (!gate) return;
        gate.innerHTML = `
            <div class="house-auth-card">
                <div class="house-auth-profile-row"><span class="auth-profile-badge" data-global-auth-profile></span></div>
                <div class="house-auth-icon">🔐</div>
                <div class="house-auth-title">Проверка доступа к Дому</div>
                <div class="house-auth-text">Загружаем ваши дома и сохранённую расстановку...</div>
            </div>
        `;
        if (typeof window.updateGlobalAuthBadge === 'function') {
            window.updateGlobalAuthBadge(activeHouseUser || null);
        }
    }

    function renderAuthGateDenied(access) {
        if (document.body) document.body.classList.remove('house-access-granted');
        const gate = getOrCreateAuthGate();
        if (!gate) return;

        const isUnauthed = !access || access.reason === 'unauthenticated';
        const houseTitle = escapeHtml((access && access.house && access.house.name) ? access.house.name : 'Дом');
        const title = isUnauthed
            ? `🔒 ${houseTitle}: требуется авторизация`
            : `🔒 ${houseTitle}: не создан в вашем аккаунте`;

        const userEmail = escapeHtml((activeHouseUser && activeHouseUser.email) ? activeHouseUser.email : '');
        const text = isUnauthed
            ? 'Дома доступны только авторизованным пользователям.\nВойдите в свой аккаунт Google, чтобы открыть свои дома и расстановку.'
            : `Вы вошли как ${userEmail || 'пользователь'}, но "${houseTitle}" ещё не создан в этом аккаунте.\nСоздайте его в консоли пошагово: Add house ➔ ${houseTitle}`;

        const primaryLabel = isUnauthed ? '🔑 Войти через Google' : '🔄 Сменить аккаунт';

        gate.innerHTML = `
            <div class="house-auth-card">
                <div class="house-auth-profile-row"><span class="auth-profile-badge" data-global-auth-profile></span></div>
                <div class="house-auth-icon">${isUnauthed ? '🔐' : '🏘️'}</div>
                <div class="house-auth-title">${title}</div>
                <div class="house-auth-text">${text}</div>
                <div class="house-auth-actions">
                    <button type="button" id="house-auth-primary-btn" class="house-auth-btn house-auth-btn-primary">${primaryLabel}</button>
                    <a href="/terminal.html" class="house-auth-btn">💻 Перейти в консоль</a>
                    ${!isUnauthed ? '<a href="/house/index.html" class="house-auth-btn">🏠 Открыть свой Дом 1</a>' : ''}
                </div>
                <div id="house-auth-status" class="house-auth-status"></div>
            </div>
        `;
        if (typeof window.updateGlobalAuthBadge === 'function') {
            window.updateGlobalAuthBadge(isUnauthed ? null : (activeHouseUser || null));
        }
        const primaryBtn = document.getElementById('house-auth-primary-btn');
        if (primaryBtn) {
            primaryBtn.addEventListener('click', () => startHouseGoogleAuth(!isUnauthed));
        }
    }

    async function verifyHouseAccess(houseId) {
        let user = null;
        if (typeof window.fetchCurrentUser === 'function') {
            try {
                user = await window.fetchCurrentUser(true);
            } catch (e) {
                user = null;
            }
        }
        if (user && !user.isGuest && window.UserHousesSync && typeof window.UserHousesSync.syncFromDb === 'function') {
            try {
                await Promise.race([
                    window.UserHousesSync.syncFromDb(user),
                    new Promise(resolve => setTimeout(resolve, 450))
                ]);
            } catch (e) {}
        }
        if (typeof window.canAccessHouse === 'function') {
            return { user, access: window.canAccessHouse(user, houseId) };
        }
        const ok = Boolean(user && !user.isGuest && user.id && user.id !== 'guest');
        return {
            user,
            access: ok
                ? { allowed: true, reason: 'ok', user }
                : { allowed: false, reason: 'unauthenticated', message: '🔒 Требуется авторизация.' }
        };
    }

    function attachAuthWatcher() {
        if (authListenerAttached) return;
        authListenerAttached = true;
        if (window.supabaseClient && window.supabaseClient.auth && typeof window.supabaseClient.auth.onAuthStateChange === 'function') {
            window.supabaseClient.auth.onAuthStateChange(async (event, session) => {
                if (event === 'SIGNED_OUT') {
                    if (typeof window.clearCurrentUserCache === 'function') window.clearCurrentUserCache();
                    activeHouseUser = null;
                    activeHouseRecord = null;
                    initialized = false;
                    roomsState = [];
                    renderAuthGateDenied({ reason: 'unauthenticated', house: (window.getHouseDefinition ? window.getHouseDefinition((activeEffectiveCfg || window.HOUSE_CONFIG || {}).homeId) : null) });
                    return;
                }
                if (event === 'INITIAL_SESSION' || event === 'SIGNED_IN' || event === 'TOKEN_REFRESHED') {
                    const sessionUid = session && session.user ? session.user.id : null;
                    if (!sessionUid || (activeHouseUser && activeHouseUser.id !== sessionUid)) {
                        if (typeof window.clearCurrentUserCache === 'function') window.clearCurrentUserCache();
                    }
                    const cfg = activeEffectiveCfg || resolveEffectiveHouseConfig();
                    const { user, access } = await verifyHouseAccess(cfg.homeId);
                    if (!access.allowed) {
                        activeHouseUser = user;
                        activeHouseRecord = null;
                        initialized = false;
                        roomsState = [];
                        renderAuthGateDenied(access);
                    } else if (!initialized || !activeHouseUser || activeHouseUser.id !== user.id) {
                        initialized = false;
                        await initHousePage();
                    } else {
                        syncAllRoomsWithDatabase();
                    }
                }
            });
        }
    }

    async function initHousePage() {
        if (initialized) return;

        const cfg = resolveEffectiveHouseConfig();
        activeEffectiveCfg = cfg;
        renderAuthGateLoading();
        attachAuthWatcher();

        const { user, access } = await verifyHouseAccess(cfg.homeId);
        activeHouseUser = user;

        if (!access || !access.allowed) {
            renderAuthGateDenied(access);
            return;
        }

        if (initialized) return;
        initialized = true;

        activeHouseRecord = access.house || (window.UserHousesSync ? window.UserHousesSync.findHouse(user, cfg.homeId) : null);

        if (window.HouseLayoutSync && typeof window.HouseLayoutSync.syncUserHouseRegistryLocal === 'function') {
            window.HouseLayoutSync.syncUserHouseRegistryLocal(user);
        }
        if (window.HouseLayoutSync && typeof window.HouseLayoutSync.migrateLegacyPendingHouseLayoutsForRoot === 'function') {
            window.HouseLayoutSync.migrateLegacyPendingHouseLayoutsForRoot(user);
        }

        const preparedRoomsCfg = (cfg.rooms || []).map(rc => prepareBoardForAccount(rc, activeHouseRecord, user));
        roomsState = preparedRoomsCfg.map(rc => loadRoomLayoutState(rc, user));
        updateHouseTopNav(user, cfg, activeHouseRecord, roomsState[0]);

        // Сначала дожидаемся быстрой синхронизации расстановки с БД, вычисляем размеры и рисуем пол ДО показа экрана (убирает мерцание при входе!)
        await Promise.race([
            syncAllRoomsWithDatabase(),
            new Promise(resolve => setTimeout(resolve, 480))
        ]);

        layoutAllBoards(true);
        initInteractions();

        const hash = String(window.location.hash || '').replace(/^#/, '').toLowerCase();
        if (hash === 'hall' || hash === 'kitchen' || hash === 'room' || hash === 'corridor') {
            jumpToQuadrant(hash, false);
        }

        removeAuthGate();
        if (document.body) {
            document.body.classList.add('house-access-granted');
            document.body.dataset.houseOwner = user.email || user.id || '';
        }

        if (window.LastPageSync && typeof window.LastPageSync.trackCurrentPage === 'function') {
            window.LastPageSync.trackCurrentPage();
        }
        if (cfg.navCmd) {
            logActionDirect(cfg.navCmd, cfg.navDesc || 'Переход в Дом');
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
            navigator.serviceWorker.register('/service-worker.js?v=20261127_1', { updateViaCache: 'none' })
                .then((reg) => {
                    if (reg && typeof reg.update === 'function') reg.update().catch(() => {});
                })
                .catch(() => {});
        });
    }

    function flushHouseChangesWithKeepalive() {
        if (!activeHouseUser || !window.HouseLayoutSync) return;
        if (typeof window.HouseLayoutSync.flushPendingHouseLayoutsKeepalive === 'function') {
            window.HouseLayoutSync.flushPendingHouseLayoutsKeepalive(activeHouseUser);
        }
        if (typeof window.HouseLayoutSync.flushPendingHouseLayouts === 'function') {
            window.HouseLayoutSync.flushPendingHouseLayouts();
        }
    }

    async function refreshAfterExternalChange() {
        if (!activeHouseUser || activeHouseUser.isGuest || !initialized) return;
        const cfg = activeEffectiveCfg || resolveEffectiveHouseConfig();
        activeHouseRecord = window.UserHousesSync ? window.UserHousesSync.findHouse(activeHouseUser, cfg.homeId) : activeHouseRecord;
        const preparedRoomsCfg = (cfg.rooms || []).map(rc => prepareBoardForAccount(rc, activeHouseRecord, activeHouseUser));
        roomsState = preparedRoomsCfg.map(rc => loadRoomLayoutState(rc, activeHouseUser));
        updateHouseTopNav(activeHouseUser, cfg, activeHouseRecord, roomsState[0]);
        layoutAllBoards(true);
        initInteractions();
    }

    window.addEventListener('storage', (event) => {
        if (!event || !event.key) return;
        if (
            event.key.startsWith('terminal_user_houses_v2::') ||
            (event.key.startsWith('room_layout_') && !event.key.endsWith('_ts'))
        ) {
            refreshAfterExternalChange().catch(() => {});
        }
    });

    window.addEventListener('online', syncAllRoomsWithDatabase);
    window.addEventListener('focus', () => {
        if (navigator.onLine !== false) syncAllRoomsWithDatabase();
    });
    document.addEventListener('visibilitychange', () => {
        if (document.visibilityState === 'hidden') {
            flushHouseChangesWithKeepalive();
        } else if (document.visibilityState === 'visible' && navigator.onLine !== false) {
            syncAllRoomsWithDatabase();
        }
    });
    window.addEventListener('pagehide', flushHouseChangesWithKeepalive);
    window.addEventListener('resize', () => layoutAllBoards(false));
    if (window.visualViewport) {
        window.visualViewport.addEventListener('resize', () => layoutAllBoards(false));
    }

    window.HouseEngine = {
        HOLD_TO_DRAG_MS,
        MOVE_CANCEL_THRESHOLD_PX,
        DOOR_WIDTH_TILES,
        getRoomsState: () => roomsState,
        getActiveUser: () => activeHouseUser,
        getActiveHouseRecord: () => activeHouseRecord,
        getSelectedItem: () => selectedItem,
        selectRoomItem,
        clearSelectedItem,
        rotateSelectedItem,
        hideSelectedItem,
        unhideRoomItem,
        restoreHiddenItems,
        runHouseConsoleCommand,
        canPlaceItem,
        canItemPassThroughDoor,
        getItemQuadrant,
        canMoveItemTo,
        applyLayoutMap,
        drawStaticFloorCanvas,
        layoutAllBoards,
        jumpToQuadrant,
        syncAllRoomsWithDatabase,
        refreshAfterExternalChange
    };
})();
