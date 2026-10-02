import { apiError, requireTenant } from '@/lib/server/supabaseAdmin';
import { createBoletoOrder, createPixOrder, getMercadoPagoAccessToken, mapMercadoPagoOrderStatus, paymentFields } from '@/lib/server/mercadopago';
import { sendChargeEmail } from '@/lib/server/email';

export const runtime='nodejs';

function daysUntil(dateValue:string){
  const now=new Date();
  const today=Date.UTC(now.getUTCFullYear(),now.getUTCMonth(),now.getUTCDate());
  const due=new Date(dateValue+'T00:00:00Z').getTime();
  return Math.ceil((due-today)/86400000);
}

export async function POST(request:Request){
  try{
    const {admin,member,organization,subscription}=await requireTenant(request,['owner','admin','finance']);
    if(!['active','trialing'].includes(organization.status)||!['active','trialing'].includes(subscription?.status||'')){
      throw new Error('A conta da empresa não está liberada para emitir cobranças.');
    }

    const body=await request.json();
    const chargeId=String(body?.chargeId||'');
    if(!chargeId) throw new Error('Cobrança não informada.');

    const {data:charge,error:chargeError}=await admin.from('charges')
      .select('id,organization_id,client_id,description,amount_cents,due_date,status,provider,payment_method,provider_charge_id,boleto_url,digitable_line,barcode_content,send_email,email_sent_at,clients(id,name,document,email,address,status)')
      .eq('id',chargeId)
      .eq('organization_id',member.organization_id)
      .single();
    if(chargeError) throw chargeError;
    if(!charge) throw new Error('Cobrança não encontrada.');
    const emailCharge=charge;

    if(charge.status==='paid'||charge.status==='cancelled') throw new Error('Esta cobrança não pode gerar um novo pagamento.');
    const requestedMethod=body?.method==='pix'?'pix':body?.method==='boleto'?'boleto':null;
    const paymentMethod=requestedMethod||charge.payment_method||'boleto';

    const client:any=Array.isArray(charge.clients)?charge.clients[0]:charge.clients;

    async function sendEmailIfNeeded(paymentUrl:string|null,paymentLine:string|null,method:string|null){
      if(!emailCharge.send_email||emailCharge.email_sent_at||!client?.email)return {sent:false,skipped:true};
      try{
        const result=await sendChargeEmail({
          to:client.email,
          clientName:client.name,
          organizationName:organization.name,
          description:emailCharge.description,
          amountCents:Number(emailCharge.amount_cents),
          dueDate:emailCharge.due_date,
          paymentMethod:method,
          paymentUrl,
          digitableLine:paymentLine
        });
        await admin.from('charges').update({
          email_sent_at:new Date().toISOString(),
          email_delivery_id:result.id||null,
          email_delivery_error:null,
          updated_at:new Date().toISOString()
        }).eq('id',emailCharge.id);
        return {sent:true,skipped:false};
      }catch(error){
        const message=error instanceof Error?error.message:'Falha ao enviar e-mail.';
        await admin.from('charges').update({
          email_delivery_error:message,
          updated_at:new Date().toISOString()
        }).eq('id',emailCharge.id);
        return {sent:false,skipped:false,error:message};
      }
    }

    if(charge.provider==='mercadopago'&&charge.provider_charge_id&&charge.boleto_url){
      const email=await sendEmailIfNeeded(charge.boleto_url,charge.digitable_line,charge.payment_method||paymentMethod);
      return Response.json({
        ok:true,existing:true,paymentMethod:charge.payment_method||paymentMethod,
        paymentUrl:charge.boleto_url,boletoUrl:charge.boleto_url,
        copyPaste:charge.digitable_line,digitableLine:charge.digitable_line,
        barcodeContent:charge.barcode_content,orderId:charge.provider_charge_id,
        email
      });
    }
    if(!client||client.status!=='active') throw new Error('Cliente inválido ou inativo.');
    if(!client.email) throw new Error('Cadastre o e-mail do cliente antes de gerar o pagamento.');

    const expirationDays=daysUntil(charge.due_date);
    if(expirationDays<1||expirationDays>30){
      throw new Error('No Mercado Pago, o vencimento deve ficar entre 1 e 30 dias após a emissão.');
    }

    const accessToken=await getMercadoPagoAccessToken(member.organization_id);
    let order:any;

    if(paymentMethod==='pix'){
      order=await createPixOrder(accessToken,{
        chargeId:charge.id,
        amountCents:Number(emailCharge.amount_cents),
        description:emailCharge.description,
        expirationDays,
        payer:{email:client.email}
      });
    }else{
      const document=String(client.document||'').replace(/\D/g,'');
      if(![11,14].includes(document.length)) throw new Error('Cadastre um CPF ou CNPJ válido no cliente.');
      const address=client.address||{};
      const required=['zip_code','street_name','street_number','neighborhood','city','state'];
      const missing=required.filter(key=>!String(address[key]||'').trim());
      if(missing.length) throw new Error('Complete o endereço do cliente: CEP, rua, número, bairro, cidade e UF.');

      order=await createBoletoOrder(accessToken,{
        chargeId:charge.id,
        amountCents:Number(emailCharge.amount_cents),
        description:emailCharge.description,
        expirationDays,
        payer:{
          email:client.email,
          name:client.name,
          document,
          address:{
            zip_code:String(address.zip_code).replace(/\D/g,''),
            street_name:String(address.street_name),
            street_number:String(address.street_number),
            neighborhood:String(address.neighborhood),
            city:String(address.city),
            state:String(address.state).toUpperCase().slice(0,2)
          }
        }
      });
    }

    const mapped=mapMercadoPagoOrderStatus(order);
    const fields=paymentFields(order);
    if(!fields.orderId||!fields.boletoUrl){
      throw new Error(paymentMethod==='pix'?'Mercado Pago não retornou os dados do Pix.':'Mercado Pago não retornou os dados do boleto.');
    }

    const {error:updateError}=await admin.from('charges').update({
      provider:'mercadopago',
      payment_method:fields.paymentMethod||paymentMethod,
      provider_charge_id:fields.orderId,
      provider_payment_id:fields.paymentId,
      boleto_url:fields.boletoUrl,
      digitable_line:fields.digitableLine,
      barcode_content:fields.barcodeContent,
      provider_status_detail:fields.providerStatusDetail,
      status:mapped.status,
      updated_at:new Date().toISOString()
    }).eq('id',emailCharge.id);
    if(updateError) throw updateError;

    const email=await sendEmailIfNeeded(
      fields.boletoUrl,
      fields.digitableLine,
      fields.paymentMethod||paymentMethod
    );

    return Response.json({
      ok:true,
      paymentMethod:fields.paymentMethod||paymentMethod,
      orderId:fields.orderId,
      paymentId:fields.paymentId,
      paymentUrl:fields.boletoUrl,
      boletoUrl:fields.boletoUrl,
      copyPaste:fields.digitableLine,
      digitableLine:fields.digitableLine,
      barcodeContent:fields.barcodeContent,
      status:mapped.status,
      email
    });
  }catch(error){
    return apiError(error);
  }
}
