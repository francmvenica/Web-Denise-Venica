// ===== NAVBAR SCROLL EFFECT =====
const navbar = document.getElementById('navbar');
let lastScroll = 0;

window.addEventListener('scroll', () => {
  const currentScroll = window.scrollY;
  if (currentScroll > 60) {
    navbar.classList.add('scrolled');
  } else {
    navbar.classList.remove('scrolled');
  }
  lastScroll = currentScroll;
});

// ===== MOBILE MENU =====
const mobileToggle = document.getElementById('mobileToggle');
const navLinks = document.getElementById('navLinks');

mobileToggle.addEventListener('click', () => {
  navLinks.classList.toggle('active');
  mobileToggle.classList.toggle('active');
});

// Close mobile menu on link click
navLinks.querySelectorAll('a').forEach(link => {
  link.addEventListener('click', () => {
    navLinks.classList.remove('active');
    mobileToggle.classList.remove('active');
  });
});

// ===== SCROLL ANIMATIONS (Intersection Observer) =====
const observerOptions = {
  threshold: 0.15,
  rootMargin: '0px 0px -50px 0px'
};

const observer = new IntersectionObserver((entries) => {
  entries.forEach(entry => {
    if (entry.isIntersecting) {
      entry.target.classList.add('visible');
      observer.unobserve(entry.target);
    }
  });
}, observerOptions);

document.querySelectorAll('.fade-up, .fade-left, .fade-right').forEach(el => {
  observer.observe(el);
});

// ===== SMOOTH SCROLL FOR ANCHOR LINKS =====
document.querySelectorAll('a[href^="#"]').forEach(anchor => {
  anchor.addEventListener('click', function (e) {
    e.preventDefault();
    const target = document.querySelector(this.getAttribute('href'));
    if (target) {
      const offset = 80;
      const top = target.getBoundingClientRect().top + window.scrollY - offset;
      window.scrollTo({ top, behavior: 'smooth' });
    }
  });
});

// ===== FORM SUBMISSION (SUPABASE) =====
const form = document.getElementById('contactForm');
if (form) {
  form.addEventListener('submit', async function(e) {
    e.preventDefault();
    const btn = document.getElementById('form-submit');
    const originalText = btn.textContent;
    
    // Datos del formulario
    const nombre = document.getElementById('form-nombre').value.trim();
    const email = document.getElementById('form-email').value.trim();
    const telefono = document.getElementById('form-telefono').value.trim();
    const motivo = document.getElementById('form-motivo').value;
    const mensaje = document.getElementById('form-mensaje').value.trim();

    // Validación básica
    if (!motivo) {
      alert('Por favor, seleccioná un motivo de consulta.');
      return;
    }

    // Sanitización básica (eliminar tags HTML)
    const sanitize = (str) => str.replace(/<[^>]*>?/gm, '');

    const formData = {
      nombre: sanitize(nombre),
      email: email, // El navegador ya valida el formato email
      telefono: sanitize(telefono),
      motivo: motivo,
      mensaje: sanitize(mensaje)
    };

    btn.textContent = 'Enviando...';
    btn.disabled = true;
    btn.style.opacity = '0.7';

    try {
      const sb = getSupabase();
      if (sb && isSupabaseConfigured()) {
        const { error } = await sb.from('contact_inquiries').insert([formData]);
        if (error) throw error;
      } else {
        // Modo demo o no configurado
        console.log('Modo Demo: Simulando envío de datos', formData);
        await new Promise(resolve => setTimeout(resolve, 1000));
      }

      // Éxito
      btn.textContent = '✓ ¡Consulta enviada!';
      btn.style.background = 'var(--sage)';
      btn.style.opacity = '1';
      
      const successMsg = document.createElement('div');
      successMsg.className = 'fade-up visible';
      successMsg.style.cssText = 'background:rgba(83,88,62,0.1); color:var(--sage); padding:16px; border-radius:8px; margin-top:20px; border:1px solid rgba(83,88,62,0.2); text-align:center; font-weight:600;';
      successMsg.textContent = '¡Gracias! Tu consulta fue recibida. Denise te contactará pronto.';
      form.appendChild(successMsg);

      setTimeout(() => {
        btn.textContent = originalText;
        btn.style.background = '';
        btn.disabled = false;
        btn.style.opacity = '';
        form.reset();
        successMsg.remove();
      }, 5000);

    } catch (err) {
      console.error('Error al enviar:', err);
      btn.textContent = 'Error al enviar';
      btn.style.background = '#c33';
      setTimeout(() => {
        btn.textContent = originalText;
        btn.style.background = '';
        btn.disabled = false;
        btn.style.opacity = '';
      }, 3000);
    }
  });
}

// ===== PARALLAX SUBTLE ON HERO =====
window.addEventListener('scroll', () => {
  const hero = document.querySelector('.hero-bg img');
  if (hero) {
    const scrolled = window.scrollY;
    if (scrolled < window.innerHeight) {
      hero.style.transform = `translateY(${scrolled * 0.3}px) scale(1.05)`;
    }
  }
});

// ===== ACTIVE NAV LINK HIGHLIGHT =====
const sections = document.querySelectorAll('section[id], footer[id]');
const navLinksAll = document.querySelectorAll('.nav-links a[href^="#"]');

window.addEventListener('scroll', () => {
  let current = '';
  sections.forEach(section => {
    const top = section.offsetTop - 120;
    if (window.scrollY >= top) {
      current = section.getAttribute('id');
    }
  });
  navLinksAll.forEach(link => {
    link.style.opacity = '0.7';
    if (link.getAttribute('href') === `#${current}`) {
      link.style.opacity = '1';
    }
  });
});
