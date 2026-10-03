import { getSupabaseAdmin } from '@/lib/server/supabaseAdmin';
import {
  boletoFields,
  getMercadoPagoOrder,
  getMercadoPagoPayment,
  mapMercadoPagoOrderStatus,
  mapMercadoPagoPaymentStatus,
  validateWebhookSignature
} from '@/lib/server/mercadopago';
import { decryptSecret } from '@/lib/server/secretCrypto';

export const runtime='nodejs';

export async function POST(request:Request){
  const url=new URL(request.url);
  const body=await request.json().catch(()=>({}));
  const dataId=String(url.searchParams.get('data.id')||body?.data?.id||'').trim();
  const xSignature=request.headers.get('x-signature');
  const xRequestId=request.headers.get('x-request-id');

  try{
    if(!validateWebhookSignature({xSignature,xRequestId,dataId:dataId||null})){
      return Response.json({error:'Assinatura inválida.'},{status:401});
    }

    const sellerId=body?.user_id!=null?String(body.user_id):null;
    if(!sellerId||!dataId) return Response.json({ok:true,ignored:true});

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
      body?.action||body?.type||body?.topic||'event',
      body?.data?.status||'',
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
      const accessToken=decryptSecret(secret.access_token_cipher);
      const eventType=String(body?.type||body?.topic||'').toLowerCase();
      const action=String(body?.action||'').toLowerCase();
      const isPaymentEvent=eventType==='payment'||action.startsWith('payment.');

      let mapped:any;
      let fields:any=null;
      let externalReference='';
      let providerPaymentId:string|null=null;
      let providerOrderId:string|null=null;

      if(isPaymentEvent){
        const payment=await getMercadoPagoPayment(accessToken,dataId);
        mapped=mapMercadoPagoPaymentStatus(payment);
        externalReference=String(payment?.external_reference||'');
        providerPaymentId=payment?.id!=null?String(payment.id):dataId;
        providerOrderId=payment?.order?.id!=null?String(payment.order.id):null;
      }else{
        const order=await getMercadoPagoOrder(accessToken,dataId);
        mapped=mapMercadoPagoOrderStatus(order);
        fields=boletoFields(order);
        externalReference=String(order?.external_reference||'');
        providerPaymentId=fields.paymentId||null;
        providerOrderId=fields.orderId||dataId;
      }

      let chargeQuery=admin.from('charges')
        .select('id,status,payment_method,provider_charge_id,provider_payment_id,pix_provider_charge_id,pix_provider_payment_id')
        .eq('organization_id',secret.organization_id)
        .eq('provider','mercadopago');

      chargeQuery=externalReference
        ? chargeQuery.eq('id',externalReference)
        : providerPaymentId
          ? chargeQuery.or('provider_payment_id.eq.'+providerPaymentId+',pix_provider_payment_id.eq.'+providerPaymentId)
          : chargeQuery.or('provider_charge_id.eq.'+dataId+',pix_provider_charge_id.eq.'+dataId);

      const {data:charge,error:chargeError}=await chargeQuery.maybeSingle();
      if(chargeError) throw chargeError;
      if(!charge){
        await admin.from('webhook_events').update({processed_at:new Date().toISOString(),processing_error:null})
          .eq('provider','mercadopago').eq('event_key',eventKey);
        return Response.json({ok:true,ignored:true});
      }

      const combined=charge.payment_method==='boleto_pix';
      const isPix=fields?.paymentMethod==='pix';
      let nextStatus=charge.status;
      if(mapped.status==='paid') nextStatus='paid';
      else if(!combined&&mapped.status==='cancelled') nextStatus='cancelled';
      else if(!combined&&mapped.status==='failed') nextStatus='failed';
      else if(charge.status!=='paid'&&charge.status!=='cancelled'&&mapped.status==='pending') nextStatus='pending';

      const update:any={
        status:nextStatus,
        provider_status_detail:fields?.providerStatusDetail||mapped.detail||null,
        updated_at:new Date().toISOString()
      };
      if(nextStatus==='paid'&&charge.status!=='paid') update.paid_at=new Date().toISOString();
      if(nextStatus==='cancelled') update.cancelled_at=new Date().toISOString();

      if(!isPaymentEvent&&fields){
        if(isPix&&combined){
          update.pix_provider_charge_id=fields.orderId;
          update.pix_provider_payment_id=fields.paymentId;
          update.pix_url=fields.boletoUrl;
          update.pix_code=fields.digitableLine;
          update.pix_qr_base64=fields.barcodeContent;
        }else if(charge.payment_method!=='card'){
          update.provider_charge_id=fields.orderId;
          update.provider_payment_id=fields.paymentId;
          update.boleto_url=fields.boletoUrl;
          update.digitable_line=fields.digitableLine;
          update.barcode_content=fields.barcodeContent;
        }
      }else if(isPaymentEvent&&providerPaymentId){
        if(charge.payment_method==='card'){
          update.provider_payment_id=providerPaymentId;
          if(providerOrderId&&!charge.provider_charge_id) update.provider_charge_id=providerOrderId;
        }else if(combined&&String(charge.pix_provider_payment_id||'')===providerPaymentId){
          update.pix_provider_payment_id=providerPaymentId;
        }else{
          update.provider_payment_id=providerPaymentId;
        }
      }

      const {error:updateError}=await admin.from('charges').update(update).eq('id',charge.id);
      if(updateError) throw updateError;

      await admin.from('webhook_events').update({processed_at:new Date().toISOString(),processing_error:null})
        .eq('provider','mercadopago').eq('event_key',eventKey);

      return Response.json({ok:true,chargeId:charge.id,status:nextStatus});
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
