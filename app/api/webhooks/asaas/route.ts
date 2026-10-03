import { createHash, timingSafeEqual } from 'crypto';
import { getSupabaseAdmin } from '@/lib/server/supabaseAdmin';

export const runtime='nodejs';

function secureEqual(a:string,b:string){
  const aa=Buffer.from(a);
  const bb=Buffer.from(b);
  if(aa.length!==bb.length) return false;
  return timingSafeEqual(aa,bb);
}

function eventKey(body:any){
  const id=String(body?.id||'').trim();
  if(id) return id;
  return createHash('sha256').update(JSON.stringify(body||{})).digest('hex');
}

function mappedChargeStatus(event:string,paymentStatus:string){
  const value=(event||paymentStatus||'').toUpperCase();
  if(['PAYMENT_RECEIVED','PAYMENT_CONFIRMED','PAYMENT_RECEIVED_IN_CASH','RECEIVED','CONFIRMED','RECEIVED_IN_CASH'].includes(value)) return 'paid';
  if(['PAYMENT_OVERDUE','OVERDUE'].includes(value)) return 'overdue';
  if([
    'PAYMENT_DELETED','PAYMENT_REFUNDED','PAYMENT_PARTIALLY_REFUNDED',
    'PAYMENT_CHARGEBACK_REQUESTED','PAYMENT_CHARGEBACK_DISPUTE',
    'REFUNDED','CHARGEBACK_REQUESTED','CHARGEBACK_DISPUTE'
  ].includes(value)) return 'cancelled';
  return null;
}

export async function POST(request:Request){
  const configuredToken=process.env.ASAAS_WEBHOOK_TOKEN||'';
  if(!configuredToken){
    return Response.json({error:'Webhook Asaas não configurado.'},{status:503});
  }

  const incomingToken=request.headers.get('asaas-access-token')||'';
  if(!incomingToken||!secureEqual(incomingToken,configuredToken)){
    return Response.json({error:'Webhook não autorizado.'},{status:401});
  }

  let body:any;
  try{
    body=await request.json();
  }catch{
    return Response.json({error:'Payload inválido.'},{status:400});
  }

  const event=String(body?.event||'');
  const payment=body?.payment||{};
  const paymentId=String(payment?.id||'');
  const transfer=body?.transfer||{};
  const transferId=String(transfer?.id||'');

  if(!event){
    return Response.json({ok:true,ignored:true});
  }

  const admin=getSupabaseAdmin();
  const id=eventKey(body);

  const {data:existing}=await admin
    .from('asaas_webhook_events')
    .select('event_id')
    .eq('event_id',id)
    .maybeSingle();
  if(existing) return Response.json({ok:true,duplicate:true});

  if(event.startsWith('TRANSFER_')&&transferId){
    const mappedTransferStatus=
      event==='TRANSFER_DONE'||String(transfer?.status||'').toUpperCase()==='DONE'?'completed':
      event==='TRANSFER_FAILED'||String(transfer?.status||'').toUpperCase()==='FAILED'?'failed':
      event==='TRANSFER_CANCELLED'||String(transfer?.status||'').toUpperCase()==='CANCELLED'?'cancelled':
      'pending';

    const {data:localTransfer,error:transferLookupError}=await admin
      .from('transfers')
      .select('id,status')
      .eq('provider','asaas')
      .eq('provider_transfer_id',transferId)
      .maybeSingle();
    if(transferLookupError) return Response.json({error:transferLookupError.message},{status:500});

    if(localTransfer){
      const now=new Date().toISOString();
      const patch:any={status:mappedTransferStatus};
      if(mappedTransferStatus==='completed') patch.completed_at=localTransfer.status==='completed'?undefined:now;
      if(mappedTransferStatus==='failed') patch.failed_at=localTransfer.status==='failed'?undefined:now;
      if(patch.completed_at===undefined) delete patch.completed_at;
      if(patch.failed_at===undefined) delete patch.failed_at;

      const {error:updateTransferError}=await admin
        .from('transfers')
        .update(patch)
        .eq('id',localTransfer.id);
      if(updateTransferError) return Response.json({error:updateTransferError.message},{status:500});
    }

    const {error:transferEventError}=await admin.from('asaas_webhook_events').insert({
      event_id:id,
      event_type:event,
      payment_id:null,
      charge_id:null,
      payload:body
    });
    if(transferEventError&&transferEventError.code!=='23505'){
      return Response.json({error:transferEventError.message},{status:500});
    }

    return Response.json({
      ok:true,
      matched:Boolean(localTransfer),
      transferStatus:mappedTransferStatus
    });
  }

  if(!paymentId){
    return Response.json({ok:true,ignored:true});
  }

  const {data:charge,error:chargeError}=await admin
    .from('charges')
    .select('id,organization_id,description,amount_cents,status,provider,provider_charge_id,clients(name)')
    .eq('provider','asaas')
    .eq('provider_charge_id',paymentId)
    .maybeSingle();
  if(chargeError) return Response.json({error:chargeError.message},{status:500});

  const status=mappedChargeStatus(event,String(payment?.status||''));
  if(charge&&status){
    const {error:updateError}=await admin
      .from('charges')
      .update({
        status,
        provider_status_detail:String(payment?.status||event),
        updated_at:new Date().toISOString()
      })
      .eq('id',charge.id);
    if(updateError) return Response.json({error:updateError.message},{status:500});

    if(event==='PAYMENT_RECEIVED'){
      const client:any=Array.isArray((charge as any).clients)?(charge as any).clients[0]:(charge as any).clients;
      const {data:existingTx,error:existingTxError}=await admin.from('transactions')
        .select('id')
        .eq('reference_id',charge.id)
        .eq('type','charge')
        .eq('direction','credit')
        .maybeSingle();
      if(existingTxError) return Response.json({error:existingTxError.message},{status:500});
      if(!existingTx){
        const {error:txError}=await admin.from('transactions').insert({
          organization_id:charge.organization_id,
          type:'charge',
          direction:'credit',
          description:'Recebimento Asaas - '+charge.description,
          counterpart:client?.name||'Cliente',
          amount_cents:Number(charge.amount_cents),
          reference_id:charge.id
        });
        if(txError&&txError.code!=='23505'){
          return Response.json({error:txError.message},{status:500});
        }
      }
    }
  }

  const {error:eventError}=await admin.from('asaas_webhook_events').insert({
    event_id:id,
    event_type:event,
    payment_id:paymentId,
    charge_id:charge?.id||null,
    payload:body
  });
  if(eventError&&eventError.code!=='23505'){
    return Response.json({error:eventError.message},{status:500});
  }

  return Response.json({ok:true,matched:Boolean(charge),status:status||null});
}
