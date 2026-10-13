// Cancel recurring charges at Mercado Pago. Preserve paid access until period end.
const UUID=/^[a-f0-9]{8}-(?:[a-f0-9]{4}-){3}[a-f0-9]{12}$/i;
export default async function handler(req,res){
  res.setHeader('Cache-Control','no-store');
  if(req.method!=='POST'){res.setHeader('Allow','POST');return res.status(405).json({error:'method_not_allowed'})}
  const root=process.env.AGENDA_SUPABASE_URL,key=process.env.AGENDA_SUPABASE_SECRET_KEY,mpKey=process.env.AGENDA_MP_ACCESS_TOKEN;
  if(!root||!key||!mpKey)return res.status(503).json({error:'billing_not_configured'});
  const token=/^Bearer (.+)$/i.exec(String(req.headers.authorization||''))?.[1];
  const businessId=String(req.body?.business_id||'');
  if(!token||token.length>4096)return res.status(401).json({error:'unauthorized'});
  if(!UUID.test(businessId))return res.status(400).json({error:'invalid_business_id'});
  const base=new URL(root),headers={apikey:key,Authorization:'Bearer '+key,Accept:'application/json'};
  if(base.protocol!=='https:')return res.status(503).json({error:'invalid_configuration'});
  async function rows(table,params){
    const url=new URL('/rest/v1/'+table,base);
    for(const [k,v] of Object.entries(params))url.searchParams.set(k,v);
    const r=await fetch(url,{headers,signal:AbortSignal.timeout(10000)});
    if(!r.ok)throw Error('database_unavailable');
    return r.json();
  }
  try{
    const auth=await fetch(new URL('/auth/v1/user',base),{
      headers:{apikey:key,Authorization:'Bearer '+token},
      signal:AbortSignal.timeout(10000)
    });
    if(!auth.ok)return res.status(401).json({error:'unauthorized'});
    const user=await auth.json();
    if(!UUID.test(String(user.id||'')))return res.status(401).json({error:'unauthorized'});
    const [members,subscriptions]=await Promise.all([
      rows('agenda_members',{select:'role',business_id:'eq.'+businessId,user_id:'eq.'+user.id,limit:'2'}),
      rows('agenda_subscriptions',{select:'business_id,plan_id,mp_pending_plan_id,mp_preapproval_id,current_period_end',business_id:'eq.'+businessId,limit:'2'})
    ]);
    if(members.length!==1||!['owner','admin'].includes(members[0].role))return res.status(403).json({error:'owner_required'});
    if(subscriptions.length!==1||!subscriptions[0].mp_preapproval_id)return res.status(404).json({error:'no_recurring_subscription'});
    const sub=subscriptions[0],id=String(sub.mp_preapproval_id);
    if(!/^[a-zA-Z0-9_-]{1,120}$/.test(id))return res.status(409).json({error:'invalid_subscription_reference'});
    const baseMp='https://api.mercadopago.com/preapproval/'+encodeURIComponent(id);
    const authorization={Authorization:'Bearer '+mpKey,Accept:'application/json'};
    const currentResponse=await fetch(baseMp,{headers:authorization,signal:AbortSignal.timeout(10000)});
    if(!currentResponse.ok)return res.status(502).json({error:'provider_unavailable'});
    const current=await currentResponse.json();
    const target=String(sub.mp_pending_plan_id||sub.plan_id);
    if(String(current.id||'')!==id || String(current.external_reference||'')!=='agenda:'+businessId+':'+target)
      return res.status(409).json({error:'provider_subscription_mismatch'});
    if(current.status!=='canceled'){
      if(!['pending','authorized','paused'].includes(current.status))
        return res.status(409).json({error:'provider_status_unknown',subscription_status:String(current.status||'unknown').slice(0,35)});
      const canceled=await fetch(baseMp,{
        method:'PUT',headers:{...authorization,'Content-Type':'application/json'},
        body:JSON.stringify({status:'canceled'}),signal:AbortSignal.timeout(12000)
      });
      // A API pode responder com falha mesmo apos concluir a alteracao.
      // Confirme o estado remoto antes de liberar PIX ou limpar o vinculo local.
      const result=await canceled.json().catch(()=>({}));
      const safe=value=>String(value??'')
        .replace(/[A-Z0-9._%+-]+@[A-Z0-9.-]+\.[A-Z]{2,}/gi,'[email]')
        .replace(/\b\d{12,}\b/g,'[id]')
        .replace(/[^a-zA-ZÀ-ÿ0-9 _.,:;/'()-]/g,' ')
        .slice(0,120).trim();
      const cause=Array.isArray(result.cause)?result.cause[0]||{}:{};
      if(!canceled.ok){
        const code=safe(cause.code??result.code??result.error??'');
        const hint=safe(cause.description??result.message??'');
        // Em algumas falhas o provedor conclui o cancelamento, mas a resposta
        // retorna erro. Só o GET autenticado confirma se pode limpar o vinculo.
        let confirmed=false;
        try{
          const check=await fetch(baseMp,{headers:authorization,signal:AbortSignal.timeout(9000)});
          if(check.ok){
            const latest=await check.json();
            confirmed=String(latest.id)===id&&latest.status==='canceled';
          }
        }catch(_){ /* Nao assumir cancelamento quando o provedor estiver indisponivel */ }
        if(!confirmed){
          console.warn('Mercado Pago: cancelamento nao confirmado',{provider_http_status:canceled.status,provider_code:code||'unknown'});
          return res.status(502).json({error:'cancel_provider_failed',
            provider_http_status:canceled.status,provider_code:code,provider_hint:hint,
            subscription_status:String(current.status||'').slice(0,35)});
        }
      }else if(String(result.id||'')!==id||result.status!=='canceled'){
        // Resposta inesperada: nao trate como sucesso sem reverificar.
        const check=await fetch(baseMp,{headers:authorization,signal:AbortSignal.timeout(9000)});
        if(!check.ok)return res.status(502).json({error:'cancel_not_confirmed'});
        const latest=await check.json();
        if(String(latest.id)!==id||latest.status!=='canceled')
          return res.status(502).json({error:'cancel_not_confirmed'});
      }
    }
    const url=new URL('/rest/v1/agenda_subscriptions',base);
    url.searchParams.set('business_id','eq.'+businessId);
    url.searchParams.set('mp_preapproval_id','eq.'+id);
    const synced=await fetch(url,{
      method:'PATCH',
      headers:{...headers,'Content-Type':'application/json',Prefer:'return=representation'},
      body:JSON.stringify({
        mp_preapproval_id:null,mp_pending_plan_id:null,mp_checkout_url:null,
        mp_status:'canceled',mp_payer_email:null,updated_at:new Date().toISOString()
      }),
      signal:AbortSignal.timeout(10000)
    });
    if(!synced.ok)return res.status(502).json({error:'cancel_sync_failed'});
    const changed=await synced.json();
    if(changed.length!==1)return res.status(409).json({error:'cancel_sync_conflict'});
    return res.status(200).json({ok:true,recurring_canceled:true,
      paid_access_until:sub.current_period_end||null});
  }catch(_){return res.status(502).json({error:'cancel_unavailable'})}
}
