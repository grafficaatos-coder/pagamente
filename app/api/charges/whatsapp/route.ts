import { apiError, requireTenant } from '@/lib/server/supabaseAdmin';
import { sendChargeWhatsApp } from '@/lib/server/whatsapp';

export const runtime='nodejs';

export async function POST(request:Request){
  try{
    const {admin,member,organization}=await requireTenant(request,['owner','admin','finance']);
    const body=await request.json();
    const chargeId=String(body?.chargeId||'');
    if(!chargeId) throw new Error('Cobrança não informada.');

    const {data:charge,error}=await admin.from('charges')
      .select('id,organization_id,description,amount_cents,due_date,payment_method,boleto_url,digitable_line,pix_url,pix_code,clients(name,whatsapp)')
      .eq('id',chargeId)
      .eq('organization_id',member.organization_id)
      .single();
    if(error) throw error;

    const client:any=Array.isArray(charge.clients)?charge.clients[0]:charge.clients;
    if(!client?.whatsapp) throw new Error('O cliente não possui WhatsApp cadastrado.');
    if(!charge.boleto_url&&!charge.pix_url) throw new Error('Esta cobrança ainda não possui link de pagamento.');

    const result=await sendChargeWhatsApp({
      to:client.whatsapp,
      clientName:client.name,
      organizationName:organization.name,
      description:charge.description,
      amountCents:Number(charge.amount_cents),
      dueDate:charge.due_date,
      paymentMethod:charge.payment_method,
      paymentUrl:charge.payment_method==='boleto_pix'?null:charge.boleto_url,
      digitableLine:charge.payment_method==='boleto_pix'?null:charge.digitable_line,
      boletoUrl:charge.payment_method==='boleto_pix'?charge.boleto_url:null,
      boletoLine:charge.payment_method==='boleto_pix'?charge.digitable_line:null,
      pixUrl:charge.payment_method==='boleto_pix'?charge.pix_url:null,
      pixCode:charge.payment_method==='boleto_pix'?charge.pix_code:null
    });

    await admin.from('charges').update({
      whatsapp_sent_at:new Date().toISOString(),
      whatsapp_delivery_id:result.id||null,
      whatsapp_delivery_error:null,
      updated_at:new Date().toISOString()
    }).eq('id',charge.id);

    return Response.json({ok:true,id:result.id});
  }catch(error){
    return apiError(error);
  }
}
