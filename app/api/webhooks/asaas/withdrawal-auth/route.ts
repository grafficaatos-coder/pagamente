import { timingSafeEqual } from 'crypto';
import { getSupabaseAdmin } from '@/lib/server/supabaseAdmin';

export const runtime='nodejs';

function secureEqual(a:string,b:string){
  const aa=Buffer.from(a);
  const bb=Buffer.from(b);
  if(aa.length!==bb.length) return false;
  return timingSafeEqual(aa,bb);
}

function normalizeKey(value:any){
  const raw=String(value||'').trim().toLowerCase();
  if(!raw) return '';
  if(raw.includes('@')) return raw;
  const digits=raw.replace(/\D/g,'');
  return digits||raw;
}

function refuse(reason:string){
  return Response.json({status:'REFUSED',refuseReason:reason});
}

export async function POST(request:Request){
  const configuredToken=process.env.ASAAS_WITHDRAWAL_AUTH_TOKEN||'';
  if(!configuredToken){
    return refuse('Autorização automática não configurada no JP.');
  }

  const incomingToken=request.headers.get('asaas-access-token')||'';
  if(!incomingToken||!secureEqual(incomingToken,configuredToken)){
    return refuse('Token de autenticação inválido.');
  }

  let body:any;
  try{
    body=await request.json();
  }catch{
    return refuse('Payload inválido.');
  }

  if(String(body?.type||'').toUpperCase()!=='TRANSFER'){
    return refuse('O JP aprova automaticamente apenas transferências criadas pelo próprio sistema.');
  }

  const transfer=body?.transfer||{};
  const transferId=String(transfer?.id||'').trim();
  if(!transferId) return refuse('Transferência sem identificador.');

  const admin=getSupabaseAdmin();
  const {data:local,error}=await admin.from('transfers')
    .select('id,sender_organization_id,destination_key,amount_cents,status,provider_transfer_id')
    .eq('provider','asaas')
    .eq('provider_transfer_id',transferId)
    .maybeSingle();

  if(error) return refuse('Não foi possível validar a transferência.');
  if(!local) return refuse('Transferência não encontrada no JP.');
  if(!['pending','processing'].includes(String(local.status||''))){
    return refuse('A transferência não está aguardando autorização.');
  }

  const incomingValueCents=Math.round(Number(transfer?.value||0)*100);
  if(!Number.isFinite(incomingValueCents)||incomingValueCents!==Number(local.amount_cents)){
    return refuse('O valor recebido do Asaas não corresponde ao valor registrado no JP.');
  }

  const operationType=String(transfer?.operationType||'').toUpperCase();
  if(operationType&&operationType!=='PIX'){
    return refuse('A operação não é uma transferência Pix reconhecida pelo JP.');
  }

  const externalReference=String(transfer?.externalReference||'').trim();
  if(externalReference&&externalReference!==String(local.id)){
    return refuse('A referência externa não corresponde à transferência registrada no JP.');
  }

  const incomingKey=normalizeKey(transfer?.bankAccount?.pixAddressKey);
  const storedKey=normalizeKey(local.destination_key);
  if(incomingKey&&storedKey&&incomingKey!==storedKey){
    return refuse('A chave Pix recebida não corresponde à transferência registrada no JP.');
  }

  try{
    await admin.from('webhook_events').insert({
      provider:'asaas_withdrawal_auth',
      event_key:'TRANSFER:'+transferId,
      organization_id:local.sender_organization_id,
      payload:body,
      processed_at:new Date().toISOString(),
      processing_error:null
    });
  }catch{
    // O log não pode impedir a autorização de uma transferência já validada.
  }

  return Response.json({status:'APPROVED'});
}
