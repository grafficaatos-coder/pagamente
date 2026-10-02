import { apiError, requireTenant } from '@/lib/server/supabaseAdmin';
import { getAsaasBalance } from '@/lib/server/asaas';
import { decryptSecret } from '@/lib/server/secretCrypto';

export const runtime='nodejs';

export async function GET(request:Request){
  try{
    const {admin,member}=await requireTenant(request);
    const {data:secret,error:secretError}=await admin.from('provider_secrets')
      .select('access_token_cipher,external_account_id')
      .eq('organization_id',member.organization_id)
      .eq('provider','baas')
      .maybeSingle();
    if(secretError) throw secretError;
    if(!secret) throw new Error('Conta Asaas ainda não conectada.');

    const balance=await getAsaasBalance(decryptSecret(secret.access_token_cipher));
    const {error:walletError}=await admin.from('wallet_accounts').update({
      balance_cents:balance.balanceCents,
      updated_at:new Date().toISOString()
    }).eq('organization_id',member.organization_id);
    if(walletError) throw walletError;

    return Response.json({
      ok:true,
      provider:'asaas',
      accountId:secret.external_account_id,
      balance:balance.balance,
      balanceCents:balance.balanceCents
    });
  }catch(error){
    return apiError(error);
  }
}
