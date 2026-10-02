import { apiError, requireTenant } from '@/lib/server/supabaseAdmin';
import { createBoletoOrder, createPixOrder, getMercadoPagoAccessToken, mapMercadoPagoOrderStatus, paymentFields } from '@/lib/server/mercadopago';

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
      .select('id,organization_id,client_id,description,amount_cents,due_date,status,provider,payment_method,provider_charge_id,boleto_url,digitable_line,barcode_content,clients(id,name,document,email,address,status)')
      .eq('id',chargeId)
      .eq('organization_id',member.organization_id)
      .single();
    if(chargeError) throw chargeError;

    if(charge.status==='paid'||charge.status==='cancelled') throw new Error('Esta cobrança não pode gerar um novo pagamento.');
    const requestedMethod=body?.method==='pix'?'pix':body?.method==='boleto'?'boleto':null;
    const paymentMethod=requestedMethod||charge.payment_method||'boleto';

    if(charge.provider==='mercadopago'&&charge.provider_charge_id&&charge.boleto_url){
      return Response.json({
        ok:true,existing:true,paymentMethod:charge.payment_method||paymentMethod,
        paymentUrl:charge.boleto_url,boletoUrl:charge.boleto_url,
        copyPaste:charge.digitable_line,digitableLine:charge.digitable_line,
        barcodeContent:charge.barcode_content,orderId:charge.provider_charge_id
      });
    }

    const client:any=Array.isArray(charge.clients)?charge.clients[0]:charge.clients;
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
        amountCents:Number(charge.amount_cents),
        description:charge.description,
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
        amountCents:Number(charge.amount_cents),
        description:charge.description,
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
    }).eq('id',charge.id);
    if(updateError) throw updateError;

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
      status:mapped.status
    });
  }catch(error){
    return apiError(error);
  }
}
