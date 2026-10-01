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

      let query=admin.from('charges').update({
        status:mapped.status,
        paid_at:mapped.status==='paid'?new Date().toISOString():null,
        cancelled_at:mapped.status==='cancelled'?new Date().toISOString():null,
        provider_payment_id:fields.paymentId,
        boleto_url:fields.boletoUrl,
        digitable_line:fields.digitableLine,
        barcode_content:fields.barcodeContent,
        provider_status_detail:fields.providerStatusDetail,
        updated_at:new Date().toISOString()
      }).eq('organization_id',secret.organization_id);

      query=externalReference?query.eq('id',externalReference):query.eq('provider_charge_id',dataId);
      const {error:updateError}=await query;
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
