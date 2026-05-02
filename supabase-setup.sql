-- =============================================
-- SCRIPT DE CONFIGURACIÓN DE BASE DE DATOS
-- Ejecutar en Supabase → SQL Editor
-- =============================================

-- 1. TABLA DE PERFILES DE USUARIO
-- Se sincroniza con auth.users mediante un trigger
CREATE TABLE IF NOT EXISTS profiles (
  id UUID REFERENCES auth.users(id) ON DELETE CASCADE PRIMARY KEY,
  nombre TEXT,
  email TEXT,
  telefono TEXT,              -- WhatsApp / SMS marketing
  ciudad TEXT,                -- Segmentación geográfica
  edad_hijos TEXT,            -- Segmentación por etapa de crianza
  como_nos_conocio TEXT,      -- Fuente de adquisición (instagram, google, etc.)
  acepta_comunicaciones BOOLEAN DEFAULT TRUE, -- Opt-in para marketing
  rol TEXT DEFAULT 'user',                    -- Rol: admin, editor, visor, user
  created_at TIMESTAMPTZ DEFAULT NOW()
);

-- Trigger para crear perfil automáticamente al registrarse
CREATE OR REPLACE FUNCTION public.handle_new_user()
RETURNS TRIGGER AS $$
BEGIN
  INSERT INTO public.profiles (id, nombre, email, telefono, ciudad, edad_hijos, como_nos_conocio)
  VALUES (
    NEW.id,
    COALESCE(NEW.raw_user_meta_data->>'nombre', ''),
    NEW.email,
    NEW.raw_user_meta_data->>'telefono',
    NEW.raw_user_meta_data->>'ciudad',
    NEW.raw_user_meta_data->>'edad_hijos',
    NEW.raw_user_meta_data->>'como_nos_conocio'
  );
  RETURN NEW;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;

-- Crear el trigger (solo si no existe)
DROP TRIGGER IF EXISTS on_auth_user_created ON auth.users;
CREATE TRIGGER on_auth_user_created
  AFTER INSERT ON auth.users
  FOR EACH ROW EXECUTE FUNCTION public.handle_new_user();

-- 2. TABLA DE CURSOS
CREATE TABLE IF NOT EXISTS courses (
  id SERIAL PRIMARY KEY,
  titulo TEXT NOT NULL,
  descripcion TEXT,
  precio_ars INTEGER NOT NULL DEFAULT 0,
  imagen_url TEXT,
  activo BOOLEAN DEFAULT TRUE,
  created_at TIMESTAMPTZ DEFAULT NOW()
);

-- 3. TABLA DE MÓDULOS (videos dentro de cada curso)
CREATE TABLE IF NOT EXISTS modules (
  id SERIAL PRIMARY KEY,
  course_id INTEGER REFERENCES courses(id) ON DELETE CASCADE,
  titulo TEXT NOT NULL,
  vimeo_video_id TEXT, -- ID del video en Vimeo (ej: "123456789")
  orden INTEGER DEFAULT 0,
  created_at TIMESTAMPTZ DEFAULT NOW()
);

-- 4. TABLA DE COMPRAS
CREATE TABLE IF NOT EXISTS purchases (
  id SERIAL PRIMARY KEY,
  user_id UUID REFERENCES auth.users(id) ON DELETE CASCADE,
  course_id INTEGER REFERENCES courses(id) ON DELETE CASCADE,
  mp_payment_id TEXT, -- ID del pago en MercadoPago
  status TEXT DEFAULT 'pending', -- approved / pending / rejected
  created_at TIMESTAMPTZ DEFAULT NOW(),
  UNIQUE(user_id, course_id)
);

-- 5. TABLA DE NOTAS INTERNAS (del admin sobre cada usuario)
CREATE TABLE IF NOT EXISTS admin_notes (
  id SERIAL PRIMARY KEY,
  user_id UUID REFERENCES auth.users(id) ON DELETE CASCADE,
  nota TEXT NOT NULL,
  autor TEXT DEFAULT 'Admin',  -- Quién escribió la nota
  created_at TIMESTAMPTZ DEFAULT NOW()
);

-- 6. TABLA DE SUGERENCIAS (de los usuarios)
CREATE TABLE IF NOT EXISTS suggestions (
  id SERIAL PRIMARY KEY,
  user_id UUID REFERENCES auth.users(id) ON DELETE CASCADE,
  contenido TEXT NOT NULL,
  leida BOOLEAN DEFAULT FALSE,
  created_at TIMESTAMPTZ DEFAULT NOW()
);

-- 7. TABLA DE PROGRESO DE MÓDULOS
CREATE TABLE IF NOT EXISTS user_module_progress (
  id SERIAL PRIMARY KEY,
  user_id UUID REFERENCES auth.users(id) ON DELETE CASCADE,
  module_id INTEGER REFERENCES modules(id) ON DELETE CASCADE,
  completed_at TIMESTAMPTZ DEFAULT NOW(),
  UNIQUE(user_id, module_id)
);

-- 8. TABLA DE CONSULTAS DE CONTACTO
CREATE TABLE IF NOT EXISTS contact_inquiries (
  id SERIAL PRIMARY KEY,
  nombre TEXT NOT NULL,
  email TEXT NOT NULL,
  telefono TEXT,
  motivo TEXT,
  mensaje TEXT,
  created_at TIMESTAMPTZ DEFAULT NOW()
);

-- =============================================
-- ROW LEVEL SECURITY (RLS)
-- Cada usuario solo ve sus propios datos
-- =============================================

-- Profiles: cada usuario solo puede leer su propio perfil
ALTER TABLE profiles ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Users can view own profile"
  ON profiles FOR SELECT
  USING (auth.uid() = id);

CREATE POLICY "Users can update own profile"
  ON profiles FOR UPDATE
  USING (auth.uid() = id);

-- Courses: todos pueden leer los cursos activos (son públicos)
ALTER TABLE courses ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Anyone can view active courses"
  ON courses FOR SELECT
  USING (activo = TRUE);

-- Modules: todos pueden leer los módulos (la protección está en purchases)
ALTER TABLE modules ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Anyone can view modules"
  ON modules FOR SELECT
  USING (TRUE);

-- Purchases: cada usuario solo puede ver sus propias compras
ALTER TABLE purchases ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Users can view own purchases"
  ON purchases FOR SELECT
  USING (auth.uid() = user_id);

-- La Edge Function (service_role) puede insertar compras
CREATE POLICY "Service role can insert purchases"
  ON purchases FOR INSERT
  WITH CHECK (TRUE);

-- =============================================
-- POLÍTICAS RLS PARA ADMIN, EDITOR Y VISOR
-- =============================================

-- Función helper para obtener el rol del usuario
CREATE OR REPLACE FUNCTION public.get_user_rol()
RETURNS TEXT AS $$
  SELECT COALESCE(
    (SELECT rol FROM public.profiles WHERE id = auth.uid()),
    'user'
  );
$$ LANGUAGE sql SECURITY DEFINER;

-- Profiles:
-- Admin puede ver TODOS los perfiles
-- Editor y Visor pueden ver TODOS los perfiles
CREATE POLICY "Admin, Editor, Visor can view all profiles"
  ON profiles FOR SELECT
  USING (public.get_user_rol() IN ('admin', 'editor', 'visor'));

-- Solo Admin puede actualizar otros perfiles (ej: para cambiar roles)
CREATE POLICY "Admin can update all profiles"
  ON profiles FOR UPDATE
  USING (public.get_user_rol() = 'admin');

-- Purchases:
-- Admin, Editor, Visor pueden ver TODAS las compras
CREATE POLICY "Admin, Editor, Visor can view all purchases"
  ON purchases FOR SELECT
  USING (public.get_user_rol() IN ('admin', 'editor', 'visor'));

-- Admin y Editor pueden insertar compras (acceso manual)
CREATE POLICY "Admin and Editor can insert purchases"
  ON purchases FOR INSERT
  WITH CHECK (public.get_user_rol() IN ('admin', 'editor'));

-- Courses:
-- Admin y Editor pueden gestionar cursos (CRUD completo)
CREATE POLICY "Admin and Editor can manage courses"
  ON courses FOR ALL
  USING (public.get_user_rol() IN ('admin', 'editor'));

-- Modules:
-- Admin y Editor pueden gestionar módulos (CRUD completo)
CREATE POLICY "Admin and Editor can manage modules"
  ON modules FOR ALL
  USING (public.get_user_rol() IN ('admin', 'editor'));

-- Admin_notes:
-- Solo admins y editores pueden ver y crear notas
ALTER TABLE admin_notes ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Admin and Editor can manage notes"
  ON admin_notes FOR ALL
  USING (public.get_user_rol() IN ('admin', 'editor'));

-- Suggestions: usuarios pueden crear, admin/editor/visor pueden ver
ALTER TABLE suggestions ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Users can create suggestions" ON suggestions FOR INSERT WITH CHECK (auth.uid() = user_id);
CREATE POLICY "Admins, editors, visors can view suggestions" ON suggestions FOR SELECT USING (get_user_rol() IN ('admin', 'editor', 'visor'));
CREATE POLICY "Admins and editors can update suggestions" ON suggestions FOR UPDATE USING (get_user_rol() IN ('admin', 'editor'));

-- User Module Progress
ALTER TABLE user_module_progress ENABLE ROW LEVEL SECURITY;
CREATE POLICY "Users can view own progress" ON user_module_progress FOR SELECT USING (auth.uid() = user_id);
CREATE POLICY "Admins, editors, visors can view all progress" ON user_module_progress FOR SELECT USING (get_user_rol() IN ('admin', 'editor', 'visor'));
CREATE POLICY "Users can insert own progress" ON user_module_progress FOR INSERT WITH CHECK (auth.uid() = user_id);
CREATE POLICY "Users can delete own progress" ON user_module_progress FOR DELETE USING (auth.uid() = user_id);

-- Contact Inquiries
ALTER TABLE contact_inquiries ENABLE ROW LEVEL SECURITY;
CREATE POLICY "Anyone can insert inquiries" ON contact_inquiries FOR INSERT WITH CHECK (TRUE);
CREATE POLICY "Admins can view inquiries" ON contact_inquiries FOR SELECT USING (get_user_rol() IN ('admin', 'editor', 'visor'));

-- =============================================
-- DATOS DE EJEMPLO
-- =============================================

INSERT INTO courses (titulo, descripcion, precio_ars) VALUES
  ('Brújula de Crianza', 'Un programa de 4 módulos para acompañar tu crianza con calma, herramientas prácticas y seguridad emocional.', 35000),
  ('Workshop: Tu niña interior', 'Un viaje de autoconocimiento para sanar y transformar la forma en la que maternas hoy.', 35000),
  ('Guía de Berrinches', 'Masterclass de 2 horas con herramientas prácticas para acompañar desbordes emocionales.', 15000)
ON CONFLICT DO NOTHING;

-- Módulos para "Brújula de Crianza" (course_id = 1)
INSERT INTO modules (course_id, titulo, vimeo_video_id, orden) VALUES
  (1, 'Introducción a las emociones', NULL, 1),
  (1, 'Rutinas y límites con respeto', NULL, 2),
  (1, 'Comunicación empática', NULL, 3),
  (1, 'Plan de acción familiar', NULL, 4)
ON CONFLICT DO NOTHING;

-- Módulos para "Workshop" (course_id = 2)
INSERT INTO modules (course_id, titulo, vimeo_video_id, orden) VALUES
  (2, 'Conectar con tu niña interior', NULL, 1),
  (2, 'Herramientas de autorregulación', NULL, 2),
  (2, 'Límites desde el amor', NULL, 3)
ON CONFLICT DO NOTHING;

-- Módulos para "Guía de Berrinches" (course_id = 3)
INSERT INTO modules (course_id, titulo, vimeo_video_id, orden) VALUES
  (3, 'Masterclass completa: Berrinches', NULL, 1)
ON CONFLICT DO NOTHING;
