import { apiError, requireTenant } from '@/lib/server/supabaseAdmin';
import { getAsaasBalance, getParentAsaasApiKey } from '@/lib/server/asaas';
import { decryptSecret } from '@/lib/server/secretCrypto';

export const runtime='nodejs';

export async function GET(request:Request){
  try{
    const {admin,member}=await requireTenant(request);
    const {data:connection,error:connectionError}=await admin.from('provider_connections')
      .select('status,external_account_id,metadata')
      .eq('organization_id',member.organization_id)
      .eq('provider','baas')
      .maybeSingle();
    if(connectionError) throw connectionError;
    if(connection?.status!=='connected') throw new Error('Conta Asaas ainda não conectada.');

    let apiKey:string;
    if(connection?.metadata?.mode==='direct'){
      apiKey=getParentAsaasApiKey();
    }else{
      const {data:secret,error:secretError}=await admin.from('provider_secrets')
        .select('access_token_cipher')
        .eq('organization_id',member.organization_id)
        .eq('provider','baas')
        .maybeSingle();
      if(secretError) throw secretError;
      if(!secret) throw new Error('Credencial da conta Asaas não encontrada.');
      apiKey=decryptSecret(secret.access_token_cipher);
    }

    const balance=await getAsaasBalance(apiKey);
    const {error:walletError}=await admin.from('wallet_accounts').update({
      balance_cents:balance.balanceCents,
      updated_at:new Date().toISOString()
    }).eq('organization_id',member.organization_id);
    if(walletError) throw walletError;

    return Response.json({
      ok:true,
      provider:'asaas',
      accountId:connection.external_account_id,
      balance:balance.balance,
      balanceCents:balance.balanceCents
    });
  }catch(error){
    return apiError(error);
  }
}
