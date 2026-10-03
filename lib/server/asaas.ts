import { decryptSecret } from '@/lib/server/secretCrypto';
function baseUrl(){
  return (process.env.ASAAS_BASE_URL||'https://api-sandbox.asaas.com/v3').replace(/\/$/,'');
}

export function getParentAsaasApiKey(){
  const value=process.env.ASAAS_API_KEY;
  if(!value) throw new Error('ASAAS_API_KEY não configurada no servidor.');
  return value;
}

function errorMessage(payload:any,status:number){
  const errors=Array.isArray(payload?.errors)?payload.errors:[];
  const descriptions=errors.map((item:any)=>item?.description||item?.message).filter(Boolean);
  if(descriptions.length) return descriptions.join(' ');
  return payload?.message||payload?.error||('Erro Asaas ('+status+').');
}

export async function asaasRequest<T=any>(
  apiKey:string,
  path:string,
  init:RequestInit={}
):Promise<T>{
  const response=await fetch(baseUrl()+path,{
    ...init,
    headers:{
      accept:'application/json',
      'content-type':'application/json',
      'access_token':apiKey,
      'User-Agent':'JP-Sistema-Cobranca/1.0',
      ...(init.headers||{})
    },
    cache:'no-store'
  });
  const text=await response.text();
  let payload:any={};
  try{payload=text?JSON.parse(text):{}}catch{payload={message:text}}
  if(!response.ok) throw new Error(errorMessage(payload,response.status));
  return payload as T;
}

export async function createAsaasSubaccount(input:any){
  return asaasRequest<any>(getParentAsaasApiKey(),'/accounts',{
    method:'POST',
    body:JSON.stringify(input)
  });
}

export async function getAsaasBalance(apiKey:string){
  const data=await asaasRequest<any>(apiKey,'/finance/balance',{method:'GET'});
  const balance=Number(data?.balance||0);
  return {raw:data,balance,balanceCents:Math.round(balance*100)};
}

export function inferPixKey(value:string){
  const original=String(value||'').trim();
  const digits=original.replace(/\D/g,'');
  if(original.includes('@')) return {key:original.toLowerCase(),type:'EMAIL'};
  if(digits.length===11){
    // CPF has 11 digits; phone keys are commonly entered with +55 or parentheses.
    const looksPhone=/^\+?55/.test(original)||/[()\s-]/.test(original);
    if(looksPhone){
      return {key:digits,type:'PHONE'};
    }
    return {key:digits,type:'CPF'};
  }
  if(digits.length===14) return {key:digits,type:'CNPJ'};
  if(digits.length===13&&digits.startsWith('55')) return {key:digits.slice(2),type:'PHONE'};
  return {key:original,type:'EVP'};
}

export function asaasEnvironment(){
  return baseUrl().includes('sandbox')?'sandbox':'production';
}


export async function getOrganizationAsaasApiKey(admin:any,organizationId:string){
  const {data:connection,error:connectionError}=await admin.from('provider_connections')
    .select('status,metadata')
    .eq('organization_id',organizationId)
    .eq('provider','baas')
    .maybeSingle();
  if(connectionError) throw connectionError;
  if(connection?.status!=='connected') throw new Error('Conta Digital Asaas ainda não está conectada.');

  if(connection?.metadata?.mode==='direct'){
    return getParentAsaasApiKey();
  }

  const {data:secret,error:secretError}=await admin.from('provider_secrets')
    .select('access_token_cipher')
    .eq('organization_id',organizationId)
    .eq('provider','baas')
    .maybeSingle();
  if(secretError) throw secretError;
  if(!secret?.access_token_cipher) throw new Error('Credencial exclusiva da Conta Digital Asaas não encontrada.');
  return decryptSecret(secret.access_token_cipher);
}
