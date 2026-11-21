// commands/fs.js — команды локальной файловой системы Android / PWA (OPFS)
// 100% бесплатно, без биллинга, без Google Cloud, работает оффлайн

(function() {
    // Вспомогательная функция очистки аргументов (убирает 'to', 'в', лишние кавычки)
    function cleanArgString(str) {
        if (!str) return '';
        let s = String(str).trim();
        // убираем кавычки по краям
        s = s.replace(/^["']|["']$/g, '');
        return s;
    }

    // 1. Команда cd / change directory
    CommandRegistry.register({
        names: [
            'cd', 'chdir', 
            'change directory', 'change directory to',
            'перейти в папку', 'сменить директорию', 'перейти'
        ],
        description: 'Переход в директорию (cd .., cd ~, cd /путь, change directory to /path)',
        category: 'FileSystem',
        usage: 'cd <путь> | cd .. | cd ~ | change directory to /terminal/organization/project/Test1',

        handler: async (parameters) => {
            if (!window.LocalFS) {
                return { response: '❌ Файловая система LocalFS не инициализирована.', style: 'output-error' };
            }

            let raw = (parameters && parameters.raw_args ? String(parameters.raw_args) : '').trim();
            
            // Если команда была 'change directory' и аргументы начинаются с 'to' или 'в'
            if (raw.toLowerCase().startsWith('to ')) {
                raw = raw.slice(3).trim();
            } else if (raw.toLowerCase().startsWith('в ')) {
                raw = raw.slice(2).trim();
            }

            // Если параметров нет — перейти в корень (~)
            const targetPath = cleanArgString(raw) || '~';

            try {
                const res = await window.LocalFS.cd(targetPath);
                return {
                    response: `📁 Текущая директория: ${res.path}`,
                    style: 'output-success'
                };
            } catch (err) {
                return {
                    response: `❌ ${err.message}`,
                    style: 'output-error'
                };
            }
        }
    });

    // 2. Команда ls / list / directories / dir / vdir
    CommandRegistry.register({
        names: [
            'ls', 'list', 'directories', 'directories list', 'show directories', 'directories tree', 'dir', 'vdir',
            'list directory', 'list folder',
            'список файлов', 'папки', 'файлы', 'содержимое'
        ],
        description: 'Просмотр содержимого текущей директории',
        category: 'FileSystem',
        usage: 'ls | dir | list directory',

        handler: async () => {
            if (!window.LocalFS) {
                return { response: '❌ Файловая система LocalFS не инициализирована.', style: 'output-error' };
            }

            try {
                const data = await window.LocalFS.list();
                const pathStr = data.path || '/';
                const totalFolders = data.folders.length;
                const totalFiles = data.files.length;

                let lines = [`📂 Директория: ${pathStr}\n`];

                if (totalFolders === 0 && totalFiles === 0) {
                    lines.push('  (директория пуста)');
                } else {
                    if (totalFolders > 0) {
                        lines.push(`📁 Папки (${totalFolders}):`);
                        data.folders.forEach(f => {
                            lines.push(`  📁 ${f.name}/`);
                        });
                    }

                    if (totalFiles > 0) {
                        if (totalFolders > 0) lines.push('');
                        lines.push(`📄 Файлы (${totalFiles}):`);
                        data.files.forEach(f => {
                            const sizeKb = (f.size / 1024).toFixed(1);
                            lines.push(`  📄 ${f.name} (${sizeKb} KB)`);
                        });
                    }
                }

                lines.push(`\n📊 Всего: ${totalFolders} папок, ${totalFiles} файлов.`);
                lines.push(`💡 Подсказки:`);
                lines.push(`  • Создать папку: create directory (двухэтапная команда)`);
                lines.push(`  • Перейти: cd <имя> | cd ..`);
                lines.push(`  • Найти папку: find directory <начало имени>`);
                lines.push(`  • Скачать zip: fs export`);

                return {
                    response: lines.join('\n'),
                    style: 'output-info'
                };
            } catch (err) {
                return {
                    response: `❌ Ошибка чтения директории: ${err.message}`,
                    style: 'output-error'
                };
            }
        }
    });

    // 3. Команда pwd / cwd (текущий путь)
    CommandRegistry.register({
        names: ['pwd', 'cwd', 'путь'],
        description: 'Показать текущий рабочий путь в хранилище',
        category: 'FileSystem',
        usage: 'pwd',

        handler: async () => {
            if (!window.LocalFS) {
                return { response: '❌ Файловая система LocalFS не инициализирована.', style: 'output-error' };
            }

            const status = window.LocalFS.getStatus();
            return {
                response: `📍 Текущий путь: ${status.path}\n💾 Хранилище: ${status.storageType}`,
                style: 'output-info'
            };
        }
    });

    // 4. Команда create directory / mkdir / add directory / make directory (строго в 2 этапа)
    CommandRegistry.register({
        names: [
            'create directory', 'mkdir',
            'add directory', 'make directory',
            'add folder', 'create folder', 'make folder',
            'создать папку', 'добавить папку', 'новая папка'
        ],
        description: 'Создание новой папки (строго в 2 этапа, включая вложенные пути: a/b/c)',
        category: 'FileSystem',
        usage: 'create directory (затем ввести название в поле)',

        handler: async (parameters, options = {}) => {
            if (!window.LocalFS) {
                return { response: '❌ Файловая система LocalFS не инициализирована.', style: 'output-error' };
            }

            const raw = (parameters && parameters.raw_args ? String(parameters.raw_args) : '').trim();
            const folderName = cleanArgString(raw);
            const prefix = (parameters && parameters.matchedCmd) ? parameters.matchedCmd : 'create directory';

            if (folderName && !(options && options.fromTwoStepBar)) {
                return {
                    response: `⚠️ Команда \`${prefix}\` работает только в 2 этапа — нельзя указывать название папки сразу в команде!\n1) Введите \`${prefix}\` без названия\n2) После появления команды под строкой ввода напишите имя новой папки.`,
                    style: 'output-error'
                };
            }

            if (!folderName) {
                return {
                    response: '📁 Создание папки: введите название новой папки (или путь a/b/c) и нажмите Enter (или ✕ для отмены).',
                    style: 'output-info',
                    commandPrefix: prefix,
                    inputValue: '',
                    inputPlaceholder: 'Название новой папки (например: Test1 или org/proj)...'
                };
            }

            try {
                const res = await window.LocalFS.mkdir(folderName);
                return {
                    response: `🟢 Папка "${res.name}" успешно создана!\n📂 Путь: ${res.path}\n💡 Для перехода: cd ${res.name}`,
                    style: 'output-success'
                };
            } catch (err) {
                return {
                    response: `❌ Ошибка создания папки: ${err.message}`,
                    style: 'output-error'
                };
            }
        }
    });

    // 5. Команда del directory / delete directory / remove directory / rmdir
    CommandRegistry.register({
        names: [
            'del directory', 'delete directory', 'remove directory', 'rmdir',
            'del folder', 'delete folder', 'remove folder',
            'удалить папку', 'удалить директорию'
        ],
        description: 'Удаление папки (с перемещением в корзину для восстановления)',
        category: 'FileSystem',
        usage: 'del directory <название> | rmdir <название>',

        handler: async (parameters) => {
            if (!window.LocalFS) {
                return { response: '❌ Файловая система LocalFS не инициализирована.', style: 'output-error' };
            }

            let raw = (parameters && parameters.raw_args ? String(parameters.raw_args) : '').trim();
            const confirmed = raw.includes('--yes') || raw.includes('-y');
            raw = raw.replace(/--yes|-y/g, '').trim();
            const folderName = cleanArgString(raw);

            if (!folderName) {
                return {
                    response: '❌ Укажите название папки для удаления.\nПример: `del directory Test1`',
                    style: 'output-error'
                };
            }

            try {
                const res = await window.LocalFS.trash(folderName, confirmed);
                if (res.cancelled) {
                    return { response: `Операция отменена. Папка "${res.name}" сохранена.`, style: 'output-info' };
                }

                return {
                    response: `🗑️ Папка "${res.name}" удалена (перемещена в корзину).\n💡 Для восстановления введите: \`undel directory ${res.name}\``,
                    style: 'output-success'
                };
            } catch (err) {
                return {
                    response: `❌ Ошибка удаления папки: ${err.message}`,
                    style: 'output-error'
                };
            }
        }
    });

    // 6. Команда undel directory / restore directory / undel
    CommandRegistry.register({
        names: [
            'undel directory', 'restore directory',
            'undel folder', 'restore folder',
            'undel', 'восстановить папку'
        ],
        description: 'Восстановление папки из корзины файловой системы',
        category: 'FileSystem',
        usage: 'undel directory <название> | restore directory <название>',

        handler: async (parameters) => {
            if (!window.LocalFS) {
                return { response: '❌ Файловая система LocalFS не инициализирована.', style: 'output-error' };
            }

            const raw = (parameters && parameters.raw_args ? String(parameters.raw_args) : '').trim();
            const folderName = cleanArgString(raw);

            if (!folderName) {
                return {
                    response: '❌ Укажите название папки для восстановления.\nПример: `undel directory Test1`',
                    style: 'output-error'
                };
            }

            try {
                const res = await window.LocalFS.restore(folderName);
                return {
                    response: `🟢 Папка "${res.name}" успешно восстановлена в текущую директорию!`,
                    style: 'output-success'
                };
            } catch (err) {
                return {
                    response: `❌ Ошибка восстановления: ${err.message}`,
                    style: 'output-error'
                };
            }
        }
    });

    // 7. Команда edit directory / rename directory / rename
    CommandRegistry.register({
        names: [
            'edit directory', 'rename directory',
            'edit folder', 'rename folder',
            'rename', 'переименовать папку'
        ],
        description: 'Переименование папки',
        category: 'FileSystem',
        usage: 'rename directory <старое_имя> to <новое_имя> | edit directory Old New',

        handler: async (parameters) => {
            if (!window.LocalFS) {
                return { response: '❌ Файловая система LocalFS не инициализирована.', style: 'output-error' };
            }

            const raw = (parameters && parameters.raw_args ? String(parameters.raw_args) : '').trim();
            
            // Разбор: "Old to New" или "Old New" или "Old" "New"
            let oldName = '';
            let newName = '';

            if (raw.toLowerCase().includes(' to ')) {
                const parts = raw.split(/\s+to\s+/i);
                oldName = cleanArgString(parts[0]);
                newName = cleanArgString(parts[1]);
            } else if (raw.toLowerCase().includes(' в ')) {
                const parts = raw.split(/\s+в\s+/i);
                oldName = cleanArgString(parts[0]);
                newName = cleanArgString(parts[1]);
            } else if (parameters && parameters.args && parameters.args.length >= 2) {
                oldName = cleanArgString(parameters.args[0]);
                newName = cleanArgString(parameters.args.slice(1).join(' '));
            }

            if (!oldName || !newName) {
                return {
                    response: '❌ Укажите старое и новое название папки.\nПример:\n  • `rename directory Test1 to Test2`\n  • `edit directory "Старая папка" to "Новая папка"`',
                    style: 'output-error'
                };
            }

            try {
                const res = await window.LocalFS.rename(oldName, newName);
                return {
                    response: `✏️ Папка "${res.oldName}" успешно переименована в "${res.newName}"!`,
                    style: 'output-success'
                };
            } catch (err) {
                return {
                    response: `❌ Ошибка переименования: ${err.message}`,
                    style: 'output-error'
                };
            }
        }
    });

    // 8. Команда find directory / search directory / search folder
    CommandRegistry.register({
        names: [
            'find directory', 'search directory', 'search folder',
            'найти папку', 'поиск папки', 'найти директорию'
        ],
        description: 'Поиск папки по началу названия (префиксу) или фрагменту',
        category: 'FileSystem',
        usage: 'find directory <начало_имени> | search folder "TestContent TestValue1"',

        handler: async (parameters) => {
            if (!window.LocalFS) {
                return { response: '❌ Файловая система LocalFS не инициализирована.', style: 'output-error' };
            }

            const raw = (parameters && parameters.raw_args ? String(parameters.raw_args) : '').trim();
            const query = cleanArgString(raw);

            if (!query) {
                return {
                    response: '❌ Укажите поисковый запрос (например: `find directory TestContent TestValue1`)',
                    style: 'output-error'
                };
            }

            try {
                const results = await window.LocalFS.search(query);

                if (results.length === 0) {
                    return {
                        response: `🔍 Поиск по запросу "${query}":\n❌ Папок, начинающихся или содержащих "${query}", не найдено.`,
                        style: 'output-info'
                    };
                }

                const lines = [`🔍 Найдено совпадений: ${results.length} (запрос: "${query}"):\n`];
                results.forEach((r, idx) => {
                    const badge = r.isPrefixMatch ? '⭐ [Начинается с]' : '🔎 [Содержит]';
                    lines.push(`${idx + 1}. 📁 ${r.name} ${badge}`);
                    lines.push(`   📍 Путь: ${r.path}`);
                    lines.push(`   👉 Перейти: cd ${r.path}\n`);
                });

                return {
                    response: lines.join('\n').trim(),
                    style: 'output-success'
                };
            } catch (err) {
                return {
                    response: `❌ Ошибка поиска: ${err.message}`,
                    style: 'output-error'
                };
            }
        }
    });

    // 9.1. Отдельная команда fs export (чтобы любые пользовательские алиасы работали напрямую)
    CommandRegistry.register({
        names: [
            'fs export', 'export zip',
            'export file system', 'download all files', 'save project',
            'скачать zip', 'экспорт zip'
        ],
        description: 'Экспорт всей текущей директории и подпапок в .ZIP архив',
        category: 'FileSystem',
        usage: 'fs export | export file system | download all files | save project',

        handler: async () => {
            if (!window.LocalFS) {
                return { response: '❌ Файловая система LocalFS не инициализирована.', style: 'output-error' };
            }
            try {
                const zipRes = await window.LocalFS.exportZip();
                return {
                    response: `📦 Архив "${zipRes.filename}" (${zipRes.size}) успешно сгенерирован и подготовлен к скачиванию!\n<a href="${zipRes.downloadUrl}" download="${zipRes.filename}" style="color:#38bdf8;text-decoration:underline;font-weight:600;">📥 Нажмите здесь, если скачивание не началось автоматически</a>\n\n💡 Теперь вы можете открыть Google Диск и просто закинуть скачанный .zip файл в любую папку — 100% бесплатно и без привязки карт!`,
                    style: 'output-success',
                    isHtml: true
                };
            } catch (e) {
                return {
                    response: `❌ Ошибка экспорта архива: ${e.message}`,
                    style: 'output-error'
                };
            }
        }
    });

    // 9.2. Отдельная команда fs pick
    CommandRegistry.register({
        names: ['fs pick', 'pick directory', 'выбрать папку'],
        description: 'Выбрать реальную системную папку на устройстве (File System Access API)',
        category: 'FileSystem',
        usage: 'fs pick | pick directory',

        handler: async () => {
            if (!window.LocalFS) {
                return { response: '❌ Файловая система LocalFS не инициализирована.', style: 'output-error' };
            }
            try {
                const pickRes = await window.LocalFS.pick();
                if (pickRes.cancelled) {
                    return { response: 'Выбор папки отменен.', style: 'output-info' };
                }
                return {
                    response: `📁 Папка устройства "${pickRes.name}" успешно подключена!\n📍 Текущий путь: ${pickRes.path}\nВведите \`ls\` для просмотра содержимого.`,
                    style: 'output-success'
                };
            } catch (e) {
                return {
                    response: `ℹ️ ${e.message}`,
                    style: 'output-info'
                };
            }
        }
    });

    // 9.3. Отдельная команда fs status
    CommandRegistry.register({
        names: ['fs status', 'статус хранилища'],
        description: 'Показать статус локального файлового хранилища',
        category: 'FileSystem',
        usage: 'fs status',

        handler: async () => {
            if (!window.LocalFS) {
                return { response: '❌ Файловая система LocalFS не инициализирована.', style: 'output-error' };
            }
            const st = window.LocalFS.getStatus();
            return {
                response: `📍 Путь: ${st.path}\n💾 Тип хранилища: ${st.storageType}\n📱 Платформа: Android PWA (Origin Private File System)\n💰 Стоимость: 0$ (полностью бесплатно)`,
                style: 'output-info'
            };
        }
    });

    // 9.4. Общая справка fs
    CommandRegistry.register({
        names: ['fs', 'файлы', 'файловая система'],
        description: 'Локальное файловое хранилище Android / Браузера (OPFS, ZIP-экспорт)',
        category: 'FileSystem',
        usage: 'fs | fs export | fs pick | fs status',

        handler: async () => {
            if (!window.LocalFS) {
                return { response: '❌ Файловая система LocalFS не инициализирована.', style: 'output-error' };
            }

            const st = window.LocalFS.getStatus();
            return {
                response: `📁 Локальная файловая система (Android / PWA)\n` +
                          `──────────────────────────────────────────────\n` +
                          `📍 Текущий путь: ${st.path}\n` +
                          `💾 Хранилище: ${st.storageType}\n\n` +
                          `📌 Доступные команды:\n` +
                          `  • ls | list | directories | dir | vdir — просмотр текущей папки\n` +
                          `  • cd <путь> | change directory <путь> | cd .. | cd ~ — переход по папкам\n` +
                          `  • create directory (в 2 этапа) — создание папки\n` +
                          `  • find directory <имя> — поиск папки по началу названия (префиксу)\n` +
                          `  • edit directory <старое> to <новое> — переименование папки\n` +
                          `  • del directory <имя> — удаление папки (в корзину)\n` +
                          `  • undel directory <имя> — восстановление удаленной папки\n` +
                          `  • fs export | Save project | Download all files — скачать в .ZIP архив\n` +
                          `  • fs pick — выбрать реальную папку на устройстве\n` +
                          `  • pwd — показать текущий рабочий каталог\n` +
                          `──────────────────────────────────────────────\n` +
                          `💡 100% бесплатно, работает оффлайн на Android без биллинга и карт.`,
                style: 'output-info'
            };
        }
    });

    // 10. Команда скачивания полного кода проекта (ZIP для Cloudflare Pages)
    CommandRegistry.register({
        names: [
            'download project', 'downoad project', 'download code', 'export project',
            'скачать код', 'скачать проект', 'код',
            'cloudflare zip', 'cloudflare export', 'cloudflare'
        ],
        description: 'Скачивание полного архива проекта (.ZIP) для бесплатного размещения на Cloudflare Pages',
        category: 'FileSystem',
        usage: 'download project | скачать код',

        handler: async () => {
            if (typeof window.downloadCloudflareProjectZip !== 'function') {
                return { response: '❌ Модуль экспорта ZIP не готов. Обновите страницу.', style: 'output-error' };
            }

            try {
                const res = await window.downloadCloudflareProjectZip();
                return {
                    response: `📦 Полный архив проекта "${res.filename}" (${res.fileCount} файлов, ${res.size}) успешно собран!\n<a href="${res.downloadUrl}" download="${res.filename}" style="color:#38bdf8;text-decoration:underline;font-weight:600;">📥 Скачать ${res.filename} вручную (если браузер заблокировал автоскачивание)</a>\n\n` +
                              `🚀 Как разместить на Cloudflare Pages за 1 минуту:\n` +
                              `  1. Зайдите в https://dash.cloudflare.com/ (Workers & Pages).\n` +
                              `  2. Нажмите "Create application" ➔ вкладка "Pages" ➔ "Upload assets".\n` +
                              `  3. Введите название проекта (например, terminal) и перетащите скачанный ZIP-файл.\n` +
                              `  4. Нажмите "Deploy site" — готово! У вас будет свой вечный бесплатный сайт https://<имя>.pages.dev с PWA и оффлайн-режимом.`,
                    style: 'output-success',
                    isHtml: true
                };
            } catch (err) {
                return {
                    response: `❌ Ошибка создания архива проекта: ${err.message}`,
                    style: 'output-error'
                };
            }
        }
    });

})();
