// Agenda Pro — Mercado Pago subscription webhook (Node.js / Vercel)
// Validation only. Subscription state is deliberately NOT modified here.
// Configure AGENDA_MP_WEBHOOK_SECRET before enabling notifications.
import { createHmac, timingSafeEqual } from 'node:crypto';

export default async function handler(req, res) {
  res.setHeader('Cache-Control', 'no-store');
  if (req.method === 'GET') return res.status(200).json({ ok: true, service: 'agenda-mp-webhook', configured: Boolean(process.env.AGENDA_MP_WEBHOOK_SECRET) });
  if (req.method !== 'POST') { res.setHeader('Allow', 'GET, POST'); return res.status(405).json({ error: 'method_not_allowed' }); }

  const secret = process.env.AGENDA_MP_WEBHOOK_SECRET;
  if (!secret) return res.status(503).json({ error: 'webhook_not_configured' });
  const signature = String(req.headers['x-signature'] || '');
  const requestId = String(req.headers['x-request-id'] || '');
  const parts = Object.fromEntries(signature.split(',').map(s => s.trim().split('=').map(v => v.trim())).filter(p => p.length === 2));
  const ts = parts.ts, provided = parts.v1;
  const rawId = req.query?.['data.id'] || req.query?.id;
  const dataId = Array.isArray(rawId) ? rawId[0] : String(rawId || '');
  if (!dataId || !requestId || !ts || !provided || !/^[a-f0-9]{64}$/i.test(provided) || !/^\d{10,16}$/.test(ts)) {
    return res.status(401).json({ error: 'invalid_signature' });
  }
  // Reject stale/replayed timestamps. Marketplace test requests use milliseconds.
  const stamp = Number(ts);
  const millis = ts.length <= 10 ? stamp * 1000 : stamp;
  if (!Number.isFinite(millis) || Math.abs(Date.now() - millis) > 10 * 60 * 1000) {
    return res.status(401).json({ error: 'expired_signature' });
  }
  const manifest = `id:${dataId.toLowerCase()};request-id:${requestId};ts:${ts};`;
  const expected = createHmac('sha256', secret).update(manifest).digest();
  const received = Buffer.from(provided, 'hex');
  if (expected.length !== received.length || !timingSafeEqual(expected, received)) {
    return res.status(401).json({ error: 'invalid_signature' });
  }
  // The callback is not evidence of paid service. Verify against Mercado Pago.
  // This first stage is intentionally read-only: never grant, cancel or renew.
  const topic = String(req.query?.type || req.body?.type || '');
  const isInvoice = topic === 'subscription_authorized_payment';
  if (topic !== 'subscription_preapproval' && !isInvoice) return res.status(200).json({ ok: true, verified: true, processed: false });
  const token = process.env.AGENDA_MP_ACCESS_TOKEN;
  if (!token) return res.status(503).json({ error: 'mercadopago_api_not_configured' });
  if (!/^[a-zA-Z0-9_-]{1,120}$/.test(dataId)) return res.status(400).json({ error: 'invalid_subscription_id' });
  let subscription, invoice;
  try {
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), 8000);
    let response;
    try {
      response = await fetch('https://api.mercadopago.com/' + (isInvoice ? 'authorized_payments/' : 'preapproval/') + encodeURIComponent(dataId), {
        headers: { Authorization: 'Bearer ' + token, Accept: 'application/json' },
        signal: controller.signal
      });
    } finally { clearTimeout(timeout); }
    if (!response.ok) return res.status(response.status === 404 ? 200 : 502).json({ ok: response.status === 404, verified: true, processed: false });
    const resource = await response.json();
    if (String(resource.id) !== dataId) return res.status(502).json({ error: 'provider_mismatch' });
    if (isInvoice) {
      invoice = resource;
      const preapprovalId = String(invoice.preapproval_id || '');
      if (!/^[a-zA-Z0-9_-]{1,120}$/.test(preapprovalId)) return res.status(502).json({ error: 'invoice_without_subscription' });
      const check = await fetch('https://api.mercadopago.com/preapproval/' + encodeURIComponent(preapprovalId), {
        headers: { Authorization: 'Bearer ' + token, Accept: 'application/json' },
        signal: controller.signal
      });
      if (!check.ok) return res.status(502).json({ error: 'subscription_unavailable' });
      subscription = await check.json();
      if (String(subscription.id) !== preapprovalId) return res.status(502).json({ error: 'subscription_mismatch' });
    } else subscription = resource;
  } catch (_) { return res.status(502).json({ error: 'provider_unavailable' }); }
  const linkedPreapprovalId = String(subscription.id);
  const invoicePaid = isInvoice && invoice.payment?.status === 'approved' && String(invoice.status || '') === 'processed';
  // Only a subscription already linked in Agenda Pro may ever be processed.
  // The lookup uses a server-side Supabase key; it is never sent to the browser.
  const supabaseUrl = process.env.AGENDA_SUPABASE_URL;
  const supabaseKey = process.env.AGENDA_SUPABASE_SECRET_KEY;
  if (!supabaseUrl || !supabaseKey) return res.status(503).json({ error: 'agenda_database_not_configured' });
  let matches;
  try {
    const base = new URL(supabaseUrl);
    if (base.protocol !== 'https:') throw new Error('invalid_database_url');
    const url = new URL('/rest/v1/agenda_subscriptions', base);
    url.searchParams.set('select', 'business_id,mp_preapproval_id');
    url.searchParams.set('mp_preapproval_id', 'eq.' + linkedPreapprovalId);
    url.searchParams.set('limit', '2');
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), 8000);
    let response;
    try {
      response = await fetch(url, {
        headers: { apikey: supabaseKey, Authorization: 'Bearer ' + supabaseKey, Accept: 'application/json' },
        signal: controller.signal
      });
    } finally { clearTimeout(timeout); }
    if (!response.ok) return res.status(502).json({ error: 'database_unavailable' });
    matches = await response.json();
  } catch (_) { return res.status(502).json({ error: 'database_unavailable' }); }
  if (!Array.isArray(matches)) return res.status(502).json({ error: 'database_invalid_response' });
  if (matches.length !== 1) return res.status(200).json({ ok: true, verified: true, provider_checked: true, linked: false, processed: false });
  // Record an audit trail with a unique request ID, without granting access or charging.
  // Retry failures; duplicates are naturally ignored by the database unique constraint.
  try {
    const endpoint = new URL('/rest/v1/agenda_mp_webhook_events', supabaseUrl);
    const response = await fetch(endpoint, {
      method: 'POST',
      headers: {
        apikey: supabaseKey, Authorization: 'Bearer ' + supabaseKey,
        'Content-Type': 'application/json', Prefer: 'resolution=ignore-duplicates,return=minimal'
      },
      body: JSON.stringify({
        request_id: requestId.slice(0, 160),
        business_id: matches[0].business_id,
        preapproval_id: linkedPreapprovalId,
        event_type: topic,
        provider_status: String(isInvoice ? (invoice.status || '') + ':' + (invoice.payment?.status || '') : subscription.status || '').slice(0, 100)
      })
    });
    if (!response.ok) return res.status(502).json({ error: 'audit_unavailable' });
  } catch (_) { return res.status(502).json({ error: 'audit_unavailable' }); }
  // Future phase: verify paid installments and atomically renew the subscription.
  return res.status(200).json({ ok: true, verified: true, provider_checked: true, linked: true, audited: true, invoice_paid: Boolean(invoicePaid), processed: false });
}
