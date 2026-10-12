// Agenda Pro: checkout preparation for Mercado Pago subscriptions.
// Must be called by an authenticated owner. Never accepts price from browser.
// This endpoint is not connected to the UI until a supervised checkout test.
export default async function handler(req, res) {
  res.setHeader('Cache-Control', 'no-store');
  if (req.method !== 'POST') { res.setHeader('Allow','POST'); return res.status(405).json({error:'method_not_allowed'}); }
  // Default off: credentials being present do not authorize live charges.
  if (process.env.AGENDA_MP_CHECKOUT_ENABLED !== 'true') {
    return res.status(503).json({error:'checkout_not_enabled'});
  }
  const root = process.env.AGENDA_SUPABASE_URL;
  const key = process.env.AGENDA_SUPABASE_SECRET_KEY;
  const mpKey = process.env.AGENDA_MP_ACCESS_TOKEN;
  if (!root || !key || !mpKey) return res.status(503).json({error:'billing_not_configured'});
  const bearer = /^Bearer (.+)$/i.exec(String(req.headers.authorization || ''));
  if (!bearer || bearer[1].length > 4096) return res.status(401).json({error:'unauthorized'});
  const businessId = String(req.body?.business_id || '');
  const planId = String(req.body?.plan_id || '');
  const uuid = /^[a-f0-9]{8}-(?:[a-f0-9]{4}-){3}[a-f0-9]{12}$/i;
  if (!uuid.test(businessId) || !uuid.test(planId)) return res.status(400).json({error:'invalid_input'});
  const headers = {apikey:key,Authorization:'Bearer '+key,Accept:'application/json'};
  const base = new URL(root);
  if (base.protocol !== 'https:') return res.status(503).json({error:'invalid_configuration'});
  async function rows(table, params) {
    const url = new URL('/rest/v1/'+table,base);
    for (const [k,v] of Object.entries(params)) url.searchParams.set(k,v);
    const response = await fetch(url,{headers});
    if (!response.ok) throw Error('database_unavailable');
    return response.json();
  }
  try {
    const userResponse = await fetch(new URL('/auth/v1/user',base),{
      headers: {apikey:key,Authorization:'Bearer '+bearer[1]}
    });
    if (!userResponse.ok) return res.status(401).json({error:'unauthorized'});
    const user = await userResponse.json();
    if (!uuid.test(String(user.id||'')) || !user.email) return res.status(403).json({error:'payer_email_required'});
    const [members,plans,subscriptions] = await Promise.all([
      rows('agenda_members',{select:'role',business_id:'eq.'+businessId,user_id:'eq.'+user.id,limit:'2'}),
      rows('agenda_plans',{select:'id,name,monthly_price_cents,active',id:'eq.'+planId,limit:'2'}),
      rows('agenda_subscriptions',{select:'business_id,plan_id,status,mp_preapproval_id,mp_checkout_url',business_id:'eq.'+businessId,limit:'2'})
    ]);
    if (members.length!==1 || !['owner','admin'].includes(members[0].role)) return res.status(403).json({error:'owner_required'});
    if (plans.length!==1 || !plans[0].active || Number(plans[0].monthly_price_cents)<=0) return res.status(400).json({error:'invalid_paid_plan'});
    if (subscriptions.length!==1) return res.status(404).json({error:'subscription_not_found'});
    if (subscriptions[0].plan_id!==planId) return res.status(409).json({error:'plan_mismatch'});
    if (subscriptions[0].mp_preapproval_id) return res.status(409).json({error:'subscription_already_linked'});
    const amountCents = Number(plans[0].monthly_price_cents);
    if (!Number.isSafeInteger(amountCents) || amountCents>100000000) return res.status(400).json({error:'invalid_amount'});
    const providerPayload = {
      reason:'Agenda Pro - '+String(plans[0].name).slice(0,80),
      external_reference:'agenda:'+businessId+':'+planId,
      payer_email:user.email,
      auto_recurring:{frequency:1,frequency_type:'months',transaction_amount:amountCents/100,currency_id:'BRL'},
      back_url:'https://agenda-pro-iucw.vercel.app',
      status:'pending'
    };
    const response = await fetch('https://api.mercadopago.com/preapproval',{
      method:'POST',
      headers:{Authorization:'Bearer '+mpKey,'Content-Type':'application/json','X-Idempotency-Key':'agenda-'+businessId+'-'+planId},
      body:JSON.stringify(providerPayload)
    });
    if (!response.ok) return res.status(502).json({error:'checkout_provider_rejected'});
    const result=await response.json();
    if (!result.id || !result.init_point) return res.status(502).json({error:'checkout_incomplete'});
    // Store only linkage, NEVER activate a subscription based on checkout creation.
    const url=new URL('/rest/v1/agenda_subscriptions',base);
    url.searchParams.set('business_id','eq.'+businessId);
    url.searchParams.set('plan_id','eq.'+planId);
    url.searchParams.set('mp_preapproval_id','is.null');
    const saved=await fetch(url,{method:'PATCH',headers:{...headers,'Content-Type':'application/json',Prefer:'return=representation'},body:JSON.stringify({
      mp_preapproval_id:String(result.id),mp_checkout_url:String(result.init_point),mp_status:String(result.status||'pending'),mp_payer_email:user.email
    })});
    if (!saved.ok) return res.status(502).json({error:'checkout_link_failed'});
    const updated=await saved.json();
    if (updated.length!==1) return res.status(409).json({error:'checkout_link_conflict'});
    return res.status(200).json({ok:true,checkout_url:result.init_point,payment_pending:true});
  } catch (_) {return res.status(502).json({error:'checkout_unavailable'});}
}
