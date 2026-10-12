// Agenda Pro: create a pending Mercado Pago subscription for a paid plan.
// The plan does NOT change until an independently verified payment arrives.
const UUID=/^[a-f0-9]{8}-(?:[a-f0-9]{4}-){3}[a-f0-9]{12}$/i;
const mpCheckoutUrl=url=>{
  try {
    const x=new URL(String(url));
    return x.protocol==='https:'&&['mercadopago.com','mercadopago.com.br','mercadopago.com.ar'].some(d=>x.hostname===d||x.hostname.endsWith('.'+d));
  } catch {return false}
};
export default async function handler(req,res) {
  res.setHeader('Cache-Control','no-store');
  if(req.method==='GET')return res.status(200).json({
    ok:true,service:'agenda-mp-checkout',pilot:true,
    enabled:process.env.AGENDA_MP_CHECKOUT_ENABLED==='true',
    restricted:Boolean(process.env.AGENDA_MP_TEST_BUSINESS_ID&&process.env.AGENDA_MP_TEST_PLAN_ID),
    configured:Boolean(process.env.AGENDA_SUPABASE_URL&&process.env.AGENDA_SUPABASE_SECRET_KEY&&process.env.AGENDA_MP_ACCESS_TOKEN)
  });
  if(req.method!=='POST'){res.setHeader('Allow','GET,POST');return res.status(405).json({error:'method_not_allowed'})}
  // Explicitly gated: do not create production charges until supervised testing.
  if(process.env.AGENDA_MP_CHECKOUT_ENABLED!=='true')return res.status(503).json({error:'checkout_not_enabled'});
  const root=process.env.AGENDA_SUPABASE_URL,key=process.env.AGENDA_SUPABASE_SECRET_KEY,mpKey=process.env.AGENDA_MP_ACCESS_TOKEN;
  if(!root||!key||!mpKey)return res.status(503).json({error:'billing_not_configured'});
  const token=/^Bearer (.+)$/i.exec(String(req.headers.authorization||''))?.[1];
  if(!token||token.length>4096)return res.status(401).json({error:'unauthorized'});
  const businessId=String(req.body?.business_id||''),planId=String(req.body?.plan_id||'');
  if(!UUID.test(businessId)||!UUID.test(planId))return res.status(400).json({error:'invalid_input'});
  // Fail closed: even with the production flag enabled, checkout is restricted
  // to the single authorized company/plan. Other tenants cannot be charged.
  const testBusiness=String(process.env.AGENDA_MP_TEST_BUSINESS_ID||'');
  const testPlan=String(process.env.AGENDA_MP_TEST_PLAN_ID||'');
  if(!UUID.test(testBusiness)||!UUID.test(testPlan)||
     businessId!==testBusiness||planId!==testPlan)
    return res.status(403).json({error:'checkout_limited_to_pilot'});
  let base;
  try{base=new URL(root)}catch(_){return res.status(503).json({error:'invalid_database_url'})}
  if(base.protocol!=='https:')return res.status(503).json({error:'invalid_configuration'});
  const serverHeaders={apikey:key,Authorization:'Bearer '+key,Accept:'application/json'};
  const select=async (table,params)=>{
    const url=new URL('/rest/v1/'+table,base);
    for(const [name,value] of Object.entries(params))url.searchParams.set(name,value);
    const result=await fetch(url,{headers:serverHeaders,signal:AbortSignal.timeout(10000)});
    if(!result.ok)throw Error('database_unavailable');
    return result.json();
  };
  try {
    const auth=await fetch(new URL('/auth/v1/user',base),{headers:{apikey:key,Authorization:'Bearer '+token},signal:AbortSignal.timeout(10000)});
    if(!auth.ok)return res.status(401).json({error:'unauthorized'});
    const user=await auth.json();
    if(!UUID.test(String(user.id||''))||!user.email)return res.status(403).json({error:'payer_email_required'});
    const [members,plans,subs,companies]=await Promise.all([
      select('agenda_members',{select:'role',business_id:'eq.'+businessId,user_id:'eq.'+user.id,limit:'2'}),
      select('agenda_plans',{select:'id,code,name,monthly_price_cents,active,visible',id:'eq.'+planId,limit:'2'}),
      select('agenda_subscriptions',{select:'business_id,plan_id,status,mp_preapproval_id,mp_checkout_url,mp_pending_plan_id',business_id:'eq.'+businessId,limit:'2'}),
      select('agenda_businesses',{select:'id,manual_blocked',id:'eq.'+businessId,limit:'2'})
    ]);
    if(members.length!==1||!['owner','admin'].includes(members[0].role))return res.status(403).json({error:'owner_required'});
    if(companies.length!==1||companies[0].manual_blocked)return res.status(403).json({error:'business_blocked'});
    if(plans.length!==1||!plans[0].active||!plans[0].visible)return res.status(400).json({error:'plan_not_available'});
    const cents=Number(plans[0].monthly_price_cents);
    if(!Number.isSafeInteger(cents)||cents!==4990||plans[0].code!=='essencial')
      return res.status(409).json({error:'pilot_amount_mismatch'});
    if(subs.length!==1)return res.status(404).json({error:'subscription_not_found'});
    const sub=subs[0];
    if(['suspended','cancelled'].includes(sub.status))return res.status(403).json({error:'subscription_blocked'});
    // Never change a running paid subscription by replacing its payment agreement.
    if(sub.mp_preapproval_id){
      if(sub.mp_pending_plan_id===planId&&mpCheckoutUrl(sub.mp_checkout_url))
        return res.status(200).json({ok:true,checkout_url:sub.mp_checkout_url,payment_pending:true,reused:true});
      return res.status(409).json({error:'subscription_already_linked'});
    }
    // Also allow an existing manually activated paid plan to start its first recurring agreement.
    const reference='agenda:'+businessId+':'+planId;
    const response=await fetch('https://api.mercadopago.com/preapproval',{
      method:'POST',
      headers:{Authorization:'Bearer '+mpKey,'Content-Type':'application/json','X-Idempotency-Key':'agenda-'+businessId+'-'+planId,Accept:'application/json'},
      body:JSON.stringify({
        reason:'Agenda Pro - '+String(plans[0].name).slice(0,80),
        external_reference:reference,
        payer_email:user.email,
        auto_recurring:{frequency:1,frequency_type:'months',transaction_amount:cents/100,currency_id:'BRL'},
        back_url:'https://agenda-pro-iucw.vercel.app',
        status:'pending'
      }),
      signal:AbortSignal.timeout(15000)
    });
    if(!response.ok){
      const rejected=await response.json().catch(()=>({}));
      // The authenticated pilot subscriber needs a bounded, redacted reason.
      // Never return an MP token, full provider payload or payer details.
      const cause=Array.isArray(rejected.cause)?rejected.cause[0]||{}:{};
      const sanitize=value=>String(value??'')
        .replace(/[A-Z0-9._%+-]+@[A-Z0-9.-]+\\.[A-Z]{2,}/gi,'[email]')
        .replace(/\\b\\d{12,}\\b/g,'[id]')
        .replace(/[^a-zA-ZÀ-ÿ0-9 _.,:/()\\[\\]-]/g,' ')
        .slice(0,145).trim();
      const providerCode=sanitize(cause.code||rejected.code||rejected.error||'');
      const providerHint=sanitize(cause.description||rejected.message||'');
      console.warn('Mercado Pago recusou assinatura',{
        status:response.status,code:providerCode||'unknown',
        hint:providerHint||'unspecified'
      });
      return res.status(502).json({
        error:'checkout_provider_rejected',
        provider_status:response.status,
        provider_code:providerCode,
        provider_hint:providerHint
      });
    }
    const result=await response.json();
    if(!result.id||!mpCheckoutUrl(result.init_point)||result.status!=='pending'||
       String(result.external_reference||'')!==reference||
       result.auto_recurring?.currency_id!=='BRL'||
       Math.round(Number(result.auto_recurring?.transaction_amount)*100)!==cents)
      return res.status(502).json({error:'checkout_provider_invalid'});
    // Compare-and-set: a concurrent checkout may not overwrite an existing agreement.
    const url=new URL('/rest/v1/agenda_subscriptions',base);
    url.searchParams.set('business_id','eq.'+businessId);
    url.searchParams.set('plan_id','eq.'+sub.plan_id);
    url.searchParams.set('mp_preapproval_id','is.null');
    const saved=await fetch(url,{
      method:'PATCH',
      headers:{...serverHeaders,'Content-Type':'application/json',Prefer:'return=representation'},
      body:JSON.stringify({
        mp_preapproval_id:String(result.id),mp_pending_plan_id:planId,
        mp_checkout_url:String(result.init_point),mp_status:'pending',mp_payer_email:user.email
      }),
      signal:AbortSignal.timeout(10000)
    });
    if(!saved.ok)return res.status(502).json({error:'checkout_link_failed'});
    const updated=await saved.json();
    if(updated.length!==1)return res.status(409).json({error:'checkout_link_conflict'});
    return res.status(200).json({ok:true,checkout_url:result.init_point,payment_pending:true});
  }catch(e){
    console.error('Falha no endpoint de checkout',{name:String(e?.name||'Error').slice(0,80),cause:String(e?.message||'unknown').slice(0,120)});
    return res.status(502).json({error:'checkout_unavailable'});
  }
}
