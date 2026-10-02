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
      .select('id,organization_id,client_id,description,amount_cents,due_date,status,provider,payment_method,provider_charge_id,provider_payment_id,boleto_url,digitable_line,barcode_content,pix_provider_charge_id,pix_provider_payment_id,pix_url,pix_code,pix_qr_base64,send_email,email_sent_at,clients(id,name,document,email,address,status)')
      .eq('id',chargeId)
      .eq('organization_id',member.organization_id)
      .single();
    if(chargeError) throw chargeError;
    if(!charge) throw new Error('Cobrança não encontrada.');
    const emailCharge=charge;

    if(charge.status==='paid'||charge.status==='cancelled') throw new Error('Esta cobrança não pode gerar um novo pagamento.');
    const requestedMethod=body?.method==='pix'?'pix':body?.method==='boleto'?'boleto':body?.method==='both'?'boleto_pix':null;
    const paymentMethod=requestedMethod||charge.payment_method||'boleto';

    const client:any=Array.isArray(charge.clients)?charge.clients[0]:charge.clients;

    async function sendEmailIfNeeded(input:{
      method:string|null;
      paymentUrl?:string|null;
      paymentLine?:string|null;
      boletoUrl?:string|null;
      boletoLine?:string|null;
      pixUrl?:string|null;
      pixCode?:string|null;
    }){
      if(!emailCharge.send_email||emailCharge.email_sent_at||!client?.email)return {sent:false,skipped:true};
      try{
        const result=await sendChargeEmail({
          to:client.email,
          clientName:client.name,
          organizationName:organization.name,
          description:emailCharge.description,
          amountCents:Number(emailCharge.amount_cents),
          dueDate:emailCharge.due_date,
          paymentMethod:input.method,
          paymentUrl:input.paymentUrl,
          digitableLine:input.paymentLine,
          boletoUrl:input.boletoUrl,
          boletoLine:input.boletoLine,
          pixUrl:input.pixUrl,
          pixCode:input.pixCode
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

    const hasExistingSingle=charge.provider==='mercadopago'&&charge.payment_method!=='boleto_pix'&&charge.provider_charge_id&&charge.boleto_url;
    const hasExistingBoth=charge.provider==='mercadopago'&&charge.payment_method==='boleto_pix'&&charge.provider_charge_id&&charge.boleto_url&&charge.pix_provider_charge_id&&charge.pix_url;

    if(hasExistingBoth){
      const email=await sendEmailIfNeeded({
        method:'boleto_pix',
        boletoUrl:charge.boleto_url,
        boletoLine:charge.digitable_line,
        pixUrl:charge.pix_url,
        pixCode:charge.pix_code
      });
      return Response.json({
        ok:true,existing:true,paymentMethod:'boleto_pix',
        boletoUrl:charge.boleto_url,digitableLine:charge.digitable_line,
        pixUrl:charge.pix_url,pixCode:charge.pix_code,
        orderId:charge.provider_charge_id,pixOrderId:charge.pix_provider_charge_id,
        email
      });
    }

    if(hasExistingSingle){
      const email=await sendEmailIfNeeded({
        method:charge.payment_method||paymentMethod,
        paymentUrl:charge.boleto_url,
        paymentLine:charge.digitable_line
      });
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
    const amountCents=Number(emailCharge.amount_cents);

    const createBoleto=async()=>{
      const document=String(client.document||'').replace(/\D/g,'');
      if(![11,14].includes(document.length)) throw new Error('Cadastre um CPF ou CNPJ válido no cliente.');
      const address=client.address||{};
      const required=['zip_code','street_name','street_number','neighborhood','city','state'];
      const missing=required.filter(key=>!String(address[key]||'').trim());
      if(missing.length) throw new Error('Complete o endereço do cliente: CEP, rua, número, bairro, cidade e UF.');

      const order=await createBoletoOrder(accessToken,{
        chargeId:charge.id,
        idempotencyKey:charge.id+'-boleto',
        amountCents,
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
      const fields=paymentFields(order);
      if(!fields.orderId||!fields.boletoUrl) throw new Error('Mercado Pago não retornou os dados do boleto.');
      return {order,fields,mapped:mapMercadoPagoOrderStatus(order)};
    };

    const createPix=async()=>{
      const order=await createPixOrder(accessToken,{
        chargeId:charge.id,
        idempotencyKey:charge.id+'-pix',
        amountCents,
        description:emailCharge.description,
        expirationDays,
        payer:{email:client.email}
      });
      const fields=paymentFields(order);
      if(!fields.orderId||!fields.boletoUrl) throw new Error('Mercado Pago não retornou os dados do Pix.');
      return {order,fields,mapped:mapMercadoPagoOrderStatus(order)};
    };

    if(paymentMethod==='boleto_pix'){
      const boleto=await createBoleto();
      const pix=await createPix();

      const {error:updateError}=await admin.from('charges').update({
        provider:'mercadopago',
        payment_method:'boleto_pix',
        provider_charge_id:boleto.fields.orderId,
        provider_payment_id:boleto.fields.paymentId,
        boleto_url:boleto.fields.boletoUrl,
        digitable_line:boleto.fields.digitableLine,
        barcode_content:boleto.fields.barcodeContent,
        pix_provider_charge_id:pix.fields.orderId,
        pix_provider_payment_id:pix.fields.paymentId,
        pix_url:pix.fields.boletoUrl,
        pix_code:pix.fields.digitableLine,
        pix_qr_base64:pix.fields.barcodeContent,
        provider_status_detail:boleto.fields.providerStatusDetail||pix.fields.providerStatusDetail,
        status:boleto.mapped.status==='paid'||pix.mapped.status==='paid'?'paid':'pending',
        updated_at:new Date().toISOString()
      }).eq('id',emailCharge.id);
      if(updateError) throw updateError;

      const email=await sendEmailIfNeeded({
        method:'boleto_pix',
        boletoUrl:boleto.fields.boletoUrl,
        boletoLine:boleto.fields.digitableLine,
        pixUrl:pix.fields.boletoUrl,
        pixCode:pix.fields.digitableLine
      });

      return Response.json({
        ok:true,paymentMethod:'boleto_pix',
        boletoUrl:boleto.fields.boletoUrl,digitableLine:boleto.fields.digitableLine,
        pixUrl:pix.fields.boletoUrl,pixCode:pix.fields.digitableLine,
        orderId:boleto.fields.orderId,pixOrderId:pix.fields.orderId,
        status:'pending',email
      });
    }

    const result=paymentMethod==='pix'?await createPix():await createBoleto();
    const fields=result.fields;

    const {error:updateError}=await admin.from('charges').update({
      provider:'mercadopago',
      payment_method:fields.paymentMethod||paymentMethod,
      provider_charge_id:fields.orderId,
      provider_payment_id:fields.paymentId,
      boleto_url:fields.boletoUrl,
      digitable_line:fields.digitableLine,
      barcode_content:fields.barcodeContent,
      provider_status_detail:fields.providerStatusDetail,
      status:result.mapped.status,
      updated_at:new Date().toISOString()
    }).eq('id',emailCharge.id);
    if(updateError) throw updateError;

    const email=await sendEmailIfNeeded({
      method:fields.paymentMethod||paymentMethod,
      paymentUrl:fields.boletoUrl,
      paymentLine:fields.digitableLine
    });

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
      status:result.mapped.status,
      email
    });
  }catch(error){
    return apiError(error);
  }
}
