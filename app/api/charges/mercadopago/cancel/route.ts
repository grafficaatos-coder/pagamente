import { apiError, requireTenant } from '@/lib/server/supabaseAdmin';
import { cancelMercadoPagoOrder, getMercadoPagoAccessToken } from '@/lib/server/mercadopago';

export const runtime='nodejs';

export async function POST(request:Request){
  try{
    const {admin,member}=await requireTenant(request,['owner','admin','finance']);
    const body=await request.json();
    const chargeId=String(body?.chargeId||'');
    if(!chargeId) throw new Error('Cobrança não informada.');

    const {data:charge,error}=await admin.from('charges')
      .select('id,status,provider,provider_charge_id,pix_provider_charge_id,payment_method')
      .eq('id',chargeId)
      .eq('organization_id',member.organization_id)
      .single();
    if(error) throw error;
    if(charge.status==='paid') throw new Error('Cobrança paga não pode ser cancelada.');
    if(charge.status==='cancelled') return Response.json({ok:true,alreadyCancelled:true});
    if(charge.provider!=='mercadopago'||(!charge.provider_charge_id&&!charge.pix_provider_charge_id)){
      throw new Error('Esta cobrança não possui pagamento Mercado Pago.');
    }

    const accessToken=await getMercadoPagoAccessToken(member.organization_id);
    if(charge.provider_charge_id){
      await cancelMercadoPagoOrder(accessToken,charge.provider_charge_id,'cancel-boleto-'+charge.id);
    }
    if(charge.pix_provider_charge_id){
      await cancelMercadoPagoOrder(accessToken,charge.pix_provider_charge_id,'cancel-pix-'+charge.id);
    }

    const {error:updateError}=await admin.from('charges').update({
      status:'cancelled',
      cancelled_at:new Date().toISOString(),
      provider_status_detail:'canceled',
      updated_at:new Date().toISOString()
    }).eq('id',charge.id);
    if(updateError) throw updateError;

    return Response.json({ok:true});
  }catch(error){
    return apiError(error);
  }
}
