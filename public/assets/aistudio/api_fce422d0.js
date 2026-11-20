// api.js — конфигурация и подключение к Supabase
const SUPABASE_URL = 'https://qecyotztitajldibychu.supabase.co';     // Замените на ваш URL из Supabase
const SUPABASE_ANON_KEY = 'sb_publishable_HdMyTN9U9GOMG1DzpJcrDg_6RCnU37G'; // Замените на ваш anon public key

// Извлекаем createClient из библиотеки и сохраняем готовый клиент в window
const { createClient } = supabase;
window.supabaseClient = createClient(SUPABASE_URL, SUPABASE_ANON_KEY);