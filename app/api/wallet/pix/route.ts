import { randomUUID } from 'crypto';
import { apiError, requireTenant } from '@/lib/server/supabaseAdmin';
import { asaasRequest, getAsaasBalance, inferPixKey } from '@/lib/server/asaas';
import { decryptSecret } from '@/lib/server/secretCrypto';

export const runtime='nodejs';

function mapStatus(value:any){
  const status=String(value||'').toUpperCase();
  if(['DONE','COMPLETED','CONFIRMED'].includes(status)) return 'completed';
  if(['FAILED','REFUSED'].includes(status)) return 'failed';
  if(['CANCELLED','CANCELED'].includes(status)) return 'cancelled';
  return 'pending';
}

export async function POST(request:Request){
  try{
    const {admin,member}=await requireTenant(request,['owner','admin','finance']);
    const body=await request.json().catch(()=>({}));
    const recipientName=String(body?.recipientName||'').trim();
    const destinationKey=String(body?.destinationKey||'').trim();
    const amountCents=Number(body?.amountCents||0);
    const description=String(body?.description||'Transferência Pix').trim()||'Transferência Pix';

    if(!recipientName) throw new Error('Informe o nome do destinatário.');
    if(!destinationKey) throw new Error('Informe a chave Pix.');
    if(!Number.isInteger(amountCents)||amountCents<=0) throw new Error('Informe um valor válido.');

    const {data:connection,error:connectionError}=await admin.from('provider_connections')
      .select('status,metadata')
      .eq('organization_id',member.organization_id)
      .eq('provider','baas')
      .maybeSingle();
    if(connectionError) throw connectionError;
    if(connection?.status!=='connected') throw new Error('Conta Asaas ainda não está conectada.');

    const {data:secret,error:secretError}=await admin.from('provider_secrets')
      .select('access_token_cipher')
      .eq('organization_id',member.organization_id)
      .eq('provider','baas')
      .maybeSingle();
    if(secretError) throw secretError;
    if(!secret) throw new Error('Credencial da conta Asaas não encontrada.');

    const apiKey=decryptSecret(secret.access_token_cipher);
    const balance=await getAsaasBalance(apiKey);
    if(balance.balanceCents<amountCents) throw new Error('Saldo insuficiente na conta Asaas.');

    const pix=inferPixKey(destinationKey);
    const transfer=await asaasRequest<any>(apiKey,'/transfers',{
      method:'POST',
      body:JSON.stringify({
        value:amountCents/100,
        pixAddressKey:pix.key,
        pixAddressKeyType:pix.type,
        description
      })
    });

    const mappedStatus=mapStatus(transfer?.status);
    const idempotencyKey='asaas-'+String(transfer?.id||randomUUID());

    const {error:transferError}=await admin.from('transfers').insert({
      sender_organization_id:member.organization_id,
      recipient_organization_id:null,
      recipient_name:recipientName,
      destination_key:pix.key,
      description,
      amount_cents:amountCents,
      fee_cents:Math.round(Number(transfer?.transferFee||0)*100),
      status:mappedStatus,
      provider:'asaas',
      provider_transfer_id:String(transfer?.id||''),
      idempotency_key:idempotencyKey,
      created_by:(await admin.auth.getUser(request.headers.get('authorization')?.replace('Bearer ','')||'')).data.user?.id||null,
      completed_at:mappedStatus==='completed'?new Date().toISOString():null,
      failed_at:mappedStatus==='failed'?new Date().toISOString():null
    });
    if(transferError) throw transferError;

    const updatedBalance=await getAsaasBalance(apiKey);
    await admin.from('wallet_accounts').update({
      balance_cents:updatedBalance.balanceCents,
      updated_at:new Date().toISOString()
    }).eq('organization_id',member.organization_id);

    return Response.json({
      ok:true,
      provider:'asaas',
      transferId:transfer?.id||null,
      status:mappedStatus,
      providerStatus:transfer?.status||null,
      balanceCents:updatedBalance.balanceCents
    });
  }catch(error){
    return apiError(error);
  }
}
