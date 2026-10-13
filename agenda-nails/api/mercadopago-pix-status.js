// Confirma o ultimo PIX de uma empresa no Mercado Pago sem confiar no navegador.
// O proprio servidor consulta /v1/payments e executa RPC atomica, se aprovado.
import {reconcilePixPayment} from '../lib/agenda-mp-pix.js';
const UUID=/^[a-f0-9]{8}-(?:[a-f0-9]{4}-){3}[a-f0-9]{12}$/i;
export default async function handler(req,res){
  res.setHeader('Cache-Control','no-store');
  if(req.method!=='POST'){res.setHeader('Allow','POST');return res.status(405).json({error:'method_not_allowed'});}
  const root=process.env.AGENDA_SUPABASE_URL,key=process.env.AGENDA_SUPABASE_SECRET_KEY;
  const token=/^Bearer (.+)$/i.exec(String(req.headers.authorization||''))?.[1];
  const businessId=String(req.body?.business_id||'');
  if(!token||token.length>4096)return res.status(401).json({error:'unauthorized'});
  if(!UUID.test(businessId))return res.status(400).json({error:'invalid_business_id'});
  if(!root||!key)return res.status(503).json({error:'billing_not_configured'});
  let base;
  try{base=new URL(root);if(base.protocol!=='https:')throw Error('url');}
  catch(_){return res.status(503).json({error:'invalid_configuration'});}
  const h={apikey:key,Authorization:'Bearer '+key,Accept:'application/json'};
  try {
    const auth=await fetch(new URL('/auth/v1/user',base),{
      headers:{apikey:key,Authorization:'Bearer '+token},signal:AbortSignal.timeout(8000)});
    if(!auth.ok)return res.status(401).json({error:'unauthorized'});
    const user=await auth.json();
    if(!UUID.test(String(user.id||'')))return res.status(401).json({error:'unauthorized'});
    const members=new URL('/rest/v1/agenda_members',base);
    members.searchParams.set('select','role');members.searchParams.set('business_id','eq.'+businessId);
    members.searchParams.set('user_id','eq.'+user.id);members.searchParams.set('limit','2');
    const memberResponse=await fetch(members,{headers:h,signal:AbortSignal.timeout(9000)});
    if(!memberResponse.ok)return res.status(502).json({error:'database_unavailable'});
    const member=await memberResponse.json();
    if(member.length!==1||!['owner','admin'].includes(member[0].role))
      return res.status(403).json({error:'owner_required'});
    const url=new URL('/rest/v1/agenda_mp_pix_charges',base);
    url.searchParams.set('select','mp_payment_id,status');
    url.searchParams.set('business_id','eq.'+businessId);
    url.searchParams.set('order','created_at.desc');
    url.searchParams.set('limit','1');
    const latest=await fetch(url,{headers:h,signal:AbortSignal.timeout(9000)});
    if(!latest.ok)return res.status(502).json({error:'database_unavailable'});
    const charges=await latest.json();
    if(!charges.length)return res.status(200).json({ok:true,payment_found:false,paid:false});
    if(charges[0].status==='approved')
      return res.status(200).json({ok:true,payment_found:true,paid:true});
    if(charges[0].status!=='pending'||!charges[0].mp_payment_id)
      return res.status(200).json({ok:true,payment_found:true,paid:false,status:charges[0].status});
    const result=await reconcilePixPayment(charges[0].mp_payment_id);
    if(!result.ok)return res.status(result.http||502).json({error:result.error});
    return res.status(200).json({ok:true,payment_found:true,
      paid:result.status==='approved',processed:result.processed===true,
      status:result.status||'pending'});
  }catch(_){return res.status(502).json({error:'pix_status_unavailable'});}
}
