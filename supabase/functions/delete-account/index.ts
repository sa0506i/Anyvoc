// Supabase Edge Function: delete-account
//
// Deletes the caller's auth.users row. Must run server-side because
// supabase.auth.admin.deleteUser requires the service-role key, which
// MUST NOT live in the client.
//
// Flow:
//   1. Read the user's JWT from the Authorization header that the
//      supabase-js SDK sets automatically when `supabase.functions
//      .invoke('delete-account')` is called.
//   2. Verify the JWT with the anon client (resolves to the user.id).
//   3. Use the service-role admin client to deleteUser(user.id).
//
// Env vars are provided automatically by Supabase when the function
// runs — no manual config needed beyond deploying the function:
//   - SUPABASE_URL
//   - SUPABASE_ANON_KEY
//   - SUPABASE_SERVICE_ROLE_KEY  (NEVER in the app. Architecture test
//                                  Rule 11 enforces this at lint time.)

// @ts-expect-error Deno-specific import resolved by the Supabase Edge runtime.
import { createClient } from 'npm:@supabase/supabase-js@2';

const CORS = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Methods': 'POST, OPTIONS',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
};

const json = (body: unknown, status = 200) =>
  new Response(JSON.stringify(body), {
    status,
    headers: { ...CORS, 'Content-Type': 'application/json' },
  });

// @ts-expect-error Deno global exists in the Edge Function runtime.
Deno.serve(async (req: Request) => {
  if (req.method === 'OPTIONS') {
    return new Response('ok', { headers: CORS });
  }

  try {
    const authHeader = req.headers.get('Authorization');
    if (!authHeader) {
      return json({ error: 'Missing Authorization header' }, 401);
    }

    // @ts-expect-error Deno.env
    const SUPABASE_URL = Deno.env.get('SUPABASE_URL');
    // @ts-expect-error Deno.env
    const SUPABASE_ANON_KEY = Deno.env.get('SUPABASE_ANON_KEY');
    // @ts-expect-error Deno.env
    const SUPABASE_SERVICE_ROLE_KEY = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY');

    if (!SUPABASE_URL || !SUPABASE_ANON_KEY || !SUPABASE_SERVICE_ROLE_KEY) {
      return json({ error: 'Edge Function env not configured' }, 500);
    }

    // Anon client scoped to the caller's JWT — verifies identity.
    const anon = createClient(SUPABASE_URL, SUPABASE_ANON_KEY, {
      global: { headers: { Authorization: authHeader } },
    });

    const {
      data: { user },
      error: userErr,
    } = await anon.auth.getUser();

    if (userErr || !user) {
      return json({ error: 'Unauthorized' }, 401);
    }

    // Admin client — bypasses RLS, can call auth.admin.*.
    const admin = createClient(SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY, {
      auth: { persistSession: false, autoRefreshToken: false },
    });

    const { error: delErr } = await admin.auth.admin.deleteUser(user.id);
    if (delErr) {
      return json({ error: delErr.message }, 500);
    }

    return json({ success: true, userId: user.id });
  } catch (e) {
    const message = e instanceof Error ? e.message : 'Unknown error';
    return json({ error: message }, 500);
  }
});
