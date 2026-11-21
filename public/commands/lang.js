// commands/lang.js — управление языком интерфейса терминала (строго в 2 этапа)

CommandRegistry.register({
    names: ['lang', 'language', 'мова', 'язык'],

    description: 'Смена языка интерфейса (строго в 2 этапа: lang -> en | ru | uk)',
    category: 'Language',
    usage: 'lang -> <ru | uk | en>',

    handler: async (parameters, options = {}) => {
        const matchedCmd = String((parameters && parameters.matchedCmd) || 'lang').trim().toLowerCase();
        const rawArgs = (parameters && parameters.raw_args ? String(parameters.raw_args) : '').trim();

        if (!(options && options.fromTwoStepBar)) {
            if (rawArgs) {
                return rejectInlineParamsError(matchedCmd, 'en');
            }
            const current = getCurrentLanguage();
            return {
                response: `${t('current_lang', { lang: current })}\nДоступные языки: ru, uk, en. Введите код языка и нажмите Enter (или ✕ для отмены).`,
                style: 'output-info',
                commandPrefix: matchedCmd,
                inputValue: '',
                inputPlaceholder: 'Код языка (ru, uk или en)...'
            };
        }

        const args = (parameters.args || []).map(a => String(a).toLowerCase());
        const targetLang = args[0];

        if (!targetLang) {
            return { response: '❌ Укажите язык: `ru`, `uk` или `en`.', style: 'output-error' };
        }

        const supported = {
            'ru': 'ru', 'русский': 'ru', 'рус': 'ru',
            'uk': 'uk', 'укр': 'uk', 'українська': 'uk', 'ua': 'uk',
            'en': 'en', 'eng': 'en', 'english': 'en', 'английский': 'en'
        };

        const resolvedLang = supported[targetLang];
        if (!resolvedLang) {
            return { response: `Неизвестный язык: "${targetLang}". Используйте: ru, uk, en`, style: 'output-error' };
        }

        setCurrentLanguage(resolvedLang);
        return { response: t('lang_changed'), style: 'output-success' };
    }
});
