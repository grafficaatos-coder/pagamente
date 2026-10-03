import { apiError, requireTenant } from '@/lib/server/supabaseAdmin';
import { asaasRequest, getOrganizationAsaasApiKey } from '@/lib/server/asaas';
import { sendChargeEmail } from '@/lib/server/email';
import { sendChargeWhatsApp } from '@/lib/server/whatsapp';

export const runtime='nodejs';

function mapStatus(value:any){
  const status=String(value||'').toUpperCase();
  if(['RECEIVED','CONFIRMED','RECEIVED_IN_CASH'].includes(status)) return 'paid';
  if(['OVERDUE'].includes(status)) return 'overdue';
  if(['REFUNDED','REFUND_REQUESTED','CHARGEBACK_REQUESTED','CHARGEBACK_DISPUTE'].includes(status)) return 'cancelled';
  return 'pending';
}

function digits(value:any){
  return String(value||'').replace(/\D/g,'');
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

    const body=await request.json().catch(()=>({}));
    chargeId=String(body?.chargeId||'');
    const requestedMethod=body?.method==='pix'?'pix':body?.method==='boleto'?'boleto':body?.method==='both'?'boleto_pix':null;
    if(!chargeId||!requestedMethod) throw new Error('Cobrança ou forma de pagamento não informada.');

    const {data:connection,error:connectionError}=await admin.from('provider_connections')
      .select('status,metadata')
      .eq('organization_id',member.organization_id)
      .eq('provider','baas')
      .maybeSingle();
    if(connectionError) throw connectionError;
    if(connection?.status!=='connected'){
      throw new Error('Ative a Conta Digital Asaas desta empresa antes de gerar cobranças.');
    }

    const {data:charge,error:chargeError}=await admin.from('charges')
      .select('id,organization_id,client_id,description,amount_cents,due_date,status,provider,payment_method,provider_charge_id,boleto_url,digitable_line,pix_url,pix_code,send_email,email_sent_at,send_whatsapp,whatsapp_sent_at,interest_monthly_percent,fine_type,fine_percent,fine_amount_cents,discount_type,discount_percent,discount_amount_cents,discount_deadline_days,clients(id,name,document,email,whatsapp,address,status)')
      .eq('id',chargeId)
      .eq('organization_id',member.organization_id)
      .single();
    if(chargeError) throw chargeError;
    if(!charge) throw new Error('Cobrança não encontrada.');
    if(charge.status==='paid'||charge.status==='cancelled') throw new Error('Esta cobrança não pode gerar um novo pagamento.');

    const client:any=Array.isArray(charge.clients)?charge.clients[0]:charge.clients;
    if(!client||client.status!=='active') throw new Error('Cliente inválido ou inativo.');
    const cpfCnpj=digits(client.document);
    if(![11,14].includes(cpfCnpj.length)) throw new Error('Cadastre um CPF ou CNPJ válido no cliente.');

    const apiKey=await getOrganizationAsaasApiKey(admin,member.organization_id);

    let customerId='';
    const byExternal=await asaasRequest<any>(apiKey,'/customers?externalReference='+encodeURIComponent(client.id)+'&limit=1',{method:'GET'});
    customerId=String(byExternal?.data?.[0]?.id||'');
    if(!customerId){
      const byDocument=await asaasRequest<any>(apiKey,'/customers?cpfCnpj='+encodeURIComponent(cpfCnpj)+'&limit=1',{method:'GET'});
      customerId=String(byDocument?.data?.[0]?.id||'');
    }

    if(!customerId){
      const address=client.address||{};
      const customerPayload:any={
        name:client.name,
        cpfCnpj,
        email:client.email||undefined,
        mobilePhone:digits(client.whatsapp)||undefined,
        externalReference:client.id,
        notificationDisabled:true
      };
      if(address.zip_code) customerPayload.postalCode=digits(address.zip_code);
      if(address.street_name) customerPayload.address=String(address.street_name);
      if(address.street_number) customerPayload.addressNumber=String(address.street_number);
      if(address.neighborhood) customerPayload.province=String(address.neighborhood);
      const createdCustomer=await asaasRequest<any>(apiKey,'/customers',{
        method:'POST',
        body:JSON.stringify(customerPayload)
      });
      customerId=String(createdCustomer?.id||'');
    }
    if(!customerId) throw new Error('O Asaas não retornou o identificador do cliente.');

    const billingType=requestedMethod==='pix'?'PIX':requestedMethod==='boleto'?'BOLETO':'UNDEFINED';
    const paymentPayload:any={
      customer:customerId,
      billingType,
      value:Number(charge.amount_cents)/100,
      dueDate:charge.due_date,
      description:charge.description,
      externalReference:charge.id
    };

    const interest=Number(charge.interest_monthly_percent||0);
    if(interest>0) paymentPayload.interest={value:interest};

    if(charge.fine_type==='percent'&&Number(charge.fine_percent||0)>0){
      paymentPayload.fine={value:Number(charge.fine_percent),type:'PERCENTAGE'};
    }else if(charge.fine_type==='fixed'&&Number(charge.fine_amount_cents||0)>0){
      paymentPayload.fine={value:Number(charge.fine_amount_cents)/100,type:'FIXED'};
    }

    if(charge.discount_type==='percent'&&Number(charge.discount_percent||0)>0){
      paymentPayload.discount={
        value:Number(charge.discount_percent),
        type:'PERCENTAGE',
        dueDateLimitDays:Number(charge.discount_deadline_days||0)
      };
    }else if(charge.discount_type==='fixed'&&Number(charge.discount_amount_cents||0)>0){
      paymentPayload.discount={
        value:Number(charge.discount_amount_cents)/100,
        type:'FIXED',
        dueDateLimitDays:Number(charge.discount_deadline_days||0)
      };
    }

    const payment=await asaasRequest<any>(apiKey,'/payments',{
      method:'POST',
      body:JSON.stringify(paymentPayload)
    });
    const paymentId=String(payment?.id||'');
    if(!paymentId) throw new Error('O Asaas não retornou o identificador da cobrança.');

    let paymentUrl=String(payment?.invoiceUrl||'');
    let digitableLine:string|null=null;
    let barcodeContent:string|null=null;
    let pixCode:string|null=null;
    let pixQrBase64:string|null=null;

    if(requestedMethod==='boleto'){
      const boleto=await asaasRequest<any>(apiKey,'/payments/'+encodeURIComponent(paymentId)+'/identificationField',{method:'GET'});
      paymentUrl=String(payment?.bankSlipUrl||payment?.invoiceUrl||'');
      digitableLine=String(boleto?.identificationField||'')||null;
      barcodeContent=String(boleto?.barCode||'')||null;
    }else if(requestedMethod==='pix'){
      const pix=await asaasRequest<any>(apiKey,'/payments/'+encodeURIComponent(paymentId)+'/pixQrCode',{method:'GET'});
      paymentUrl=String(payment?.invoiceUrl||'');
      pixCode=String(pix?.payload||'')||null;
      pixQrBase64=String(pix?.encodedImage||'')||null;
      digitableLine=pixCode;
    }

    const mappedStatus=mapStatus(payment?.status);
    const update:any={
      provider:'asaas',
      payment_method:requestedMethod,
      provider_charge_id:paymentId,
      provider_payment_id:paymentId,
      boleto_url:paymentUrl||null,
      digitable_line:requestedMethod==='pix'?pixCode:digitableLine,
      barcode_content:barcodeContent,
      pix_url:requestedMethod==='pix'?paymentUrl:null,
      pix_code:requestedMethod==='pix'?pixCode:null,
      pix_qr_base64:requestedMethod==='pix'?pixQrBase64:null,
      provider_status_detail:String(payment?.status||''),
      status:mappedStatus,
      updated_at:new Date().toISOString()
    };
    const {error:updateError}=await admin.from('charges').update(update).eq('id',charge.id);
    if(updateError) throw updateError;

    let email:any={sent:false,skipped:true};
    if(charge.send_email&&!charge.email_sent_at&&client.email){
      try{
        const emailInput:any={
          to:client.email,
          clientName:client.name,
          organizationName:organization.name,
          description:charge.description,
          amountCents:Number(charge.amount_cents),
          dueDate:charge.due_date,
          paymentMethod:requestedMethod
        };
        if(requestedMethod==='boleto_pix'){
          emailInput.boletoUrl=paymentUrl;
          emailInput.pixUrl=paymentUrl;
        }else{
          emailInput.paymentUrl=paymentUrl;
          emailInput.digitableLine=requestedMethod==='pix'?pixCode:digitableLine;
        }
        const result=await sendChargeEmail(emailInput);
        await admin.from('charges').update({
          email_sent_at:new Date().toISOString(),
          email_delivery_id:result.id||null,
          email_delivery_error:null,
          updated_at:new Date().toISOString()
        }).eq('id',charge.id);
        email={sent:true,skipped:false};
      }catch(error){
        const message=error instanceof Error?error.message:'Falha ao enviar e-mail.';
        await admin.from('charges').update({
          email_delivery_error:message,
          updated_at:new Date().toISOString()
        }).eq('id',charge.id);
        email={sent:false,skipped:false,error:message};
      }
    }

    let whatsapp:any={sent:false,skipped:true};
    if(charge.send_whatsapp&&!charge.whatsapp_sent_at&&client.whatsapp){
      try{
        const whatsappInput:any={
          to:client.whatsapp,
          clientName:client.name,
          organizationName:organization.name,
          description:charge.description,
          amountCents:Number(charge.amount_cents),
          dueDate:charge.due_date,
          paymentMethod:requestedMethod
        };
        if(requestedMethod==='boleto_pix'){
          whatsappInput.boletoUrl=paymentUrl;
          whatsappInput.pixUrl=paymentUrl;
        }else{
          whatsappInput.paymentUrl=paymentUrl;
          whatsappInput.digitableLine=requestedMethod==='pix'?pixCode:digitableLine;
        }
        const result=await sendChargeWhatsApp(whatsappInput);
        await admin.from('charges').update({
          whatsapp_sent_at:new Date().toISOString(),
          whatsapp_delivery_id:result.id||null,
          whatsapp_delivery_error:null,
          updated_at:new Date().toISOString()
        }).eq('id',charge.id);
        whatsapp={sent:true,skipped:false};
      }catch(error){
        const message=error instanceof Error?error.message:'Falha ao enviar WhatsApp.';
        await admin.from('charges').update({
          whatsapp_delivery_error:message,
          updated_at:new Date().toISOString()
        }).eq('id',charge.id);
        whatsapp={sent:false,skipped:false,error:message};
      }
    }

    return Response.json({
      ok:true,
      provider:'asaas',
      paymentMethod:requestedMethod,
      paymentId,
      paymentUrl,
      digitableLine,
      pixCode,
      status:mappedStatus,
      providerStatus:payment?.status||null,
      email,
      whatsapp
    });
  }catch(error){
    const message=error instanceof Error?error.message:'Erro inesperado ao gerar cobrança Asaas.';
    if(admin&&chargeId){
      try{
        await admin.from('charges').update({
          provider_status_detail:'Erro ao gerar no Asaas: '+message,
          updated_at:new Date().toISOString()
        }).eq('id',chargeId);
      }catch{}
    }
    console.error('[asaas-charge]',message);
    return apiError(error);
  }
}
