// ===== SUPABASE CLIENT CONFIGURATION =====
// Documentación: https://supabase.com/docs/reference/javascript/initializing
//
// INSTRUCCIONES:
// 1. Crear un proyecto en https://app.supabase.com
// 2. Ir a Settings → API
// 3. Copiar la "Project URL" y la "anon public" key
// 4. Reemplazar los valores de abajo

// Las credenciales se leen desde config.js
const SUPABASE_URL = (typeof SUPABASE_CONFIG !== 'undefined') ? SUPABASE_CONFIG.url : '';
const SUPABASE_ANON_KEY = (typeof SUPABASE_CONFIG !== 'undefined') ? SUPABASE_CONFIG.anonKey : '';

// Importar el cliente de Supabase desde CDN
// Se carga en index.html/login.html/dashboard.html via <script> tag
// <script src="https://cdn.jsdelivr.net/npm/@supabase/supabase-js@2"></script>

let _supabaseClient = null;

function getSupabase() {
  if (!_supabaseClient) {
    if (typeof supabase === 'undefined' || !supabase.createClient) {
      console.error('Supabase JS SDK no está cargado. Asegurate de incluir el <script> del CDN antes de este archivo.');
      return null;
    }
    _supabaseClient = supabase.createClient(SUPABASE_URL, SUPABASE_ANON_KEY);
  }
  return _supabaseClient;
}

// Verificar si las credenciales están configuradas (no son placeholder)
function isSupabaseConfigured() {
  const isDefaultUrl = SUPABASE_URL.includes('TU-PROYECTO') || SUPABASE_URL === '';
  const isDefaultKey = SUPABASE_ANON_KEY.includes('TU-ANON-KEY') || SUPABASE_ANON_KEY === '';
  
  const configured = !isDefaultUrl && !isDefaultKey;
  console.log('Supabase configurado:', configured ? 'SÍ' : 'NO (Modo Demo Activo)');
  return configured;
}
