import { apiError, requireTenant } from '@/lib/server/supabaseAdmin';
import { getAsaasBalance, getOrganizationAsaasApiKey } from '@/lib/server/asaas';

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

    const apiKey=await getOrganizationAsaasApiKey(admin,member.organization_id);
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
