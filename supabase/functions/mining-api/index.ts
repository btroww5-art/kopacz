import "jsr:@supabase/functions-js/edge-runtime.d.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Methods": "GET, POST, OPTIONS",
  "Access-Control-Allow-Headers": "Content-Type, Authorization, X-Client-Info, Apikey, x-worker-secret",
};

type WorkerStats = {
  hashrateRaw?: number;
  hashrate1m?: number;
  hashrate15m?: number;
  sharesGood?: number;
  sharesTotal?: number;
  ping?: number;
  uptime?: number;
  diff?: number;
  errors?: number;
  pool?: string;
  threads?: number;
  version?: string;
};

const json = (body: unknown, status = 200) =>
  new Response(JSON.stringify(body), {
    status,
    headers: { ...corsHeaders, "Content-Type": "application/json" },
  });

const cleanPath = (req: Request) => {
  const url = new URL(req.url);
  let path = url.pathname;
  if (path.startsWith("/mining-api")) path = path.slice("/mining-api".length);
  return path.replace(/^\/+/, "");
};

const requireWorkerSecret = (req: Request) => {
  const expected = Deno.env.get("WORKER_API_SECRET");
  if (!expected) return false;
  return req.headers.get("x-worker-secret") === expected;
};

const createServiceClient = () =>
  createClient(
    Deno.env.get("SUPABASE_URL")!,
    Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!,
    { auth: { persistSession: false } },
  );

async function requireAdmin(req: Request, supabase: ReturnType<typeof createServiceClient>) {
  const header = req.headers.get("Authorization") || "";
  const token = header.replace(/^Bearer\s+/i, "");
  if (!token) return null;

  const { data, error } = await supabase.auth.getUser(token);
  if (error || !data.user?.email) return null;

  const allowList = (Deno.env.get("ADMIN_EMAILS") || "")
    .split(",")
    .map((email) => email.trim().toLowerCase())
    .filter(Boolean);

  if (allowList.length > 0 && !allowList.includes(data.user.email.toLowerCase())) {
    return null;
  }

  if (allowList.length === 0 && data.user.app_metadata?.role !== "admin") {
    return null;
  }

  return data.user;
}

function sanitizeStats(stats: WorkerStats) {
  return {
    hashrateRaw: Number(stats.hashrateRaw) || 0,
    hashrate1m: Number(stats.hashrate1m) || 0,
    hashrate15m: Number(stats.hashrate15m) || 0,
    sharesGood: Number(stats.sharesGood) || 0,
    sharesTotal: Number(stats.sharesTotal) || 0,
    ping: Number(stats.ping) || 0,
    uptime: Number(stats.uptime) || 0,
    diff: Number(stats.diff) || 0,
    errors: Number(stats.errors) || 0,
    pool: String(stats.pool || "N/A").slice(0, 120),
    threads: Number(stats.threads) || 0,
    version: String(stats.version || "N/A").slice(0, 60),
  };
}

Deno.serve(async (req: Request) => {
  if (req.method === "OPTIONS") {
    return new Response(null, { status: 200, headers: corsHeaders });
  }

  const supabase = createServiceClient();
  const path = cleanPath(req);
  const url = new URL(req.url);

  try {
    if (req.method === "GET" && (path === "" || path === "status")) {
      return json({
        ok: true,
        running: false,
        protected: Boolean(Deno.env.get("WORKER_API_SECRET")),
        pool: "gulf.moneroocean.stream:10128",
        message: "Dashboard reads Supabase in real time. External workers register through this protected API.",
      });
    }

    if (req.method === "GET" && path === "workers") {
      const admin = await requireAdmin(req, supabase);
      if (!admin) return json({ error: "Unauthorized" }, 401);

      const moneroAddress = url.searchParams.get("moneroAddress");
      let query = supabase.from("workers").select("*").order("last_seen", { ascending: false });
      if (moneroAddress) query = query.eq("monero_address", moneroAddress);

      const { data, error } = await query;
      if (error) throw error;
      return json({ workers: data || [] });
    }

    if (req.method === "POST" && path === "workers/register") {
      if (!requireWorkerSecret(req)) return json({ error: "Unauthorized worker" }, 401);

      const body = await req.json();
      const moneroAddress = String(body.moneroAddress || "").trim();
      const workerId = String(body.workerId || "").trim();
      const hostname = String(body.hostname || "unknown").trim().slice(0, 120);

      if (!moneroAddress || !workerId) {
        return json({ error: "Missing required fields" }, 400);
      }

      const id = `${moneroAddress}:${workerId}`;
      const { data, error } = await supabase.from("workers").upsert({
        id,
        monero_address: moneroAddress,
        worker_id: workerId.slice(0, 120),
        hostname,
        is_local: Boolean(body.isLocal),
        last_seen: new Date().toISOString(),
        online: true,
      }, { onConflict: "id" }).select().single();

      if (error) throw error;
      return json({ success: true, worker: data });
    }

    if (req.method === "POST" && path === "workers/stats") {
      if (!requireWorkerSecret(req)) return json({ error: "Unauthorized worker" }, 401);

      const body = await req.json();
      const moneroAddress = String(body.moneroAddress || "").trim();
      const workerId = String(body.workerId || "").trim();
      if (!moneroAddress || !workerId || !body.stats) {
        return json({ error: "Missing required fields" }, 400);
      }

      const id = `${moneroAddress}:${workerId}`;
      const stats = sanitizeStats(body.stats);
      const { data: existing } = await supabase
        .from("workers")
        .select("history")
        .eq("id", id)
        .maybeSingle();

      const history = Array.isArray(existing?.history) ? existing.history : [];
      history.push({
        ts: Date.now(),
        hashrate: stats.hashrateRaw,
        shares: stats.sharesGood,
        latency: stats.ping,
      });
      while (history.length > 288) history.shift();

      const { error } = await supabase.from("workers").upsert({
        id,
        monero_address: moneroAddress,
        worker_id: workerId.slice(0, 120),
        hostname: String(body.hostname || "unknown").slice(0, 120),
        stats,
        last_seen: new Date().toISOString(),
        online: true,
        history,
      }, { onConflict: "id" });

      if (error) throw error;
      return json({ success: true });
    }

    if (req.method === "POST" && path === "workers/cleanup") {
      const admin = await requireAdmin(req, supabase);
      if (!admin) return json({ error: "Unauthorized" }, 401);

      const fiveMinAgo = new Date(Date.now() - 5 * 60 * 1000).toISOString();
      const { error } = await supabase
        .from("workers")
        .update({ online: false })
        .lt("last_seen", fiveMinAgo)
        .eq("online", true);

      if (error) throw error;
      return json({ success: true });
    }

    return json({ error: "Not found", path, method: req.method }, 404);
  } catch (err) {
    const message = err instanceof Error ? err.message : "Unknown error";
    return json({ error: message }, 500);
  }
});
