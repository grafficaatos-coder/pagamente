import http from "node:http";
import path from "node:path";
import os from "node:os";
import { createReadStream, createWriteStream } from "node:fs";
import {
  access,
  mkdir,
  mkdtemp,
  readFile,
  rm,
  stat,
  writeFile
} from "node:fs/promises";
import { pipeline } from "node:stream/promises";
import { execFile } from "node:child_process";
import { promisify } from "node:util";
import P from "pino";
import QRCode from "qrcode";
import makeWASocket, {
  Browsers,
  DisconnectReason,
  jidNormalizedUser,
  useMultiFileAuthState
} from "@whiskeysockets/baileys";

const execFileAsync = promisify(execFile);
const logger = P({ level: process.env.WHATSAPP_LOG_LEVEL || "warn" });

const API_BASE_URL = String(process.env.API_BASE_URL || "").replace(/\/$/, "");
const INTERNAL_TOKEN = process.env.INTERNAL_TOKEN || "";
const BUSINESS_ID = process.env.BUSINESS_ID || "";
const AUTH_DIR = process.env.WHATSAPP_AUTH_DIR || "/data/auth";
const PORT = Number(process.env.PORT || 8080);
const leaseId = process.pid + "-" + Date.now() + "-" + Math.random().toString(36).slice(2, 10);
const agentId = "agenda-baileys-" + BUSINESS_ID + "-" + process.pid;

if (!API_BASE_URL || !INTERNAL_TOKEN || !BUSINESS_ID) {
  throw new Error("API_BASE_URL, INTERNAL_TOKEN e BUSINESS_ID são obrigatórios.");
}

const authHeaders = {
  "content-type": "application/json",
  "x-internal-token": INTERNAL_TOKEN,
  "x-business-id": BUSINESS_ID
};

let socket = null;
let runtimeState = "offline";
let runtimeError = "";
let qrText = "";
let qrSvg = null;
let phone = null;
let leaseOwned = false;
let leaseFailures = 0;
let connectBusy = false;
let dispatchBusy = false;
let manualDisconnect = false;
let closing = false;
let reconnectTimer = null;
let checkpointDirty = false;
let lastCheckpointAt = 0;
let lastOpenAt = 0;
let reconnectAttempts = 0;

function sleep(ms) {
  return new Promise(resolve => setTimeout(resolve, ms));
}

async function api(route, init = {}) {
  const headers = { ...authHeaders, ...(init.headers || {}) };
  const response = await fetch(API_BASE_URL + route, {
    ...init,
    headers
  });
  if (!response.ok) {
    throw new Error(route + ": " + response.status + " " + await response.text());
  }
  if (response.status === 204) return {};
  return response.json();
}

async function renewLease() {
  const result = await api("/internal/lease", {
    method: "POST",
    body: JSON.stringify({ lease_id: leaseId })
  });
  return Boolean(result.owned);
}

async function releaseLease() {
  if (!leaseOwned) return;
  await api("/internal/lease/release", {
    method: "POST",
    body: JSON.stringify({ lease_id: leaseId })
  }).catch(() => {});
  leaseOwned = false;
}

async function heartbeat() {
  try {
    await api("/internal/heartbeat", {
      method: "POST",
      body: JSON.stringify({
        lease_id: leaseId,
        agent_id: agentId,
        state: runtimeState,
        phone,
        error: runtimeError || null,
        last_checkpoint_at: lastCheckpointAt
          ? new Date(lastCheckpointAt).toISOString()
          : null
      })
    });
  } catch (error) {
    logger.warn({ error: String(error?.message || error) }, "heartbeat failed");
  }
}

async function hasAuthFiles() {
  try {
    await access(path.join(AUTH_DIR, "creds.json"));
    return true;
  } catch {
    return false;
  }
}

async function resetAuth() {
  await rm(AUTH_DIR, { recursive: true, force: true }).catch(() => {});
  await mkdir(AUTH_DIR, { recursive: true });
}

function disconnectCode(lastDisconnect) {
  const error = lastDisconnect?.error;
  return Number(
    error?.output?.statusCode ||
    error?.data?.statusCode ||
    error?.statusCode ||
    0
  ) || 0;
}

function scheduleReconnect(delayMs) {
  if (closing || manualDisconnect) return;
  if (reconnectTimer) clearTimeout(reconnectTimer);
  reconnectTimer = setTimeout(() => {
    reconnectTimer = null;
    void connectSocket();
  }, delayMs);
  reconnectTimer.unref?.();
}

async function connectSocket() {
  if (closing || manualDisconnect || !leaseOwned || connectBusy) return;
  connectBusy = true;
  runtimeState = "connecting";
  runtimeError = "";
  qrText = "";
  qrSvg = null;

  try {
    await mkdir(AUTH_DIR, { recursive: true });
    const auth = await useMultiFileAuthState(AUTH_DIR);

    const nextSocket = makeWASocket({
      auth: auth.state,
      logger,
      browser: Browsers.ubuntu("Agenda Pro"),
      printQRInTerminal: false,
      markOnlineOnConnect: false,
      syncFullHistory: false,
      generateHighQualityLinkPreview: false,
      maxMsgRetryCount: 1,
      connectTimeoutMs: 30000,
      defaultQueryTimeoutMs: 30000,
      keepAliveIntervalMs: 15000
    });

    socket = nextSocket;

    nextSocket.ev.on("creds.update", async () => {
      try {
        await auth.saveCreds();
        checkpointDirty = true;
      } catch (error) {
        runtimeError = ("Falha ao salvar credenciais locais: " + String(error?.message || error)).slice(0, 1200);
      }
    });

    nextSocket.ev.on("connection.update", async update => {
      if (socket !== nextSocket) return;

      try {
        if (update.qr) {
          qrText = update.qr;
          qrSvg = await QRCode.toString(update.qr, {
            type: "svg",
            width: 320,
            margin: 1
          });
          runtimeState = "waiting_qr";
          runtimeError = "";
        }

        if (update.connection === "open") {
          runtimeState = "online";
          runtimeError = "";
          qrText = "";
          qrSvg = null;
          reconnectAttempts = 0;
          lastOpenAt = Date.now();
          checkpointDirty = true;

          const normalized = jidNormalizedUser(String(nextSocket.user?.id || ""));
          phone = normalized ? normalized.split("@")[0].split(":")[0] : null;

          await heartbeat();
        }

        if (update.connection === "close") {
          const code = disconnectCode(update.lastDisconnect);
          socket = null;

          if (closing || manualDisconnect) {
            runtimeState = "offline";
            return;
          }

          if (code === DisconnectReason.loggedOut) {
            runtimeState = "waiting_qr";
            runtimeError = "WhatsApp desconectado pelo aparelho. Escaneie um novo QR.";
            phone = null;
            await resetAuth();
            checkpointDirty = true;
            scheduleReconnect(1200);
            return;
          }

          reconnectAttempts += 1;
          runtimeState = "connecting";
          runtimeError = String(
            update.lastDisconnect?.error?.message ||
            "Conexão interrompida; tentando reconectar."
          ).slice(0, 1200);

          const delay = Math.min(30000, 1500 * Math.max(1, reconnectAttempts));
          scheduleReconnect(delay);
        }
      } catch (error) {
        runtimeState = "error";
        runtimeError = String(error?.message || error).slice(0, 1200);
      }
    });
  } catch (error) {
    socket = null;
    runtimeState = "error";
    runtimeError = String(error?.message || error).slice(0, 1200);
    scheduleReconnect(5000);
  } finally {
    connectBusy = false;
  }
}

async function leaseCycle() {
  if (closing || manualDisconnect) return;

  try {
    const owned = await renewLease();

    if (!owned) {
      leaseFailures = 0;
      leaseOwned = false;
      runtimeState = "standby_lease";
      runtimeError = "";
      if (socket) {
        try { socket.end(new Error("Lease pertence a outro runtime")); } catch {}
        socket = null;
      }
      return;
    }

    leaseOwned = true;
    leaseFailures = 0;

    if (!socket && !connectBusy) {
      await connectSocket();
    }
  } catch (error) {
    leaseFailures += 1;
    runtimeError = ("Lease falhou (" + leaseFailures + "): " + String(error?.message || error)).slice(0, 1200);

    if (leaseOwned && leaseFailures >= 4) {
      leaseOwned = false;
      runtimeState = "standby_lease";
      if (socket) {
        try { socket.end(new Error("Lease não pôde ser renovado por 20s")); } catch {}
        socket = null;
      }
    }
  }
}

async function validateDestination(phoneValue) {
  const digits = String(phoneValue || "").replace(/\D/g, "");
  if (!digits) throw Object.assign(new Error("Destino sem telefone válido."), { noRetry: true });

  const results = await socket.onWhatsApp(digits).catch(() => []);
  const first = Array.isArray(results) ? results.find(item => item?.exists) : null;
  if (!first?.jid) {
    throw Object.assign(new Error("Número não possui WhatsApp ativo."), { noRetry: true });
  }
  return first.jid;
}

async function completeDispatch(message, messageRef) {
  let lastError = null;

  for (let attempt = 1; attempt <= 5; attempt += 1) {
    try {
      await api("/internal/dispatch/" + message.id + "/complete", {
        method: "POST",
        body: JSON.stringify({
          reservation_token: message.reservation_token,
          message_ref: messageRef || null
        })
      });
      return;
    } catch (error) {
      lastError = error;
      if (attempt < 5) await sleep(500 * (2 ** (attempt - 1)));
    }
  }

  throw lastError || new Error("Falha ao confirmar envio concluído.");
}

async function dispatchCycle() {
  if (
    dispatchBusy ||
    runtimeState !== "online" ||
    !socket ||
    closing ||
    manualDisconnect ||
    !leaseOwned
  ) return;

  dispatchBusy = true;

  try {
    const result = await api("/internal/dispatch/next", {
      method: "POST",
      body: JSON.stringify({ lease_id: leaseId })
    });

    if (!result.message) return;
    const message = result.message;
    let dispatchStarted = false;
    let sent = false;

    try {
      const jid = await validateDestination(message.phone);

      await api("/internal/dispatch/" + message.id + "/start", {
        method: "POST",
        body: JSON.stringify({
          reservation_token: message.reservation_token
        })
      });
      dispatchStarted = true;

      const info = await socket.sendMessage(jid, { text: message.text });
      sent = true;

      await completeDispatch(message, info?.key?.id || null);
    } catch (error) {
      const ambiguous = dispatchStarted || sent;
      const noRetry =
        ambiguous ||
        error?.noRetry === true ||
        String(message.delivery_semantics || "").toUpperCase() === "AT_MOST_ONCE";

      await api("/internal/dispatch/" + message.id + "/fail", {
        method: "POST",
        body: JSON.stringify({
          reservation_token: message.reservation_token,
          no_retry: noRetry,
          error: ambiguous
            ? "Envio iniciado, mas o resultado ficou incerto. Retry automático bloqueado para evitar mensagem duplicada. " +
              String(error?.message || error).slice(0, 900)
            : String(error?.message || error).slice(0, 1200)
        })
      }).catch(() => {});

      throw error;
    }
  } catch (error) {
    runtimeError = String(error?.message || error).slice(0, 1200);
    logger.error({ error: runtimeError }, "dispatch failed");
  } finally {
    dispatchBusy = false;
  }
}

async function checkpointBuffer() {
  if (!await hasAuthFiles()) return null;

  const tempDir = await mkdtemp(path.join(os.tmpdir(), "agenda-wa-save-"));
  const archive = path.join(tempDir, "auth.tar.gz");

  try {
    await execFileAsync("tar", ["-czf", archive, "-C", AUTH_DIR, "."], {
      timeout: 30000
    });
    const info = await stat(archive);
    if (!info.size) return null;
    return await readFile(archive);
  } finally {
    await rm(tempDir, { recursive: true, force: true }).catch(() => {});
  }
}

async function restoreBuffer(buffer) {
  const tempDir = await mkdtemp(path.join(os.tmpdir(), "agenda-wa-restore-"));
  const archive = path.join(tempDir, "auth.tar.gz");

  try {
    runtimeState = "restoring";
    await writeFile(archive, buffer);
    await resetAuth();
    await execFileAsync("tar", ["-xzf", archive, "-C", AUTH_DIR], {
      timeout: 30000
    });
    checkpointDirty = false;
    runtimeState = "offline";
    runtimeError = "";
  } finally {
    await rm(tempDir, { recursive: true, force: true }).catch(() => {});
  }
}

async function manualDisconnectNow() {
  manualDisconnect = true;
  runtimeState = "offline";
  qrText = "";
  qrSvg = null;
  runtimeError = "";

  if (reconnectTimer) {
    clearTimeout(reconnectTimer);
    reconnectTimer = null;
  }

  if (socket) {
    try { await socket.logout(); } catch {}
    try { socket.end(new Error("Manual disconnect")); } catch {}
  }
  socket = null;
  phone = null;
  await resetAuth();
  checkpointDirty = false;
  await releaseLease();
}

function sendJson(res, status, body) {
  const data = JSON.stringify(body);
  res.writeHead(status, {
    "content-type": "application/json; charset=utf-8",
    "content-length": Buffer.byteLength(data),
    "cache-control": "no-store"
  });
  res.end(data);
}

async function readBody(req) {
  const chunks = [];
  for await (const chunk of req) chunks.push(chunk);
  return Buffer.concat(chunks);
}

const server = http.createServer(async (req, res) => {
  try {
    const url = new URL(req.url || "/", "http://localhost");

    if (url.pathname === "/ready") {
      return sendJson(res, 200, {
        ok: true,
        state: runtimeState,
        engine: "baileys",
        business_id: BUSINESS_ID
      });
    }

    if (url.pathname === "/status") {
      return sendJson(res, 200, {
        ok: true,
        status:
          runtimeState === "online" ? "connected" :
          runtimeState === "waiting_qr" ? "qr" :
          runtimeState === "connecting" || runtimeState === "restoring" ? "connecting" :
          runtimeState === "error" ? "error" :
          "disconnected",
        state: runtimeState,
        phone,
        qr_svg: runtimeState === "waiting_qr" ? qrSvg : null,
        qr_available: Boolean(qrText),
        last_error: runtimeError || null,
        lease_owned: leaseOwned,
        checkpoint_dirty: checkpointDirty,
        last_open_at: lastOpenAt ? new Date(lastOpenAt).toISOString() : null,
        last_checkpoint_at: lastCheckpointAt ? new Date(lastCheckpointAt).toISOString() : null
      });
    }

    if ((url.pathname === "/start" || url.pathname === "/connect") && req.method === "POST") {
      manualDisconnect = false;
      await leaseCycle();

      const started = Date.now();
      while (
        Date.now() - started < 12000 &&
        !["online", "waiting_qr", "standby_lease", "error"].includes(runtimeState)
      ) {
        await sleep(250);
      }

      return sendJson(res, 200, {
        ok: true,
        status:
          runtimeState === "online" ? "connected" :
          runtimeState === "waiting_qr" ? "qr" :
          runtimeState === "error" ? "error" :
          "connecting",
        state: runtimeState,
        phone,
        qr_svg: qrSvg,
        last_error: runtimeError || null
      });
    }

    if (url.pathname === "/restore" && req.method === "POST") {
      const buffer = await readBody(req);
      if (!buffer.length) return sendJson(res, 400, { error: "Checkpoint vazio." });
      await restoreBuffer(buffer);
      return sendJson(res, 200, { ok: true });
    }

    if (url.pathname === "/checkpoint" && req.method === "POST") {
      const buffer = await checkpointBuffer();
      if (!buffer) {
        res.writeHead(204, { "cache-control": "no-store" });
        res.end();
        return;
      }

      res.writeHead(200, {
        "content-type": "application/gzip",
        "content-length": String(buffer.length),
        "cache-control": "no-store"
      });
      res.end(buffer);
      return;
    }

    if (url.pathname === "/checkpoint-ack" && req.method === "POST") {
      checkpointDirty = false;
      lastCheckpointAt = Date.now();
      await heartbeat();
      return sendJson(res, 200, { ok: true });
    }

    if (url.pathname === "/disconnect" && req.method === "POST") {
      await manualDisconnectNow();
      return sendJson(res, 200, { ok: true, status: "disconnected" });
    }

    return sendJson(res, 404, { error: "Rota não encontrada" });
  } catch (error) {
    runtimeState = "error";
    runtimeError = String(error?.message || error).slice(0, 1200);
    logger.error({ error: runtimeError }, "runtime request failed");
    return sendJson(res, 500, { error: runtimeError });
  }
});

async function shutdown(signal) {
  if (closing) return;
  closing = true;

  if (reconnectTimer) clearTimeout(reconnectTimer);

  logger.info({ signal }, "shutting down");
  await heartbeat().catch(() => {});
  await releaseLease().catch(() => {});

  try { socket?.end(new Error("Shutdown " + signal)); } catch {}
  socket = null;

  server.close(() => process.exit(0));
  setTimeout(() => process.exit(0), 5000).unref?.();
}

process.on("SIGINT", () => void shutdown("SIGINT"));
process.on("SIGTERM", () => void shutdown("SIGTERM"));

await resetAuth();

server.listen(PORT, "0.0.0.0", () => {
  logger.info({ port: PORT, business: BUSINESS_ID }, "Agenda Pro Baileys runtime ready");
});

setInterval(() => void leaseCycle(), 5000).unref?.();
setInterval(() => void heartbeat(), 5000).unref?.();
setInterval(() => void dispatchCycle(), 2500).unref?.();
