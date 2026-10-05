import { Container } from "@cloudflare/containers";

function runtimeRequest(path, init) {
  return new Request("https://agenda-whatsapp-runtime" + path, init);
}

function runtimeStub(env, businessId) {
  return env.WHATSAPP_CONTAINER.getByName(businessId);
}

function json(body, status = 200, headers = {}) {
  return new Response(JSON.stringify(body), {
    status,
    headers: {
      "content-type": "application/json; charset=utf-8",
      "cache-control": "no-store",
      ...headers
    }
  });
}

function cors(env) {
  return {
    "access-control-allow-origin": env.AGENDA_ORIGIN || "*",
    "access-control-allow-headers": "authorization,content-type",
    "access-control-allow-methods": "GET,POST,OPTIONS"
  };
}

function serviceHeaders(env, extra = {}) {
  return {
    apikey: env.SUPABASE_SERVICE_ROLE_KEY,
    authorization: "Bearer " + env.SUPABASE_SERVICE_ROLE_KEY,
    "content-type": "application/json",
    ...extra
  };
}

async function supabase(env, path, options = {}) {
  return fetch(env.SUPABASE_URL + path, {
    ...options,
    headers: serviceHeaders(env, options.headers || {})
  });
}

async function rpc(env, name, args = {}) {
  const response = await supabase(env, "/rest/v1/rpc/" + name, {
    method: "POST",
    body: JSON.stringify(args)
  });
  if (!response.ok) {
    throw new Error(name + ": " + response.status + " " + await response.text());
  }
  if (response.status === 204) return null;
  return response.json();
}

async function verifyMember(request, env, businessId) {
  const bearer = request.headers.get("authorization") || "";
  if (!bearer.toLowerCase().startsWith("bearer ")) {
    throw new Response("Sessão ausente", { status: 401 });
  }

  const userResponse = await fetch(env.SUPABASE_URL + "/auth/v1/user", {
    headers: {
      apikey: env.SUPABASE_PUBLISHABLE_KEY,
      authorization: bearer
    }
  });
  if (!userResponse.ok) throw new Response("Sessão inválida", { status: 401 });

  const user = await userResponse.json();
  const memberResponse = await supabase(
    env,
    "/rest/v1/agenda_members?business_id=eq." + encodeURIComponent(businessId) +
      "&user_id=eq." + encodeURIComponent(user.id) +
      "&select=role&limit=1"
  );
  if (!memberResponse.ok) throw new Response("Falha ao validar empresa", { status: 500 });
  const rows = await memberResponse.json();
  if (!rows.length) throw new Response("Sem acesso a esta empresa", { status: 403 });

  return { user, role: rows[0].role };
}

function internalAuthorized(request, env) {
  const supplied = request.headers.get("x-internal-token") || "";
  const expected = String(env.INTERNAL_TOKEN || "");
  return Boolean(expected && supplied && supplied === expected);
}

function normalizePhone(value) {
  let phone = String(value || "").replace(/\D/g, "").replace(/^0+/, "");
  if ((phone.length === 10 || phone.length === 11) && !phone.startsWith("55")) {
    phone = "55" + phone;
  }
  return phone;
}

function formatAppointment(iso) {
  const date = new Date(iso);
  return {
    date: new Intl.DateTimeFormat("pt-BR", {
      timeZone: "America/Sao_Paulo",
      day: "2-digit",
      month: "2-digit",
      year: "numeric"
    }).format(date),
    time: new Intl.DateTimeFormat("pt-BR", {
      timeZone: "America/Sao_Paulo",
      hour: "2-digit",
      minute: "2-digit",
      hour12: false
    }).format(date)
  };
}

function messageText(kind, business, customer, service, appointment) {
  const first = String(customer.name || "").trim().split(/\s+/)[0] || "Cliente";
  const when = formatAppointment(appointment.starts_at);
  const professional = String(appointment.professional_name || "").trim();
  const proLine = professional ? "\n👤 Profissional: *" + professional + "*" : "";

  if (kind === "reminder") {
    return "Olá, " + first + "! 😊\n\n" +
      "Passando para lembrar do seu horário na *" + business.name + "*.\n\n" +
      "📅 Data: *" + when.date + "*\n" +
      "🕐 Horário: *" + when.time + "*\n" +
      "✨ Serviço: *" + service.name + "*" + proLine +
      "\n\nSe precisar alterar, fale com a gente por aqui.";
  }

  if (kind === "followup") {
    return "Olá, " + first + "! 😊\n\n" +
      "Obrigado pelo seu atendimento na *" + business.name + "*.\n\n" +
      "Esperamos que tenha gostado. Quando quiser agendar novamente, é só chamar a gente por aqui. 💛";
  }

  return "Olá, " + first + "! 😊\n\n" +
    "Seu horário na *" + business.name + "* foi agendado.\n\n" +
    "📅 Data: *" + when.date + "*\n" +
    "🕐 Horário: *" + when.time + "*\n" +
    "✨ Serviço: *" + service.name + "*" + proLine +
    "\n\nSe precisar alterar o horário, fale com a gente por aqui.";
}

async function fetchOne(env, path) {
  const response = await supabase(env, path);
  if (!response.ok) throw new Error("Banco: " + response.status + " " + await response.text());
  const rows = await response.json();
  return rows[0] || null;
}

async function cancelClaimed(env, businessId, job, reason) {
  await rpc(env, "agenda_baileys_cancel_job", {
    p_business_id: businessId,
    p_job_id: job.id,
    p_reservation_token: job.reservation_token,
    p_reason: reason
  });
}

async function validatedDispatch(env, businessId) {
  for (let pass = 0; pass < 5; pass += 1) {
    const job = await rpc(env, "agenda_baileys_claim_next", {
      p_business_id: businessId,
      p_lease_id: null
    });
    if (!job) return null;

    // claim_next normally receives the active lease. The internal route patches
    // this parameter before calling this helper.
    return job;
  }
  return null;
}

async function claimAndValidate(env, businessId, leaseId) {
  for (let pass = 0; pass < 5; pass += 1) {
    const job = await rpc(env, "agenda_baileys_claim_next", {
      p_business_id: businessId,
      p_lease_id: leaseId
    });
    if (!job) return null;

    const appointment = await fetchOne(
      env,
      "/rest/v1/agenda_appointments?id=eq." + encodeURIComponent(job.appointment_id) +
        "&business_id=eq." + encodeURIComponent(businessId) +
        "&select=id,business_id,customer_id,service_id,professional_name,starts_at,status&limit=1"
    );

    if (!appointment) {
      await cancelClaimed(env, businessId, job, "Agendamento não existe mais.");
      continue;
    }

    if (appointment.status === "cancelled" || appointment.status === "no_show") {
      await cancelClaimed(env, businessId, job, "Agendamento cancelado ou marcado como falta.");
      continue;
    }

    if (job.message_type === "followup" && appointment.status !== "completed") {
      await cancelClaimed(env, businessId, job, "Pós-atendimento cancelado porque o atendimento não foi concluído.");
      continue;
    }

    if (job.message_type === "reminder" && new Date(appointment.starts_at).getTime() <= Date.now()) {
      await cancelClaimed(env, businessId, job, "Lembrete expirou porque o horário já passou.");
      continue;
    }

    const [customer, service, business] = await Promise.all([
      fetchOne(
        env,
        "/rest/v1/agenda_customers?id=eq." + encodeURIComponent(appointment.customer_id) +
          "&business_id=eq." + encodeURIComponent(businessId) +
          "&select=id,name,phone&limit=1"
      ),
      fetchOne(
        env,
        "/rest/v1/agenda_services?id=eq." + encodeURIComponent(appointment.service_id) +
          "&business_id=eq." + encodeURIComponent(businessId) +
          "&select=id,name,duration_minutes&limit=1"
      ),
      fetchOne(
        env,
        "/rest/v1/agenda_businesses?id=eq." + encodeURIComponent(businessId) +
          "&select=id,name&limit=1"
      )
    ]);

    if (!customer || !service || !business) {
      await cancelClaimed(env, businessId, job, "Cliente, serviço ou empresa não encontrado na revalidação.");
      continue;
    }

    const currentPhone = normalizePhone(customer.phone);
    const queuedPhone = normalizePhone(job.customer_phone);

    if (!currentPhone) {
      await cancelClaimed(env, businessId, job, "Cliente está sem WhatsApp cadastrado.");
      continue;
    }

    if (queuedPhone && queuedPhone !== currentPhone) {
      await cancelClaimed(env, businessId, job, "Telefone da cliente mudou depois que a mensagem entrou na fila.");
      continue;
    }

    return {
      id: job.id,
      appointment_id: job.appointment_id,
      message_type: job.message_type,
      reservation_token: job.reservation_token,
      delivery_semantics: job.delivery_semantics || "AT_MOST_ONCE",
      phone: currentPhone,
      text: messageText(job.message_type, business, customer, service, appointment)
    };
  }

  return null;
}

async function configureRuntime(env, businessId, apiBaseUrl, profileKey) {
  const stub = runtimeStub(env, businessId);
  const response = await stub.fetch(runtimeRequest("/__runtime/configure", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({
      businessId,
      profileKey: profileKey || ("agenda-whatsapp/" + businessId + ".tar.gz"),
      apiBaseUrl
    })
  }));
  if (!response.ok) throw new Error("Falha ao iniciar runtime: " + await response.text());
  return stub;
}

export class WhatsAppContainer extends Container {
  defaultPort = 8080;
  requiredPorts = [8080];
  sleepAfter = "10m";
  pingEndpoint = "localhost/ready";
  enableInternet = true;

  async runtimeConfig() {
    return (await this.ctx.storage.get("runtime_config")) || null;
  }

  async ensureSelfHealSchedule() {
    const scheduled = await this.listSchedules("selfHeal");
    if (!scheduled.length) await this.schedule(60, "selfHeal", null);
  }

  async restoreProfile(config) {
    const object = await this.env.WHATSAPP_PROFILES.get(config.profileKey);
    if (!object) return false;

    const response = await this.containerFetch(new Request("https://agenda-runtime/restore", {
      method: "POST",
      headers: { "content-type": "application/gzip" },
      body: object.body
    }));
    if (!response.ok) throw new Error("Falha ao restaurar sessão R2: " + await response.text());
    return true;
  }

  async checkpointProfile(config) {
    await this.ctx.storage.put("checkpoint_pending", true);

    const response = await this.containerFetch(
      new Request("https://agenda-runtime/checkpoint", { method: "POST" })
    );
    if (response.status === 204) {
      await this.ctx.storage.put("checkpoint_pending", false);
      return false;
    }
    if (!response.ok || !response.body) {
      throw new Error("Checkpoint falhou: " + response.status + " " + await response.text());
    }

    await this.env.WHATSAPP_PROFILES.put(config.profileKey, response.body, {
      httpMetadata: { contentType: "application/gzip" },
      customMetadata: {
        business_id: config.businessId,
        saved_at: new Date().toISOString()
      }
    });

    const ack = await this.containerFetch(
      new Request("https://agenda-runtime/checkpoint-ack", { method: "POST" })
    );
    if (!ack.ok) throw new Error("Checkpoint salvo no R2, mas o runtime não confirmou.");

    await this.ctx.storage.put("checkpoint_pending", false);
    return true;
  }

  async ensureStarted(config) {
    const next = config || await this.runtimeConfig();
    if (!next) throw new Error("Runtime WhatsApp sem configuração.");
    if (config) await this.ctx.storage.put("runtime_config", config);

    const state = await this.getState();
    if (state.status === "healthy" || state.status === "running") {
      this.renewActivityTimeout();
      await this.ensureSelfHealSchedule();
      return;
    }

    await this.startAndWaitForPorts({
      ports: [8080],
      startOptions: {
        envVars: {
          API_BASE_URL: next.apiBaseUrl,
          INTERNAL_TOKEN: this.env.INTERNAL_TOKEN,
          BUSINESS_ID: next.businessId,
          WHATSAPP_AUTH_DIR: "/data/auth",
          WHATSAPP_LOG_LEVEL: "warn"
        },
        enableInternet: true
      },
      cancellationOptions: { portReadyTimeoutMS: 45000 }
    });

    await this.restoreProfile(next);
    const start = await this.containerFetch(
      new Request("https://agenda-runtime/start", { method: "POST" })
    );
    if (!start.ok) throw new Error("Runtime não iniciou: " + await start.text());

    await this.ensureSelfHealSchedule();
  }

  async waitForStopped(timeoutMs = 45000) {
    const deadline = Date.now() + timeoutMs;
    while (Date.now() < deadline) {
      const state = await this.getState();
      if (state.status === "stopped" || state.status === "stopped_with_code") return true;
      await new Promise(resolve => setTimeout(resolve, 500));
    }
    return false;
  }

  async stopRuntime() {
    await this.stop("SIGTERM").catch(() => undefined);
    let stopped = await this.waitForStopped(45000);
    if (!stopped) {
      await this.stop("SIGKILL").catch(() => undefined);
      stopped = await this.waitForStopped(10000);
    }
    if (!stopped) throw new Error("Container não parou.");
  }

  async restartRuntime(config) {
    const state = await this.getState();
    if (state.status === "healthy" || state.status === "running") {
      try {
        const status = await this.containerFetch(new Request("https://agenda-runtime/status"));
        const payload = await status.clone().json().catch(() => ({}));
        if (status.ok && payload.state === "online") {
          await this.checkpointProfile(config);
        }
      } catch {}
    }
    await this.stopRuntime();
    await this.ensureStarted(config);
  }

  async configureDesiredOnline(config) {
    await this.ctx.storage.put("runtime_config", config);
    await this.ensureStarted(config);

    try {
      const response = await this.containerFetch(new Request("https://agenda-runtime/status"));
      const payload = await response.clone().json().catch(() => ({}));
      const runtimeState = String(payload.state || "").toLowerCase();
      if (runtimeState === "offline" || runtimeState === "standby_lease") {
        await this.containerFetch(new Request("https://agenda-runtime/start", { method: "POST" }));
      }
    } catch {}

    this.renewActivityTimeout();
    await this.ensureSelfHealSchedule();
  }

  async selfHeal() {
    const config = await this.runtimeConfig();
    if (!config) return;

    const previous = (await this.ctx.storage.get("runtime_health")) || {
      consecutiveFailures: 0
    };

    try {
      await this.ensureStarted(config);

      const response = await this.containerFetch(new Request("https://agenda-runtime/status"));
      const payload = await response.clone().json().catch(() => ({}));
      const state = String(payload.state || "").toLowerCase();

      if (!response.ok || state === "error") {
        throw new Error(String(payload.error || ("Runtime respondeu " + response.status)));
      }

      if (state === "online" && (payload.checkpoint_dirty || await this.ctx.storage.get("checkpoint_pending"))) {
        await this.checkpointProfile(config);
      }

      const transient = new Set(["starting", "connecting", "restoring", "standby_lease"]);
      const nowIso = new Date().toISOString();

      if (transient.has(state)) {
        const transientSince =
          previous.transientState === state && previous.transientSince
            ? previous.transientSince
            : nowIso;
        const age = Date.now() - Date.parse(transientSince);
        if (Number.isFinite(age) && age > 180000 && state !== "standby_lease") {
          throw new Error("Runtime preso em " + state + " por mais de 180 segundos.");
        }
        await this.ctx.storage.put("runtime_health", {
          ...previous,
          consecutiveFailures: 0,
          lastOkAt: nowIso,
          lastError: undefined,
          transientState: state,
          transientSince
        });
      } else {
        await this.ctx.storage.put("runtime_health", {
          ...previous,
          consecutiveFailures: 0,
          lastOkAt: nowIso,
          lastError: undefined,
          transientState: undefined,
          transientSince: undefined
        });
      }

      this.renewActivityTimeout();
    } catch (error) {
      const failures = Number(previous.consecutiveFailures || 0) + 1;
      const message = error instanceof Error ? error.message : String(error);
      const next = {
        ...previous,
        consecutiveFailures: failures,
        lastErrorAt: new Date().toISOString(),
        lastError: message.slice(0, 1200)
      };

      if (failures >= 2) {
        try {
          await this.restartRuntime(config);
          next.consecutiveFailures = 0;
          next.lastRestartAt = new Date().toISOString();
          next.transientState = undefined;
          next.transientSince = undefined;
        } catch (restartError) {
          next.lastError = (
            message + "; reinício falhou: " +
            (restartError instanceof Error ? restartError.message : String(restartError))
          ).slice(0, 1200);
        }
      }

      await this.ctx.storage.put("runtime_health", next);
      console.error(JSON.stringify({
        level: "error",
        event: "agenda_whatsapp_self_heal",
        business_id: config.businessId,
        failures,
        message
      }));
    } finally {
      this.deleteSchedules("selfHeal");
      await this.schedule(60, "selfHeal", null).catch(() => undefined);
    }
  }

  async fetch(request) {
    const url = new URL(request.url);

    if (url.pathname === "/__runtime/configure") {
      const config = await request.json();
      await this.configureDesiredOnline(config);
      return json({ ok: true, state: await this.getState() });
    }

    if (url.pathname === "/__runtime/keepalive") {
      await this.ensureStarted();
      this.renewActivityTimeout();
      return json({ ok: true, state: await this.getState() });
    }

    if (url.pathname === "/__runtime/status") {
      return json({
        ok: true,
        state: await this.getState(),
        health: (await this.ctx.storage.get("runtime_health")) || null,
        configured: Boolean(await this.runtimeConfig())
      });
    }

    if (url.pathname === "/__runtime/restart") {
      const config = await this.runtimeConfig();
      if (!config) return json({ ok: false, error: "Configuração ausente." }, 409);
      await this.restartRuntime(config);
      return json({ ok: true, state: await this.getState() });
    }

    if (url.pathname === "/__runtime/stop") {
      const config = await this.runtimeConfig();
      if (config) {
        try {
          const status = await this.containerFetch(new Request("https://agenda-runtime/status"));
          const payload = await status.clone().json().catch(() => ({}));
          if (status.ok && payload.state === "online") await this.checkpointProfile(config);
        } catch {}
      }
      await this.stopRuntime().catch(() => undefined);
      return json({ ok: true });
    }

    if (url.pathname === "/disconnect") {
      await this.ensureStarted();
      const response = await this.containerFetch(request);
      const config = await this.runtimeConfig();
      if (config) await this.env.WHATSAPP_PROFILES.delete(config.profileKey);
      await this.stopRuntime().catch(() => undefined);
      return response;
    }

    await this.ensureStarted();
    this.renewActivityTimeout();
    return this.containerFetch(request);
  }

  async onStop(params) {
    console.log(JSON.stringify({
      level: "info",
      event: "agenda_whatsapp_container_stop",
      ...params,
      durable_object: this.ctx.id.toString()
    }));
  }

  onError(error) {
    console.error(JSON.stringify({
      level: "error",
      event: "agenda_whatsapp_container_error",
      error: error instanceof Error ? error.message : String(error),
      durable_object: this.ctx.id.toString()
    }));
    throw error;
  }
}

async function internalRoute(request, env, url) {
  if (!internalAuthorized(request, env)) return json({ error: "Não autorizado" }, 401);

  const businessId = String(request.headers.get("x-business-id") || "").trim();
  if (!businessId) return json({ error: "x-business-id obrigatório" }, 400);

  if (url.pathname === "/internal/lease" && request.method === "POST") {
    const body = await request.json().catch(() => ({}));
    const owned = await rpc(env, "agenda_baileys_acquire_lease", {
      p_business_id: businessId,
      p_lease_id: String(body.lease_id || ""),
      p_ttl_seconds: 20
    });
    return json({ ok: true, owned: Boolean(owned) });
  }

  if (url.pathname === "/internal/lease/release" && request.method === "POST") {
    const body = await request.json().catch(() => ({}));
    const released = await rpc(env, "agenda_baileys_release_lease", {
      p_business_id: businessId,
      p_lease_id: String(body.lease_id || "")
    });
    return json({ ok: true, released: Boolean(released) });
  }

  if (url.pathname === "/internal/heartbeat" && request.method === "POST") {
    const body = await request.json().catch(() => ({}));
    const accepted = await rpc(env, "agenda_baileys_heartbeat", {
      p_business_id: businessId,
      p_lease_id: String(body.lease_id || ""),
      p_agent_id: String(body.agent_id || ""),
      p_status: String(body.state || "offline"),
      p_phone: body.phone || null,
      p_error: body.error || null,
      p_checkpoint_at: body.last_checkpoint_at || null
    });
    return json({ ok: Boolean(accepted) });
  }

  if (url.pathname === "/internal/dispatch/next" && request.method === "POST") {
    const body = await request.json().catch(() => ({}));
    const message = await claimAndValidate(env, businessId, String(body.lease_id || ""));
    return json({ message });
  }

  let match = url.pathname.match(/^\/internal\/dispatch\/([^/]+)\/(start|complete|fail)$/);
  if (match && request.method === "POST") {
    const jobId = match[1];
    const action = match[2];
    const body = await request.json().catch(() => ({}));
    const token = body.reservation_token;

    if (action === "start") {
      const ok = await rpc(env, "agenda_baileys_mark_dispatch_started", {
        p_business_id: businessId,
        p_job_id: jobId,
        p_reservation_token: token
      });
      return json({ ok: Boolean(ok) }, ok ? 200 : 409);
    }

    if (action === "complete") {
      const ok = await rpc(env, "agenda_baileys_complete_job", {
        p_business_id: businessId,
        p_job_id: jobId,
        p_reservation_token: token,
        p_message_ref: body.message_ref || null
      });
      return json({ ok: Boolean(ok) }, ok ? 200 : 409);
    }

    const ok = await rpc(env, "agenda_baileys_fail_job", {
      p_business_id: businessId,
      p_job_id: jobId,
      p_reservation_token: token,
      p_error: String(body.error || "Falha no envio").slice(0, 1500),
      p_no_retry: body.no_retry !== false
    });
    return json({ ok: Boolean(ok) }, ok ? 200 : 409);
  }

  return json({ error: "Rota interna não encontrada" }, 404);
}

async function upsertConnectState(env, businessId) {
  const profileKey = "agenda-whatsapp/" + businessId + ".tar.gz";
  const response = await supabase(env, "/rest/v1/agenda_baileys_sessions?on_conflict=business_id", {
    method: "POST",
    headers: { Prefer: "resolution=merge-duplicates,return=representation" },
    body: JSON.stringify({
      business_id: businessId,
      status: "connecting",
      desired_online: true,
      profile_key: profileKey,
      last_error: null,
      updated_at: new Date().toISOString()
    })
  });
  if (!response.ok) throw new Error("Falha ao preparar conexão: " + await response.text());
  const rows = await response.json();
  return rows[0];
}

async function publicRoute(request, env, url) {
  const match = url.pathname.match(/^\/v1\/([^/]+)\/(status|connect|disconnect)$/);
  if (!match) return null;

  const businessId = decodeURIComponent(match[1]);
  const action = match[2];
  const access = await verifyMember(request, env, businessId);

  if ((action === "connect" || action === "disconnect") &&
      !["owner", "admin"].includes(access.role)) {
    return json({ error: "Somente o administrador da empresa pode conectar o WhatsApp" }, 403);
  }

  if (action === "connect") {
    const row = await upsertConnectState(env, businessId);
    const stub = await configureRuntime(
      env,
      businessId,
      url.origin,
      row.profile_key
    );
    const response = await stub.fetch(runtimeRequest("/connect", { method: "POST" }));
    return new Response(response.body, {
      status: response.status,
      headers: response.headers
    });
  }

  if (action === "status") {
    const session = await fetchOne(
      env,
      "/rest/v1/agenda_baileys_sessions?business_id=eq." +
        encodeURIComponent(businessId) +
        "&select=business_id,status,desired_online,phone,last_error,last_seen_at,last_checkpoint_at,profile_key&limit=1"
    );

    if (!session || !session.desired_online) {
      return json({
        ok: true,
        status: session?.status || "disconnected",
        phone: session?.phone || null,
        qr_svg: null,
        last_error: session?.last_error || null
      });
    }

    const stub = runtimeStub(env, businessId);
    const response = await stub.fetch(runtimeRequest("/status"));
    return new Response(response.body, {
      status: response.status,
      headers: response.headers
    });
  }

  const stub = runtimeStub(env, businessId);
  try {
    await stub.fetch(runtimeRequest("/disconnect", { method: "POST" }));
  } catch {}

  await supabase(
    env,
    "/rest/v1/agenda_baileys_sessions?business_id=eq." + encodeURIComponent(businessId),
    {
      method: "PATCH",
      body: JSON.stringify({
        status: "disconnected",
        desired_online: false,
        phone: null,
        qr: null,
        pairing_code: null,
        runtime_lease_id: null,
        runtime_lease_expires_at: null,
        last_error: null,
        updated_at: new Date().toISOString()
      })
    }
  );

  return json({ ok: true, status: "disconnected" });
}

async function keepConnections(env) {
  const settings = await fetchOne(
    env,
    "/rest/v1/agenda_platform_settings?id=eq.true&select=baileys_enabled,baileys_service_url&limit=1"
  );
  if (!settings?.baileys_enabled || !settings?.baileys_service_url) return [];

  const response = await supabase(
    env,
    "/rest/v1/agenda_baileys_sessions?desired_online=eq.true&select=business_id,status,last_seen_at,profile_key,last_recovery_at"
  );
  if (!response.ok) throw new Error(await response.text());
  const sessions = await response.json();
  const results = [];

  for (const row of sessions) {
    try {
      const stub = await configureRuntime(
        env,
        row.business_id,
        String(settings.baileys_service_url).replace(/\/$/, ""),
        row.profile_key || ("agenda-whatsapp/" + row.business_id + ".tar.gz")
      );

      const seen = row.last_seen_at ? Date.parse(row.last_seen_at) : 0;
      const staleMs = seen ? Date.now() - seen : Infinity;

      if (staleMs > 120000 && row.status !== "qr") {
        await supabase(
          env,
          "/rest/v1/agenda_baileys_sessions?business_id=eq." + encodeURIComponent(row.business_id),
          {
            method: "PATCH",
            body: JSON.stringify({
              status: "connecting",
              last_error: null,
              last_recovery_at: new Date().toISOString(),
              recovery_attempts: 1,
              updated_at: new Date().toISOString()
            })
          }
        );
        const restart = await stub.fetch(runtimeRequest("/__runtime/restart", { method: "POST" }));
        if (!restart.ok) throw new Error(await restart.text());
        results.push({ business_id: row.business_id, action: "restart" });
      } else {
        await stub.fetch(runtimeRequest("/__runtime/keepalive", { method: "POST" }));
        results.push({ business_id: row.business_id, action: "keepalive" });
      }
    } catch (error) {
      results.push({
        business_id: row.business_id,
        action: "error",
        error: error instanceof Error ? error.message : String(error)
      });
    }
  }

  return results;
}

export default {
  async fetch(request, env) {
    const headers = cors(env);
    if (request.method === "OPTIONS") {
      return new Response(null, { status: 204, headers });
    }

    try {
      const url = new URL(request.url);

      if (url.pathname === "/health") {
        return json({ ok: true, service: "agenda-pro-baileys" }, 200, headers);
      }

      if (url.pathname.startsWith("/internal/")) {
        const response = await internalRoute(request, env, url);
        Object.entries(headers).forEach(([key, value]) => response.headers.set(key, value));
        return response;
      }

      const routed = await publicRoute(request, env, url);
      if (routed) {
        Object.entries(headers).forEach(([key, value]) => routed.headers.set(key, value));
        return routed;
      }

      return json({ error: "Rota não encontrada" }, 404, headers);
    } catch (error) {
      if (error instanceof Response) {
        const response = new Response(error.body, error);
        Object.entries(headers).forEach(([key, value]) => response.headers.set(key, value));
        return response;
      }

      console.error(error);
      return json({
        error: error instanceof Error ? error.message : "Erro interno"
      }, 500, headers);
    }
  },

  async scheduled(_event, env, ctx) {
    ctx.waitUntil(keepConnections(env));
  }
};
