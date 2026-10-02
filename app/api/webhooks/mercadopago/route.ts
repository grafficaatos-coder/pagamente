import { getSupabaseAdmin } from '@/lib/server/supabaseAdmin';
import { boletoFields, getMercadoPagoOrder, mapMercadoPagoOrderStatus, validateWebhookSignature } from '@/lib/server/mercadopago';
import { decryptSecret } from '@/lib/server/secretCrypto';

export const runtime='nodejs';

export async function POST(request:Request){
  const url=new URL(request.url);
  const body=await request.json().catch(()=>({}));
  const dataId=url.searchParams.get('data.id')||body?.data?.id||null;
  const xSignature=request.headers.get('x-signature');
  const xRequestId=request.headers.get('x-request-id');

  try{
    if(!validateWebhookSignature({xSignature,xRequestId,dataId})){
      return Response.json({error:'Assinatura inválida.'},{status:401});
    }

    const sellerId=body?.user_id!=null?String(body.user_id):null;
    if(!sellerId||!dataId) return Response.json({ok:true});

    const admin=getSupabaseAdmin();
    const {data:secret,error:secretError}=await admin.from('provider_secrets')
      .select('organization_id,access_token_cipher')
      .eq('provider','mercadopago')
      .eq('external_account_id',sellerId)
      .maybeSingle();
    if(secretError) throw secretError;
    if(!secret) return Response.json({ok:true,ignored:true});

    const eventKey=[
      dataId,
      body?.action||'order',
      body?.data?.status||'unknown',
      body?.data?.version??''
    ].join(':');

    const {error:eventError}=await admin.from('webhook_events').insert({
      provider:'mercadopago',
      event_key:eventKey,
      organization_id:secret.organization_id,
      payload:body
    });
    if(eventError&&eventError.code==='23505') return Response.json({ok:true,duplicate:true});
    if(eventError) throw eventError;

    try{
      const order=await getMercadoPagoOrder(decryptSecret(secret.access_token_cipher),dataId);
      const mapped=mapMercadoPagoOrderStatus(order);
      const fields=boletoFields(order);
      const externalReference=String(order?.external_reference||'');

      let chargeQuery=admin.from('charges')
        .select('id,status,payment_method,provider_charge_id,pix_provider_charge_id')
        .eq('organization_id',secret.organization_id);

      chargeQuery=externalReference
        ? chargeQuery.eq('id',externalReference)
        : chargeQuery.or('provider_charge_id.eq.'+dataId+',pix_provider_charge_id.eq.'+dataId);

      const {data:charge,error:chargeError}=await chargeQuery.maybeSingle();
      if(chargeError) throw chargeError;
      if(!charge){
        await admin.from('webhook_events').update({
          processed_at:new Date().toISOString(),
          processing_error:null
        }).eq('provider','mercadopago').eq('event_key',eventKey);
        return Response.json({ok:true,ignored:true});
      }

      const combined=charge.payment_method==='boleto_pix';
      const isPix=fields.paymentMethod==='pix';
      let nextStatus=charge.status;
      if(mapped.status==='paid') nextStatus='paid';
      else if(!combined&&mapped.status==='cancelled') nextStatus='cancelled';
      else if(charge.status!=='paid'&&mapped.status==='pending') nextStatus='pending';

      const update:any={
        status:nextStatus,
        paid_at:nextStatus==='paid'?(charge.status==='paid'?undefined:new Date().toISOString()):undefined,
        cancelled_at:nextStatus==='cancelled'?new Date().toISOString():null,
        provider_status_detail:fields.providerStatusDetail,
        updated_at:new Date().toISOString()
      };

      if(isPix&&combined){
        update.pix_provider_charge_id=fields.orderId;
        update.pix_provider_payment_id=fields.paymentId;
        update.pix_url=fields.boletoUrl;
        update.pix_code=fields.digitableLine;
        update.pix_qr_base64=fields.barcodeContent;
      }else{
        update.provider_payment_id=fields.paymentId;
        update.boleto_url=fields.boletoUrl;
        update.digitable_line=fields.digitableLine;
        update.barcode_content=fields.barcodeContent;
      }

      if(update.paid_at===undefined) delete update.paid_at;

      const {error:updateError}=await admin.from('charges').update(update).eq('id',charge.id);
      if(updateError) throw updateError;

      await admin.from('webhook_events').update({
        processed_at:new Date().toISOString(),
        processing_error:null
      }).eq('provider','mercadopago').eq('event_key',eventKey);

      return Response.json({ok:true});
    }catch(processingError){
      const message=processingError instanceof Error?processingError.message:'Erro ao processar webhook.';
      await admin.from('webhook_events').update({processing_error:message})
        .eq('provider','mercadopago').eq('event_key',eventKey);
      return Response.json({error:message},{status:500});
    }
  }catch(error){
    const message=error instanceof Error?error.message:'Erro no webhook.';
    return Response.json({error:message},{status:500});
  }
}
