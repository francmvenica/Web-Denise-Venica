// ===== AUTHENTICATION MODULE =====
// Requiere: supabase-config.js cargado previamente

// ─── REGISTRO ───
async function authSignUp(email, password, profileData) {
  const sb = getSupabase();
  if (!isSupabaseConfigured()) {
    // Modo Demo: Guardar en localStorage
    const user = { id: 'demo-uuid', email: email, user_metadata: { nombre: profileData.nombre } };
    localStorage.setItem('demo_session', JSON.stringify(user));
    return { data: { user }, error: null };
  }

  const { data, error } = await sb.auth.signUp({
    email: email,
    password: password,
    options: {
      data: { 
        nombre: profileData.nombre,
        telefono: profileData.telefono,
        ciudad: profileData.ciudad,
        edad_hijos: profileData.edad_hijos,
        como_nos_conocio: profileData.como_nos_conocio
      }
    }
  });

  if (error) return { data: null, error };

  // Si el registro fue exitoso, crear perfil con todos los datos de marketing
  if (data.user) {
    await sb.from('profiles').upsert({
      id: data.user.id,
      nombre: profileData.nombre,
      email: email,
      telefono: profileData.telefono || null,
      ciudad: profileData.ciudad || null,
      edad_hijos: profileData.edad_hijos || null,
      como_nos_conocio: profileData.como_nos_conocio || null,
    });
  }

  return { data, error: null };
}

// ─── LOGIN ───
async function authSignIn(email, password) {
  const sb = getSupabase();
  if (!isSupabaseConfigured()) {
    console.log('Login: Usando Modo Demo');
    // Modo Demo: Simular login exitoso
    const user = { id: 'demo-uuid', email: email, user_metadata: { nombre: 'Usuario Demo' } };
    localStorage.setItem('demo_session', JSON.stringify(user));
    return { data: { user }, error: null };
  }

  console.log('Login: Intentando conexión real con Supabase');
  const { data, error } = await sb.auth.signInWithPassword({
    email: email,
    password: password
  });

  return { data, error };
}

// ─── LOGOUT ───
async function authSignOut() {
  const sb = getSupabase();
  if (!isSupabaseConfigured()) {
    localStorage.removeItem('demo_session');
    window.location.href = 'login.html';
    return;
  }

  await sb.auth.signOut();
  window.location.href = 'login.html';
}

// ─── OBTENER USUARIO ACTUAL ───
async function authGetUser() {
  const sb = getSupabase();
  if (!isSupabaseConfigured()) {
    const session = localStorage.getItem('demo_session');
    return session ? JSON.parse(session) : null;
  }

  const { data: { user } } = await sb.auth.getUser();
  return user;
}

// ─── OBTENER PERFIL DEL USUARIO ───
async function authGetProfile() {
  const sb = getSupabase();
  if (!isSupabaseConfigured()) {
    const user = await authGetUser();
    if (!user) return null;
    return { 
      id: user.id, 
      nombre: user.user_metadata?.nombre || 'Usuario Demo', 
      email: user.email,
      rol: 'admin' // Por defecto en demo somos admin
    };
  }

  const user = await authGetUser();
  if (!user) return null;

  const { data } = await sb
    .from('profiles')
    .select('*')
    .eq('id', user.id)
    .single();

  return data;
}

// ─── PROTECCIÓN DE RUTA ───
// Llamar al inicio de páginas protegidas (dashboard, curso)
// Redirige a login si no hay sesión activa
async function authRequireLogin() {
  const user = await authGetUser();
  if (!user) {
    window.location.href = 'login.html';
    return null;
  }
  return user;
}

// ─── REDIRIGIR SI YA ESTÁ LOGUEADO ───
// Llamar en login.html para redirigir al dashboard si ya tiene sesión
async function authRedirectIfLoggedIn() {
  const user = await authGetUser();
  if (user) {
    window.location.href = 'dashboard.html';
    return true;
  }
  return false;
}

// ─── LISTENER DE CAMBIOS DE SESIÓN ───
function authOnStateChange(callback) {
  const sb = getSupabase();
  if (!sb || !isSupabaseConfigured()) return;

  sb.auth.onAuthStateChange((event, session) => {
    callback(event, session);
  });
}
