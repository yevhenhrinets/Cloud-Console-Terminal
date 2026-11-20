import React, { useState, useRef } from 'react';
import {
  Terminal,
  LayoutDashboard,
  UtensilsCrossed,
  Armchair,
  HelpCircle,
  ExternalLink,
  RotateCw,
  Maximize2,
  Minimize2,
  Database,
  CheckCircle2,
  Copy,
  Check,
  Sparkles,
  Layers,
  Clock,
  LogIn,
  AlertTriangle,
  ShieldAlert,
  Info,
  Globe,
  ListTodo
} from 'lucide-react';

type ActivePage = 'terminal' | 'dashboard' | 'missions' | 'kitchen' | 'hall' | 'auth-guide' | 'docs';

interface PageConfig {
  id: ActivePage;
  label: string;
  icon: React.ReactNode;
  url: string;
  badge?: string;
}

export default function App() {
  const [currentPage, setCurrentPage] = useState<ActivePage>('terminal');
  const [isFullScreen, setIsFullScreen] = useState(false);
  const [copiedCmd, setCopiedCmd] = useState<string | null>(null);
  const [iframeKey, setIframeKey] = useState(0);
  const [authMessage, setAuthMessage] = useState<string | null>(null);
  const [theme, setTheme] = useState<'dark' | 'light'>(() => {
    try {
      return (localStorage.getItem('terminal_theme') as 'light' | 'dark') || 'dark';
    } catch (e) {
      return 'dark';
    }
  });
  const iframeRef = useRef<HTMLIFrameElement>(null);

  React.useEffect(() => {
    const handleStorage = (e: StorageEvent) => {
      if (e.key === 'terminal_theme' && (e.newValue === 'light' || e.newValue === 'dark')) {
        setTheme(e.newValue);
      }
    };
    const handleMessage = (e: MessageEvent) => {
      if (e.data && e.data.type === 'THEME_CHANGE' && (e.data.theme === 'light' || e.data.theme === 'dark')) {
        setTheme(e.data.theme);
      }
    };
    window.addEventListener('storage', handleStorage);
    window.addEventListener('message', handleMessage);
    return () => {
      window.removeEventListener('storage', handleStorage);
      window.removeEventListener('message', handleMessage);
    };
  }, []);

  const devAppUrl = 'https://ais-dev-chnak55kwbkbbooyikw4mw-618166997611.europe-west3.run.app';
  const preAppUrl = 'https://ais-pre-chnak55kwbkbbooyikw4mw-618166997611.europe-west3.run.app';
  const supabaseCallbackUrl = 'https://qecyotztitajldibychu.supabase.co/auth/v1/callback';

  const pages: PageConfig[] = [
    {
      id: 'terminal',
      label: 'Консоль (Terminal)',
      icon: <Terminal className="w-4 h-4" />,
      url: '/terminal.html',
      badge: 'CLI v1.01h'
    },
    {
      id: 'dashboard',
      label: 'Дашборд (Dashboard)',
      icon: <LayoutDashboard className="w-4 h-4" />,
      url: '/dashboard.html',
      badge: 'v1.01h'
    },
    {
      id: 'missions',
      label: 'Завдання (Missions)',
      icon: <ListTodo className="w-4 h-4 text-emerald-400" />,
      url: '/missions.html',
      badge: 'Нове'
    },
    {
      id: 'kitchen',
      label: 'Кухня (Kitchen)',
      icon: <UtensilsCrossed className="w-4 h-4" />,
      url: '/house/kitchen.html',
      badge: '2D Room'
    },
    {
      id: 'hall',
      label: 'Зал (Hall)',
      icon: <Armchair className="w-4 h-4" />,
      url: '/house/hall.html',
      badge: '2D Room'
    },
    {
      id: 'auth-guide',
      label: 'Виправлення 403 Google',
      icon: <ShieldAlert className="w-4 h-4 text-amber-400" />,
      url: '#',
      badge: 'Важливо'
    },
    {
      id: 'docs',
      label: 'Довідка команд',
      icon: <HelpCircle className="w-4 h-4" />,
      url: '#',
      badge: 'Supabase'
    }
  ];

  const quickCommands = [
    { cmd: 'help', desc: 'Список усіх доступних команд' },
    { cmd: 'Add mission Развесить стирку', desc: 'Додати доручення через консоль' },
    { cmd: 'show missions', desc: 'Список активних доручень' },
    { cmd: 'show date', desc: 'Поточна дата і час' },
    { cmd: 'show notes', desc: 'Переглянути список заміток' },
    { cmd: 'building show', desc: 'Список динамічних построєк' },
    { cmd: 'timers', desc: 'Активні таймери в роботі' },
    { cmd: 'inventory', desc: 'Склад готової продукції' },
    { cmd: 'kitchen', desc: 'Перейти в інтерактивну кухню' },
    { cmd: 'hall', desc: 'Перейти у зал' }
  ];

  const handleCopy = (text: string, id: string) => {
    navigator.clipboard.writeText(text);
    setCopiedCmd(id);
    setTimeout(() => setCopiedCmd(null), 2000);
  };

  const handleReloadIframe = () => {
    setIframeKey(prev => prev + 1);
  };

  const triggerGoogleLoginDirectly = async () => {
    try {
      const SUPABASE_URL = 'https://qecyotztitajldibychu.supabase.co';
      const SUPABASE_ANON_KEY = 'sb_publishable_HdMyTN9U9GOMG1DzpJcrDg_6RCnU37G';
      
      let redirectTarget = `${preAppUrl}/terminal.html`;
      if (!window.location.hostname.includes('google.com') && window.location.origin.startsWith('http')) {
        redirectTarget = window.location.origin + '/terminal.html';
      }
      const authUrl = `${SUPABASE_URL}/auth/v1/authorize?provider=google&redirect_to=${encodeURIComponent(redirectTarget)}`;
      window.open(authUrl, '_blank');
      setAuthMessage('Вікно Google OAuth відкрито в новій вкладці! Після входу поверніться і оновіть консоль.');
      setTimeout(() => setAuthMessage(null), 5000);
    } catch (err: any) {
      setAuthMessage('Помилка: ' + err.message);
    }
  };

  React.useEffect(() => {
    // Якщо додаток відкрито напряму в браузері (або як PWA з іконки на телефоні):
    if (window.self === window.top && !window.location.search.includes('shell=1')) {
      window.location.replace('/terminal.html');
    }
  }, []);

  const activePageConfig = pages.find(p => p.id === currentPage) || pages[0];

  const isLight = theme === 'light';

  return (
    <div data-theme={theme} className={`flex flex-col h-[100dvh] w-screen overflow-hidden font-sans transition-colors duration-200 ${isLight ? 'bg-slate-100 text-slate-800' : 'bg-slate-950 text-slate-100'} selection:bg-cyan-500/30 selection:text-cyan-200`}>
      {/* Banner for opening directly as PWA without iframe */}
      <div className={`border-b px-3 py-1.5 text-xs flex items-center justify-between shrink-0 z-50 transition-colors ${isLight ? 'bg-gradient-to-r from-sky-100 via-slate-100 to-indigo-100 border-slate-300 text-slate-800' : 'bg-gradient-to-r from-sky-950 via-slate-900 to-indigo-950 border-sky-800/60 text-sky-200'}`}>
        <div className={`flex items-center gap-1.5 truncate pr-2 ${isLight ? 'text-slate-700' : 'text-sky-200'}`}>
          <Globe className="w-3.5 h-3.5 text-emerald-500 shrink-0" />
          <span className="truncate text-[11px] sm:text-xs">
            <strong>PWA та Демо-режим:</strong> усі команди працюють безпосередньо в терміналі
          </span>
        </div>
        <div className="flex items-center gap-1.5 shrink-0">
          <a
            href="/terminal.html"
            target="_blank"
            rel="noreferrer"
            className="px-2 py-0.5 bg-emerald-600 hover:bg-emerald-500 text-white font-semibold rounded-md flex items-center gap-1 text-[11px] shadow animate-pulse"
            title="Відкрити без рамок Google для встановлення PWA на телефон"
          >
            <span>📲 Встановити PWA</span>
            <ExternalLink className="w-3 h-3" />
          </a>
          <button
            type="button"
            onClick={async () => {
              const w = window as any;
              if (w.downloadCloudflareProjectZip) {
                await w.downloadCloudflareProjectZip();
              } else {
                window.location.href = '/terminal.html';
              }
            }}
            className="px-2 py-0.5 bg-sky-600 hover:bg-sky-500 text-white font-semibold rounded-md flex items-center gap-1 text-[11px] shadow"
            title="Завантажити повний архів коду (.ZIP) для Cloudflare Pages"
          >
            <span>💾 Скачати ZIP</span>
          </button>
          <a
            href="https://terminal-6se.pages.dev/index.html"
            target="_blank"
            rel="noreferrer"
            className="px-2 py-0.5 bg-indigo-600 hover:bg-indigo-500 text-white font-medium rounded-md flex items-center gap-1 text-[11px] shadow"
            title="Оригінальний хостинг Cloudflare Pages"
          >
            <span>Cloudflare</span>
            <ExternalLink className="w-3 h-3" />
          </a>
          <button
            onClick={() => setCurrentPage('auth-guide')}
            className={`px-2 py-0.5 rounded-md text-[11px] font-medium border ${isLight ? 'bg-amber-100 text-amber-800 border-amber-300 hover:bg-amber-200' : 'bg-amber-500/20 text-amber-300 border-amber-500/40 hover:bg-amber-500/30'}`}
          >
            Чому 403?
          </button>
        </div>
      </div>

      {/* Top Shell Bar */}
      {!isFullScreen && (
        <header className={`border-b backdrop-blur-md px-2 sm:px-4 py-1.5 shrink-0 z-40 transition-colors ${isLight ? 'border-slate-200 bg-white/95' : 'border-slate-800 bg-slate-900/95'}`}>
          <div className="flex items-center justify-between gap-1.5 sm:gap-3 max-w-7xl mx-auto">
            {/* App Brand & Status */}
            <div className="flex items-center gap-1.5 shrink-0">
              <div className="h-7 w-7 rounded-lg bg-gradient-to-tr from-sky-500 to-indigo-600 flex items-center justify-center shadow-md shadow-sky-500/20">
                <Terminal className="w-3.5 h-3.5 text-white" />
              </div>
              <div className="hidden sm:block">
                <div className="flex items-center gap-1.5">
                  <h1 className={`text-xs font-bold tracking-tight ${isLight ? 'text-slate-900' : 'text-white'}`}>Cloud Terminal</h1>
                  <span className="text-[9px] font-mono px-1 py-0.2 rounded bg-emerald-500/15 text-emerald-600 font-semibold flex items-center gap-1">
                    <span className="w-1.5 h-1.5 rounded-full bg-emerald-500 animate-pulse" /> Live
                  </span>
                </div>
              </div>
            </div>

            {/* Navigation Tabs (Scrollable on mobile) */}
            <nav className={`flex items-center gap-1 p-0.5 rounded-xl border text-xs overflow-x-auto max-w-xl mx-1 ${isLight ? 'bg-slate-200/70 border-slate-300' : 'bg-slate-950/70 border-slate-800'}`}>
              {pages.map((page) => {
                const isActive = currentPage === page.id;
                return (
                  <button
                    key={page.id}
                    onClick={() => setCurrentPage(page.id)}
                    className={`flex items-center gap-1 px-2.5 py-1 rounded-lg text-xs font-medium transition-all shrink-0 ${
                      isActive
                        ? 'bg-sky-600 text-white shadow-sm shadow-sky-500/30 font-semibold'
                        : isLight
                        ? 'text-slate-600 hover:text-slate-900 hover:bg-slate-300/60'
                        : 'text-slate-400 hover:text-slate-200 hover:bg-slate-900/60'
                    }`}
                  >
                    {page.icon}
                    <span className="text-[11px] sm:text-xs">{page.label.split(' ')[0]}</span>
                  </button>
                );
              })}
            </nav>

            {/* Action Tools */}
            <div className="flex items-center gap-1 shrink-0">
              <button
                onClick={triggerGoogleLoginDirectly}
                title="Увійти через Google"
                className="px-2 py-1 rounded-lg bg-indigo-600 hover:bg-indigo-500 text-white font-semibold text-xs flex items-center gap-1 shadow-sm"
              >
                <LogIn className="w-3.5 h-3.5" />
                <span className="hidden md:inline text-[11px]">Вхід Google</span>
              </button>
              <button
                onClick={handleReloadIframe}
                title="Оновити сторінку"
                className="p-1 rounded-lg text-slate-400 hover:text-slate-200 hover:bg-slate-800 transition-colors"
              >
                <RotateCw className="w-3.5 h-3.5" />
              </button>
              <a
                href={`${preAppUrl}${activePageConfig.url === '#' ? '/terminal.html' : activePageConfig.url}`}
                target="_blank"
                rel="noreferrer"
                title="Відкрити сторінку окремо в браузері"
                className="p-1 rounded-lg text-slate-400 hover:text-slate-200 hover:bg-slate-800 transition-colors"
              >
                <ExternalLink className="w-3.5 h-3.5" />
              </a>
              <button
                onClick={() => setIsFullScreen(true)}
                title="Повний екран"
                className="p-1 rounded-lg text-slate-400 hover:text-slate-200 hover:bg-slate-800 transition-colors"
              >
                <Maximize2 className="w-3.5 h-3.5" />
              </button>
            </div>
          </div>
        </header>
      )}

      {/* Floating Exit Fullscreen Button */}
      {isFullScreen && (
        <button
          onClick={() => setIsFullScreen(false)}
          className="fixed top-3 right-3 z-50 px-3 py-1.5 rounded-full bg-slate-900/90 text-slate-300 hover:text-white border border-slate-700 text-xs shadow-xl backdrop-blur-md flex items-center gap-1.5 transition-all opacity-80 hover:opacity-100"
        >
          <Minimize2 className="w-3.5 h-3.5" />
          <span>Вийти з повного екрана</span>
        </button>
      )}

      {/* Auth Alert Notification */}
      {authMessage && (
        <div className="bg-indigo-600/95 text-white px-4 py-2 text-xs font-medium text-center shadow-lg flex items-center justify-center gap-2 z-50">
          <Info className="w-4 h-4" />
          <span>{authMessage}</span>
        </div>
      )}

      {/* Main View Area */}
      <main className="flex-1 w-full h-full relative overflow-hidden bg-slate-950">
        {currentPage === 'auth-guide' ? (
          <div className="h-full overflow-y-auto p-4 sm:p-6 md:p-8 max-w-4xl mx-auto space-y-6">
            {/* 403 Problem Card */}
            <div className="p-6 rounded-2xl bg-amber-950/30 border border-amber-500/40 shadow-xl space-y-4">
              <div className="flex items-start gap-3">
                <div className="w-10 h-10 rounded-xl bg-amber-500/20 text-amber-400 flex items-center justify-center shrink-0 mt-0.5">
                  <ShieldAlert className="w-5 h-5" />
                </div>
                <div className="space-y-1">
                  <h2 className="text-base sm:text-lg font-bold text-white">
                    Чому Google повертає помилку 403 ("We're sorry, but you do not have access to this page")?
                  </h2>
                  <p className="text-xs sm:text-sm text-slate-300 leading-relaxed">
                    У вашому початковому коді була логіка «Auth First» — при завантаженні сторінка відразу автоматично викликала <code className="text-amber-300 font-mono">executeCommand('Login')</code>. Це призводило до помилки з двох причин:
                  </p>
                </div>
              </div>

              <div className="grid grid-cols-1 md:grid-cols-3 gap-4 pt-2">
                <div className="p-4 rounded-xl bg-slate-900/80 border border-slate-800 space-y-2">
                  <div className="text-xs font-bold text-rose-400 flex items-center gap-1.5">
                    <AlertTriangle className="w-4 h-4 shrink-0" /> 1. Блокування в iFrame
                  </div>
                  <p className="text-xs text-slate-300 leading-relaxed">
                    Google Security блокує <code className="text-slate-200">accounts.google.com</code> всередині тегів <code className="text-slate-200">&lt;iframe&gt;</code> для захисту від clickjacking-атак.
                  </p>
                </div>

                <div className="p-4 rounded-xl bg-slate-900/80 border border-slate-800 space-y-2">
                  <div className="text-xs font-bold text-amber-400 flex items-center gap-1.5">
                    <Globe className="w-4 h-4 shrink-0" /> 2. Redirect URLs у Supabase
                  </div>
                  <p className="text-xs text-slate-300 leading-relaxed">
                    У панелі Supabase дозволеними для перенаправлення були лише адреси Cloudflare Pages (<code className="text-slate-200">terminal-6se.pages.dev</code>).
                  </p>
                </div>

                <div className="p-4 rounded-xl bg-slate-900/80 border border-indigo-500/40 space-y-2">
                  <div className="text-xs font-bold text-indigo-400 flex items-center gap-1.5">
                    <ShieldAlert className="w-4 h-4 shrink-0" /> 3. Помилка applet-auth-bridge
                  </div>
                  <p className="text-xs text-slate-300 leading-relaxed">
                    Адреса <code className="text-slate-200">ais-dev-*.run.app</code> захищена Google IAP. Якщо в мобільному Chrome активний інший Google-профіль із багатьох, Google повертає 403.
                  </p>
                </div>
              </div>
            </div>

            {/* How We Fixed the Code */}
            <div className="p-6 rounded-2xl bg-slate-900/70 border border-slate-800 space-y-3">
              <h3 className="text-sm font-bold text-white flex items-center gap-2">
                <CheckCircle2 className="w-4 h-4 text-emerald-400" />
                Що ми вже автоматично виправили в коді:
              </h3>
              <ul className="text-xs text-slate-300 space-y-2 pl-4 list-disc">
                <li>
                  <strong className="text-white">Прибрали блокуючий автовизов Login:</strong> тепер при першому вході термінал, дашборд і кімнати відкриваються в <strong className="text-emerald-400">гостьовому демо-режимі</strong>. Нічого не падає в 403, і сторінки не зациклюються в редиректі.
                </li>
                <li>
                  <strong className="text-white">Безпечний виклик Login:</strong> якщо ви або користувач викликаєте команду <code className="text-sky-300 font-mono">login</code> або тиснете кнопку входу, система відкриває авторизацію в <strong className="text-indigo-400">окремій вкладці браузера (new window)</strong>, де Google успішно відображає вибір акаунту.
                </li>
                <li>
                  <strong className="text-white">Демо-дані в постройках:</strong> дашборд тепер автоматично підвантажує постройки кімнат (Печь, Стиралка, Мультиварка, Телевизор), тому кліки в Кухні та Залі відразу відкривають відповідні черги навіть без авторизації.
                </li>
              </ul>
            </div>

            {/* Exact Steps to Add to Supabase & Google Cloud Console */}
            <div className="p-6 rounded-2xl bg-slate-900/90 border border-indigo-500/30 space-y-4">
              <h3 className="text-sm font-bold text-white flex items-center gap-2">
                <Globe className="w-4 h-4 text-sky-400" />
                Що потрібно додати в налаштування Supabase (для синхронізації з хмарою):
              </h3>
              <p className="text-xs text-slate-300">
                Щоб після входу через Google дані зберігалися у вашому проєкті Supabase з цього апплету, скопіюйте ці посилання в налаштування:
              </p>

              <div className="space-y-3">
                <div className="p-3 rounded-xl bg-slate-950 border border-slate-800 space-y-1.5">
                  <div className="flex items-center justify-between">
                    <span className="text-[11px] font-semibold text-sky-300">
                      1. Supabase Dashboard &rarr; Authentication &rarr; URL Configuration &rarr; Redirect URLs:
                    </span>
                    <button
                      onClick={() => handleCopy(`${devAppUrl}/**\n${preAppUrl}/**`, 'supa-urls')}
                      className="px-2 py-0.5 rounded bg-slate-800 hover:bg-slate-700 text-[10px] text-slate-300 flex items-center gap-1"
                    >
                      {copiedCmd === 'supa-urls' ? <Check className="w-3 h-3 text-emerald-400" /> : <Copy className="w-3 h-3" />}
                      <span>{copiedCmd === 'supa-urls' ? 'Скопійовано' : 'Копіювати обидва'}</span>
                    </button>
                  </div>
                  <div className="font-mono text-xs text-slate-300 space-y-1">
                    <div className="p-1.5 rounded bg-slate-900 select-all">{devAppUrl}/**</div>
                    <div className="p-1.5 rounded bg-slate-900 select-all">{preAppUrl}/**</div>
                  </div>
                </div>

                <div className="p-3 rounded-xl bg-slate-950 border border-slate-800 space-y-1.5">
                  <div className="flex items-center justify-between">
                    <span className="text-[11px] font-semibold text-indigo-300">
                      2. Google Cloud Console &rarr; APIs & Services &rarr; Credentials &rarr; OAuth 2.0 Client ID:
                    </span>
                    <button
                      onClick={() => handleCopy(supabaseCallbackUrl, 'google-cb')}
                      className="px-2 py-0.5 rounded bg-slate-800 hover:bg-slate-700 text-[10px] text-slate-300 flex items-center gap-1"
                    >
                      {copiedCmd === 'google-cb' ? <Check className="w-3 h-3 text-emerald-400" /> : <Copy className="w-3 h-3" />}
                      <span>{copiedCmd === 'google-cb' ? 'Скопійовано' : 'Копіювати'}</span>
                    </button>
                  </div>
                  <p className="text-[11px] text-slate-400">
                    У полі <strong>Authorized redirect URIs</strong> повинен бути вказаний Supabase callback (він у вас уже доданий для Cloudflare Pages):
                  </p>
                  <div className="font-mono text-xs text-slate-300 p-1.5 rounded bg-slate-900 select-all">
                    {supabaseCallbackUrl}
                  </div>
                </div>
              </div>

              <div className="pt-2 flex justify-end">
                <button
                  onClick={triggerGoogleLoginDirectly}
                  className="px-4 py-2 rounded-xl bg-indigo-600 hover:bg-indigo-500 text-white font-bold text-xs flex items-center gap-2 shadow-lg shadow-indigo-600/30"
                >
                  <LogIn className="w-4 h-4" />
                  <span>Перевірити авторизацію через Google у новій вкладці</span>
                </button>
              </div>
            </div>
          </div>
        ) : currentPage === 'docs' ? (
          <div className="h-full overflow-y-auto p-4 sm:p-6 md:p-8 max-w-5xl mx-auto space-y-6">
            {/* Overview Card */}
            <div className="p-6 rounded-2xl bg-gradient-to-br from-slate-900 to-slate-900/80 border border-slate-800 shadow-xl space-y-4">
              <div className="flex items-center gap-3">
                <div className="w-10 h-10 rounded-xl bg-sky-500/20 text-sky-400 flex items-center justify-center">
                  <Database className="w-5 h-5" />
                </div>
                <div>
                  <h2 className="text-lg font-bold text-white">Довідник проєкту Cloud Terminal</h2>
                  <p className="text-xs text-slate-400">
                    Архітектура, підключена база даних Supabase та повний перелік команд
                  </p>
                </div>
              </div>

              <div className="grid grid-cols-1 sm:grid-cols-3 gap-3 pt-2">
                <div className="p-3 rounded-xl bg-slate-950/60 border border-slate-800/80">
                  <div className="text-[11px] text-slate-400">Хостинг додатку</div>
                  <div className="text-xs font-bold text-sky-300 mt-0.5">Google Cloud Run (Vite / Node)</div>
                </div>
                <div className="p-3 rounded-xl bg-slate-950/60 border border-slate-800/80">
                  <div className="text-[11px] text-slate-400">База даних</div>
                  <div className="text-xs font-bold text-emerald-400 mt-0.5">Supabase PostgreSQL + RLS</div>
                </div>
                <div className="p-3 rounded-xl bg-slate-950/60 border border-slate-800/80">
                  <div className="text-[11px] text-slate-400">Автентифікація</div>
                  <div className="text-xs font-bold text-indigo-300 mt-0.5">Google OAuth via Supabase</div>
                </div>
              </div>
            </div>

            {/* Quick Commands Copy */}
            <div className="space-y-3">
              <h3 className="text-sm font-bold text-white flex items-center gap-2">
                <Sparkles className="w-4 h-4 text-sky-400" />
                Швидкі команди для тестування в терміналі
              </h3>
              <div className="grid grid-cols-1 sm:grid-cols-2 md:grid-cols-4 gap-2.5">
                {quickCommands.map((item) => (
                  <button
                    key={item.cmd}
                    onClick={() => handleCopy(item.cmd, item.cmd)}
                    className="p-3 rounded-xl bg-slate-900/60 border border-slate-800 hover:border-sky-500/40 text-left transition-all group flex flex-col justify-between"
                  >
                    <div className="flex items-center justify-between w-full">
                      <code className="text-xs font-mono font-bold text-sky-300 group-hover:text-sky-200">
                        {item.cmd}
                      </code>
                      {copiedCmd === item.cmd ? (
                        <Check className="w-3.5 h-3.5 text-emerald-400" />
                      ) : (
                        <Copy className="w-3.5 h-3.5 text-slate-500 group-hover:text-slate-300" />
                      )}
                    </div>
                    <div className="text-[11px] text-slate-400 mt-1 line-clamp-1">{item.desc}</div>
                  </button>
                ))}
              </div>
            </div>

            {/* Groups of Commands */}
            <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
              {/* Group 1 */}
              <div className="p-5 rounded-2xl bg-slate-900/60 border border-slate-800 space-y-3">
                <h4 className="text-sm font-bold text-white flex items-center gap-2">
                  <Layers className="w-4 h-4 text-emerald-400" />
                  Управління замітками (Notes CRUD)
                </h4>
                <ul className="text-xs space-y-2 text-slate-300 font-mono">
                  <li className="p-2 rounded bg-slate-950/50 border border-slate-800/60">
                    <span className="text-emerald-400">add note [текст]</span> — додати нову замітку
                  </li>
                  <li className="p-2 rounded bg-slate-950/50 border border-slate-800/60">
                    <span className="text-emerald-400">show notes</span> або <span className="text-emerald-400">notes</span> — переглянути всі
                  </li>
                  <li className="p-2 rounded bg-slate-950/50 border border-slate-800/60">
                    <span className="text-emerald-400">note [id]</span> — переглянути конкретну замітку
                  </li>
                  <li className="p-2 rounded bg-slate-950/50 border border-slate-800/60">
                    <span className="text-emerald-400">edit [id] [новий текст]</span> — Git-style версіонування
                  </li>
                  <li className="p-2 rounded bg-slate-950/50 border border-slate-800/60">
                    <span className="text-emerald-400">pin [id] / unpin [id]</span> — закріплення/відкріплення
                  </li>
                  <li className="p-2 rounded bg-slate-950/50 border border-slate-800/60">
                    <span className="text-emerald-400">del [id]</span> — м'яке видалення (soft-delete в корзину)
                  </li>
                  <li className="p-2 rounded bg-slate-950/50 border border-slate-800/60">
                    <span className="text-emerald-400">notes trash / restore [id]</span> — корзина і відновлення
                  </li>
                </ul>
              </div>

              {/* Group 2 */}
              <div className="p-5 rounded-2xl bg-slate-900/60 border border-slate-800 space-y-3">
                <h4 className="text-sm font-bold text-white flex items-center gap-2">
                  <Clock className="w-4 h-4 text-amber-400" />
                  Постройки, Таймери та Склад
                </h4>
                <ul className="text-xs space-y-2 text-slate-300 font-mono">
                  <li className="p-2 rounded bg-slate-950/50 border border-slate-800/60">
                    <span className="text-amber-400">building show</span> — переглянути всі постройки
                  </li>
                  <li className="p-2 rounded bg-slate-950/50 border border-slate-800/60">
                    <span className="text-amber-400">Add building [Назва]</span> — створити нову постройку
                  </li>
                  <li className="p-2 rounded bg-slate-950/50 border border-slate-800/60">
                    <span className="text-amber-400">Add task [Постройка] [Задача] [Час]</span> — прив'язати задачу
                  </li>
                  <li className="p-2 rounded bg-slate-950/50 border border-slate-800/60">
                    <span className="text-amber-400">timers</span> — список активних черг з розрахунком `ends_at`
                  </li>
                  <li className="p-2 rounded bg-slate-950/50 border border-slate-800/60">
                    <span className="text-amber-400">add timer [Ім'я] [Очередь]</span> — запустити таймер у чергу
                  </li>
                  <li className="p-2 rounded bg-slate-950/50 border border-slate-800/60">
                    <span className="text-amber-400">inventory</span> — склад готових виробів після закінчення
                  </li>
                </ul>
              </div>

              {/* Group 3: Missions */}
              <div className="p-5 rounded-2xl bg-slate-900/60 border border-slate-800 space-y-3 md:col-span-2">
                <h4 className="text-sm font-bold text-white flex items-center gap-2">
                  <ListTodo className="w-4 h-4 text-sky-400" />
                  Поручення та Завдання (Missions Queue & Database)
                </h4>
                <div className="grid grid-cols-1 md:grid-cols-2 gap-3 text-xs text-slate-300 font-mono">
                  <div className="p-2.5 rounded bg-slate-950/50 border border-slate-800/60">
                    <span className="text-sky-400">Add mission [текст]</span> — додати доручення в чергу (напр. <code>Add mission Розвесить стирку</code>)
                  </div>
                  <div className="p-2.5 rounded bg-slate-950/50 border border-slate-800/60">
                    <span className="text-sky-400">missions</span> або <span className="text-sky-400">show missions</span> — переглянути активний список справ
                  </div>
                  <div className="p-2.5 rounded bg-slate-950/50 border border-slate-800/60">
                    <span className="text-sky-400">done mission [#]</span> — відмітити виконаним із фіксацією дати і таймзони
                  </div>
                  <div className="p-2.5 rounded bg-slate-950/50 border border-slate-800/60">
                    <span className="text-sky-400">/missions.html</span> — інтерактивна сторінка з Drag & Drop перетаскуванням та таблицею-архівом
                  </div>
                </div>
              </div>
            </div>

            {/* Direct Links */}
            <div className="p-5 rounded-2xl bg-slate-900/40 border border-slate-800 flex flex-wrap items-center justify-between gap-4">
              <div>
                <h4 className="text-xs font-bold text-white">Прямі статичні маршрути:</h4>
                <p className="text-[11px] text-slate-400">
                  Усі файли додатку доступні напряму як статичні сторінки:
                </p>
              </div>
              <div className="flex flex-wrap gap-2 text-xs">
                <a href={`${preAppUrl}/terminal.html`} target="_blank" rel="noreferrer" className="px-2.5 py-1 rounded bg-slate-800 hover:bg-slate-700 text-sky-400 flex items-center gap-1">
                  /terminal.html <ExternalLink className="w-3 h-3" />
                </a>
                <a href={`${preAppUrl}/missions.html`} target="_blank" rel="noreferrer" className="px-2.5 py-1 rounded bg-slate-800 hover:bg-slate-700 text-sky-400 flex items-center gap-1">
                  /missions.html <ExternalLink className="w-3 h-3" />
                </a>
                <a href={`${preAppUrl}/dashboard.html`} target="_blank" rel="noreferrer" className="px-2.5 py-1 rounded bg-slate-800 hover:bg-slate-700 text-sky-400 flex items-center gap-1">
                  /dashboard.html <ExternalLink className="w-3 h-3" />
                </a>
                <a href={`${preAppUrl}/house/kitchen.html`} target="_blank" rel="noreferrer" className="px-2.5 py-1 rounded bg-slate-800 hover:bg-slate-700 text-sky-400 flex items-center gap-1">
                  /house/kitchen.html <ExternalLink className="w-3 h-3" />
                </a>
                <a href={`${preAppUrl}/house/hall.html`} target="_blank" rel="noreferrer" className="px-2.5 py-1 rounded bg-slate-800 hover:bg-slate-700 text-sky-400 flex items-center gap-1">
                  /house/hall.html <ExternalLink className="w-3 h-3" />
                </a>
              </div>
            </div>
          </div>
        ) : (
          <iframe
            key={iframeKey}
            ref={iframeRef}
            src={activePageConfig.url}
            title={activePageConfig.label}
            className={`w-full h-full border-none ${isLight ? 'bg-slate-50' : 'bg-slate-950'}`}
            allow="clipboard-read; clipboard-write; notifications"
          />
        )}
      </main>
    </div>
  );
}
