// ===== DASHBOARD MODULE =====
// Requiere: supabase-config.js y auth.js cargados previamente

// ─── INICIALIZACIÓN ───
async function initDashboard() {
  const user = await authRequireLogin();
  if (!user) return;

  const profile = await authGetProfile();
  const nameEl = document.getElementById('userName');
  const greetingEl = document.getElementById('welcomeGreeting');

  if (profile) {
    const displayName = profile.nombre || user.email.split('@')[0];
    if (nameEl) nameEl.textContent = displayName;
    if (greetingEl) greetingEl.textContent = `¡Hola, ${displayName.split(' ')[0]}!`;
  }

  await loadCourses(user.id, profile);

  if (profile && ['admin', 'editor', 'visor'].includes(profile.rol)) {
    const navRight = document.querySelector('.user-menu');
    if (navRight) {
      const adminBtn = document.createElement('a');
      adminBtn.href = 'admin.html';
      adminBtn.innerHTML = '⚙️ Admin';
      adminBtn.style.cssText = 'color:var(--plum); font-weight:600; text-decoration:none; font-size:0.85rem; border:1px solid var(--linen); padding:4px 10px; border-radius:4px;';
      navRight.insertBefore(adminBtn, navRight.firstChild);
    }
  }
}

async function loadCourses(userId, profile) {
  const sb = getSupabase();
  if (!isSupabaseConfigured()) { renderDemoCourses(); return; }

  try {
    const { data: courses } = await sb.from('courses').select('*, modules(*)').eq('activo', true).order('id');
    const { data: purchases } = await sb.from('purchases').select('course_id').eq('user_id', userId).eq('status', 'approved');
    const { data: progress } = await sb.from('user_module_progress').select('module_id').eq('user_id', userId);
    
    const purchasedIds = new Set((purchases || []).map(p => p.course_id));
    const completedSet = new Set((progress || []).map(p => p.module_id));

    renderCoursesGrid(courses || [], purchasedIds, completedSet);
  } catch (err) {
    console.error('Error loading courses:', err);
    renderDemoCourses();
  }
}

function renderCoursesGrid(courses, purchasedIds, completedSet) {
  const activeGrid = document.getElementById('activeCoursesGrid');
  const availableGrid = document.getElementById('availableCoursesGrid');
  const activeSection = document.getElementById('activeSection');

  activeGrid.innerHTML = '';
  availableGrid.innerHTML = '';

  let hasActive = false;

  courses.forEach(course => {
    const isPurchased = purchasedIds.has(course.id);
    const cardHtml = createCourseCard(course, isPurchased, completedSet);
    
    if (isPurchased) {
      hasActive = true;
      activeGrid.innerHTML += cardHtml;
    } else {
      availableGrid.innerHTML += cardHtml;
    }
  });

  if (activeSection) activeSection.style.display = hasActive ? 'block' : 'none';
  if (!hasActive && activeSection) {
    activeSection.style.display = 'block';
    activeGrid.innerHTML = `
      <div style="grid-column: 1/-1; text-align:center; padding:40px; color:var(--clay);">
        <p style="font-size:1.1rem;">Todavía no tenés cursos activos.</p>
        <p style="font-size:0.9rem; opacity:0.7;">Explorá los programas recomendados más abajo 👇</p>
      </div>`;
  }
}

function createCourseCard(course, isPurchased, completedSet = new Set()) {
  const gradient = isPurchased
    ? 'linear-gradient(135deg, var(--plum), var(--sage))'
    : 'linear-gradient(135deg, var(--earth), var(--clay))';

  const badge = isPurchased
    ? '<span class="course-badge owned">Desbloqueado</span>'
    : '<span class="course-badge locked">Premium</span>';

  let progressHtml = '';
  if (isPurchased && course.modules) {
    const total = course.modules.length;
    const completed = course.modules.filter(m => completedSet.has(m.id)).length;
    const percent = total > 0 ? Math.round((completed / total) * 100) : 0;
    progressHtml = `
      <div style="margin: 12px 0;">
        <div style="display:flex; justify-content:space-between; font-size:0.7rem; margin-bottom:4px; color:var(--clay); font-weight:700; text-transform:uppercase; letter-spacing:0.5px;">
          <span>Progreso</span>
          <span>${percent}%</span>
        </div>
        <div style="width:100%; height:6px; background:rgba(255,255,255,0.5); border-radius:3px; overflow:hidden; border:1px solid var(--linen);">
          <div style="width:${percent}%; height:100%; background:var(--plum); transition: width 0.5s ease;"></div>
        </div>
      </div>`;
  }

  const button = isPurchased
    ? `<a href="curso.html?id=${course.id}" class="btn btn-primary" style="width:100%; text-align:center;">▶ Ver contenido</a>`
    : `<button onclick="handlePurchase(${course.id})" class="btn btn-secondary" style="width:100%;">Comprar acceso ($${course.precio_ars.toLocaleString('es-AR')})</button>`;

  const overlay = isPurchased ? '' : `
    <div class="locked-overlay">
      <span class="locked-icon">🔒</span>
      <span style="font-weight:600;color:var(--earth);">Contenido bloqueado</span>
    </div>`;

  const imgSrc = course.imagen_url || course.imagen || null;
  const imgHtml = imgSrc 
    ? `<img src="${imgSrc}" alt="${course.titulo}" style="width:100%;height:100%;object-fit:cover;">`
    : `<div style="width:100%;height:100%;background:${gradient}; opacity:0.8;"></div>`;

  return `
    <div class="course-card" style="display:flex; flex-direction:column;">
      ${overlay}
      <div class="course-img">
        ${imgHtml}
      </div>
      <div class="course-content" style="flex:1; display:flex; flex-direction:column;">
        ${badge}
        <h3 style="margin-top:8px;">${course.titulo}</h3>
        <p style="flex:1;">${course.descripcion}</p>
        ${progressHtml}
        <div style="margin-top:auto;">${button}</div>
      </div>
    </div>`;
}

// ─── COMPRAR CURSO (MERCADOPAGO) ───
async function handlePurchase(courseId) {
  const sb = getSupabase();
  if (!sb) {
    alert('Sistema de pagos no configurado todavía. Contactá a Denise por WhatsApp.');
    return;
  }

  const user = await authGetUser();
  if (!user) {
    window.location.href = 'login.html';
    return;
  }

  try {
    // Llamar a la Edge Function que crea la preferencia de MercadoPago
    const { data, error } = await sb.functions.invoke('create-preference', {
      body: { course_id: courseId }
    });

    if (error) throw error;
    if (data && data.init_point) {
      // Redirigir al checkout de MercadoPago
      window.location.href = data.init_point;
    } else {
      throw new Error('No se recibió el link de pago');
    }
  } catch (err) {
    console.error('Error al iniciar compra:', err);
    alert('Hubo un problema al procesar tu compra. Por favor intentá de nuevo o contactá a Denise por WhatsApp.');
  }
}

// ─── MODO DEMO (sin Supabase configurado) ───
function renderDemoCourses() {
  const activeGrid = document.getElementById('activeCoursesGrid');
  const availableGrid = document.getElementById('availableCoursesGrid');

  if (activeGrid) {
    activeGrid.innerHTML = createCourseCard({
      id: 1,
      titulo: 'Brújula de Crianza',
      descripcion: 'Introducción a las emociones y el desarrollo infantil. Rutinas y límites con respeto.',
      precio_ars: 35000,
      imagen: 'assets/brujula_crianza.png'
    }, true);
  }

  if (availableGrid) {
    availableGrid.innerHTML = createCourseCard({
      id: 2,
      titulo: 'Workshop: Tu niña interior',
      descripcion: 'Un viaje de autoconocimiento para sanar y transformar la forma en la que maternas hoy.',
      precio_ars: 35000,
      imagen: 'assets/nina_interior.png'
    }, false) + createCourseCard({
      id: 3,
      titulo: 'Guía de Berrinches',
      descripcion: 'Masterclass de 2 horas con herramientas prácticas para acompañar desbordes emocionales.',
      precio_ars: 15000,
      imagen: 'assets/guia_berrinches.png'
    }, false);
  }
}

// ─── CERRAR SESIÓN ───
function handleLogout() {
  authSignOut();
}

// ─── INICIAR AL CARGAR ───
document.addEventListener('DOMContentLoaded', () => {
  initDashboard();
});
