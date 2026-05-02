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
    const resendApiKey = Deno.env.get('RESEND_API_KEY');
    const authHeader = req.headers.get('Authorization') || '';

    if (!supabaseUrl || !supabaseServiceKey) {
      throw new Error('Supabase no está configurado correctamente en el servidor.');
    }
    if (!resendApiKey) {
      // Devolvemos un código específico o mensaje para que el frontend sepa que falta la API Key
      return new Response(JSON.stringify({ 
        error: 'CONFIG_MISSING', 
        message: 'La conexión con Resend (envío de emails) no está configurada. Falta la API Key.' 
      }), {
        headers: { ...corsHeaders, 'Content-Type': 'application/json' },
        status: 400,
      });
    }

    if (!authHeader) throw new Error('No autorizado');

    // Inicializar cliente de Supabase (Admin) para verificar permisos
    const supabaseAdmin = createClient(supabaseUrl, supabaseServiceKey, {
      auth: { autoRefreshToken: false, persistSession: false }
    });

    const token = authHeader.replace('Bearer ', '');
    const { data: { user: caller }, error: callerAuthError } = await supabaseAdmin.auth.getUser(token);
    if (callerAuthError || !caller) throw new Error('Token inválido');

    // Verificar que sea admin
    const { data: callerProfile } = await supabaseAdmin
      .from('profiles')
      .select('rol')
      .eq('id', caller.id)
      .single();

    if (callerProfile?.rol !== 'admin') {
      throw new Error('Solo los administradores pueden enviar correos masivos.');
    }

    // Recibir parámetros
    const { subject, htmlBody, toType, senderDomain, senderName } = await req.json();

    if (!subject || !htmlBody || !toType || !senderDomain) {
      throw new Error('Faltan datos obligatorios para el envío.');
    }

    // Obtener la lista de usuarios según el filtro
    let { data: profiles } = await supabaseAdmin.from('profiles').select('id, email, nombre').eq('acepta_comunicaciones', true);
    let recipients = profiles || [];

    if (toType === 'buyers' || toType === 'non-buyers') {
      const { data: purchases } = await supabaseAdmin.from('purchases').select('user_id').eq('status', 'approved');
      const buyerIds = new Set((purchases || []).map(p => p.user_id));
      
      if (toType === 'buyers') {
        recipients = recipients.filter(u => buyerIds.has(u.id));
      } else {
        recipients = recipients.filter(u => !buyerIds.has(u.id));
      }
    }

    // Filtrar los que no tienen email
    recipients = recipients.filter(u => u.email && u.email.includes('@'));

    if (recipients.length === 0) {
      throw new Error('No hay destinatarios válidos para este filtro.');
    }

    // Preparar y enviar emails vía Resend
    // Resend permite enviar lotes usando el endpoint de BATCH o enviando un array, 
    // pero para no complicar, enviamos un array de emails al endpoint de /emails si son pocos,
    // o iteramos (en un entorno real grande se usa Batch API).
    // Aquí hacemos un Promise.all para enviar cada uno, personalizando el texto {nombre}.

    const emailPromises = recipients.map(user => {
      const personalHtml = htmlBody.replace(/{nombre}/g, user.nombre || 'Usuario');
      const fromEmail = `${senderName || 'Denise Venica'} <info@${senderDomain}>`;

      return fetch('https://api.resend.com/emails', {
        method: 'POST',
        headers: {
          'Authorization': `Bearer ${resendApiKey}`,
          'Content-Type': 'application/json'
        },
        body: JSON.stringify({
          from: fromEmail,
          to: user.email,
          subject: subject,
          html: personalHtml
        })
      }).then(res => res.json());
    });

    const results = await Promise.all(emailPromises);
    const hasErrors = results.some(r => r.error);

    if (hasErrors) {
      console.error('Algunos emails fallaron:', results.filter(r => r.error));
      return new Response(JSON.stringify({ error: 'Algunos envíos fallaron. Revisa los logs.' }), {
        headers: { ...corsHeaders, 'Content-Type': 'application/json' },
        status: 500,
      });
    }

    return new Response(JSON.stringify({ success: true, count: recipients.length }), {
      headers: { ...corsHeaders, 'Content-Type': 'application/json' },
      status: 200,
    });

  } catch (error: any) {
    console.error('Error in send-mass-email:', error.message);
    return new Response(JSON.stringify({ error: error.message }), {
      headers: { ...corsHeaders, 'Content-Type': 'application/json' },
      status: 400,
    });
  }
});
