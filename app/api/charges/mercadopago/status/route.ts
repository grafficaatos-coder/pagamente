import { apiError, requireTenant } from '@/lib/server/supabaseAdmin';
import {
  getMercadoPagoAccessToken,
  getMercadoPagoOrder,
  mapMercadoPagoOrderStatus,
  searchMercadoPagoPayments,
  mapMercadoPagoPaymentStatus
} from '@/lib/server/mercadopago';

export const runtime='nodejs';

function bestStatus(values:string[]){
  if(values.includes('paid')) return 'paid';
  if(values.includes('failed')) return 'failed';
  if(values.includes('cancelled')) return 'cancelled';
  return 'pending';
}

export async function GET(request:Request){
  try{
    const {admin,member}=await requireTenant(request,['owner','admin','finance']);
    const url=new URL(request.url);
    const chargeId=String(url.searchParams.get('chargeId')||'').trim();

    let query=admin.from('charges')
      .select('id,status,payment_method,provider_charge_id,pix_provider_charge_id,provider_payment_id,pix_provider_payment_id,provider_status_detail')
      .eq('organization_id',member.organization_id)
      .eq('provider','mercadopago');

    if(chargeId){
      query=query.eq('id',chargeId);
    }else{
      query=query.in('status',['draft','pending','overdue']).limit(50);
    }

    const {data:rows,error}=await query;
    if(error) throw error;

    const accessToken=await getMercadoPagoAccessToken(member.organization_id);
    const updates:any[]=[];

    for(const charge of rows??[]){
      try{
        const statuses:string[]=[];
        let detail:string|null=null;
        let paymentId:string|null=null;

        if(charge.payment_method==='card'){
          const search=await searchMercadoPagoPayments(accessToken,charge.id);
          const results=Array.isArray(search?.results)?search.results:[];
          for(const payment of results){
            const mapped=mapMercadoPagoPaymentStatus(payment);
            statuses.push(mapped.status);
            if(mapped.detail) detail=mapped.detail;
            if(mapped.status==='paid'&&payment?.id!=null) paymentId=String(payment.id);
          }
          if(!results.length) statuses.push('pending');
        }else{
          if(charge.provider_charge_id){
            const order=await getMercadoPagoOrder(accessToken,String(charge.provider_charge_id));
            const mapped=mapMercadoPagoOrderStatus(order);
            statuses.push(mapped.status);
            detail=mapped.detail||detail;
          }
          if(charge.payment_method==='boleto_pix'&&charge.pix_provider_charge_id){
            const pixOrder=await getMercadoPagoOrder(accessToken,String(charge.pix_provider_charge_id));
            const mappedPix=mapMercadoPagoOrderStatus(pixOrder);
            statuses.push(mappedPix.status);
            detail=mappedPix.detail||detail;
          }
          if(!statuses.length) statuses.push('pending');
        }

        const nextStatus=bestStatus(statuses);
        const patch:any={
          status:nextStatus,
          provider_status_detail:detail||charge.provider_status_detail||null,
          updated_at:new Date().toISOString()
        };
        if(nextStatus==='paid'&&charge.status!=='paid') patch.paid_at=new Date().toISOString();
        if(nextStatus==='cancelled') patch.cancelled_at=new Date().toISOString();
        if(paymentId) patch.provider_payment_id=paymentId;

        const {error:updateError}=await admin.from('charges').update(patch).eq('id',charge.id);
        if(updateError) throw updateError;

        updates.push({id:charge.id,status:nextStatus,detail:patch.provider_status_detail});
      }catch(refreshError){
        updates.push({
          id:charge.id,
          status:charge.status,
          error:refreshError instanceof Error?refreshError.message:'Falha ao consultar Mercado Pago.'
        });
      }
    }

    return Response.json({ok:true,updates});
  }catch(error){
    return apiError(error);
  }
}
