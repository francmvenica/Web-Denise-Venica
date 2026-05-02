// =============================================
// EDGE FUNCTION: mp-webhook
// Recibe notificaciones de pago de MercadoPago
// Deploy: supabase functions deploy mp-webhook
// =============================================
//
// Configurar en MercadoPago → Developers → Webhooks:
//   URL: https://<project-ref>.supabase.co/functions/v1/mp-webhook
//   Eventos: payment.created, payment.updated
//
// Variables de entorno necesarias:
//   supabase secrets set MP_ACCESS_TOKEN=tu_access_token
// =============================================

import { createClient } from "npm:@supabase/supabase-js@2";
import { MercadoPagoConfig, Payment } from "npm:mercadopago";

Deno.serve(async (req) => {
  // Este endpoint debe ser público (MercadoPago lo llama directamente)
  if (req.method !== "POST") {
    return new Response("Method not allowed", { status: 405 });
  }

  try {
    const body = await req.json();

    // MercadoPago envía diferentes tipos de notificaciones
    // Solo nos interesan los pagos
    if (body.type !== "payment" && body.action !== "payment.created" && body.action !== "payment.updated") {
      return new Response(JSON.stringify({ received: true }), { status: 200 });
    }

    const paymentId = body.data?.id;
    if (!paymentId) {
      return new Response(JSON.stringify({ received: true }), { status: 200 });
    }

    // 1. Consultar el pago en MercadoPago para obtener los datos completos
    const mpClient = new MercadoPagoConfig({
      accessToken: Deno.env.get("MP_ACCESS_TOKEN")!,
    });

    const payment = new Payment(mpClient);
    const paymentData = await payment.get({ id: paymentId });

    console.log("Webhook recibido - Pago:", paymentId, "Status:", paymentData.status);

    // 2. Solo procesar pagos aprobados
    if (paymentData.status !== "approved") {
      console.log("Pago no aprobado, ignorando:", paymentData.status);
      return new Response(JSON.stringify({ received: true, status: paymentData.status }), {
        status: 200,
      });
    }

    // 3. Extraer metadata (user_id y course_id que enviamos al crear la preferencia)
    const metadata = paymentData.metadata;
    if (!metadata?.user_id || !metadata?.course_id) {
      console.error("Metadata incompleta en el pago:", metadata);
      return new Response(JSON.stringify({ error: "Metadata incompleta" }), {
        status: 200, // Responder 200 para que MP no reintente
      });
    }

    // 4. Registrar la compra en la base de datos
    const supabaseAdmin = createClient(
      Deno.env.get("SUPABASE_URL")!,
      Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!
    );

    const { error: insertError } = await supabaseAdmin
      .from("purchases")
      .upsert(
        {
          user_id: metadata.user_id,
          course_id: metadata.course_id,
          mp_payment_id: String(paymentId),
          status: "approved",
        },
        {
          onConflict: "user_id,course_id",
        }
      );

    if (insertError) {
      console.error("Error al registrar compra:", insertError);
      // Responder 200 igualmente para que MP no reintente
    } else {
      console.log("✅ Compra registrada:", metadata.user_id, "→ Curso", metadata.course_id);
    }

    return new Response(
      JSON.stringify({ received: true, purchase_registered: !insertError }),
      { status: 200 }
    );
  } catch (err) {
    console.error("Error en webhook:", err);
    // Siempre responder 200 para que MercadoPago no reintente indefinidamente
    return new Response(JSON.stringify({ error: "Error procesando webhook" }), {
      status: 200,
    });
  }
});
