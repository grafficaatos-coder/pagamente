import { Container, getContainer } from "@cloudflare/containers";

export class WhatsAppContainer extends Container {
  defaultPort = 8080;
  sleepAfter = "30m";
  enableInternet = true;
  pingEndpoint = "health";
}

function json(body, status, headers) {
  return new Response(JSON.stringify(body), {
    status: status || 200,
    headers: Object.assign({ "content-type": "application/json; charset=utf-8" }, headers || {})
  });
}

function cors(env) {
  return {
    "access-control-allow-origin": env.AGENDA_ORIGIN || "*",
    "access-control-allow-headers": "authorization,content-type",
    "access-control-allow-methods": "GET,POST,OPTIONS"
  };
}

function serviceHeaders(env, extra) {
  return Object.assign({
    apikey: env.SUPABASE_SERVICE_ROLE_KEY,
    authorization: "Bearer " + env.SUPABASE_SERVICE_ROLE_KEY,
    "content-type": "application/json"
  }, extra || {});
}

async function supabase(env, path, options) {
  options = options || {};
  return fetch(env.SUPABASE_URL + path, Object.assign({}, options, {
    headers: serviceHeaders(env, options.headers || {})
  }));
}

async function verifyMember(request, env, businessId) {
  const bearer = request.headers.get("authorization") || "";
  if (!bearer.toLowerCase().startsWith("bearer ")) {
    throw new Response("Sessão ausente", { status: 401 });
  }

  const userRes = await fetch(env.SUPABASE_URL + "/auth/v1/user", {
    headers: {
      apikey: env.SUPABASE_PUBLISHABLE_KEY,
      authorization: bearer
    }
  });
  if (!userRes.ok) throw new Response("Sessão inválida", { status: 401 });

  const user = await userRes.json();
  const memberPath =
    "/rest/v1/agenda_members?business_id=eq." + encodeURIComponent(businessId) +
    "&user_id=eq." + encodeURIComponent(user.id) +
    "&select=role&limit=1";
  const memberRes = await supabase(env, memberPath);
  if (!memberRes.ok) throw new Response("Falha ao validar empresa", { status: 500 });
  const rows = await memberRes.json();
  if (!rows.length) throw new Response("Sem acesso a esta empresa", { status: 403 });
  return { user: user, role: rows[0].role };
}

async function startBusinessContainer(env, businessId) {
  const container = getContainer(env.WHATSAPP_CONTAINER, businessId);
  await container.startAndWaitForPorts({
    ports: [8080],
    startOptions: {
      envVars: {
        BUSINESS_ID: businessId,
        SUPABASE_URL: env.SUPABASE_URL,
        SUPABASE_SERVICE_ROLE_KEY: env.SUPABASE_SERVICE_ROLE_KEY
      },
      enableInternet: true
    },
    cancellationOptions: { portReadyTimeoutMS: 30000 }
  });
  return container;
}

async function forwardToBusiness(request, env, businessId, subpath) {
  const container = await startBusinessContainer(env, businessId);
  const source = new URL(request.url);
  const target = new URL("http://container" + subpath);
  target.search = source.search;
  return container.fetch(new Request(target.toString(), request));
}

function formatDateTime(iso) {
  const d = new Date(iso);
  return {
    date: new Intl.DateTimeFormat("pt-BR", {
      timeZone: "America/Sao_Paulo",
      day: "2-digit",
      month: "2-digit",
      year: "numeric"
    }).format(d),
    time: new Intl.DateTimeFormat("pt-BR", {
      timeZone: "America/Sao_Paulo",
      hour: "2-digit",
      minute: "2-digit",
      hour12: false
    }).format(d)
  };
}

function queueText(item, businessName) {
  const first = String(item.customer_name || "").trim().split(/\\s+/)[0] || "";
  const dt = formatDateTime(item.starts_at);
  const service = item.service_name || "atendimento";
  const professional = item.professional_name || "";
  const hello = "Olá" + (first ? ", " + first : "") + "! 😊";

  if (item.message_type === "reminder") {
    return hello +
      "\n\nPassando para lembrar do seu horário na *" + businessName + "*." +
      "\n\n📅 Data: *" + dt.date + "*" +
      "\n🕐 Horário: *" + dt.time + "*" +
      "\n✨ Serviço: *" + service + "*" +
      (professional ? "\n👤 Profissional: *" + professional + "*" : "") +
      "\n\nSe precisar alterar, fale com a gente por aqui.";
  }

  if (item.message_type === "followup") {
    return hello +
      "\n\nObrigado pelo seu atendimento na *" + businessName + "*." +
      "\n\nEsperamos que tenha gostado. Quando quiser agendar novamente, é só chamar a gente por aqui. 💛";
  }

  return hello +
    "\n\nSeu horário na *" + businessName + "* foi agendado." +
    "\n\n📅 Data: *" + dt.date + "*" +
    "\n🕐 Horário: *" + dt.time + "*" +
    "\n✨ Serviço: *" + service + "*" +
    (professional ? "\n👤 Profissional: *" + professional + "*" : "") +
    "\n\nSe precisar alterar o horário, fale com a gente por aqui.";
}

async function markQueue(env, queueId, patch) {
  await supabase(env, "/rest/v1/agenda_whatsapp_queue?id=eq." + encodeURIComponent(queueId), {
    method: "PATCH",
    body: JSON.stringify(Object.assign({}, patch, { updated_at: new Date().toISOString() }))
  });
}

async function enqueueDue(env) {
  const settingsRes = await supabase(
    env,
    "/rest/v1/agenda_platform_settings?id=eq.true&select=baileys_enabled&limit=1"
  );
  if (!settingsRes.ok) return;
  const settings = await settingsRes.json();
  if (!settings[0] || !settings[0].baileys_enabled) return;

  const sessionRes = await supabase(
    env,
    "/rest/v1/agenda_baileys_sessions?status=eq.connected&select=business_id"
  );
  if (!sessionRes.ok) return;
  const sessions = await sessionRes.json();
  const connected = new Set(sessions.map(function (x) { return x.business_id; }));
  if (!connected.size) return;

  const now = encodeURIComponent(new Date().toISOString());
  const queueRes = await supabase(
    env,
    "/rest/v1/agenda_whatsapp_queue?status=eq.pending&scheduled_for=lte." + now +
    "&select=*&order=scheduled_for.asc&limit=100"
  );
  if (!queueRes.ok) return;

  const due = (await queueRes.json()).filter(function (x) {
    return connected.has(x.business_id);
  });

  for (const item of due) {
    const businessRes = await supabase(
      env,
      "/rest/v1/agenda_businesses?id=eq." + encodeURIComponent(item.business_id) +
      "&select=name&limit=1"
    );
    const businesses = businessRes.ok ? await businessRes.json() : [];
    const businessName = businesses[0] ? businesses[0].name : "Agenda Pro";
    const text = queueText(item, businessName);

    const lockRes = await supabase(
      env,
      "/rest/v1/agenda_whatsapp_queue?id=eq." + encodeURIComponent(item.id) + "&status=eq.pending",
      {
        method: "PATCH",
        headers: { Prefer: "return=representation" },
        body: JSON.stringify({
          status: "queued",
          attempts: Number(item.attempts || 0) + 1,
          last_error: null,
          updated_at: new Date().toISOString()
        })
      }
    );
    const locked = lockRes.ok ? await lockRes.json() : [];
    if (!locked.length) continue;

    await env.MESSAGE_QUEUE.send({
      business_id: item.business_id,
      queue_id: item.id,
      text: text
    });
  }
}

export default {
  async fetch(request, env) {
    const h = cors(env);
    if (request.method === "OPTIONS") return new Response(null, { status: 204, headers: h });

    try {
      const url = new URL(request.url);
      if (url.pathname === "/health") return json({ ok: true }, 200, h);

      const match = url.pathname.match(/^\/v1\/([^/]+)\/(status|connect|disconnect)$/);
      if (!match) return json({ error: "Rota não encontrada" }, 404, h);

      const businessId = match[1];
      const action = match[2];
      const access = await verifyMember(request, env, businessId);

      if ((action === "connect" || action === "disconnect") &&
          ["owner", "admin"].indexOf(access.role) === -1) {
        return json({ error: "Somente administrador pode conectar o WhatsApp" }, 403, h);
      }

      const response = await forwardToBusiness(request, env, businessId, "/" + action);
      const out = new Response(response.body, response);
      Object.entries(h).forEach(function (entry) {
        out.headers.set(entry[0], entry[1]);
      });
      return out;
    } catch (error) {
      if (error instanceof Response) {
        const out = new Response(error.body, error);
        Object.entries(cors(env)).forEach(function (entry) {
          out.headers.set(entry[0], entry[1]);
        });
        return out;
      }
      console.error(error);
      return json({ error: error && error.message ? error.message : "Erro interno" }, 500, cors(env));
    }
  },

  async scheduled(_event, env, ctx) {
    ctx.waitUntil(enqueueDue(env));
  },

  async queue(batch, env) {
    for (const message of batch.messages) {
      const job = message.body;
      try {
        const container = await startBusinessContainer(env, job.business_id);
        const response = await container.fetch(new Request("http://container/send-queue", {
          method: "POST",
          headers: { "content-type": "application/json" },
          body: JSON.stringify({ queue_id: job.queue_id, text: job.text })
        }));
        const data = await response.json().catch(function () { return {}; });
        if (!response.ok) throw new Error(data.error || "Falha no envio");

        await markQueue(env, job.queue_id, {
          status: "done",
          done_at: new Date().toISOString(),
          last_error: null
        });
        message.ack();
      } catch (error) {
        console.error("queue send failed", error);
        await markQueue(env, job.queue_id, {
          status: "pending",
          last_error: error && error.message ? error.message : "Falha temporária"
        });
        message.retry();
      }
    }
  }
};
