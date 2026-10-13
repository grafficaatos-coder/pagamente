// Agenda Pro — cobrança mensal avulsa via PIX (piloto Julli / Essencial).
// Nao e debito recorrente: o assinante gera um novo PIX a cada periodo.
import {randomUUID} from 'node:crypto';
const UUID=/^[a-f0-9]{8}-(?:[a-f0-9]{4}-){3}[a-f0-9]{12}$/i;
const trustedUrl=value=>{
  try {const u=new URL(String(value));return u.protocol==='https:'&&
    ['mercadopago.com.br','mercadopago.com'].some(d=>u.hostname===d||u.hostname.endsWith('.'+d));}
  catch(_){return false;}
};
export default async function handler(req,res){
  res.setHeader('Cache-Control','no-store');
  if(req.method==='GET')return res.status(200).json({
    ok:true,service:'agenda-mp-pix',pilot:true,
    enabled:process.env.AGENDA_MP_CHECKOUT_ENABLED==='true',
    configured:Boolean(process.env.AGENDA_MP_ACCESS_TOKEN&&process.env.AGENDA_SUPABASE_URL&&process.env.AGENDA_SUPABASE_SECRET_KEY)
  });
  if(req.method!=='POST'){res.setHeader('Allow','GET,POST');return res.status(405).json({error:'method_not_allowed'});}
  if(process.env.AGENDA_MP_CHECKOUT_ENABLED!=='true')return res.status(503).json({error:'checkout_not_enabled'});
  const root=process.env.AGENDA_SUPABASE_URL,key=process.env.AGENDA_SUPABASE_SECRET_KEY,mpKey=process.env.AGENDA_MP_ACCESS_TOKEN;
  if(!root||!key||!mpKey)return res.status(503).json({error:'billing_not_configured'});
  const token=/^Bearer (.+)$/i.exec(String(req.headers.authorization||''))?.[1];
  const businessId=String(req.body?.business_id||''),planId=String(req.body?.plan_id||'');
  const payerEmail=String(req.body?.payer_email||'').trim().toLowerCase();
  if(!token||token.length>4096)return res.status(401).json({error:'unauthorized'});
  if(!UUID.test(businessId)||!UUID.test(planId))return res.status(400).json({error:'invalid_input'});
  if(payerEmail.length>160||!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(payerEmail))
    return res.status(400).json({error:'invalid_payer_email'});
  if(businessId!==String(process.env.AGENDA_MP_TEST_BUSINESS_ID||'')||
     planId!==String(process.env.AGENDA_MP_TEST_PLAN_ID||''))
    return res.status(403).json({error:'checkout_limited_to_pilot'});
  let base;
  try{base=new URL(root);if(base.protocol!=='https:')throw Error('url');}
  catch(_){return res.status(503).json({error:'invalid_configuration'});}
  const h={apikey:key,Authorization:'Bearer '+key,Accept:'application/json'};
  const rows=async(table,filters)=>{
    const url=new URL('/rest/v1/'+table,base);
    for(const [k,v] of Object.entries(filters))url.searchParams.set(k,v);
    const r=await fetch(url,{headers:h,signal:AbortSignal.timeout(9000)});
    if(!r.ok)throw Error('database_unavailable');
    return r.json();
  };
  const patch=async(id,update)=>{
    const u=new URL('/rest/v1/agenda_mp_pix_charges',base);
    u.searchParams.set('id','eq.'+id);
    const r=await fetch(u,{method:'PATCH',headers:{...h,'Content-Type':'application/json',Prefer:'return=representation'},
      body:JSON.stringify({...update,updated_at:new Date().toISOString()}),signal:AbortSignal.timeout(10000)});
    if(!r.ok)throw Error('pix_persist_failed');
    return r.json();
  };
  try{
    const auth=await fetch(new URL('/auth/v1/user',base),{
      headers:{apikey:key,Authorization:'Bearer '+token},signal:AbortSignal.timeout(9000)});
    if(!auth.ok)return res.status(401).json({error:'unauthorized'});
    const user=await auth.json();
    if(!UUID.test(String(user.id||'')))return res.status(401).json({error:'unauthorized'});
    const [member,plans,subs,companies,existing]=await Promise.all([
      rows('agenda_members',{select:'role',business_id:'eq.'+businessId,user_id:'eq.'+user.id,limit:'2'}),
      rows('agenda_plans',{select:'id,code,name,active,visible,monthly_price_cents',id:'eq.'+planId,limit:'2'}),
      rows('agenda_subscriptions',{select:'status,mp_preapproval_id,current_period_end,plan_id',business_id:'eq.'+businessId,limit:'2'}),
      rows('agenda_businesses',{select:'manual_blocked',id:'eq.'+businessId,limit:'2'}),
      rows('agenda_mp_pix_charges',{select:'id,status,plan_id,checkout_url,mp_payment_id,expires_at',
        business_id:'eq.'+businessId,status:'in.(creating,pending)',limit:'2'})
    ]);
    if(member.length!==1||!['owner','admin'].includes(member[0].role))return res.status(403).json({error:'owner_required'});
    if(companies.length!==1||companies[0].manual_blocked)return res.status(403).json({error:'business_blocked'});
    if(plans.length!==1||!plans[0].active||!plans[0].visible||
       plans[0].code!=='essencial'||Number(plans[0].monthly_price_cents)!==4990)
      return res.status(409).json({error:'pilot_amount_mismatch'});
    if(subs.length!==1||['suspended','cancelled'].includes(subs[0].status))
      return res.status(403).json({error:'subscription_unavailable'});
    if(subs[0].mp_preapproval_id)
      return res.status(409).json({error:'cancel_recurring_first'});
    const periodEnd=Date.parse(String(subs[0].current_period_end||''));
    if(subs[0].status==='active'&&Number.isFinite(periodEnd)&&
       periodEnd>Date.now()+7*86400000)
      return res.status(409).json({error:'already_paid_until_later'});
    if(existing.length>1)return res.status(409).json({error:'multiple_pending_pix'});
    if(existing.length===1){
      const old=existing[0];
      if(Date.parse(old.expires_at)>Date.now()){
        if(old.plan_id===planId&&old.mp_payment_id&&trustedUrl(old.checkout_url))
          return res.status(200).json({ok:true,payment_pending:true,reused:true,checkout_url:old.checkout_url});
        return res.status(409).json({error:'pix_already_processing'});
      }
      await patch(old.id,{status:'expired'});
    }
    // PIX e uma compra nova, nao um contrato automatico de cartao.
    // Confere que o recebedor do Access Token e uma conta real.
    const me=await fetch('https://api.mercadopago.com/users/me',{
      headers:{Authorization:'Bearer '+mpKey,Accept:'application/json'},signal:AbortSignal.timeout(9000)});
    if(!me.ok)return res.status(503).json({error:'collector_verification_unavailable'});
    const collector=await me.json();
    if(!collector?.id)return res.status(503).json({error:'collector_verification_incomplete'});
    if((Array.isArray(collector.tags)&&collector.tags.includes('test_user'))||
       /@(?:[a-z0-9-]+\.)?testuser\.com$/i.test(String(collector.email||'')))
      return res.status(409).json({error:'collector_is_test_account'});
    if(String(collector.email||'').trim().toLowerCase()===payerEmail)
      return res.status(409).json({error:'payer_equals_collector'});
    const chargeId=randomUUID(),reference='agenda-pix:'+chargeId;
    const expires=new Date(Date.now()+24*3600000).toISOString();
    const created=await fetch(new URL('/rest/v1/agenda_mp_pix_charges',base),{
      method:'POST',headers:{...h,'Content-Type':'application/json',Prefer:'return=representation'},
      body:JSON.stringify({id:chargeId,business_id:businessId,plan_id:planId,
        amount_cents:4990,external_reference:reference,expires_at:expires,status:'creating'}),
      signal:AbortSignal.timeout(9000)
    });
    if(!created.ok)return res.status(created.status===409?409:502).json({error:'pix_reservation_failed'});
    let payment;
    try {
      const sent=await fetch('https://api.mercadopago.com/v1/payments',{
        method:'POST',
        headers:{Authorization:'Bearer '+mpKey,Accept:'application/json','Content-Type':'application/json',
          'X-Idempotency-Key':chargeId},
        body:JSON.stringify({
          transaction_amount:49.9,description:'Agenda Pro - Essencial (mensal)',
          payment_method_id:'pix',external_reference:reference,
          date_of_expiration:expires,payer:{email:payerEmail}
        }),
        signal:AbortSignal.timeout(15000)
      });
      if(!sent.ok){
        const status=sent.status;
        await patch(chargeId,{status:'failed'}).catch(()=>{});
        return res.status(502).json({error:'pix_provider_rejected',provider_status:status});
      }
      payment=await sent.json();
    }catch(_){
      // A requisicao pode ter chegado ao provedor: nao crie outra ate conciliar.
      return res.status(502).json({error:'pix_payment_unknown_retry_later'});
    }
    const ticket=String(payment.point_of_interaction?.transaction_data?.ticket_url||'');
    if(!/^\d{1,40}$/.test(String(payment.id||''))||
       payment.payment_method_id!=='pix'||
       payment.currency_id!=='BRL'||
       payment.external_reference!==reference||
       Math.round(Number(payment.transaction_amount)*100)!==4990||
       !trustedUrl(ticket))
      return res.status(502).json({error:'pix_provider_invalid'});
    const updated=await patch(chargeId,{status:'pending',mp_payment_id:String(payment.id),checkout_url:ticket});
    if(updated.length!==1)return res.status(502).json({error:'pix_link_failed'});
    return res.status(200).json({ok:true,payment_pending:true,checkout_url:ticket});
  }catch(e){
    console.error('PIX checkout failed',{name:String(e?.name||'Error').slice(0,50),reason:String(e?.message||'unknown').slice(0,80)});
    return res.status(502).json({error:'pix_unavailable'});
  }
}
