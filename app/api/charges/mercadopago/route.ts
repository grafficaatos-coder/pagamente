import { apiError, requireTenant } from '@/lib/server/supabaseAdmin';
import { createBoletoOrder, createPixOrder, createCardCheckoutPreference, getMercadoPagoAccessToken, mapMercadoPagoOrderStatus, paymentFields } from '@/lib/server/mercadopago';
import { sendChargeEmail } from '@/lib/server/email';
import { sendChargeWhatsApp } from '@/lib/server/whatsapp';

export const runtime='nodejs';

function daysUntil(dateValue:string){
  const now=new Date();
  const today=Date.UTC(now.getUTCFullYear(),now.getUTCMonth(),now.getUTCDate());
  const due=new Date(dateValue+'T00:00:00Z').getTime();
  return Math.ceil((due-today)/86400000);
}

export async function POST(request:Request){
  let admin:any=null;
  let chargeId='';
  try{
    const tenant=await requireTenant(request,['owner','admin','finance']);
    admin=tenant.admin;
    const {member,organization,subscription}=tenant;
    if(!['active','trialing'].includes(organization.status)||!['active','trialing'].includes(subscription?.status||'')){
      throw new Error('A conta da empresa não está liberada para emitir cobranças.');
    }

    const body=await request.json();
    chargeId=String(body?.chargeId||'');
    if(!chargeId) throw new Error('Cobrança não informada.');

    const {data:charge,error:chargeError}=await admin.from('charges')
      .select('id,organization_id,client_id,description,amount_cents,due_date,status,provider,payment_method,provider_charge_id,provider_payment_id,boleto_url,digitable_line,barcode_content,pix_provider_charge_id,pix_provider_payment_id,pix_url,pix_code,pix_qr_base64,send_email,email_sent_at,send_whatsapp,whatsapp_sent_at,clients(id,name,document,email,email_2,email_3,whatsapp,address,status)')
      .eq('id',chargeId)
      .eq('organization_id',member.organization_id)
      .single();
    if(chargeError) throw chargeError;
    if(!charge) throw new Error('Cobrança não encontrada.');
    const emailCharge=charge;

    if(charge.status==='paid'||charge.status==='cancelled') throw new Error('Esta cobrança não pode gerar um novo pagamento.');
    const requestedMethod=body?.method==='pix'?'pix':body?.method==='boleto'?'boleto':body?.method==='both'?'boleto_pix':body?.method==='card'?'card':null;
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
      if(!emailCharge.send_email||emailCharge.email_sent_at||![client?.email,client?.email_2,client?.email_3].some(Boolean))return {sent:false,skipped:true};
      try{
        const result=await sendChargeEmail({
          to:[client.email,client.email_2,client.email_3].filter(Boolean),
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

    async function sendWhatsAppIfNeeded(input:{
      method:string|null;
      paymentUrl?:string|null;
      paymentLine?:string|null;
      boletoUrl?:string|null;
      boletoLine?:string|null;
      pixUrl?:string|null;
      pixCode?:string|null;
    }){
      if(!emailCharge.send_whatsapp||emailCharge.whatsapp_sent_at||!client?.whatsapp)return {sent:false,skipped:true};
      try{
        const result=await sendChargeWhatsApp({
          to:client.whatsapp,
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
          whatsapp_sent_at:new Date().toISOString(),
          whatsapp_delivery_id:result.id||null,
          whatsapp_delivery_error:null,
          updated_at:new Date().toISOString()
        }).eq('id',emailCharge.id);
        return {sent:true,skipped:false};
      }catch(error){
        const message=error instanceof Error?error.message:'Falha ao enviar WhatsApp.';
        await admin.from('charges').update({
          whatsapp_delivery_error:message,
          updated_at:new Date().toISOString()
        }).eq('id',emailCharge.id);
        return {sent:false,skipped:false,error:message};
      }
    }

    const hasExistingSingle=charge.provider==='mercadopago'&&charge.payment_method!=='boleto_pix'&&charge.provider_charge_id&&charge.boleto_url;
    const hasExistingBoth=charge.provider==='mercadopago'&&charge.payment_method==='boleto_pix'&&charge.provider_charge_id&&charge.boleto_url&&charge.pix_provider_charge_id&&charge.pix_url;

    if(hasExistingBoth){
      if(charge.status==='draft'){
        await admin.from('charges').update({
          status:'pending',
          provider_status_detail:charge.provider_status_detail||'waiting_payment',
          updated_at:new Date().toISOString()
        }).eq('id',charge.id);
      }
      const deliveryInput={
        method:'boleto_pix',
        boletoUrl:charge.boleto_url,
        boletoLine:charge.digitable_line,
        pixUrl:charge.pix_url,
        pixCode:charge.pix_code
      };
      const email=await sendEmailIfNeeded(deliveryInput);
      const whatsapp=await sendWhatsAppIfNeeded(deliveryInput);
      return Response.json({
        ok:true,existing:true,paymentMethod:'boleto_pix',
        boletoUrl:charge.boleto_url,digitableLine:charge.digitable_line,
        pixUrl:charge.pix_url,pixCode:charge.pix_code,
        orderId:charge.provider_charge_id,pixOrderId:charge.pix_provider_charge_id,
        email,whatsapp
      });
    }

    if(hasExistingSingle){
      const deliveryInput={
        method:charge.payment_method||paymentMethod,
        paymentUrl:charge.boleto_url,
        paymentLine:charge.digitable_line
      };
      const email=await sendEmailIfNeeded(deliveryInput);
      const whatsapp=await sendWhatsAppIfNeeded(deliveryInput);
      return Response.json({
        ok:true,existing:true,paymentMethod:charge.payment_method||paymentMethod,
        paymentUrl:charge.boleto_url,boletoUrl:charge.boleto_url,
        copyPaste:charge.digitable_line,digitableLine:charge.digitable_line,
        barcodeContent:charge.barcode_content,orderId:charge.provider_charge_id,
        email,whatsapp
      });
    }

    if(!client||client.status!=='active') throw new Error('Cliente inválido ou inativo.');
    if(!client.email) throw new Error('Cadastre o e-mail do cliente antes de gerar o pagamento.');

    const expirationDays=daysUntil(charge.due_date);
    if(paymentMethod!=='card'&&(expirationDays<1||expirationDays>30)){
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

    if(paymentMethod==='card'){
      const preference=await createCardCheckoutPreference(accessToken,{
        chargeId:charge.id,
        amountCents,
        description:emailCharge.description,
        payer:{email:client.email}
      });
      const paymentUrl=String(preference?.init_point||preference?.sandbox_init_point||'');
      const preferenceId=String(preference?.id||'');
      if(!paymentUrl||!preferenceId) throw new Error('Mercado Pago não retornou o link para pagamento com cartão.');

      const {error:cardUpdateError}=await admin.from('charges').update({
        provider:'mercadopago',
        payment_method:'card',
        provider_charge_id:preferenceId,
        boleto_url:paymentUrl,
        digitable_line:null,
        barcode_content:null,
        provider_status_detail:'waiting_card_payment',
        status:'pending',
        updated_at:new Date().toISOString()
      }).eq('id',emailCharge.id);
      if(cardUpdateError) throw cardUpdateError;

      const deliveryInput={method:'card',paymentUrl,paymentLine:null};
      const email=await sendEmailIfNeeded(deliveryInput);
      const whatsapp=await sendWhatsAppIfNeeded(deliveryInput);

      return Response.json({
        ok:true,
        paymentMethod:'card',
        paymentUrl,
        preferenceId,
        status:'pending',
        email,
        whatsapp
      });
    }

    if(paymentMethod==='boleto_pix'){
      let boleto:any;
      let pix:any;

      if(charge.provider_charge_id&&charge.boleto_url){
        boleto={
          fields:{
            orderId:charge.provider_charge_id,
            paymentId:charge.provider_payment_id,
            boletoUrl:charge.boleto_url,
            digitableLine:charge.digitable_line,
            barcodeContent:charge.barcode_content,
            providerStatusDetail:charge.provider_status_detail,
            paymentMethod:'boleto'
          },
          mapped:{status:charge.status==='paid'?'paid':'pending'}
        };
      }else{
        boleto=await createBoleto();
        const {error:boletoUpdateError}=await admin.from('charges').update({
          provider:'mercadopago',
          payment_method:'boleto_pix',
          provider_charge_id:boleto.fields.orderId,
          provider_payment_id:boleto.fields.paymentId,
          boleto_url:boleto.fields.boletoUrl,
          digitable_line:boleto.fields.digitableLine,
          barcode_content:boleto.fields.barcodeContent,
          provider_status_detail:boleto.fields.providerStatusDetail,
          status:boleto.mapped.status==='paid'?'paid':'draft',
          updated_at:new Date().toISOString()
        }).eq('id',emailCharge.id);
        if(boletoUpdateError) throw boletoUpdateError;
      }

      if(charge.pix_provider_charge_id&&charge.pix_url){
        pix={
          fields:{
            orderId:charge.pix_provider_charge_id,
            paymentId:charge.pix_provider_payment_id,
            boletoUrl:charge.pix_url,
            digitableLine:charge.pix_code,
            barcodeContent:charge.pix_qr_base64,
            providerStatusDetail:charge.provider_status_detail,
            paymentMethod:'pix'
          },
          mapped:{status:charge.status==='paid'?'paid':'pending'}
        };
      }else{
        pix=await createPix();
        const {error:pixUpdateError}=await admin.from('charges').update({
          provider:'mercadopago',
          payment_method:'boleto_pix',
          pix_provider_charge_id:pix.fields.orderId,
          pix_provider_payment_id:pix.fields.paymentId,
          pix_url:pix.fields.boletoUrl,
          pix_code:pix.fields.digitableLine,
          pix_qr_base64:pix.fields.barcodeContent,
          provider_status_detail:pix.fields.providerStatusDetail||boleto.fields.providerStatusDetail,
          status:pix.mapped.status==='paid'||boleto.mapped.status==='paid'?'paid':'draft',
          updated_at:new Date().toISOString()
        }).eq('id',emailCharge.id);
        if(pixUpdateError) throw pixUpdateError;
      }

      const finalStatus=(
        boleto.mapped.status==='paid'||pix.mapped.status==='paid'
      )?'paid':'pending';

      const {error:updateError}=await admin.from('charges').update({
        provider:'mercadopago',
        payment_method:'boleto_pix',
        provider_status_detail:pix.fields.providerStatusDetail||boleto.fields.providerStatusDetail,
        status:finalStatus,
        updated_at:new Date().toISOString()
      }).eq('id',emailCharge.id);
      if(updateError) throw updateError;

      const deliveryInput={
        method:'boleto_pix',
        boletoUrl:boleto.fields.boletoUrl,
        boletoLine:boleto.fields.digitableLine,
        pixUrl:pix.fields.boletoUrl,
        pixCode:pix.fields.digitableLine
      };
      const email=await sendEmailIfNeeded(deliveryInput);
      const whatsapp=await sendWhatsAppIfNeeded(deliveryInput);

      return Response.json({
        ok:true,paymentMethod:'boleto_pix',
        boletoUrl:boleto.fields.boletoUrl,digitableLine:boleto.fields.digitableLine,
        pixUrl:pix.fields.boletoUrl,pixCode:pix.fields.digitableLine,
        orderId:boleto.fields.orderId,pixOrderId:pix.fields.orderId,
        status:finalStatus,email,whatsapp
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

    const deliveryInput={
      method:fields.paymentMethod||paymentMethod,
      paymentUrl:fields.boletoUrl,
      paymentLine:fields.digitableLine
    };
    const email=await sendEmailIfNeeded(deliveryInput);
    const whatsapp=await sendWhatsAppIfNeeded(deliveryInput);

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
      email,
      whatsapp
    });
  }catch(error){
    const message=error instanceof Error?error.message:'Erro inesperado ao gerar cobrança Mercado Pago.';
    if(admin&&chargeId){
      try{
        await admin.from('charges').update({
          provider_status_detail:'Erro ao gerar no Mercado Pago: '+message,
          updated_at:new Date().toISOString()
        }).eq('id',chargeId);
      }catch{}
    }
    console.error('[mercadopago-charge]',message);
    return apiError(error);
  }
}
