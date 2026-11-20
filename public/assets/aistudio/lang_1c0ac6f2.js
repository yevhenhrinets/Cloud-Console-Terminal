// commands/lang.js — управление языком интерфейса терминала

CommandRegistry.register({
    names: ['lang', 'language', 'мова', 'язык'],
    
    description: 'Multi-language',
    category: 'Language',
    usage: 'Lang en | lang ru | lang uk',
    
    handler: async (parameters) => {
        const args = parameters.args.map(a => a.toLowerCase());
        const targetLang = args[0];

        if (!targetLang) {
            const current = getCurrentLanguage();
            return { 
                response: t('current_lang', { lang: current }) + '\nДоступные языки: ru, uk, en.\nПример: lang en или мова uk', 
                style: 'output-info' 
            };
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


