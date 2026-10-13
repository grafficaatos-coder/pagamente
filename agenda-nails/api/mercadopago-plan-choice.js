// Agenda Pro: escolha de plano pelo assinante, sem cobrança e sem liberação de acesso.
// Para um mês já pago, registra a escolha para a próxima renovação.
const UUID=/^[a-f0-9]{8}-(?:[a-f0-9]{4}-){3}[a-f0-9]{12}$/i;
export default async function handler(req,res){
  res.setHeader('Cache-Control','no-store');
  if(req.method!=='POST'){res.setHeader('Allow','POST');return res.status(405).json({error:'method_not_allowed'});}
  const root=process.env.AGENDA_SUPABASE_URL,key=process.env.AGENDA_SUPABASE_SECRET_KEY;
  if(!root||!key)return res.status(503).json({error:'billing_not_configured'});
  const token=/^Bearer (.+)$/i.exec(String(req.headers.authorization||''))?.[1];
  const businessId=String(req.body?.business_id||''),planId=String(req.body?.plan_id||'');
  if(!token||token.length>4096)return res.status(401).json({error:'unauthorized'});
  if(!UUID.test(businessId)||!UUID.test(planId))return res.status(400).json({error:'invalid_input'});
  let base;
  try{base=new URL(root);if(base.protocol!=='https:')throw Error('url')}
  catch(_){return res.status(503).json({error:'invalid_configuration'})}
  const h={apikey:key,Authorization:'Bearer '+key,Accept:'application/json'};
  const get=async(table,params)=>{
    const url=new URL('/rest/v1/'+table,base);
    for(const [k,v] of Object.entries(params))url.searchParams.set(k,v);
    const r=await fetch(url,{headers:h,signal:AbortSignal.timeout(9000)});
    if(!r.ok)throw Error('database_unavailable');
    return r.json();
  };
  try{
    const auth=await fetch(new URL('/auth/v1/user',base),{
      headers:{apikey:key,Authorization:'Bearer '+token},signal:AbortSignal.timeout(9000)});
    if(!auth.ok)return res.status(401).json({error:'unauthorized'});
    const user=await auth.json();
    if(!UUID.test(String(user.id||'')))return res.status(401).json({error:'unauthorized'});
    const [member,plans,subs,business,pending]=await Promise.all([
      get('agenda_members',{select:'role',business_id:'eq.'+businessId,user_id:'eq.'+user.id,limit:'2'}),
      get('agenda_plans',{select:'id,name,monthly_price_cents,active,visible',id:'eq.'+planId,limit:'2'}),
      get('agenda_subscriptions',{select:'plan_id,status,mp_preapproval_id,current_period_end,mp_last_payment_at,requested_plan_id',
        business_id:'eq.'+businessId,limit:'2'}),
      get('agenda_businesses',{select:'manual_blocked',id:'eq.'+businessId,limit:'2'}),
      get('agenda_mp_pix_charges',{select:'id',business_id:'eq.'+businessId,
        status:'in.(creating,pending)',expires_at:'gt.'+new Date().toISOString(),limit:'1'})
    ]);
    if(member.length!==1||!['owner','admin'].includes(member[0].role))
      return res.status(403).json({error:'owner_required'});
    if(business.length!==1||business[0].manual_blocked)
      return res.status(403).json({error:'business_blocked'});
    if(plans.length!==1||plans[0].active!==true||plans[0].visible!==true||
       !Number.isSafeInteger(Number(plans[0].monthly_price_cents))||
       Number(plans[0].monthly_price_cents)<=0)
      return res.status(409).json({error:'plan_not_available'});
    if(subs.length!==1||['suspended','cancelled'].includes(subs[0].status))
      return res.status(403).json({error:'subscription_unavailable'});
    const sub=subs[0];
    if(sub.mp_preapproval_id)return res.status(409).json({error:'cancel_recurring_first'});
    if(pending.length)return res.status(409).json({error:'pix_already_processing'});
    const paidUntil=Date.parse(String(sub.current_period_end||''));
    const isPaid=Boolean(sub.mp_last_payment_at)&&sub.status==='active'&&Number.isFinite(paidUntil);
    const effectivePaid=isPaid&&paidUntil>Date.now()+7*86400000;
    // Only schedule when the existing paid period is still in force.
    // Otherwise return readiness to checkout, never grant a plan by selection alone.
    const planChanged=planId!==sub.plan_id;
    const planned=effectivePaid&&planChanged?planId:null;
    if(effectivePaid||sub.requested_plan_id){
      const u=new URL('/rest/v1/agenda_subscriptions',base);
      u.searchParams.set('business_id','eq.'+businessId);
      u.searchParams.set('plan_id','eq.'+sub.plan_id);
      u.searchParams.set('mp_preapproval_id','is.null');
      const response=await fetch(u,{
        method:'PATCH',headers:{...h,'Content-Type':'application/json',Prefer:'return=representation'},
        body:JSON.stringify({requested_plan_id:planned,updated_at:new Date().toISOString()}),
        signal:AbortSignal.timeout(9000)
      });
      if(!response.ok)return res.status(502).json({error:'plan_choice_save_failed'});
      const updated=await response.json();
      if(updated.length!==1)return res.status(409).json({error:'plan_choice_conflict'});
    }
    return res.status(200).json({
      ok:true,scheduled:Boolean(planned),ready_to_pay:!effectivePaid,
      plan_name:plans[0].name,amount_cents:plans[0].monthly_price_cents,
      current_period_end:effectivePaid?sub.current_period_end:null
    });
  }catch(_){return res.status(502).json({error:'plan_choice_unavailable'})}
}
