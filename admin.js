// ===== ADMIN PANEL MODULE =====
// Requiere: supabase-config.js y auth.js

let allUsers = [];
let allCourses = [];
let allPurchases = [];
let currentUserId = null;
let userPage = 1;
const USER_PAGE_SIZE = 10;

function escapeHTML(str) {
  if (!str) return '';
  const div = document.createElement('div');
  div.textContent = str;
  return div.innerHTML;
}

// ─── INIT ───
async function initAdmin() {
  const user = await authRequireLogin();
  if (!user) return;

  const sb = getSupabase();
  if (!sb || !isSupabaseConfigured()) { loadDemoData(); return; }

  const profile = await authGetProfile();
  if (!profile || !['admin', 'editor', 'visor'].includes(profile.rol)) {
    window.location.href = 'dashboard.html';
    return;
  }

  window.currentUserRole = profile.rol;
  applyRolePermissions();

  await Promise.all([loadStats(), loadUsers(), loadCourses(), loadPurchases(), loadSuggestions()]);
}

function applyRolePermissions() {
  const role = window.currentUserRole;
  if (role !== 'admin') {
    document.querySelectorAll('.admin-only').forEach(el => el.style.display = 'none');
  } else {
    document.querySelectorAll('.admin-only').forEach(el => el.style.display = '');
  }

  if (role === 'visor') {
    document.querySelectorAll('.not-visor').forEach(el => el.style.display = 'none');
    // Deshabilitar botones dentro de las cards de cursos
    const style = document.createElement('style');
    style.textContent = '.btn-admin:not(.btn-outline) { display: none; } .btn-admin.btn-outline { pointer-events: none; opacity: 0.5; }';
    document.head.appendChild(style);
  }
}

// ─── TAB SWITCHING ───
document.querySelectorAll('.admin-tab').forEach(tab => {
  tab.addEventListener('click', () => {
    document.querySelectorAll('.admin-tab').forEach(t => t.classList.remove('active'));
    document.querySelectorAll('.tab-section').forEach(s => s.classList.remove('active'));
    
    const targetTab = tab.dataset.tab;
    tab.classList.add('active');
    document.getElementById('sec' + capitalize(targetTab)).classList.add('active');

    // Cargar datos según la pestaña
    if (targetTab === 'resumen') loadStats();
    if (targetTab === 'usuarios') loadUsers();
    if (targetTab === 'cursos') loadCourses();
    if (targetTab === 'ventas') loadSales();
    if (targetTab === 'consultas') loadInquiries();
    if (targetTab === 'sugerencias') loadSuggestions();
  });
});

function capitalize(s) { return s.charAt(0).toUpperCase() + s.slice(1); }

function toggleCustomDateFilter() {
  const filter = document.getElementById('statsDateFilter').value;
  const container = document.getElementById('customDateContainer');
  container.style.display = filter === 'custom' ? 'flex' : 'none';
}

// ─── STATS ───
async function loadStats() {
  const sb = getSupabase();
  if (!sb || !isSupabaseConfigured()) { loadDemoData(); return; }

  const filter = document.getElementById('statsDateFilter')?.value || 'all';
  let startDate = null;
  let endDate = null;

  const now = new Date();
  if (filter === 'today') {
    startDate = new Date(now.getFullYear(), now.getMonth(), now.getDate()).toISOString();
  } else if (filter === 'yesterday') {
    const yesterday = new Date(now.getFullYear(), now.getMonth(), now.getDate() - 1);
    startDate = yesterday.toISOString();
    endDate = new Date(now.getFullYear(), now.getMonth(), now.getDate()).toISOString();
  } else if (filter === 'week') {
    startDate = new Date(now.getTime() - 7 * 86400000).toISOString();
  } else if (filter === 'month') {
    startDate = new Date(now.getTime() - 30 * 86400000).toISOString();
  } else if (filter === 'custom') {
    const customStart = document.getElementById('customStartDate').value;
    const customEnd = document.getElementById('customEndDate').value;
    if (customStart) startDate = new Date(customStart + 'T00:00:00').toISOString();
    if (customEnd) endDate = new Date(customEnd + 'T23:59:59').toISOString();
  }

  try {
    let usersQuery = sb.from('profiles').select('*', { count: 'exact', head: true });
    let salesQuery = sb.from('purchases').select('*, courses(titulo, precio_ars)').eq('status', 'approved');

    if (startDate) {
      usersQuery = usersQuery.gte('created_at', startDate);
      salesQuery = salesQuery.gte('created_at', startDate);
    }
    if (endDate) {
      usersQuery = usersQuery.lt('created_at', endDate);
      salesQuery = salesQuery.lt('created_at', endDate);
    }

    const { count: userCount } = await usersQuery;
    const { data: purchases } = await salesQuery;
    
    // El registro de la semana siempre es de los últimos 7 días independientemente del filtro general
    const weekAgo = new Date(Date.now() - 7 * 86400000).toISOString();
    const { count: weekCount } = await sb.from('profiles').select('*', { count: 'exact', head: true }).gte('created_at', weekAgo);

    document.getElementById('statUsuarios').textContent = userCount || 0;
    document.getElementById('statCompras').textContent = purchases?.length || 0;
    const total = purchases?.reduce((sum, p) => sum + (p.courses?.precio_ars || 0), 0) || 0;
    document.getElementById('statRecaudado').textContent = '$' + total.toLocaleString('es-AR');
    document.getElementById('statSemana').textContent = '+' + (weekCount || 0);

    // Course stats table
    const courseMap = {};
    purchases?.forEach(p => {
      const t = p.courses?.titulo || 'Sin título';
      if (!courseMap[t]) courseMap[t] = { ventas: 0, recaudado: 0 };
      courseMap[t].ventas++;
      courseMap[t].recaudado += p.courses?.precio_ars || 0;
    });
    const tbody = document.getElementById('courseStatsBody');
    tbody.innerHTML = Object.entries(courseMap).map(([titulo, d]) =>
      `<tr><td>${titulo}</td><td>${d.ventas}</td><td>$${d.recaudado.toLocaleString('es-AR')}</td><td>${userCount ? Math.round(d.ventas / userCount * 100) : 0}%</td></tr>`
    ).join('') || '<tr><td colspan="4" style="text-align:center;color:var(--sand);padding:24px;">Sin datos</td></tr>';
    renderSalesChart(purchases || []);
  } catch (e) { console.error('Stats error:', e); }
}

let salesChartInstance = null;
function renderSalesChart(purchases) {
  const ctx = document.getElementById('salesChart')?.getContext('2d');
  if (!ctx) return;

  if (salesChartInstance) salesChartInstance.destroy();

  // Agrupar por día (últimos 30 días)
  const last30Days = {};
  const formatDate = (date) => {
    const d = new Date(date);
    return `${String(d.getDate()).padStart(2, '0')}/${String(d.getMonth() + 1).padStart(2, '0')}`;
  };

  for (let i = 29; i >= 0; i--) {
    const d = new Date();
    d.setDate(d.getDate() - i);
    last30Days[formatDate(d)] = 0;
  }

  purchases.forEach(p => {
    const dateKey = formatDate(p.created_at);
    if (last30Days.hasOwnProperty(dateKey)) {
      last30Days[dateKey] += p.courses?.precio_ars || 0;
    }
  });

  const labels = Object.keys(last30Days);
  const data = Object.values(last30Days);

  salesChartInstance = new Chart(ctx, {
    type: 'line',
    data: {
      labels,
      datasets: [{
        label: 'Ventas ($)',
        data,
        borderColor: '#6e5d91',
        backgroundColor: 'rgba(110, 93, 145, 0.1)',
        borderWidth: 3,
        tension: 0.4,
        fill: true,
        pointBackgroundColor: '#6e5d91',
        pointRadius: 4
      }]
    },
    options: {
      responsive: true,
      maintainAspectRatio: false,
      plugins: {
        legend: { display: false }
      },
      scales: {
        y: {
          beginAtZero: true,
          grid: { color: 'rgba(0,0,0,0.05)' },
          ticks: { callback: (value) => '$' + value.toLocaleString() }
        },
        x: {
          grid: { display: false }
        }
      }
    }
  });
}

// ─── USERS ───
async function loadUsers() {
  const sb = getSupabase();
  try {
    const { data } = await sb.from('profiles').select('*').order('created_at', { ascending: false });
    allUsers = data || [];
    renderUsers(allUsers);
    // Populate city filter
    const cities = [...new Set(allUsers.map(u => u.ciudad).filter(Boolean))];
    const sel = document.getElementById('userFilterCity');
    sel.innerHTML = '<option value="">Todas las ciudades</option>' + cities.map(c => `<option value="${c}">${c}</option>`).join('');
  } catch (e) { console.error('Users error:', e); }
}

function renderUsers(users) {
  const tbody = document.getElementById('usersTableBody');
  const pagContainer = document.getElementById('usersPagination');
  
  if (!users.length) {
    tbody.innerHTML = `<tr><td colspan="8" style="text-align:center;padding:48px 24px;color:var(--clay);">
      <div style="font-size:3rem;margin-bottom:12px;opacity:0.3;">👥</div>
      <p style="margin:0;font-weight:600;">No se encontraron usuarios</p>
      <p style="margin:4px 0 0;font-size:0.85rem;opacity:0.7;">Probá ajustando los filtros de búsqueda.</p>
    </td></tr>`;
    pagContainer.innerHTML = '';
    return;
  }

  // Paginación
  const totalPages = Math.ceil(users.length / USER_PAGE_SIZE);
  if (userPage > totalPages) userPage = totalPages || 1;
  const start = (userPage - 1) * USER_PAGE_SIZE;
  const pageUsers = users.slice(start, start + USER_PAGE_SIZE);

  tbody.innerHTML = pageUsers.map(u => `<tr>
    <td><strong>${u.nombre || '—'}</strong></td>
    <td>${u.email || '—'}</td>
    <td>${u.telefono || '—'}</td>
    <td>${u.ciudad || '—'}</td>
    <td>${u.edad_hijos || '—'}</td>
    <td><span class="badge badge-outline" style="font-size:0.7rem; text-transform:capitalize;">${u.como_nos_conocio || '—'}</span></td>
    <td>${u.created_at ? new Date(u.created_at).toLocaleDateString('es-AR') : '—'}</td>
    <td>${u.rol === 'admin' ? '<span class="badge badge-red">Admin</span>' : u.rol === 'editor' ? '<span class="badge badge-green">Editor</span>' : u.rol === 'visor' ? '<span class="badge badge-yellow">Visor</span>' : '<span class="badge badge-blue" style="background:rgba(0,100,255,0.1); color:#0064ff;">User</span>'}</td>
    <td style="text-align:right;">
      <div style="display:flex; justify-content:flex-end; gap:8px; align-items:center;">
        <button class="btn-admin btn-outline btn-sm" onclick="openUserDetail('${u.id}')">Ver</button>
        <div class="dropdown">
          <button class="dots-btn">⋮</button>
          <div class="dropdown-content">
            <button onclick="copyToClipboard('${u.email}')">📋 Copiar Email</button>
            <button class="admin-only" onclick="openUserDetail('${u.id}')">⚖️ Cambiar Rol</button>
            <button class="admin-only" style="color:#c33;" onclick="deleteUserFromList('${u.id}')">🗑 Eliminar</button>
          </div>
        </div>
      </div>
    </td>
  </tr>`).join('');

  // Render pagination
  pagContainer.innerHTML = `
    <button class="page-btn" ${userPage === 1 ? 'disabled' : ''} onclick="changeUserPage(${userPage - 1})">Anterior</button>
    <span class="page-info">Página ${userPage} de ${totalPages}</span>
    <button class="page-btn" ${userPage === totalPages ? 'disabled' : ''} onclick="changeUserPage(${userPage + 1})">Siguiente</button>
  `;
  applyRolePermissions(); // Re-aplicar para los nuevos elementos
}

function changeUserPage(p) {
  userPage = p;
  filterUsers();
}

function copyToClipboard(text) {
  navigator.clipboard.writeText(text);
  showToast('Copiado al portapapeles');
}

async function deleteUserFromList(id) {
  currentUserId = id;
  await deleteUser();
}

function filterUsers() {
  const q = document.getElementById('userSearch').value.toLowerCase();
  const src = document.getElementById('userFilterSource').value;
  const city = document.getElementById('userFilterCity').value;
  let filtered = allUsers;
  if (q) filtered = filtered.filter(u => (u.nombre || '').toLowerCase().includes(q) || (u.email || '').toLowerCase().includes(q));
  if (src) filtered = filtered.filter(u => u.como_nos_conocio === src);
  if (city) filtered = filtered.filter(u => u.ciudad === city);
  renderUsers(filtered);
}

function exportUsersCSV() {
  const headers = ['Nombre', 'Email', 'Teléfono', 'Ciudad', 'Edad hijos', 'Fuente', 'Fecha registro'];
  const rows = allUsers.map(u => [u.nombre, u.email, u.telefono, u.ciudad, u.edad_hijos, u.como_nos_conocio, u.created_at ? new Date(u.created_at).toLocaleDateString('es-AR') : '']);
  const csv = [headers, ...rows].map(r => r.map(v => `"${(v || '').replace(/"/g, '""')}"`).join(',')).join('\n');
  const blob = new Blob(['\uFEFF' + csv], { type: 'text/csv;charset=utf-8;' });
  const a = document.createElement('a'); a.href = URL.createObjectURL(blob);
  a.download = 'usuarios_' + new Date().toISOString().slice(0, 10) + '.csv';
  a.click();
}

// ─── USER DETAIL + NOTES ───
async function openUserDetail(userId) {
  currentUserId = userId;
  const u = allUsers.find(x => x.id === userId);
  if (!u) return;
  document.getElementById('modalUserName').textContent = u.nombre || u.email;
  document.getElementById('modalUserInfo').innerHTML = `
    <div style="display:grid;grid-template-columns:1fr 1fr;gap:12px;font-size:0.9rem;">
      <div><strong>Email:</strong> ${u.email || '—'}</div>
      <div><strong>Teléfono:</strong> ${u.telefono || '—'}</div>
      <div><strong>Ciudad:</strong> ${u.ciudad || '—'}</div>
      <div><strong>Hijos:</strong> ${u.edad_hijos || '—'}</div>
      <div><strong>Fuente:</strong> ${u.como_nos_conocio || '—'}</div>
      <div><strong>Registro:</strong> ${u.created_at ? new Date(u.created_at).toLocaleDateString('es-AR') : '—'}</div>
    </div>`;

  if (window.currentUserRole === 'admin') {
    document.getElementById('roleSelectorGroup').style.display = 'block';
    document.getElementById('modalUserRole').value = u.rol || 'user';
  }

  const coursesContainer = document.getElementById('modalUserCourses');
  coursesContainer.innerHTML = '<p style="color:var(--sand);font-size:0.85rem;">Cargando progresos...</p>';
  
  const sb = getSupabase();
  if (sb && isSupabaseConfigured()) {
    // Buscar compras de este usuario
    const { data: userPurchases } = await sb.from('purchases').select('course_id, courses(id, titulo)').eq('user_id', userId).eq('status', 'approved');
    
    if (!userPurchases || userPurchases.length === 0) {
      coursesContainer.innerHTML = '<p style="color:var(--clay);font-size:0.85rem;">No tiene cursos adquiridos.</p>';
    } else {
      let html = '';
      for (const p of userPurchases) {
        if (!p.courses) continue;
        const cId = p.courses.id;
        const cTitle = p.courses.titulo;
        
        // Cantidad de modulos del curso
        const { count: totalMods } = await sb.from('modules').select('*', { count: 'exact', head: true }).eq('course_id', cId);
        
        // Cuales completó este usuario
        const { data: prog } = await sb.from('user_module_progress').select('module_id, modules!inner(course_id)').eq('user_id', userId).eq('modules.course_id', cId);
        
        const completed = prog ? prog.length : 0;
        const total = totalMods || 0;
        const percent = total > 0 ? Math.round((completed / total) * 100) : 0;
        
        html += `
          <div style="background:var(--white);border:1px solid var(--linen);border-radius:8px;padding:12px 16px;margin-bottom:8px;">
            <div style="display:flex;justify-content:space-between;align-items:center;margin-bottom:8px;">
              <strong style="color:var(--earth);font-size:0.9rem;">${cTitle}</strong>
              <span style="font-size:0.8rem;color:var(--plum);font-weight:600;">${percent}% (${completed}/${total})</span>
            </div>
            <div style="width:100%;background:var(--linen);height:6px;border-radius:3px;overflow:hidden;">
              <div style="width:${percent}%;background:var(--plum);height:100%;transition:width 0.3s ease;"></div>
            </div>
          </div>
        `;
      }
      coursesContainer.innerHTML = html || '<p style="color:var(--clay);font-size:0.85rem;">No tiene cursos adquiridos.</p>';
    }
  } else {
    // Modo Demo
    coursesContainer.innerHTML = `
      <div style="background:var(--white);border:1px solid var(--linen);border-radius:8px;padding:12px 16px;margin-bottom:8px;">
        <div style="display:flex;justify-content:space-between;align-items:center;margin-bottom:8px;">
          <strong style="color:var(--earth);font-size:0.9rem;">Brújula de Crianza (Demo)</strong>
          <span style="font-size:0.8rem;color:var(--plum);font-weight:600;">50% (2/4)</span>
        </div>
        <div style="width:100%;background:var(--linen);height:6px;border-radius:3px;overflow:hidden;">
          <div style="width:50%;background:var(--plum);height:100%;"></div>
        </div>
      </div>`;
  }

  await loadUserNotes(userId);
  document.getElementById('modalUserDetail').classList.add('active');
}

async function loadUserNotes(userId) {
  const container = document.getElementById('modalUserNotes');
  const sb = getSupabase();
  if (!sb || !isSupabaseConfigured()) { container.innerHTML = '<p style="color:var(--sand);font-size:0.85rem;">Modo demo</p>'; return; }
  try {
    const { data } = await sb.from('admin_notes').select('*').eq('user_id', userId).order('created_at', { ascending: false });
    container.innerHTML = (data || []).map(n => `<div class="note-item"><p>${n.nota}</p><div class="note-date">${new Date(n.created_at).toLocaleString('es-AR')} · ${n.autor}</div></div>`).join('') || '<p style="color:var(--sand);font-size:0.85rem;">Sin notas.</p>';
  } catch (e) { container.innerHTML = '<p style="color:var(--sand);">Error cargando notas</p>'; }
}

async function addNote() {
  const input = document.getElementById('newNoteInput');
  const nota = input.value.trim();
  if (!nota || !currentUserId) return;
  const sb = getSupabase();
  if (!sb || !isSupabaseConfigured()) { alert('Supabase no configurado'); return; }
  await sb.from('admin_notes').insert({ user_id: currentUserId, nota });
  input.value = '';
  await loadUserNotes(currentUserId);
}

async function changeUserRole() {
  const newRole = document.getElementById('modalUserRole').value;
  if (!currentUserId || !newRole) return;
  const sb = getSupabase();
  if (!sb || !isSupabaseConfigured()) { alert('Supabase no configurado'); return; }
  
  try {
    const { error } = await sb.from('profiles').update({ rol: newRole }).eq('id', currentUserId);
    if (error) throw error;
    alert('Rol actualizado correctamente');
    // Actualizar localmente
    const u = allUsers.find(x => x.id === currentUserId);
    if (u) u.rol = newRole;
  } catch (e) {
    console.error(e);
    alert('Error al cambiar el rol. Asegurate de tener permisos de administrador.');
  }
}

async function deleteUser() {
  if (window.currentUserRole !== 'admin') {
    showToast('No tenés permisos para eliminar usuarios.', 'error');
    return;
  }
  if (!confirm('ATENCIÓN: ¿Estás segura de que querés eliminar a este usuario permanentemente? Esto no se puede deshacer.')) return;
  
  const sb = getSupabase();
  if (!sb || !isSupabaseConfigured()) {
    // Demo Mode
    allUsers = allUsers.filter(u => u.id !== currentUserId);
    renderUsers(allUsers);
    closeModal('modalUserDetail');
    showToast('Usuario eliminado (Modo Demo)');
    return;
  }
  
  // En producción, esto debería llamar a una Edge Function para eliminar de auth.users,
  // pero para fines prácticos podemos eliminar de profiles (que por cascade borra otras cosas,
  // aunque la cuenta de auth seguiría viva sin perfil).
  showToast('Esta función requiere conexión con Supabase Admin API. Por ahora está desactivada por seguridad.', 'info');
}

// ─── CREAR NUEVO USUARIO ───
function openCreateUserModal() {
  document.getElementById('newUserNombre').value = '';
  document.getElementById('newUserEmail').value = '';
  document.getElementById('newUserPassword').value = '';
  document.getElementById('newUserRole').value = 'user';
  document.getElementById('modalCreateUser').classList.add('active');
}

async function submitCreateUser() {
  const nombre = document.getElementById('newUserNombre').value.trim();
  const email = document.getElementById('newUserEmail').value.trim();
  const password = document.getElementById('newUserPassword').value;
  const rol = document.getElementById('newUserRole').value;

  if (!nombre || !email || !password) {
    showToast('Por favor, completá todos los campos.', 'error');
    return;
  }
  if (password.length < 6) {
    showToast('La contraseña debe tener al menos 6 caracteres.', 'error');
    return;
  }

  const btn = document.getElementById('btnSubmitCreateUser');
  btn.textContent = 'Creando...';
  btn.disabled = true;

  const sb = getSupabase();
  if (!sb || !isSupabaseConfigured()) {
    // Modo Demo
    setTimeout(() => {
      allUsers.unshift({
        id: 'demo_' + Date.now(),
        nombre,
        email,
        rol,
        telefono: '—',
        ciudad: '—',
        edad_hijos: '—',
        como_nos_conocio: '—',
        created_at: new Date().toISOString()
      });
      renderUsers(allUsers);
      closeModal('modalCreateUser');
      showToast(`[Demo] Usuario ${nombre} creado con rol ${rol}.`);
      btn.textContent = 'Crear Usuario';
      btn.disabled = false;
    }, 1000);
    return;
  }

  try {
    const { data, error } = await sb.functions.invoke('admin-create-user', {
      body: { nombre, email, password, rol }
    });

    if (error) throw error;
    
    showToast('Usuario creado correctamente.');
    closeModal('modalCreateUser');
    await loadUsers(); // Refrescar lista

  } catch (err) {
    console.error('Error al crear usuario:', err);
    showToast('Hubo un problema al crear el usuario. ' + (err.message || ''), 'error');
  } finally {
    btn.textContent = 'Crear Usuario';
    btn.disabled = false;
  }
}

// ─── COURSES ───
async function loadCourses() {
  const sb = getSupabase();
  try {
    const { data } = await sb.from('courses').select('*, modules(*)').order('id');
    allCourses = data || [];
    renderCourses(allCourses);
    // Populate dropdowns
    const sel1 = document.getElementById('salesFilterCourse');
    const sel2 = document.getElementById('grantCourseSelect');
    const opts = allCourses.map(c => `<option value="${c.id}">${c.titulo}</option>`).join('');
    sel1.innerHTML = '<option value="">Todos los cursos</option>' + opts;
    sel2.innerHTML = '<option value="">Seleccionar curso...</option>' + opts;
  } catch (e) { console.error('Courses error:', e); }
}

function renderCourses(courses) {
  const container = document.getElementById('coursesListContainer');
  if (!courses.length) {
    container.innerHTML = `
      <div style="text-align:center;padding:60px 24px;color:var(--clay);background:var(--white);border:1px solid var(--linen);border-radius:12px;">
        <div style="font-size:3rem;margin-bottom:12px;opacity:0.3;">📚</div>
        <p style="margin:0;font-weight:600;">Todavía no creaste ningún curso</p>
        <p style="margin:8px 0 20px;font-size:0.85rem;opacity:0.7;">Comenzá creando tu primer programa para tus alumnos.</p>
        <button class="btn-admin btn-sage" onclick="openCourseModal()">+ Nuevo Curso</button>
      </div>`;
    return;
  }
  container.innerHTML = courses.map(c => `
    <div class="email-config-card">
      <div style="display:flex;justify-content:space-between;align-items:flex-start;">
        <div>
          <h3>${c.titulo} ${c.activo ? '<span class="badge badge-green">Activo</span>' : '<span class="badge badge-red">Inactivo</span>'}</h3>
          <p style="color:var(--clay);font-size:0.9rem;margin:4px 0;">${c.descripcion || ''}</p>
          <p style="font-size:0.85rem;color:var(--sand);">Precio: <strong>$${(c.precio_ars || 0).toLocaleString('es-AR')}</strong> · ${(c.modules || []).length} módulos</p>
        </div>
        <div style="display:flex;gap:8px;">
          <button class="btn-admin btn-outline btn-sm" onclick="openCourseModal(${c.id})">✏️ Editar</button>
          <button class="btn-admin btn-danger btn-sm" onclick="deleteCourse(${c.id})">🗑</button>
        </div>
      </div>
      ${(c.modules || []).length ? '<div style="margin-top:12px;padding-top:12px;border-top:1px solid var(--linen);">' + c.modules.sort((a,b) => a.orden - b.orden).map((m, i) => `<div style="display:flex;align-items:center;gap:8px;padding:4px 0;font-size:0.85rem;color:var(--earth);"><span style="width:22px;height:22px;background:var(--linen);border-radius:50%;display:flex;align-items:center;justify-content:center;font-size:0.7rem;font-weight:700;">${i+1}</span>${m.titulo}${m.vimeo_video_id ? ' <span style="color:var(--sage);font-size:0.75rem;">✓ Vimeo</span>' : ' <span style="color:var(--sand);font-size:0.75rem;">sin video</span>'}</div>`).join('') + '</div>' : ''}
    </div>`).join('');
}

function openCourseModal(courseId) {
  const modal = document.getElementById('modalCourse');
  const title = document.getElementById('modalCourseTitle');
  document.getElementById('courseEditId').value = courseId || '';
  if (courseId) {
    const c = allCourses.find(x => x.id === courseId);
    if (!c) return;
    title.textContent = 'Editar curso';
    document.getElementById('courseTitulo').value = c.titulo;
    document.getElementById('courseDescripcion').value = c.descripcion || '';
    document.getElementById('coursePrecio').value = c.precio_ars;
    document.getElementById('courseActivo').value = String(c.activo);
    document.getElementById('courseImagenUrl').value = c.imagen_url || '';
    renderModuleRows(c.modules || []);
  } else {
    title.textContent = 'Nuevo curso';
    document.getElementById('courseTitulo').value = '';
    document.getElementById('courseDescripcion').value = '';
    document.getElementById('coursePrecio').value = '';
    document.getElementById('courseActivo').value = 'true';
    document.getElementById('courseImagenUrl').value = '';
    document.getElementById('courseModulesList').innerHTML = '';
  }
  modal.classList.add('active');
}

function renderModuleRows(modules) {
  const container = document.getElementById('courseModulesList');
  container.innerHTML = modules.sort((a, b) => a.orden - b.orden).map((m, i) => `
    <div style="display:flex;gap:8px;margin-bottom:8px;align-items:center;" data-module-id="${m.id}">
      <span style="font-weight:700;color:var(--sand);width:20px;">${i + 1}</span>
      <input type="text" value="${m.titulo}" placeholder="Título del módulo" style="flex:1;padding:8px 12px;border:1px solid var(--linen);border-radius:6px;font-family:'DM Sans',sans-serif;font-size:0.85rem;">
      <input type="text" value="${m.vimeo_video_id || ''}" placeholder="ID Vimeo" style="width:120px;padding:8px 12px;border:1px solid var(--linen);border-radius:6px;font-family:'DM Sans',sans-serif;font-size:0.85rem;">
      <button class="btn-admin btn-danger btn-sm" onclick="this.parentElement.remove()">✕</button>
    </div>`).join('');
}

function addModuleRow() {
  const container = document.getElementById('courseModulesList');
  const count = container.children.length + 1;
  const row = document.createElement('div');
  row.style.cssText = 'display:flex;gap:8px;margin-bottom:8px;align-items:center;';
  row.innerHTML = `<span style="font-weight:700;color:var(--sand);width:20px;">${count}</span>
    <input type="text" placeholder="Título del módulo" style="flex:1;padding:8px 12px;border:1px solid var(--linen);border-radius:6px;font-family:'DM Sans',sans-serif;font-size:0.85rem;">
    <input type="text" placeholder="ID Vimeo" style="width:120px;padding:8px 12px;border:1px solid var(--linen);border-radius:6px;font-family:'DM Sans',sans-serif;font-size:0.85rem;">
    <button class="btn-admin btn-danger btn-sm" onclick="this.parentElement.remove()">✕</button>`;
  container.appendChild(row);
}

async function saveCourse() {
  const sb = getSupabase();
  if (!sb || !isSupabaseConfigured()) { showToast('Supabase no configurado', 'error'); return; }
  const id = document.getElementById('courseEditId').value;
  const courseData = {
    titulo: document.getElementById('courseTitulo').value.trim(),
    descripcion: document.getElementById('courseDescripcion').value.trim(),
    precio_ars: parseInt(document.getElementById('coursePrecio').value) || 0,
    activo: document.getElementById('courseActivo').value === 'true',
    imagen_url: document.getElementById('courseImagenUrl').value.trim()
  };
  if (!courseData.titulo) { showToast('El título es obligatorio', 'error'); return; }

  try {
    let courseId;
    if (id) {
      await sb.from('courses').update(courseData).eq('id', id);
      courseId = parseInt(id);
      await sb.from('modules').delete().eq('course_id', courseId);
    } else {
      const { data } = await sb.from('courses').insert(courseData).select().single();
      courseId = data.id;
    }
    // Save modules
    const rows = document.getElementById('courseModulesList').children;
    const modules = [];
    for (let i = 0; i < rows.length; i++) {
      const inputs = rows[i].querySelectorAll('input');
      const titulo = inputs[0]?.value.trim();
      if (titulo) modules.push({ course_id: courseId, titulo, vimeo_video_id: inputs[1]?.value.trim() || null, orden: i + 1 });
    }
    if (modules.length) await sb.from('modules').insert(modules);

    closeModal('modalCourse');
    await loadCourses();
    showToast('Curso guardado correctamente');
  } catch (e) { console.error('Save course error:', e); showToast('Error al guardar', 'error'); }
}

async function deleteCourse(id) {
  if (!confirm('¿Estás seguro de eliminar este curso y todos sus módulos?')) return;
  const sb = getSupabase();
  if (!sb) return;
  await sb.from('courses').delete().eq('id', id);
  await loadCourses();
}

// ─── SALES ───
async function loadPurchases() {
  const sb = getSupabase();
  try {
    const { data } = await sb.from('purchases').select('*, profiles(nombre, email), courses(titulo, precio_ars)').order('created_at', { ascending: false });
    allPurchases = data || [];
    renderSales(allPurchases);
    // Populate grant access user dropdown
    const sel = document.getElementById('grantUserSelect');
    sel.innerHTML = '<option value="">Seleccionar usuario...</option>' + allUsers.map(u => `<option value="${u.id}">${u.nombre || u.email}</option>`).join('');
  } catch (e) { console.error('Purchases error:', e); }
}

function renderSales(sales) {
  const tbody = document.getElementById('salesTableBody');
  if (!sales.length) {
    tbody.innerHTML = `<tr><td colspan="5" style="text-align:center;padding:48px 24px;color:var(--clay);">
      <div style="font-size:3rem;margin-bottom:12px;opacity:0.3;">💰</div>
      <p style="margin:0;font-weight:600;">No hay ventas registradas</p>
      <p style="margin:4px 0 0;font-size:0.85rem;opacity:0.7;">Cuando realices ventas, aparecerán detalladas aquí.</p>
    </td></tr>`;
    return;
  }
  const statusBadge = s => s === 'approved' ? '<span class="badge badge-green">Aprobado</span>' : s === 'pending' ? '<span class="badge badge-yellow">Pendiente</span>' : '<span class="badge badge-red">Rechazado</span>';
  tbody.innerHTML = sales.map(p => `<tr>
    <td>${p.profiles?.nombre || p.profiles?.email || '—'}</td>
    <td>${p.courses?.titulo || '—'}</td>
    <td>${statusBadge(p.status)}</td>
    <td style="font-size:0.8rem;">${p.mp_payment_id || 'Manual'}</td>
    <td>${p.created_at ? new Date(p.created_at).toLocaleDateString('es-AR') : '—'}</td>
  </tr>`).join('');
}

function filterSales() {
  const course = document.getElementById('salesFilterCourse').value;
  const status = document.getElementById('salesFilterStatus').value;
  let filtered = allPurchases;
  if (course) filtered = filtered.filter(p => p.course_id == course);
  if (status) filtered = filtered.filter(p => p.status === status);
  renderSales(filtered);
}

function openGrantAccessModal() { document.getElementById('modalGrantAccess').classList.add('active'); }

async function grantAccess() {
  const userId = document.getElementById('grantUserSelect').value;
  const courseId = document.getElementById('grantCourseSelect').value;
  if (!userId || !courseId) { showToast('Seleccioná un usuario y un curso', 'error'); return; }
  const sb = getSupabase();
  if (!sb) return;
  try {
    await sb.from('purchases').upsert({ user_id: userId, course_id: parseInt(courseId), status: 'approved', mp_payment_id: 'manual_' + Date.now() }, { onConflict: 'user_id,course_id' });
    showToast('Acceso otorgado correctamente');
    closeModal('modalGrantAccess');
    await loadPurchases();
  } catch (e) { console.error(e); showToast('Error al otorgar acceso', 'error'); }
}

// ─── SUGGESTIONS ───
async function loadSuggestions() {
  const sb = getSupabase();
  if (!sb || !isSupabaseConfigured()) { renderDemoSuggestions(); return; }
  try {
    const { data } = await sb.from('suggestions').select('*, profiles(nombre, email)').order('created_at', { ascending: false });
    const container = document.getElementById('suggestionsContainer');
    if (!data?.length) {
      container.innerHTML = `
        <div style="text-align:center;padding:40px 24px;color:var(--clay);opacity:0.6;">
          <div style="font-size:2.5rem;margin-bottom:8px;">💡</div>
          <p style="margin:0;font-size:0.9rem;">No hay sugerencias nuevas.</p>
        </div>`;
      return;
    }
    container.innerHTML = data.map(s => `
      <div class="note-item" style="${s.leida ? '' : 'border-left:3px solid var(--plum);'}">
        <div style="display:flex;justify-content:space-between;align-items:center;">
          <strong style="font-size:0.9rem;">${escapeHTML(s.profiles?.nombre || s.profiles?.email || 'Usuario')}</strong>
          ${!s.leida ? `<button class="btn-admin btn-outline btn-sm" onclick="markSuggestionRead(${s.id})">Marcar leída</button>` : '<span class="badge badge-green">Leída</span>'}
        </div>
        <p style="margin:8px 0 4px;color:var(--earth);">${escapeHTML(s.contenido)}</p>
        <div class="note-date">${new Date(s.created_at).toLocaleString('es-AR')}</div>
      </div>`).join('');
  } catch (e) { console.error(e); }
}

async function loadInquiries() {
  const sb = getSupabase();
  if (!sb || !isSupabaseConfigured()) { renderDemoInquiries(); return; }
  try {
    const { data } = await sb.from('contact_inquiries').select('*').order('created_at', { ascending: false });
    const container = document.getElementById('inquiriesContainer');
    if (!data?.length) {
      container.innerHTML = `<p style="text-align:center;padding:40px;color:var(--clay);">No hay consultas todavía.</p>`;
      return;
    }
    container.innerHTML = data.map(i => `
      <div class="note-item">
        <div style="display:flex;justify-content:space-between;">
          <strong>${escapeHTML(i.nombre)}</strong>
          <span class="badge badge-green">${escapeHTML(i.motivo || 'General')}</span>
        </div>
        <div style="font-size:0.85rem;color:var(--clay);margin:4px 0;">
          📧 ${escapeHTML(i.email)} | 📱 ${escapeHTML(i.telefono || 'Sin teléfono')}
        </div>
        <p style="margin:8px 0;color:var(--earth);">${escapeHTML(i.mensaje) || '<em>Sin mensaje</em>'}</p>
        <div class="note-date">${new Date(i.created_at).toLocaleString('es-AR')}</div>
      </div>`).join('');
  } catch (e) { console.error(e); }
}

function renderDemoInquiries() {
  const container = document.getElementById('inquiriesContainer');
  if (!container) return;
  container.innerHTML = `
    <div class="note-item">
      <div style="display:flex;justify-content:space-between;">
        <strong>Laura Estévez (Demo)</strong>
        <span class="badge badge-green">Orientación 1:1</span>
      </div>
      <div style="font-size:0.85rem;color:var(--clay);margin:4px 0;">📧 laura@ejemplo.com | 📱 +54 9 11 0000-0000</div>
      <p style="margin:8px 0;color:var(--earth);">Hola Denise, me gustaría saber si atendés por la tarde.</p>
      <div class="note-date">${new Date().toLocaleString('es-AR')}</div>
    </div>`;
}

function renderDemoSuggestions() {
  const container = document.getElementById('suggestionsContainer');
  if (!container) return;
  const demoData = [
    { id: 1, contenido: 'Me encantaría que el curso de Berrinches tuviera más ejercicios prácticos para descargar.', profiles: { nombre: 'María López' }, leida: false, created_at: new Date().toISOString() },
    { id: 2, contenido: 'La plataforma se ve increíble, Denise. ¡Gracias por tanto material!', profiles: { nombre: 'Lucía García' }, leida: true, created_at: new Date(Date.now() - 86400000).toISOString() },
    { id: 3, contenido: '¿Van a subir contenido sobre adolescentes pronto?', profiles: { nombre: 'Carla Méndez' }, leida: false, created_at: new Date(Date.now() - 172800000).toISOString() }
  ];
  
  container.innerHTML = demoData.map(s => `
    <div class="note-item" style="${s.leida ? '' : 'border-left:3px solid var(--plum);'}">
      <div style="display:flex;justify-content:space-between;align-items:center;">
        <strong style="font-size:0.9rem;">${s.profiles?.nombre} (Demo)</strong>
        ${!s.leida ? `<button class="btn-admin btn-outline btn-sm" onclick="showToast('Modo Demo: No se puede marcar como leída')">Marcar leída</button>` : '<span class="badge badge-green">Leída</span>'}
      </div>
      <p style="margin:8px 0 4px;color:var(--earth);">${s.contenido}</p>
      <div class="note-date">${new Date(s.created_at).toLocaleString('es-AR')}</div>
    </div>`).join('');
}

function handleLogout() {
  authSignOut();
}

async function markSuggestionRead(id) {
  const sb = getSupabase();
  await sb.from('suggestions').update({ leida: true }).eq('id', id);
  await loadSuggestions();
}

// ─── EMAILS ───
function saveEmailConfig() {
  const domain = document.getElementById('emailDomain').value;
  const name = document.getElementById('emailSenderName').value;
  localStorage.setItem('emailConfig', JSON.stringify({ domain, name }));
  showToast('Configuración guardada localmente.');
}

async function sendMassEmail() {
  const to = document.getElementById('emailTo').value;
  const subject = document.getElementById('emailSubject').value.trim();
  const body = document.getElementById('emailBody').value.trim();
  const domain = document.getElementById('emailDomain').value.trim();
  const senderName = document.getElementById('emailSenderName').value.trim();

  if (!domain) {
    showToast('Por favor configurá primero tu dominio de envío en la sección superior.', 'error');
    return;
  }
  if (!subject || !body) { 
    showToast('Completá el asunto y el mensaje', 'error'); 
    return; 
  }

  // Solo por si estamos en modo demo
  const sb = getSupabase();
  if (!sb || !isSupabaseConfigured()) {
    showToast('Modo Demo: El envío de correos no está disponible sin conexión a la base de datos.', 'info');
    return;
  }

  const btn = document.querySelector('button[onclick="sendMassEmail()"]');
  const originalText = btn.innerHTML;
  btn.innerHTML = '⏳ Enviando...';
  btn.disabled = true;

  // Envolver el mensaje en una estructura HTML premium
  const htmlTemplate = `
    <div style="font-family:'DM Sans',Arial,sans-serif; background-color:#faf8f5; padding:40px 20px; color:#593b1f;">
      <div style="max-width:600px; margin:0 auto; background-color:#ffffff; border-radius:12px; overflow:hidden; box-shadow:0 4px 20px rgba(89,59,31,0.08);">
        <div style="background-color:#53583e; padding:30px; text-align:center;">
          <h1 style="color:#ede1d2; font-family:'Playfair Display',serif; font-size:22px; margin:0;">Denise Venica</h1>
        </div>
        <div style="padding:40px 30px; line-height:1.8;">
          <h2 style="color:#6e5d91; font-family:'Playfair Display',serif; font-size:18px; margin-top:0;">Hola {nombre},</h2>
          ${body.replace(/\n/g, '<br>')}
          <div style="margin-top:30px; font-style:italic; color:#6e5d91;">
            <p>Siempre es con amor,<br>Deni.</p>
          </div>
        </div>
        <div style="background-color:#d8dad3; padding:20px; text-align:center; font-size:12px; color:#806044;">
          <p>© 2026 Denise Venica · Psicología y Crianza</p>
        </div>
      </div>
    </div>
  `;

  try {
    const { data, error } = await sb.functions.invoke('send-mass-email', {
      body: { 
        subject, 
        htmlBody: htmlTemplate, 
        toType: to, 
        senderDomain: domain, 
        senderName 
      }
    });

    if (error) {
      // Intentar leer si es el error específico de configuración que enviamos desde el backend
      if (error.message && error.message.includes('CONFIG_MISSING')) {
         showToast('El sistema de correos aún no está configurado (Falta conectar con Resend.com).', 'error');
      } else {
         throw error;
      }
      return;
    }

    if (data && data.error === 'CONFIG_MISSING') {
      showToast('El sistema de correos aún no está configurado (Falta conectar con Resend.com).', 'error');
      return;
    }

    showToast(`¡Correos enviados exitosamente a ${data?.count || 0} usuarios!`);
    document.getElementById('emailSubject').value = '';
    document.getElementById('emailBody').value = '';

  } catch (err) {
    console.error(err);
    showToast('Error al intentar enviar los correos. ' + (err.message || ''), 'error');
  } finally {
    btn.innerHTML = originalText;
    btn.disabled = false;
  }
}

function previewEmail() {
  const subject = document.getElementById('emailSubject').value || '(sin asunto)';
  const body = document.getElementById('emailBody').value || '(sin contenido)';
  const preview = body.replace(/{nombre}/g, 'María');
  alert(`Vista previa del email:\n\nAsunto: ${subject}\n\n${preview}`);
}

// ─── MODAL HELPERS ───
function closeModal(id) { document.getElementById(id).classList.remove('active'); }
document.querySelectorAll('.modal-overlay').forEach(m => {
  m.addEventListener('click', e => { if (e.target === m) m.classList.remove('active'); });
});

// ─── CERRAR SESIÓN ───
function handleLogout() {
  authSignOut();
}

// ─── DEMO DATA ───
function loadDemoData() {
  window.currentUserRole = 'admin';
  applyRolePermissions();

  const filter = document.getElementById('statsDateFilter')?.value || 'all';
  let usrCount = '47';
  let salesCount = '12';
  let totalRecaudado = '$420.000';
  let statsHTML = '<tr><td>Brújula de Crianza</td><td>7</td><td>$245.000</td><td>15%</td></tr><tr><td>Workshop: Tu niña interior</td><td>3</td><td>$105.000</td><td>6%</td></tr><tr><td>Guía de Berrinches</td><td>2</td><td>$30.000</td><td>4%</td></tr>';

  if (filter === 'today') {
    usrCount = '2'; salesCount = '0'; totalRecaudado = '$0';
    statsHTML = '<tr><td colspan="4" style="text-align:center;color:var(--sand);padding:24px;">Sin datos hoy</td></tr>';
  } else if (filter === 'yesterday') {
    usrCount = '4'; salesCount = '1'; totalRecaudado = '$35.000';
    statsHTML = '<tr><td>Brújula de Crianza</td><td>1</td><td>$35.000</td><td>25%</td></tr>';
  } else if (filter === 'week') {
    usrCount = '15'; salesCount = '3'; totalRecaudado = '$105.000';
    statsHTML = '<tr><td>Brújula de Crianza</td><td>2</td><td>$70.000</td><td>13%</td></tr><tr><td>Workshop: Tu niña interior</td><td>1</td><td>$35.000</td><td>6%</td></tr>';
  } else if (filter === 'custom') {
    usrCount = '8'; salesCount = '2'; totalRecaudado = '$70.000';
    statsHTML = '<tr><td>Brújula de Crianza</td><td>2</td><td>$70.000</td><td>25%</td></tr>';
  }

  document.getElementById('statUsuarios').textContent = usrCount;
  document.getElementById('statCompras').textContent = salesCount;
  document.getElementById('statRecaudado').textContent = totalRecaudado;
  document.getElementById('statSemana').textContent = '+8';
  document.getElementById('courseStatsBody').innerHTML = statsHTML;

  // Solo inicializar listas de demo la primera vez
  if (allUsers.length === 0) {
    allUsers = [
      { id: '1', nombre: 'María López', email: 'maria@test.com', telefono: '+54 9 11 1234-5678', ciudad: 'Buenos Aires', edad_hijos: '3 y 5 años', como_nos_conocio: 'instagram', rol: 'user', created_at: new Date().toISOString() },
      { id: '2', nombre: 'Lucía García', email: 'lucia@test.com', telefono: '+54 9 341 555-1234', ciudad: 'Rosario', edad_hijos: '1 año', como_nos_conocio: 'google', rol: 'visor', created_at: new Date().toISOString() },
      { id: '3', nombre: 'Carla Méndez', email: 'carla@test.com', telefono: '+54 9 11 9999-0000', ciudad: 'Córdoba', edad_hijos: '2 años', como_nos_conocio: 'instagram', rol: 'user', created_at: new Date().toISOString() },
      { id: '4', nombre: 'Jimena Paz', email: 'jimena@test.com', telefono: '+54 9 11 1111-2222', ciudad: 'Mendoza', edad_hijos: '4 años', como_nos_conocio: 'google', rol: 'user', created_at: new Date().toISOString() },
      { id: '5', nombre: 'Ana Rosa', email: 'ana@test.com', telefono: '+54 9 11 3333-4444', ciudad: 'Buenos Aires', edad_hijos: '—', como_nos_conocio: 'referido', rol: 'editor', created_at: new Date().toISOString() }
    ];
    // Generar más para probar paginación
    for (let i = 6; i <= 25; i++) {
      allUsers.push({ id: String(i), nombre: 'Usuario Demo ' + i, email: `demo${i}@test.com`, rol: 'user', created_at: new Date().toISOString() });
    }
    renderUsers(allUsers);
    allCourses = [
      { id: 1, titulo: 'Brújula de Crianza', descripcion: 'Programa de 4 módulos...', precio_ars: 35000, activo: true, modules: [{ id: 1, titulo: 'Introducción', vimeo_video_id: null, orden: 1 }] },
      { id: 2, titulo: 'Workshop: Tu niña interior', descripcion: 'Autoconocimiento...', precio_ars: 35000, activo: true, modules: [] },
      { id: 3, titulo: 'Guía de Berrinches', descripcion: 'Herramientas prácticas...', precio_ars: 15000, activo: true, modules: [] }
    ];
    renderCourses(allCourses);
    allPurchases = [{ profiles: { nombre: 'María López' }, courses: { titulo: 'Brújula de Crianza' }, status: 'approved', mp_payment_id: 'MP123456', created_at: new Date().toISOString() }];
    renderSales(allPurchases);
  }

  // Generar datos ficticios para el gráfico en modo demo
  const demoChartData = [];
  const now = new Date();
  for (let i = 0; i < 30; i++) {
    const d = new Date();
    d.setDate(now.getDate() - i);
    // Simular picos de ventas los fines de semana
    const day = d.getDay();
    const count = (day === 0 || day === 6) ? 3 : Math.random() > 0.7 ? 1 : 0;
    for (let j = 0; j < count; j++) {
      demoChartData.push({
        created_at: d.toISOString(),
        courses: { precio_ars: Math.random() > 0.5 ? 35000 : 15000 }
      });
    }
  }
  renderSalesChart(demoChartData);
  renderDemoSuggestions();
}

// ─── START ───
document.addEventListener('DOMContentLoaded', initAdmin);
