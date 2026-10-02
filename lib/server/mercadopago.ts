import { createHash, createHmac, timingSafeEqual } from 'crypto';
import { getSupabaseAdmin } from './supabaseAdmin';
import { decryptSecret, encryptSecret } from './secretCrypto';

const API='https://api.mercadopago.com';

function env(name:string){
  const value=process.env[name];
  if(!value) throw new Error(name+' não configurado no servidor.');
  return value;
}

export function mercadoPagoRedirectUri(){
  return process.env.MERCADOPAGO_REDIRECT_URI
    || (env('APP_URL').replace(/\/$/,'')+'/api/integrations/mercadopago/callback');
}

async function mpFetch(path:string,options:RequestInit={}){
  const response=await fetch(API+path,{...options,cache:'no-store'});
  const text=await response.text();
  let data:any={};
  try{data=text?JSON.parse(text):{}}catch{data={raw:text}}
  if(!response.ok){
    const detail=data?.message||data?.error||data?.cause?.[0]?.description||('Mercado Pago HTTP '+response.status);
    throw new Error(typeof detail==='string'?detail:JSON.stringify(detail));
  }
  return data;
}

export function pkceChallenge(verifier:string){
  return createHash('sha256').update(verifier).digest('base64url');
}

export async function exchangeAuthorizationCode(code:string,codeVerifier?:string|null){
  const body:any={
    client_id:env('MERCADOPAGO_CLIENT_ID'),
    client_secret:env('MERCADOPAGO_CLIENT_SECRET'),
    grant_type:'authorization_code',
    code,
    redirect_uri:mercadoPagoRedirectUri()
  };
  if(codeVerifier) body.code_verifier=codeVerifier;
  return mpFetch('/oauth/token',{
    method:'POST',
    headers:{accept:'application/json','content-type':'application/json'},
    body:JSON.stringify(body)
  });
}

export async function refreshAccessToken(refreshToken:string){
  return mpFetch('/oauth/token',{
    method:'POST',
    headers:{accept:'application/json','content-type':'application/json'},
    body:JSON.stringify({
      client_id:env('MERCADOPAGO_CLIENT_ID'),
      client_secret:env('MERCADOPAGO_CLIENT_SECRET'),
      grant_type:'refresh_token',
      refresh_token:refreshToken
    })
  });
}

export async function saveMercadoPagoTokens(organizationId:string,tokens:any){
  if(!tokens?.access_token) throw new Error('Mercado Pago não retornou access_token.');
  const admin=getSupabaseAdmin();
  const expiresIn=Number(tokens.expires_in||0);
  const expiresAt=expiresIn>0?new Date(Date.now()+expiresIn*1000).toISOString():null;
  const externalAccountId=tokens.user_id!=null?String(tokens.user_id):null;

  const secretRow={
    organization_id:organizationId,
    provider:'mercadopago',
    access_token_cipher:encryptSecret(tokens.access_token),
    refresh_token_cipher:tokens.refresh_token?encryptSecret(tokens.refresh_token):null,
    external_account_id:externalAccountId,
    token_type:tokens.token_type||null,
    scope:tokens.scope||null,
    expires_at:expiresAt,
    updated_at:new Date().toISOString()
  };

  const {error:secretError}=await admin.from('provider_secrets').upsert(secretRow,{onConflict:'organization_id,provider'});
  if(secretError) throw secretError;

  const {error:publicError}=await admin.from('provider_connections').upsert({
    organization_id:organizationId,
    provider:'mercadopago',
    status:'connected',
    external_account_id:externalAccountId,
    metadata:{oauth:true},
    connected_at:new Date().toISOString(),
    updated_at:new Date().toISOString()
  },{onConflict:'organization_id,provider'});
  if(publicError) throw publicError;
}

export async function getMercadoPagoAccessToken(organizationId:string){
  const admin=getSupabaseAdmin();
  const {data,error}=await admin.from('provider_secrets')
    .select('*')
    .eq('organization_id',organizationId)
    .eq('provider','mercadopago')
    .maybeSingle();
  if(error) throw error;
  if(!data) throw new Error('Mercado Pago ainda não está conectado para esta empresa.');

  let accessToken=decryptSecret(data.access_token_cipher);
  const expiresAt=data.expires_at?new Date(data.expires_at).getTime():0;
  const shouldRefresh=Boolean(data.refresh_token_cipher&&expiresAt&&expiresAt<Date.now()+24*60*60*1000);

  if(shouldRefresh){
    const refreshed=await refreshAccessToken(decryptSecret(data.refresh_token_cipher));
    await saveMercadoPagoTokens(organizationId,refreshed);
    accessToken=refreshed.access_token;
  }
  return accessToken;
}

export async function createBoletoOrder(accessToken:string,input:{
  chargeId:string;
  idempotencyKey?:string;
  amountCents:number;
  description:string;
  expirationDays:number;
  payer:{
    email:string;
    name:string;
    document:string;
    address:{
      zip_code:string;
      street_name:string;
      street_number:string;
      neighborhood:string;
      city:string;
      state:string;
    }
  }
}){
  const parts=input.payer.name.trim().split(/\s+/);
  const firstName=parts.shift()||'Cliente';
  const lastName=parts.join(' ')||'Cliente';
  const document=input.payer.document.replace(/\D/g,'');
  const identificationType=document.length===14?'CNPJ':'CPF';

  return mpFetch('/v1/orders',{
    method:'POST',
    headers:{
      accept:'application/json',
      'content-type':'application/json',
      authorization:'Bearer '+accessToken,
      'x-idempotency-key':input.idempotencyKey||input.chargeId
    },
    body:JSON.stringify({
      type:'online',
      external_reference:input.chargeId,
      processing_mode:'automatic',
      total_amount:(input.amountCents/100).toFixed(2),
      description:input.description,
      payer:{
        email:input.payer.email,
        first_name:firstName,
        last_name:lastName,
        identification:{type:identificationType,number:document},
        address:input.payer.address
      },
      transactions:{
        payments:[{
          amount:(input.amountCents/100).toFixed(2),
          expiration_time:'P'+input.expirationDays+'D',
          payment_method:{id:'boleto',type:'ticket'}
        }]
      }
    })
  });
}

export async function createPixOrder(accessToken:string,input:{
  chargeId:string;
  idempotencyKey?:string;
  amountCents:number;
  description:string;
  expirationDays:number;
  payer:{ email:string }
}){
  return mpFetch('/v1/orders',{
    method:'POST',
    headers:{
      accept:'application/json',
      'content-type':'application/json',
      authorization:'Bearer '+accessToken,
      'x-idempotency-key':input.idempotencyKey||input.chargeId
    },
    body:JSON.stringify({
      type:'online',
      external_reference:input.chargeId,
      processing_mode:'automatic',
      total_amount:(input.amountCents/100).toFixed(2),
      description:input.description,
      payer:{email:input.payer.email},
      transactions:{
        payments:[{
          amount:(input.amountCents/100).toFixed(2),
          expiration_time:'P'+input.expirationDays+'D',
          payment_method:{id:'pix',type:'bank_transfer'}
        }]
      }
    })
  });
}

export async function getMercadoPagoOrder(accessToken:string,orderId:string){
  return mpFetch('/v1/orders/'+encodeURIComponent(orderId),{
    headers:{accept:'application/json',authorization:'Bearer '+accessToken}
  });
}

export async function cancelMercadoPagoOrder(accessToken:string,orderId:string,idempotencyKey:string){
  return mpFetch('/v1/orders/'+encodeURIComponent(orderId)+'/cancel',{
    method:'POST',
    headers:{
      accept:'application/json',
      'content-type':'application/json',
      authorization:'Bearer '+accessToken,
      'x-idempotency-key':idempotencyKey
    },
    body:'{}'
  });
}

export function mapMercadoPagoOrderStatus(order:any){
  const payment=order?.transactions?.payments?.[0];
  const status=payment?.status||order?.status;
  const detail=payment?.status_detail||order?.status_detail||null;
  if(status==='processed'&&detail==='accredited') return {status:'paid',detail};
  if(status==='canceled'||status==='cancelled'||status==='expired'||status==='refunded') return {status:'cancelled',detail};
  if(status==='failed') return {status:'failed',detail};
  if(status==='action_required'||status==='created'||status==='processing'||status==='pending') return {status:'pending',detail};
  return {status:'pending',detail};
}

export function paymentFields(order:any){
  const payment=order?.transactions?.payments?.[0]||{};
  const method=payment?.payment_method||{};
  const isPix=method?.id==='pix'||method?.type==='bank_transfer';
  return {
    orderId:order?.id?String(order.id):null,
    paymentId:payment?.id?String(payment.id):null,
    paymentMethod:isPix?'pix':'boleto',
    boletoUrl:method.ticket_url||null,
    barcodeContent:isPix?(method.qr_code_base64||method.qr_code||null):(method.barcode_content||null),
    digitableLine:isPix?(method.qr_code||null):(method.digitable_line||null),
    providerStatusDetail:payment?.status_detail||order?.status_detail||null
  };
}

export const boletoFields=paymentFields;

export function validateWebhookSignature(input:{
  xSignature:string|null;
  xRequestId:string|null;
  dataId:string|null;
}){
  const secret=process.env.MERCADOPAGO_WEBHOOK_SECRET;
  if(!secret) throw new Error('MERCADOPAGO_WEBHOOK_SECRET não configurado.');
  if(!input.xSignature||!input.xRequestId||!input.dataId) return false;

  const values=Object.fromEntries(
    input.xSignature.split(',').map(part=>{
      const [key,...rest]=part.trim().split('=');
      return [key,rest.join('=')];
    })
  );
  const ts=values.ts;
  const v1=values.v1;
  if(!ts||!v1) return false;

  const manifest='id:'+input.dataId.toLowerCase()+';request-id:'+input.xRequestId+';ts:'+ts+';';
  const expected=createHmac('sha256',secret).update(manifest).digest('hex');
  const a=Buffer.from(expected,'hex');
  const b=Buffer.from(v1,'hex');
  return a.length===b.length&&timingSafeEqual(a,b);
}
