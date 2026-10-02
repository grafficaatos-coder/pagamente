import { apiError, requireTenant } from '@/lib/server/supabaseAdmin';
import { sendChargeEmail } from '@/lib/server/chargeEmail';

export const runtime='nodejs';

export async function POST(request:Request){
  try{
    const {admin,member}=await requireTenant(request,['owner','admin','finance']);
    const body=await request.json();
    const chargeId=String(body?.chargeId||'');
    const force=body?.force===true;
    if(!chargeId) throw new Error('Cobrança não informada.');

    const {data:charge,error}=await admin.from('charges')
      .select('id,organization_id,description,amount_cents,due_date,status,payment_method,boleto_url,digitable_line,send_email,email_sent_at,clients(name,email)')
      .eq('id',chargeId)
      .eq('organization_id',member.organization_id)
      .single();
    if(error) throw error;

    if(!force&&!charge.send_email) {
      return Response.json({ok:true,skipped:true,reason:'Envio automático por e-mail desativado para esta cobrança.'});
    }
    if(!force&&charge.email_sent_at){
      return Response.json({ok:true,skipped:true,reason:'E-mail já enviado.',sentAt:charge.email_sent_at});
    }

    const client:any=Array.isArray(charge.clients)?charge.clients[0]:charge.clients;
    if(!client?.email) throw new Error('Cliente sem e-mail cadastrado.');
    if(!charge.boleto_url) throw new Error('A cobrança ainda não possui link de pagamento.');

    try{
      const result=await sendChargeEmail({
        to:client.email,
        clientName:client.name||'Cliente',
        description:charge.description,
        amountCents:Number(charge.amount_cents),
        dueDate:charge.due_date,
        paymentMethod:charge.payment_method,
        paymentUrl:charge.boleto_url,
        digitableLine:charge.digitable_line
      });

      const sentAt=new Date().toISOString();
      await admin.from('charges').update({
        email_sent_at:sentAt,
        email_last_error:null,
        updated_at:sentAt
      }).eq('id',charge.id);

      return Response.json({ok:true,id:result?.id||null,sentAt});
    }catch(sendError){
      const message=sendError instanceof Error?sendError.message:'Falha ao enviar e-mail.';
      await admin.from('charges').update({
        email_last_error:message,
        updated_at:new Date().toISOString()
      }).eq('id',charge.id);
      throw sendError;
    }
  }catch(error){
    return apiError(error);
  }
}
