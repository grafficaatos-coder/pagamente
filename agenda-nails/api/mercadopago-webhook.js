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
  // An authenticated notification is NOT proof that a payment was approved.
  // Before any subscription write, fetch the payment/preapproval from MP's API,
  // verify ownership/external_reference and de-duplicate the event.
  // Until that step is implemented, we acknowledge verified events only.
  const topic = String(req.query?.type || req.body?.type || '');
  const supported = ['subscription_preapproval','subscription_preapproval_plan','subscription_authorized_payment'];
  if (!supported.includes(topic)) return res.status(200).json({ ok: true, processed: false });
  return res.status(200).json({ ok: true, verified: true, processed: false });
}
