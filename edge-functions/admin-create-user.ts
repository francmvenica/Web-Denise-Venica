import { serve } from "https://deno.land/std@0.190.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2.45.6";

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
};

serve(async (req: Request) => {
  // Handle CORS
  if (req.method === 'OPTIONS') {
    return new Response('ok', { headers: corsHeaders });
  }

  try {
    const supabaseUrl = Deno.env.get('SUPABASE_URL') || '';
    const supabaseServiceKey = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY') || '';
    const authHeader = req.headers.get('Authorization') || '';

    if (!supabaseUrl || !supabaseServiceKey) {
      throw new Error('Server misconfiguration: Missing Supabase secrets.');
    }
    if (!authHeader) {
      throw new Error('Missing Authorization header');
    }

    // 1. Initialize admin client (bypasses RLS)
    const supabaseAdmin = createClient(supabaseUrl, supabaseServiceKey, {
      auth: {
        autoRefreshToken: false,
        persistSession: false
      }
    });

    // 2. Verify caller is a real Admin
    const token = authHeader.replace('Bearer ', '');
    const { data: { user: caller }, error: callerAuthError } = await supabaseAdmin.auth.getUser(token);
    if (callerAuthError || !caller) {
      throw new Error('Invalid token');
    }

    // Check profile role
    const { data: callerProfile, error: profileError } = await supabaseAdmin
      .from('profiles')
      .select('rol')
      .eq('id', caller.id)
      .single();

    if (profileError || callerProfile?.rol !== 'admin') {
      throw new Error('Unauthorized: Only administrators can create users via this endpoint.');
    }

    // 3. Get payload
    const { email, password, nombre, rol } = await req.json();

    if (!email || !password || !nombre) {
      throw new Error('Faltan campos obligatorios (email, password, nombre).');
    }

    const assignedRole = ['admin', 'editor', 'visor', 'user'].includes(rol) ? rol : 'user';

    // 4. Create User in Auth
    const { data: newUserObj, error: createUserError } = await supabaseAdmin.auth.admin.createUser({
      email: email,
      password: password,
      user_metadata: { name: nombre },
      email_confirm: true // Auto confirm email so they can login immediately
    });

    if (createUserError) throw createUserError;
    if (!newUserObj || !newUserObj.user) throw new Error('User creation failed.');

    const newUserId = newUserObj.user.id;

    // 5. Update Profile
    // (Note: there is a Postgres trigger that automatically creates the profile row. 
    // We might need to wait a tiny bit or just upsert/update to ensure it's there.)
    // We will do an UPSERT to be safe.
    
    const { error: updateProfileError } = await supabaseAdmin
      .from('profiles')
      .upsert({
        id: newUserId,
        nombre: nombre,
        email: email,
        rol: assignedRole
      }, { onConflict: 'id' });

    if (updateProfileError) {
      // If profile fails, ideally we should delete the auth user or warn, but let's just log it.
      console.error("Profile update failed for new user:", updateProfileError);
      throw new Error('Usuario creado en Auth, pero falló la actualización del perfil/rol.');
    }

    return new Response(JSON.stringify({ success: true, user_id: newUserId }), {
      headers: { ...corsHeaders, 'Content-Type': 'application/json' },
      status: 200,
    });

  } catch (error: any) {
    console.error('Error in create-user function:', error.message);
    return new Response(JSON.stringify({ error: error.message }), {
      headers: { ...corsHeaders, 'Content-Type': 'application/json' },
      status: 400,
    });
  }
});
