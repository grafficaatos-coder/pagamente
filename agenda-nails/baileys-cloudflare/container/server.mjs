import http from "node:http";
import P from "pino";
import QRCode from "qrcode";
import { Boom } from "@hapi/boom";
import makeWASocket, {
  BufferJSON,
  DisconnectReason,
  fetchLatestBaileysVersion,
  initAuthCreds,
  makeCacheableSignalKeyStore,
  proto
} from "@whiskeysockets/baileys";

const BUSINESS_ID = process.env.BUSINESS_ID;
const SUPABASE_URL = process.env.SUPABASE_URL;
const SERVICE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY;
const PORT = Number(process.env.PORT || 8080);

if (!BUSINESS_ID || !SUPABASE_URL || !SERVICE_KEY) {
  throw new Error("Configuração do container incompleta");
}

const logger = P({ level: process.env.LOG_LEVEL || "warn" });
let sock = null;
let connectPromise = null;
let liveStatus = "disconnected";
let latestQrSvg = null;
let latestQrRaw = null;
let reconnectTimer = null;

const headers = {
  apikey: SERVICE_KEY,
  authorization: "Bearer " + SERVICE_KEY,
  "content-type": "application/json"
};

async function rest(path, options) {
  options = options || {};
  return fetch(SUPABASE_URL + path, Object.assign({}, options, {
    headers: Object.assign({}, headers, options.headers || {})
  }));
}

async function updateSession(patch) {
  const row = Object.assign({
    business_id: BUSINESS_ID,
    updated_at: new Date().toISOString()
  }, patch);
  const res = await rest("/rest/v1/agenda_baileys_sessions?on_conflict=business_id", {
    method: "POST",
    headers: { Prefer: "resolution=merge-duplicates,return=minimal" },
    body: JSON.stringify(row)
  });
  if (!res.ok) throw new Error("Falha ao atualizar sessão");
}

async function readSession() {
  const res = await rest(
    "/rest/v1/agenda_baileys_sessions?business_id=eq." +
    encodeURIComponent(BUSINESS_ID) + "&select=*&limit=1"
  );
  if (!res.ok) throw new Error("Falha ao ler sessão");
  const rows = await res.json();
  return rows[0] || null;
}

async function readAuth(keyType, keyId) {
  const path =
    "/rest/v1/agenda_baileys_auth?business_id=eq." + encodeURIComponent(BUSINESS_ID) +
    "&key_type=eq." + encodeURIComponent(keyType) +
    "&key_id=eq." + encodeURIComponent(keyId) +
    "&select=data&limit=1";
  const res = await rest(path);
  if (!res.ok) throw new Error("Falha ao ler autenticação");
  const rows = await res.json();
  if (!rows.length) return null;
  return JSON.parse(rows[0].data, BufferJSON.reviver);
}

async function writeAuth(keyType, keyId, value) {
  if (value == null) {
    const path =
      "/rest/v1/agenda_baileys_auth?business_id=eq." + encodeURIComponent(BUSINESS_ID) +
      "&key_type=eq." + encodeURIComponent(keyType) +
      "&key_id=eq." + encodeURIComponent(keyId);
    const res = await rest(path, { method: "DELETE" });
    if (!res.ok) throw new Error("Falha ao remover chave de autenticação");
    return;
  }

  const row = {
    business_id: BUSINESS_ID,
    key_type: keyType,
    key_id: keyId,
    data: JSON.stringify(value, BufferJSON.replacer),
    updated_at: new Date().toISOString()
  };

  const res = await rest(
    "/rest/v1/agenda_baileys_auth?on_conflict=business_id,key_type,key_id",
    {
      method: "POST",
      headers: { Prefer: "resolution=merge-duplicates,return=minimal" },
      body: JSON.stringify(row)
    }
  );
  if (!res.ok) throw new Error("Falha ao salvar autenticação");
}

async function clearAuth() {
  const res = await rest(
    "/rest/v1/agenda_baileys_auth?business_id=eq." + encodeURIComponent(BUSINESS_ID),
    { method: "DELETE" }
  );
  if (!res.ok) throw new Error("Falha ao limpar autenticação");
}

async function databaseAuthState() {
  const creds = (await readAuth("creds", "creds")) || initAuthCreds();

  const keys = {
    async get(type, ids) {
      const out = {};
      await Promise.all(ids.map(async function (id) {
        let value = await readAuth(type, id);
        if (type === "app-state-sync-key" && value) {
          value = proto.Message.AppStateSyncKeyData.fromObject(value);
        }
        if (value != null) out[id] = value;
      }));
      return out;
    },

    async set(data) {
      const tasks = [];
      for (const type of Object.keys(data || {})) {
        for (const entry of Object.entries(data[type] || {})) {
          tasks.push(writeAuth(type, entry[0], entry[1]));
        }
      }
      await Promise.all(tasks);
    },

    async clear() {
      await clearAuth();
    }
  };

  return {
    state: { creds: creds, keys: keys },
    saveCreds: function () {
      return writeAuth("creds", "creds", creds);
    }
  };
}

function scheduleReconnect() {
  if (reconnectTimer) return;
  reconnectTimer = setTimeout(function () {
    reconnectTimer = null;
    ensureSocket().catch(function (error) {
      logger.error(error, "reconnect failed");
    });
  }, 3000);
}

async function createSocket() {
  const auth = await databaseAuthState();
  const versionInfo = await fetchLatestBaileysVersion();

  liveStatus = "connecting";
  await updateSession({ status: "connecting", last_error: null });

  const next = makeWASocket({
    version: versionInfo.version,
    logger: logger,
    printQRInTerminal: false,
    markOnlineOnConnect: false,
    syncFullHistory: false,
    generateHighQualityLinkPreview: false,
    auth: {
      creds: auth.state.creds,
      keys: makeCacheableSignalKeyStore(auth.state.keys, logger)
    }
  });

  next.ev.on("creds.update", auth.saveCreds);

  next.ev.on("connection.update", async function (update) {
    try {
      if (update.qr) {
        latestQrRaw = update.qr;
        latestQrSvg = await QRCode.toString(update.qr, {
          type: "svg",
          width: 280,
          margin: 1
        });
        liveStatus = "qr";
        await updateSession({
          status: "qr",
          qr: update.qr,
          pairing_code: null,
          last_error: null
        });
      }

      if (update.connection === "open") {
        liveStatus = "connected";
        latestQrRaw = null;
        latestQrSvg = null;
        const userId = String(next.user && next.user.id ? next.user.id : "");
        const phone = userId.split(":")[0].split("@")[0] || null;
        await updateSession({
          status: "connected",
          phone: phone,
          qr: null,
          pairing_code: null,
          connected_at: new Date().toISOString(),
          last_seen_at: new Date().toISOString(),
          last_error: null
        });
      }

      if (update.connection === "close") {
        const statusCode = new Boom(update.lastDisconnect && update.lastDisconnect.error)
          .output.statusCode;
        const loggedOut = statusCode === DisconnectReason.loggedOut;
        sock = null;

        if (loggedOut) {
          liveStatus = "disconnected";
          await clearAuth();
          await updateSession({
            status: "disconnected",
            phone: null,
            qr: null,
            pairing_code: null,
            last_error: "WhatsApp desconectado pelo aparelho"
          });
        } else {
          liveStatus = "error";
          await updateSession({
            status: "error",
            qr: null,
            last_error:
              (update.lastDisconnect && update.lastDisconnect.error &&
               update.lastDisconnect.error.message) ||
              "Conexão interrompida"
          });
          scheduleReconnect();
        }
      }
    } catch (error) {
      logger.error(error, "connection.update failed");
    }
  });

  sock = next;
  return next;
}

async function ensureSocket() {
  if (sock && ["connected", "connecting", "qr"].includes(liveStatus)) return sock;
  if (connectPromise) return connectPromise;

  connectPromise = createSocket().finally(function () {
    connectPromise = null;
  });
  return connectPromise;
}

async function waitForReady(timeout) {
  timeout = timeout || 25000;
  await ensureSocket();
  const started = Date.now();

  while (Date.now() - started < timeout) {
    if (liveStatus === "connected" && sock) return sock;
    if (liveStatus === "qr") throw new Error("WhatsApp precisa ser conectado pelo QR Code");
    await new Promise(function (resolve) { setTimeout(resolve, 350); });
  }
  throw new Error("WhatsApp não ficou disponível a tempo");
}

function normalizePhone(value) {
  let n = String(value || "").replace(/\D/g, "").replace(/^0+/, "");
  if ((n.length === 10 || n.length === 11) && !n.startsWith("55")) n = "55" + n;
  return n;
}

async function loadQueueItem(id) {
  const res = await rest(
    "/rest/v1/agenda_whatsapp_queue?id=eq." + encodeURIComponent(id) +
    "&business_id=eq." + encodeURIComponent(BUSINESS_ID) +
    "&select=*&limit=1"
  );
  if (!res.ok) throw new Error("Falha ao carregar mensagem");
  const rows = await res.json();
  return rows[0] || null;
}

async function disconnect() {
  if (sock) {
    try { await sock.logout(); } catch {}
    try { sock.end(new Error("logout")); } catch {}
  }
  sock = null;
  liveStatus = "disconnected";
  latestQrRaw = null;
  latestQrSvg = null;
  await clearAuth();
  await updateSession({
    status: "disconnected",
    phone: null,
    qr: null,
    pairing_code: null,
    connected_at: null,
    last_error: null
  });
}

function sendJson(res, status, body) {
  const data = JSON.stringify(body);
  res.writeHead(status, {
    "content-type": "application/json; charset=utf-8",
    "content-length": Buffer.byteLength(data)
  });
  res.end(data);
}

async function bodyJson(req) {
  const chunks = [];
  for await (const chunk of req) chunks.push(chunk);
  if (!chunks.length) return {};
  return JSON.parse(Buffer.concat(chunks).toString("utf8"));
}

const server = http.createServer(async function (req, res) {
  try {
    const url = new URL(req.url, "http://localhost");

    if (url.pathname === "/health") {
      return sendJson(res, 200, { ok: true, business_id: BUSINESS_ID });
    }

    if (url.pathname === "/status" && req.method === "GET") {
      const row = await readSession();
      return sendJson(res, 200, {
        ok: true,
        status: row ? row.status : liveStatus,
        phone: row ? row.phone : null,
        qr_svg: row && row.status === "qr" ? latestQrSvg : null,
        qr: row && row.status === "qr" ? (row.qr || latestQrRaw) : null,
        last_error: row ? row.last_error : null
      });
    }

    if (url.pathname === "/connect" && req.method === "POST") {
      await ensureSocket();
      const started = Date.now();
      while (Date.now() - started < 12000 &&
             ["qr", "connected"].indexOf(liveStatus) === -1) {
        await new Promise(function (resolve) { setTimeout(resolve, 250); });
      }

      const row = await readSession();
      return sendJson(res, 200, {
        ok: true,
        status: row ? row.status : liveStatus,
        phone: row ? row.phone : null,
        qr_svg: latestQrSvg,
        qr: row ? (row.qr || latestQrRaw) : latestQrRaw,
        last_error: row ? row.last_error : null
      });
    }

    if (url.pathname === "/disconnect" && req.method === "POST") {
      await disconnect();
      return sendJson(res, 200, { ok: true, status: "disconnected" });
    }

    if (url.pathname === "/send-queue" && req.method === "POST") {
      const body = await bodyJson(req);
      const queueId = String(body.queue_id || "");
      const text = String(body.text || "");
      if (!queueId || !text) {
        return sendJson(res, 400, { error: "Mensagem incompleta" });
      }

      const item = await loadQueueItem(queueId);
      if (!item) return sendJson(res, 404, { error: "Mensagem não encontrada" });
      if (item.status === "done" || item.status === "cancelled") {
        return sendJson(res, 200, { ok: true, skipped: true });
      }

      const phone = normalizePhone(item.customer_phone);
      if (!phone) {
        return sendJson(res, 400, { error: "Cliente sem WhatsApp cadastrado" });
      }

      const socket = await waitForReady();
      const jid = phone + "@s.whatsapp.net";
      const result = await socket.sendMessage(jid, { text: text });

      await updateSession({
        last_seen_at: new Date().toISOString(),
        last_error: null
      });

      return sendJson(res, 200, {
        ok: true,
        sent: true,
        message_id: result && result.key ? result.key.id : null
      });
    }

    return sendJson(res, 404, { error: "Rota não encontrada" });
  } catch (error) {
    logger.error(error);
    return sendJson(res, 500, {
      error: error && error.message ? error.message : "Erro interno"
    });
  }
});

server.listen(PORT, "0.0.0.0", function () {
  logger.info({ port: PORT, business: BUSINESS_ID }, "Baileys container ready");
});
