import { createClient } from "https://esm.sh/@supabase/supabase-js@2.45.0";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
};

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response(null, { headers: corsHeaders });

  try {
    const url = Deno.env.get("SUPABASE_URL")!;
    const anon = Deno.env.get("SUPABASE_PUBLISHABLE_KEY") ?? Deno.env.get("SUPABASE_ANON_KEY")!;
    const service = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;

    const auth = req.headers.get("Authorization") ?? "";
    const userClient = createClient(url, anon, { global: { headers: { Authorization: auth } } });
    const { data: ures } = await userClient.auth.getUser();
    if (!ures.user) return new Response(JSON.stringify({ error: "Unauthorized" }), { status: 401, headers: { ...corsHeaders, "Content-Type": "application/json" } });

    const admin = createClient(url, service);
    const { data: roleRow } = await admin.from("user_roles").select("role").eq("user_id", ures.user.id).eq("role", "super_admin").maybeSingle();
    if (!roleRow) return new Response(JSON.stringify({ error: "Forbidden" }), { status: 403, headers: { ...corsHeaders, "Content-Type": "application/json" } });

    const body = await req.json() as {
      action?: "create" | "update" | "delete";
      user_id?: string;
      email?: string;
      password?: string;
      name?: string;
      phone?: string;
      branch_id?: string | null;
      role?: "super_admin" | "branch_user";
    };
    const action = body.action ?? "create";

    if (action === "create") {
      if (!body.email || !body.password || !body.name) {
        return new Response(JSON.stringify({ error: "Missing fields" }), { status: 400, headers: { ...corsHeaders, "Content-Type": "application/json" } });
      }
      const { data: created, error: cErr } = await admin.auth.admin.createUser({
        email: body.email,
        password: body.password,
        email_confirm: true,
        user_metadata: { name: body.name, username: body.email },
      });
      if (cErr || !created.user) throw cErr ?? new Error("create failed");
      await admin.from("profiles").update({ name: body.name, phone: body.phone ?? null, branch_id: body.branch_id ?? null }).eq("id", created.user.id);
      await admin.from("user_roles").insert({ user_id: created.user.id, role: body.role ?? "branch_user" });
      return new Response(JSON.stringify({ id: created.user.id }), { headers: { ...corsHeaders, "Content-Type": "application/json" } });
    }

    if (action === "update") {
      if (!body.user_id) return new Response(JSON.stringify({ error: "user_id required" }), { status: 400, headers: { ...corsHeaders, "Content-Type": "application/json" } });
      const authUpdate: Record<string, unknown> = {};
      if (body.email) authUpdate.email = body.email;
      if (body.password) authUpdate.password = body.password;
      if (body.name) authUpdate.user_metadata = { name: body.name, username: body.email ?? body.name };
      if (Object.keys(authUpdate).length > 0) {
        const { error: uErr } = await admin.auth.admin.updateUserById(body.user_id, authUpdate);
        if (uErr) throw uErr;
      }
      const profileUpdate: Record<string, unknown> = {};
      if (body.name !== undefined) profileUpdate.name = body.name;
      if (body.phone !== undefined) profileUpdate.phone = body.phone ?? null;
      if (body.branch_id !== undefined) profileUpdate.branch_id = body.branch_id ?? null;
      if (body.email !== undefined) profileUpdate.username = body.email;
      if (Object.keys(profileUpdate).length > 0) {
        await admin.from("profiles").update(profileUpdate).eq("id", body.user_id);
      }
      if (body.role) {
        await admin.from("user_roles").delete().eq("user_id", body.user_id);
        await admin.from("user_roles").insert({ user_id: body.user_id, role: body.role });
      }
      return new Response(JSON.stringify({ id: body.user_id }), { headers: { ...corsHeaders, "Content-Type": "application/json" } });
    }

    if (action === "delete") {
      if (!body.user_id) return new Response(JSON.stringify({ error: "user_id required" }), { status: 400, headers: { ...corsHeaders, "Content-Type": "application/json" } });
      if (body.user_id === ures.user.id) {
        return new Response(JSON.stringify({ error: "O'zingizni o'chira olmaysiz" }), { status: 400, headers: { ...corsHeaders, "Content-Type": "application/json" } });
      }
      await admin.from("user_roles").delete().eq("user_id", body.user_id);
      await admin.from("profiles").delete().eq("id", body.user_id);
      const { error: dErr } = await admin.auth.admin.deleteUser(body.user_id);
      if (dErr) throw dErr;
      return new Response(JSON.stringify({ id: body.user_id }), { headers: { ...corsHeaders, "Content-Type": "application/json" } });
    }

    return new Response(JSON.stringify({ error: "Unknown action" }), { status: 400, headers: { ...corsHeaders, "Content-Type": "application/json" } });
  } catch (e) {
    return new Response(JSON.stringify({ error: (e as Error).message }), { status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" } });
  }
});