import { apiError, requireTenant } from '@/lib/server/supabaseAdmin';
import { asaasEnvironment, createAsaasSubaccount } from '@/lib/server/asaas';
import { encryptSecret } from '@/lib/server/secretCrypto';

export const runtime='nodejs';

function digits(value:any){
  return String(value||'').replace(/\D/g,'');
}

export async function POST(request:Request){
  try{
    const {admin,member,organization}=await requireTenant(request,['owner','admin']);
    const body=await request.json().catch(()=>({}));

    const cpfCnpj=digits(body?.cpfCnpj);
    const isCompany=cpfCnpj.length===14;
    const isPerson=cpfCnpj.length===11;
    if(!isCompany&&!isPerson) throw new Error('Informe um CPF ou CNPJ válido.');

    const name=String(body?.name||organization.name||'').trim();
    const email=String(body?.email||'').trim();
    const mobilePhone=digits(body?.mobilePhone);
    const address=String(body?.address||'').trim();
    const addressNumber=String(body?.addressNumber||'').trim();
    const complement=String(body?.complement||'').trim();
    const province=String(body?.province||'').trim();
    const postalCode=digits(body?.postalCode);
    const incomeValue=Number(body?.incomeValue||0);

    if(!name||!email||!mobilePhone||!address||!addressNumber||!province||postalCode.length!==8||incomeValue<=0){
      throw new Error('Preencha nome, e-mail, celular, faturamento/renda, endereço, número, bairro e CEP.');
    }

    const {data:existing}=await admin.from('provider_connections')
      .select('status,external_account_id')
      .eq('organization_id',member.organization_id)
      .eq('provider','baas')
      .maybeSingle();
    if(existing?.status==='connected') throw new Error('Esta empresa já possui uma conta digital conectada.');

    const payload:any={
      name,
      email,
      cpfCnpj,
      mobilePhone,
      incomeValue,
      address,
      addressNumber,
      province,
      postalCode
    };

    if(complement) payload.complement=complement;
    if(isCompany){
      payload.companyType=String(body?.companyType||'LIMITED');
      payload.taxRegime=String(body?.taxRegime||'UNKNOWN');
    }else{
      const birthDate=String(body?.birthDate||'');
      if(!birthDate) throw new Error('Informe a data de nascimento.');
      payload.birthDate=birthDate;
    }

    const created=await createAsaasSubaccount(payload);
    if(!created?.apiKey||!created?.walletId||!created?.id){
      throw new Error('O Asaas não retornou as credenciais completas da subconta.');
    }

    const now=new Date().toISOString();
    const metadata={
      platform:'asaas',
      walletId:created.walletId,
      environment:asaasEnvironment(),
      accountName:created.name||name,
      cpfCnpj,
      onboarding:'created'
    };

    const {error:secretError}=await admin.from('provider_secrets').upsert({
      organization_id:member.organization_id,
      provider:'baas',
      access_token_cipher:encryptSecret(created.apiKey),
      external_account_id:created.id,
      token_type:'api_key',
      scope:'asaas_subaccount',
      updated_at:now
    },{onConflict:'organization_id,provider'});
    if(secretError) throw secretError;

    const {error:connectionError}=await admin.from('provider_connections').upsert({
      organization_id:member.organization_id,
      provider:'baas',
      status:'connected',
      external_account_id:created.id,
      connected_at:now,
      metadata
    },{onConflict:'organization_id,provider'});
    if(connectionError) throw connectionError;

    return Response.json({
      ok:true,
      provider:'asaas',
      accountId:created.id,
      walletId:created.walletId,
      environment:asaasEnvironment()
    });
  }catch(error){
    return apiError(error);
  }
}
