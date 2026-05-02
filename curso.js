// ===== CURSO VIEWER MODULE =====
// Requiere: supabase-config.js y auth.js cargados previamente

// ─── OBTENER COURSE ID DE LA URL ───
function getCourseIdFromUrl() {
  const params = new URLSearchParams(window.location.search);
  return parseInt(params.get('id'));
}

// ─── INICIALIZACIÓN ───
async function initCurso() {
  const courseId = getCourseIdFromUrl();
  if (!courseId) {
    window.location.href = 'dashboard.html';
    return;
  }

  // Verificar sesión
  const user = await authRequireLogin();
  if (!user) return;

  const sb = getSupabase();
  if (!isSupabaseConfigured()) {
    renderDemoCurso();
    return;
  }

  try {
    // Verificar que el usuario tiene acceso al curso
    const { data: purchase } = await sb
      .from('purchases')
      .select('id')
      .eq('user_id', user.id)
      .eq('course_id', courseId)
      .eq('status', 'approved')
      .single();

    if (!purchase) {
      showLockedState();
      return;
    }

    // Cargar datos del curso
    const { data: course } = await sb
      .from('courses')
      .select('*')
      .eq('id', courseId)
      .single();

    // Cargar módulos del curso
    const { data: modules } = await sb
      .from('modules')
      .select('*')
      .eq('course_id', courseId)
      .order('orden');

    // Cargar progreso del usuario
    const { data: progress } = await sb
      .from('user_module_progress')
      .select('module_id')
      .eq('user_id', user.id);
    
    const completedSet = new Set((progress || []).map(p => p.module_id));

    if (course && modules && modules.length > 0) {
      renderCurso(course, modules, completedSet, user.id);
    } else {
      showLockedState();
    }
  } catch (err) {
    console.error('Error cargando curso:', err);
    renderDemoCurso();
  }
}

// ─── MOSTRAR ESTADO BLOQUEADO ───
function showLockedState() {
  document.getElementById('lockedState').style.display = 'block';
  document.getElementById('cursoContent').style.display = 'none';
}

// ─── RENDERIZAR CURSO ───
function renderCurso(course, modules, completedSet = new Set(), currentUserId = null) {
  document.getElementById('lockedState').style.display = 'none';
  document.getElementById('cursoContent').style.display = 'grid';

  // Update title
  document.title = course.titulo + ' | Denise Venica';
  document.getElementById('courseTitle').textContent = course.titulo;
  
  function updateProgressText() {
    const completedCount = document.querySelectorAll('.module-checkbox:checked').length;
    document.getElementById('courseProgress').textContent = `${completedCount} de ${modules.length} completados`;
  }

  // Render module list in sidebar
  const list = document.getElementById('modulesList');
  list.innerHTML = '';

  modules.forEach((mod, index) => {
    const item = document.createElement('div');
    item.className = 'module-item' + (index === 0 ? ' active' : '');
    const isChecked = completedSet.has(mod.id) ? 'checked' : '';
    
    item.innerHTML = `
      <div class="module-num">${index + 1}</div>
      <div class="module-title">${mod.titulo}</div>
      <input type="checkbox" class="module-checkbox" data-modid="${mod.id}" ${isChecked} title="Marcar como completado">
    `;
    
    // Al hacer click en el item, cambiar de video
    item.addEventListener('click', (e) => {
      if (e.target.classList.contains('module-checkbox')) return; // No cambiar de video si toca el checkbox
      list.querySelectorAll('.module-item').forEach(el => el.classList.remove('active'));
      item.classList.add('active');
      loadVideo(mod);
    });

    // Evento del checkbox
    const checkbox = item.querySelector('.module-checkbox');
    checkbox.addEventListener('change', async (e) => {
      updateProgressText();
      const sb = getSupabase();
      if (!sb || !currentUserId) return;

      try {
        if (e.target.checked) {
          await sb.from('user_module_progress').insert({ user_id: currentUserId, module_id: mod.id });
        } else {
          await sb.from('user_module_progress').delete().eq('user_id', currentUserId).eq('module_id', mod.id);
        }
      } catch (err) {
        console.error('Error guardando progreso:', err);
      }
    });

    list.appendChild(item);
  });

  updateProgressText();

  // Load first module
  loadVideo(modules[0]);
}

// ─── CARGAR VIDEO DE VIMEO ───
function loadVideo(module) {
  const wrapper = document.getElementById('videoWrapper');
  const titleEl = document.getElementById('moduleTitle');

  titleEl.textContent = module.titulo;

  if (module.vimeo_video_id) {
    wrapper.innerHTML = `
      <iframe
        src="https://player.vimeo.com/video/${module.vimeo_video_id}?badge=0&autopause=0&player_id=0"
        allow="autoplay; fullscreen; picture-in-picture"
        allowfullscreen
        title="${module.titulo}">
      </iframe>`;
  } else {
    wrapper.innerHTML = `
      <div style="display:flex;align-items:center;justify-content:center;height:100%;color:#999;flex-direction:column;gap:8px;">
        <span style="font-size:2rem;">🎬</span>
        <p style="margin:0;">Video próximamente disponible</p>
      </div>`;
  }
}

// ─── MODO DEMO ───
function renderDemoCurso() {
  const courseId = getCourseIdFromUrl();
  document.getElementById('lockedState').style.display = 'none';
  document.getElementById('cursoContent').style.display = 'grid';

  const COURSES_DATA = {
    1: { 
      titulo: 'Brújula de Crianza', 
      descripcion: 'Programa de 4 módulos para acompañar tu crianza.',
      modules: [
        { titulo: 'Módulo 1: Introducción a las emociones', vimeo_video_id: null },
        { titulo: 'Módulo 2: Rutinas y límites con respeto', vimeo_video_id: null },
        { titulo: 'Módulo 3: Comunicación empática', vimeo_video_id: null },
        { titulo: 'Módulo 4: Plan de acción familiar', vimeo_video_id: null },
      ]
    },
    2: { 
      titulo: 'Workshop: Tu niña interior', 
      descripcion: 'Un viaje de autoconocimiento para sanar.',
      modules: [
        { titulo: 'Sesión 1: Conectar con tu niña interior', vimeo_video_id: null },
        { titulo: 'Sesión 2: Herramientas de autorregulación', vimeo_video_id: null },
        { titulo: 'Sesión 3: Límites desde el amor', vimeo_video_id: null },
      ]
    },
    3: { 
      titulo: 'Guía de Berrinches', 
      descripcion: 'Herramientas prácticas para acompañar desbordes.',
      modules: [
        { titulo: 'Masterclass: Manejo de Berrinches', vimeo_video_id: null },
      ]
    }
  };

  const course = COURSES_DATA[courseId] || COURSES_DATA[1];

  renderCurso(
    { titulo: `${course.titulo} (Demo)`, descripcion: course.descripcion },
    course.modules,
    new Set()
  );
}

// ─── INICIAR AL CARGAR ───
document.addEventListener('DOMContentLoaded', () => {
  if (isSupabaseConfigured()) {
    initCurso();
  } else {
    renderDemoCurso();
  }
});
