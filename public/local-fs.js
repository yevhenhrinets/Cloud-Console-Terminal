// local-fs.js — Локальная файловая система (OPFS + File System Access API + ZIP-экспорт)
// 100% бесплатно, работает на Android, сохраняется локально на устройстве

let rootHandle = null;
let currentHandle = null;
let currentPath = '/';
let pathStack = []; // Стек { name, handle, path }
let isPickedDirectory = false;
let pickedDirectoryName = 'Локальное хранилище устройства';

// Инициализация файловой системы (по умолчанию OPFS — Origin Private File System)
async function initLocalFS() {
    if (!rootHandle) {
        if (navigator.storage && navigator.storage.getDirectory) {
            rootHandle = await navigator.storage.getDirectory();
            currentHandle = rootHandle;
            currentPath = '/';
            pathStack = [];
        } else {
            throw new Error('Файловая система не поддерживается вашим браузером.');
        }
    }
    return currentHandle;
}

// Выбор реальной папки на устройстве Android / ПК через File System Access API
async function pickLocalDirectory() {
    if (typeof window.showDirectoryPicker !== 'function') {
        throw new Error('Прямой выбор папок (showDirectoryPicker) не поддерживается этим браузером на Android. Терминал автоматически использует постоянное хранилище устройства (OPFS).');
    }

    try {
        const handle = await window.showDirectoryPicker({
            mode: 'readwrite'
        });
        rootHandle = handle;
        currentHandle = handle;
        currentPath = `/${handle.name}`;
        pathStack = [];
        isPickedDirectory = true;
        pickedDirectoryName = handle.name;

        return {
            name: handle.name,
            path: currentPath
        };
    } catch (e) {
        if (e.name === 'AbortError') {
            return { cancelled: true };
        }
        throw e;
    }
}

// 1. Список элементов в текущей директории
async function fsListDirectory() {
    await initLocalFS();
    const folders = [];
    const files = [];

    // Чтение через асинхронный итератор FileSystemDirectoryHandle
    for await (const [name, handle] of currentHandle.entries()) {
        if (name === '.trash') continue; // скрываем корзину из обычного вывода

        if (handle.kind === 'directory') {
            folders.push({
                name: name,
                kind: 'directory',
                path: `${currentPath === '/' ? '' : currentPath}/${name}`
            });
        } else {
            let size = 0;
            let lastModified = null;
            try {
                const file = await handle.getFile();
                size = file.size;
                lastModified = file.lastModified;
            } catch (e) {}

            files.push({
                name: name,
                kind: 'file',
                size: size,
                modifiedTime: lastModified
            });
        }
    }

    // Сортировка по алфавиту
    folders.sort((a, b) => a.name.localeCompare(b.name));
    files.sort((a, b) => a.name.localeCompare(b.name));

    return {
        path: currentPath,
        folders: folders,
        files: files
    };
}

// 2. Создание папки
async function fsCreateDirectory(folderName) {
    await initLocalFS();
    const clean = folderName.trim().replace(/^["']|["']$/g, '');
    if (!clean) throw new Error('Укажите название папки.');

    // Поддержка пути с подпапками: a/b/c
    const segments = clean.split('/').filter(Boolean);
    let target = currentHandle;

    for (const seg of segments) {
        target = await target.getDirectoryHandle(seg, { create: true });
    }

    return {
        name: segments[segments.length - 1],
        path: `${currentPath === '/' ? '' : currentPath}/${clean}`
    };
}

// 3. Навигация (cd, cd .., cd /path)
async function fsChangeDirectory(targetPath, createMissing = false) {
    await initLocalFS();
    const clean = (targetPath || '').trim().replace(/^["']|["']$/g, '');

    // Возврат в корень: cd / или cd ~ или cd
    if (!clean || clean === '/' || clean === '~') {
        currentHandle = rootHandle;
        currentPath = isPickedDirectory ? `/${pickedDirectoryName}` : '/';
        pathStack = [];
        return { path: currentPath };
    }

    // На уровень выше: cd ..
    if (clean === '..') {
        if (pathStack.length > 0) {
            const prev = pathStack.pop();
            currentHandle = prev.handle;
            currentPath = prev.path;
        } else {
            currentHandle = rootHandle;
            currentPath = isPickedDirectory ? `/${pickedDirectoryName}` : '/';
        }
        return { path: currentPath };
    }

    // Разбор составного пути (например: /terminal/organization/project_name/Test1)
    const isAbsolute = clean.startsWith('/');
    const segments = clean.split('/').filter(Boolean);

    let startHandle = isAbsolute ? rootHandle : currentHandle;
    let startPath = isAbsolute ? (isPickedDirectory ? `/${pickedDirectoryName}` : '/') : currentPath;
    let tempStack = isAbsolute ? [] : [...pathStack];

    for (const seg of segments) {
        if (seg === '.') continue;
        if (seg === '..') {
            if (tempStack.length > 0) {
                const prev = tempStack.pop();
                startHandle = prev.handle;
                startPath = prev.path;
            } else {
                startHandle = rootHandle;
                startPath = isPickedDirectory ? `/${pickedDirectoryName}` : '/';
            }
            continue;
        }

        try {
            const nextHandle = await startHandle.getDirectoryHandle(seg, { create: createMissing });
            tempStack.push({ name: seg, handle: startHandle, path: startPath });
            startHandle = nextHandle;
            startPath = `${startPath === '/' ? '' : startPath}/${seg}`;
        } catch (e) {
            throw new Error(`Папка "${seg}" не найдена в пути "${startPath}".\n💡 Создайте её: mkdir ${seg}`);
        }
    }

    currentHandle = startHandle;
    currentPath = startPath;
    pathStack = tempStack;

    return { path: currentPath };
}

// 4. Поиск папок по префиксу или имени
async function fsSearchFolders(prefix) {
    await initLocalFS();
    const clean = prefix.trim().toLowerCase();
    const results = [];

    async function walk(handle, basePath) {
        for await (const [name, entry] of handle.entries()) {
            if (name === '.trash') continue;
            if (entry.kind === 'directory') {
                const fullPath = `${basePath === '/' ? '' : basePath}/${name}`;
                if (name.toLowerCase().startsWith(clean) || name.toLowerCase().includes(clean)) {
                    results.push({
                        name: name,
                        path: fullPath,
                        isPrefixMatch: name.toLowerCase().startsWith(clean)
                    });
                }
                // Рекурсивный обход подпапок
                await walk(entry, fullPath);
            }
        }
    }

    await walk(rootHandle, isPickedDirectory ? `/${pickedDirectoryName}` : '/');
    return results;
}

// 5. Переименование папки
async function fsRenameDirectory(oldName, newName) {
    await initLocalFS();
    const cleanOld = oldName.trim().replace(/^["']|["']$/g, '');
    const cleanNew = newName.trim().replace(/^["']|["']$/g, '');

    if (!cleanOld || !cleanNew) throw new Error('Укажите старое и новое название папки.');

    // Проверяем существование старой папки
    let oldHandle;
    try {
        oldHandle = await currentHandle.getDirectoryHandle(cleanOld);
    } catch (e) {
        throw new Error(`Папка "${cleanOld}" не найдена в текущей директории.`);
    }

    // Создаем новую папку и копируем содержимое
    const newHandle = await currentHandle.getDirectoryHandle(cleanNew, { create: true });
    await copyDirectoryRecursive(oldHandle, newHandle);

    // Удаляем старую
    await currentHandle.removeEntry(cleanOld, { recursive: true });

    return { oldName: cleanOld, newName: cleanNew };
}

// Вспомогательная функция рекурсивного копирования
async function copyDirectoryRecursive(srcHandle, destHandle) {
    for await (const [name, entry] of srcHandle.entries()) {
        if (entry.kind === 'directory') {
            const newSubDir = await destHandle.getDirectoryHandle(name, { create: true });
            await copyDirectoryRecursive(entry, newSubDir);
        } else {
            const file = await entry.getFile();
            const newFileHandle = await destHandle.getFileHandle(name, { create: true });
            const writable = await newFileHandle.createWritable();
            await writable.write(await file.arrayBuffer());
            await writable.close();
        }
    }
}

// 6. Удаление папки (с перемещением в .trash для возможности восстановления)
async function fsTrashDirectory(folderName, confirmed = false) {
    await initLocalFS();
    const clean = folderName.trim().replace(/^["']|["']$/g, '');

    let targetHandle;
    try {
        targetHandle = await currentHandle.getDirectoryHandle(clean);
    } catch (e) {
        throw new Error(`Папка "${clean}" не найдена.`);
    }

    if (!confirmed) {
        const ok = window.confirm(`⚠️ Вы уверены, что хотите удалить локальную папку "${clean}"?`);
        if (!ok) return { cancelled: true, name: clean };
    }

    // Перемещаем в .trash в корневом каталоге
    const trashHandle = await rootHandle.getDirectoryHandle('.trash', { create: true });
    const trashTarget = await trashHandle.getDirectoryHandle(`${Date.now()}_${clean}`, { create: true });
    await copyDirectoryRecursive(targetHandle, trashTarget);

    // Удаляем из текущей папки
    await currentHandle.removeEntry(clean, { recursive: true });

    return { success: true, name: clean };
}

// 7. Восстановление папки из .trash (undel)
async function fsRestoreDirectory(folderName) {
    await initLocalFS();
    const clean = folderName.trim().toLowerCase();

    let trashHandle;
    try {
        trashHandle = await rootHandle.getDirectoryHandle('.trash');
    } catch (e) {
        throw new Error('Корзина пуста.');
    }

    let foundTrashName = null;
    let foundOriginalName = null;
    let foundHandle = null;

    for await (const [name, handle] of trashHandle.entries()) {
        const originalName = name.replace(/^\d+_/, '');
        if (originalName.toLowerCase() === clean) {
            foundTrashName = name;
            foundOriginalName = originalName;
            foundHandle = handle;
            break;
        }
    }

    if (!foundHandle) {
        throw new Error(`В корзине не найдена папка "${folderName}".`);
    }

    // Восстанавливаем в текущую директорию
    const restoredHandle = await currentHandle.getDirectoryHandle(foundOriginalName, { create: true });
    await copyDirectoryRecursive(foundHandle, restoredHandle);

    // Удаляем из корзины
    await trashHandle.removeEntry(foundTrashName, { recursive: true });

    return { name: foundOriginalName };
}

// 8. Экспорт папки в .ZIP архив для удобной ручной отправки на Google Диск
async function fsExportZip() {
    await initLocalFS();

    if (typeof JSZip === 'undefined') {
        throw new Error('Библиотека JSZip не загружена. Проверьте интернет-соединение.');
    }

    const zip = new JSZip();

    async function addDirectoryToZip(dirHandle, zipFolder) {
        for await (const [name, entry] of dirHandle.entries()) {
            if (name === '.trash') continue;
            if (entry.kind === 'directory') {
                const subZip = zipFolder.folder(name);
                await addDirectoryToZip(entry, subZip);
            } else {
                const file = await entry.getFile();
                const arrayBuffer = await file.arrayBuffer();
                zipFolder.file(name, arrayBuffer);
            }
        }
    }

    await addDirectoryToZip(currentHandle, zip);

    const blob = await zip.generateAsync({ type: 'blob' });
    const dateStr = new Date().toISOString().slice(0, 10);
    const folderName = currentPath === '/' ? 'Terminal' : (currentPath.split('/').filter(Boolean).pop() || 'Terminal');
    const filename = `${folderName}_${dateStr}.zip`;

    const downloadUrl = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = downloadUrl;
    a.download = filename;
    a.style.display = 'none';
    a.rel = 'noopener';
    document.body.appendChild(a);
    a.click();
    setTimeout(() => {
        try { a.remove(); } catch (e) {}
        try { URL.revokeObjectURL(downloadUrl); } catch (e) {}
    }, 60000);

    return {
        filename: filename,
        downloadUrl: downloadUrl,
        size: (blob.size / 1024).toFixed(1) + ' KB'
    };
}

// 9. Скачать весь исходный код проекта (ZIP-архив для Cloudflare Pages)
async function downloadCloudflareProjectZip() {
    if (typeof JSZip === 'undefined') {
        throw new Error('Библиотека JSZip не загружена. Проверьте интернет-соединение.');
    }

    const zip = new JSZip();

    const appFiles = [
        'index.html',
        'terminal.html',
        'dashboard.html',
        'dashboard.css',
        'dashboard-logic.js',
        'dashboard-ui.js',
        'missions.html',
        'missions-store.js',
        'style.css',
        'api.js',
        'helpers.js',
        'registry.js',
        'localization.js',
        'commands.js',
        'commands-actions.js',
        'local-fs.js',
        'manifest.json',
        '_headers',
        'service-worker.js',
        'kitchen.html',
        'hall.html',
        'house.css',
        'house-engine.js',
        'icon.svg',
        'icon-512.png',
        'badge.svg',
        'badge.png',
        'updates.txt',
        'armchair.svg', 'bed.svg', 'boiler.svg', 'closet.svg', 'conditioner.svg',
        'floor.svg', 'fridge.svg', 'multicooker.svg', 'radiator.svg', 'router.svg',
        'sofa.svg', 'stove.svg', 'table.svg', 'tv.svg', 'washing_machine.svg',
        'house/index.html', 'house/kitchen.html', 'house/hall.html',
        'house2/index.html', 'house2/kitchen.html', 'house2/hall.html',
        'house3/index.html',
        'house/armchair.svg', 'house/bed.svg', 'house/boiler.svg', 'house/closet.svg',
        'house/conditioner.svg', 'house/floor.svg', 'house/fridge.svg', 'house/multicooker.svg',
        'house/radiator.svg', 'house/router.svg', 'house/sofa.svg', 'house/stove.svg',
        'house/table.svg', 'house/tv.svg', 'house/washing_machine.svg', 'house/window.svg',
        'commands/fs.js', 'commands/add.js', 'commands/aliases.js', 'commands/auth.js', 'commands/building.js',
        'commands/del.js', 'commands/edit.js', 'commands/go_to.js',
        'commands/help.js', 'commands/history.js', 'commands/inventory.js',
        'commands/lang.js', 'commands/missions.js',
        'commands/note_history.js', 'commands/pin.js', 'commands/read.js',
        'commands/restore.js', 'commands/show.js', 'commands/support.js', 'commands/system.js',
        'commands/task.js', 'commands/theme.js', 'commands/timers.js', 'commands/trash_history.js',
        'commands/trash_notes.js', 'commands/unpin.js'
    ];

    let loadedCount = 0;
    const batchSize = 16;
    for (let i = 0; i < appFiles.length; i += batchSize) {
        const chunk = appFiles.slice(i, i + batchSize);
        await Promise.all(chunk.map(async (relPath) => {
            try {
                const resp = await fetch('/' + relPath, { cache: 'no-cache' });
                if (resp.ok) {
                    const blob = await resp.blob();
                    zip.file(relPath, blob);
                    loadedCount++;
                }
            } catch (e) {
                console.warn('Не удалось загрузить файл в архив:', relPath, e);
            }
        }));
    }

    if (loadedCount === 0) {
        throw new Error('Не удалось получить ни одного файла проекта для архива.');
    }

    const zipBlob = await zip.generateAsync({ type: 'blob' });
    const filename = `Terminal_${new Date().toISOString().slice(0, 10)}.zip`;

    const downloadUrl = URL.createObjectURL(zipBlob);
    const a = document.createElement('a');
    a.href = downloadUrl;
    a.download = filename;
    a.style.display = 'none';
    a.rel = 'noopener';
    document.body.appendChild(a);
    a.click();
    setTimeout(() => {
        try { a.remove(); } catch (e) {}
        try { URL.revokeObjectURL(downloadUrl); } catch (e) {}
    }, 60000);

    return {
        filename: filename,
        downloadUrl: downloadUrl,
        fileCount: loadedCount,
        size: (zipBlob.size / 1024).toFixed(1) + ' KB'
    };
}

// Глобальный экспорт
window.LocalFS = {
    init: initLocalFS,
    pick: pickLocalDirectory,
    list: fsListDirectory,
    cd: fsChangeDirectory,
    mkdir: fsCreateDirectory,
    search: fsSearchFolders,
    rename: fsRenameDirectory,
    trash: fsTrashDirectory,
    restore: fsRestoreDirectory,
    exportZip: fsExportZip,
    downloadProjectZip: downloadCloudflareProjectZip,
    getCurrentPath: () => currentPath,
    getStatus: () => ({
        path: currentPath,
        isPicked: isPickedDirectory,
        storageType: isPickedDirectory ? `Выбранная папка (${pickedDirectoryName})` : 'Локальное хранилище Android / Браузера (OPFS)'
    })
};
window.downloadCloudflareProjectZip = downloadCloudflareProjectZip;
