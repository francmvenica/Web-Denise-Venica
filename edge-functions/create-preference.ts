// =============================================
// EDGE FUNCTION: create-preference
// Crea una preferencia de pago en MercadoPago
// Deploy: supabase functions deploy create-preference
// =============================================
// 
// Variables de entorno necesarias:
//   supabase secrets set MP_ACCESS_TOKEN=tu_access_token
//
// Uso desde el frontend:
//   const { data } = await supabase.functions.invoke('create-preference', {
//     body: { course_id: 1 }
//   });
//   window.location.href = data.init_point;
// =============================================

import { createClient } from "npm:@supabase/supabase-js@2";
import { MercadoPagoConfig, Preference } from "npm:mercadopago";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
};

Deno.serve(async (req) => {
  // Handle CORS preflight
  if (req.method === "OPTIONS") {
    return new Response("ok", { headers: corsHeaders });
  }

  try {
    // 1. Verificar autenticación del usuario
    const authHeader = req.headers.get("Authorization");
    if (!authHeader) {
      return new Response(JSON.stringify({ error: "No autorizado" }), {
        status: 401,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    // Crear cliente de Supabase con el token del usuario
    const supabaseUrl = Deno.env.get("SUPABASE_URL")!;
    const supabaseKey = Deno.env.get("SUPABASE_ANON_KEY")!;
    const supabase = createClient(supabaseUrl, supabaseKey, {
      global: { headers: { Authorization: authHeader } },
    });

    // Obtener usuario actual
    const { data: { user }, error: userError } = await supabase.auth.getUser();
    if (userError || !user) {
      return new Response(JSON.stringify({ error: "Usuario no válido" }), {
        status: 401,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    // 2. Obtener course_id del body
    const { course_id } = await req.json();
    if (!course_id) {
      return new Response(JSON.stringify({ error: "course_id requerido" }), {
        status: 400,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    // 3. Consultar datos del curso (usar service role para bypass RLS)
    const supabaseAdmin = createClient(
      supabaseUrl,
      Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!
    );

    const { data: course, error: courseError } = await supabaseAdmin
      .from("courses")
      .select("*")
      .eq("id", course_id)
      .single();

    if (courseError || !course) {
      return new Response(JSON.stringify({ error: "Curso no encontrado" }), {
        status: 404,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    // 4. Verificar que no haya comprado ya este curso
    const { data: existingPurchase } = await supabaseAdmin
      .from("purchases")
      .select("id")
      .eq("user_id", user.id)
      .eq("course_id", course_id)
      .eq("status", "approved")
      .single();

    if (existingPurchase) {
      return new Response(JSON.stringify({ error: "Ya tenés acceso a este curso" }), {
        status: 400,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    // 5. Crear preferencia en MercadoPago
    const mpAccessToken = Deno.env.get("MP_ACCESS_TOKEN");
    if (!mpAccessToken) {
      console.error("CRITICAL: MP_ACCESS_TOKEN is not set in Supabase Secrets.");
      return new Response(JSON.stringify({ 
        error: "Servicio de pagos no configurado",
        message: "Falta la clave MP_ACCESS_TOKEN en los secretos de Supabase."
      }), {
        status: 500,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    const mpClient = new MercadoPagoConfig({
      accessToken: mpAccessToken,
    });

    const preference = new Preference(mpClient);
    const result = await preference.create({
      body: {
        items: [
          {
            id: String(course.id),
            title: course.titulo,
            description: course.descripcion || "",
            quantity: 1,
            unit_price: course.precio_ars,
            currency_id: "ARS",
          },
        ],
        payer: {
          email: user.email,
        },
        metadata: {
          user_id: user.id,
          course_id: course.id,
        },
        back_urls: {
          success: `${req.headers.get("origin") || "https://tu-dominio.com"}/dashboard.html?payment=success`,
          failure: `${req.headers.get("origin") || "https://tu-dominio.com"}/dashboard.html?payment=failure`,
          pending: `${req.headers.get("origin") || "https://tu-dominio.com"}/dashboard.html?payment=pending`,
        },
        auto_return: "approved",
        notification_url: `${supabaseUrl}/functions/v1/mp-webhook`,
      },
    });

    // 6. Devolver el init_point al frontend
    return new Response(
      JSON.stringify({
        init_point: result.init_point,
        preference_id: result.id,
      }),
      {
        status: 200,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      }
    );
  } catch (err) {
    console.error("Error:", err);
    return new Response(
      JSON.stringify({ error: "Error interno del servidor" }),
      {
        status: 500,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      }
    );
  }
});
