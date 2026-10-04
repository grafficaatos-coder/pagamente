import { randomUUID } from 'crypto';
import { apiError, requireTenant } from '@/lib/server/supabaseAdmin';
import { asaasRequest, getAsaasBalance, getOrganizationAsaasApiKey, inferPixKey } from '@/lib/server/asaas';

export const runtime='nodejs';

function mapStatus(value:any){
  const status=String(value||'').toUpperCase();
  if(['DONE','COMPLETED','CONFIRMED'].includes(status)) return 'completed';
  if(['FAILED','REFUSED'].includes(status)) return 'failed';
  if(['CANCELLED','CANCELED'].includes(status)) return 'cancelled';
  return 'pending';
}


export async function GET(request:Request){
  try{
    const {admin,member}=await requireTenant(request,['owner','admin','finance']);
    const url=new URL(request.url);
    const localTransferId=String(url.searchParams.get('transferId')||'').trim();

    let query=admin.from('transfers')
      .select('id,recipient_name,amount_cents,fee_cents,status,provider_transfer_id,created_at')
      .eq('sender_organization_id',member.organization_id)
      .eq('provider','asaas');

    if(localTransferId){
      query=query.eq('id',localTransferId);
    }else{
      query=query.eq('status','pending').limit(20);
    }

    const {data:rows,error}=await query;
    if(error) throw error;
    const transfers=rows??[];
    if(!transfers.length) return Response.json({ok:true,updates:[]});

    const apiKey=await getOrganizationAsaasApiKey(admin,member.organization_id);
    const updates:any[]=[];

    for(const row of transfers){
      if(!row.provider_transfer_id) continue;
      try{
        const providerTransfer=await asaasRequest<any>(
          apiKey,
          '/transfers/'+encodeURIComponent(String(row.provider_transfer_id)),
          {method:'GET'}
        );
        const nextStatus=mapStatus(providerTransfer?.status);
        const now=new Date().toISOString();
        const patch:any={
          status:nextStatus,
          completed_at:nextStatus==='completed'?(row.status==='completed'?undefined:now):null,
          failed_at:nextStatus==='failed'?(row.status==='failed'?undefined:now):null
        };
        if(patch.completed_at===undefined) delete patch.completed_at;
        if(patch.failed_at===undefined) delete patch.failed_at;

        const {error:updateError}=await admin.from('transfers').update(patch).eq('id',row.id);
        if(updateError) throw updateError;

        updates.push({
          id:row.id,
          status:nextStatus,
          providerStatus:String(providerTransfer?.status||''),
          failReason:providerTransfer?.failReason||null,
          receiptUrl:providerTransfer?.transactionReceiptUrl||null
        });
      }catch(refreshError){
        updates.push({
          id:row.id,
          status:row.status,
          error:refreshError instanceof Error?refreshError.message:'Falha ao consultar transferência no Asaas.'
        });
      }
    }

    const updatedBalance=await getAsaasBalance(apiKey).catch(()=>null);
    if(updatedBalance){
      await admin.from('wallet_accounts').update({
        balance_cents:updatedBalance.balanceCents,
        updated_at:new Date().toISOString()
      }).eq('organization_id',member.organization_id);
    }

    return Response.json({
      ok:true,
      updates,
      balanceCents:updatedBalance?.balanceCents??null
    });
  }catch(error){
    return apiError(error);
  }
}

export async function POST(request:Request){
  try{
    const {admin,member,user}=await requireTenant(request,['owner','admin','finance']);
    const body=await request.json().catch(()=>({}));
    const recipientName=String(body?.recipientName||'').trim();
    const destinationKey=String(body?.destinationKey||'').trim();
    const destinationKeyType=String(body?.destinationKeyType||'').trim().toUpperCase();
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

    const apiKey=await getOrganizationAsaasApiKey(admin,member.organization_id);
    const balance=await getAsaasBalance(apiKey);
    if(balance.balanceCents<amountCents) throw new Error('Saldo insuficiente na conta Asaas.');

    let pix:{key:string;type:string};
    if(destinationKeyType){
      const digits=destinationKey.replace(/\D/g,'');
      if(destinationKeyType==='PHONE'){
        if(digits.length!==11) throw new Error('Telefone Pix deve ter 11 dígitos, incluindo o DDD.');
        pix={key:digits,type:'PHONE'};
      }else if(destinationKeyType==='CPF'){
        if(digits.length!==11) throw new Error('CPF Pix deve ter 11 dígitos.');
        pix={key:digits,type:'CPF'};
      }else if(destinationKeyType==='CNPJ'){
        if(digits.length!==14) throw new Error('CNPJ Pix deve ter 14 dígitos.');
        pix={key:digits,type:'CNPJ'};
      }else if(destinationKeyType==='EMAIL'){
        if(!destinationKey.includes('@')) throw new Error('Informe um e-mail válido como chave Pix.');
        pix={key:destinationKey.toLowerCase(),type:'EMAIL'};
      }else if(destinationKeyType==='EVP'){
        pix={key:destinationKey,type:'EVP'};
      }else{
        throw new Error('Tipo de chave Pix inválido.');
      }
    }else{
      pix=inferPixKey(destinationKey);
    }

    const {data:duplicate,error:duplicateError}=await admin.from('transfers')
      .select('id,provider_transfer_id,created_at')
      .eq('sender_organization_id',member.organization_id)
      .eq('provider','asaas')
      .eq('status','pending')
      .eq('destination_key',pix.key)
      .eq('amount_cents',amountCents)
      .limit(1)
      .maybeSingle();
    if(duplicateError) throw duplicateError;
    if(duplicate){
      throw new Error('Já existe um Pix com o mesmo valor para esta chave aguardando conclusão no Asaas. Aguarde a conclusão ou cancele a transferência pendente antes de enviar outra.');
    }

    const localTransferId=randomUUID();
    const transfer=await asaasRequest<any>(apiKey,'/transfers',{
      method:'POST',
      body:JSON.stringify({
        value:amountCents/100,
        pixAddressKey:pix.key,
        pixAddressKeyType:pix.type,
        description,
        externalReference:localTransferId
      })
    });

    const mappedStatus=mapStatus(transfer?.status);
    const idempotencyKey='asaas-'+String(transfer?.id||localTransferId);

    const {error:transferError}=await admin.from('transfers').insert({
      id:localTransferId,
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
      created_by:user.id,
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
      failReason:transfer?.failReason||null,
      receiptUrl:transfer?.transactionReceiptUrl||null,
      balanceCents:updatedBalance.balanceCents
    });
  }catch(error){
    return apiError(error);
  }
}
