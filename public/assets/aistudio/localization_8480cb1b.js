
// localization.js — модуль локализации и словарей синонимов (UA, RU, EN)

const dictionaries = {
    uk: {
        not_authorized: 'Помилка: ви не авторизовані. Будь ласка, введіть команду "login" для входа через Google.',
        list_empty: 'Список нотаток порожній.',
        note_saved: 'Нотатку успішно збережено в хмару: "{text}"',
        note_saved_author: 'Нотатку збережено (Автор ID: {id}): "{text}"',
        notes_list_title: 'Ваші останні нотатки:',
        error_load_notes: 'Помилка завантаження нотаток: {err}',
        error_save_note: 'Помилка збереження нотатки: {err}',
        error_operation: 'Помилка операції: {err}',
        error_delete: 'Помилка видалення: {err}',
        error_update: 'Помилка оновлення: {err}',
        notes_not_found: 'Нотатки не знайдено або у вас немає доступу.',
        already_pinned_plural: 'Нотатки з ID [{ids}] вже закріплені. Змін не потрібно.',
        already_pinned_singular: 'Нотатка з ID [{ids}] вже закріплена. Змін не потрібно.',
        already_unpinned_plural: 'Нотатки з ID [{ids}] вже відкріплені. Змін не потрібно.',
        already_unpinned_singular: 'Нотатка з ID [{ids}] вже відкріплена. Змін не потрібно.',
        pinned_plural: 'Нотатки з ID [{ids}] закріплені зверху.',
        pinned_singular: 'Нотатка з ID [{ids}] закріплена зверху.',
        unpinned_plural: 'Нотатки з ID [{ids}] відкріплені.',
        unpinned_singular: 'Нотатка з ID [{ids}] відкріплена.',
        hidden_plural: 'Успішно приховані ({entity}) з ID: [{ids}].',
        hidden_singular: 'Успішно прихована ({entity}) з ID: [{ids}].',
        updated_success: 'Успішно оновлено запис з ID [{id}].',
        profile_title: 'Ваш профіль:\n  Імя: {name}\n  Нікнейм: {nickname}\n  Email: {email}\n  Роль: {role}\n  ID: {id}',
        lang_changed: 'Мову успішно змінено на: Українська (uk)',
        current_lang: 'Поточна мова: {lang}'
    },
    ru: {
        not_authorized: 'Ошибка: вы не авторизованы. Пожалуйста, введите команду "login" для входа через Google.',
        list_empty: 'Список заметок пуст.',
        note_saved: 'Заметка успешно сохранена в облако: "{text}"',
        note_saved_author: 'Заметка сохранена (Автор ID: {id}): "{text}"',
        notes_list_title: 'Ваши последние заметки:',
        error_load_notes: 'Ошибка загрузки заметок: {err}',
        error_save_note: 'Ошибка сохранения заметки: {err}',
        error_operation: 'Ошибка операции: {err}',
        error_delete: 'Ошибка удаления: {err}',
        error_update: 'Ошибка обновления: {err}',
        notes_not_found: 'Заметки не найдены или у вас нет доступа.',
        already_pinned_plural: 'Заметки с ID [{ids}] уже закреплены. Изменений не требуется.',
        already_pinned_singular: 'Заметка с ID [{ids}] уже закреплена. Изменений не требуется.',
        already_unpinned_plural: 'Заметки с ID [{ids}] уже откреплены. Изменений не требуется.',
        already_unpinned_singular: 'Заметка с ID [{ids}] уже откреплена. Изменений не требуется.',
        pinned_plural: 'Заметки с ID [{ids}] закреплены сверху.',
        pinned_singular: 'Заметка с ID [{ids}] закреплена сверху.',
        unpinned_plural: 'Заметки с ID [{ids}] откреплены.',
        unpinned_singular: 'Заметка с ID [{ids}] откреплена.',
        hidden_plural: 'Успешно скрыты ({entity}) с ID: [{ids}].',
        hidden_singular: 'Успешно скрыта ({entity}) с ID: [{ids}].',
        updated_success: 'Успешно обновлена запись с ID [{id}].',
        profile_title: 'Ваш профиль:\n  Имя: {name}\n  Никнейм: {nickname}\n  Email: {email}\n  Роль: {role}\n  ID: {id}',
        lang_changed: 'Язык успешно изменен на: Русский (ru)',
        current_lang: 'Текущий язык: {lang}'
    },
    en: {
        not_authorized: 'Error: you are not authorized. Please type "login" to sign in via Google.',
        list_empty: 'Notes list is empty.',
        note_saved: 'Note successfully saved to cloud: "{text}"',
        note_saved_author: 'Note saved (Author ID: {id}): "{text}"',
        notes_list_title: 'Your recent notes:',
        error_load_notes: 'Error loading notes: {err}',
        error_save_note: 'Error saving note: {err}',
        error_operation: 'Operation error: {err}',
        error_delete: 'Deletion error: {err}',
        error_update: 'Update error: {err}',
        notes_not_found: 'Notes not found or access denied.',
        already_pinned_plural: 'Notes with ID [{ids}] are already pinned. No changes needed.',
        already_pinned_singular: 'Note with ID [{ids}] is already pinned. No changes needed.',
        already_unpinned_plural: 'Notes with ID [{ids}] are already unpinned. No changes needed.',
        already_unpinned_singular: 'Note with ID [{ids}] is already unpinned. No changes needed.',
        pinned_plural: 'Notes with ID [{ids}] have been pinned to top.',
        pinned_singular: 'Note with ID [{ids}] has been pinned to top.',
        unpinned_plural: 'Notes with ID [{ids}] have been unpinned.',
        unpinned_singular: 'Note with ID [{ids}] has been unpinned.',
        hidden_plural: 'Successfully hidden ({entity}) with ID: [{ids}].',
        hidden_singular: 'Successfully hidden ({entity}) with ID: [{ids}].',
        updated_success: 'Successfully updated record with ID [{id}].',
        profile_title: 'Your profile:\n  Name: {name}\n  Nickname: {nickname}\n  Email: {email}\n  Role: {role}\n  ID: {id}',
        lang_changed: 'Language successfully changed to: English (en)',
        current_lang: 'Current language: {lang}'
    }
};

function getCurrentLanguage() {
    return localStorage.getItem('terminal_lang') || 'ru'; // по умолчанию русский
}

function setCurrentLanguage(lang) {
    if (dictionaries[lang]) {
        localStorage.setItem('terminal_lang', lang);
        return true;
    }
    return false;
}

// Функция перевода с подстановкой параметров (например: t('note_saved', { text: 'привет' }))
function t(key, params = {}) {
    const lang = getCurrentLanguage();
    const dict = dictionaries[lang] || dictionaries['ru'];
    let text = dict[key] || dictionaries['ru'][key] || key;

    for (const [paramKey, value] of Object.entries(params)) {
        text = text.replace(new RegExp(`\\{${paramKey}\\}`, 'g'), value);
    }
    return text;
}

