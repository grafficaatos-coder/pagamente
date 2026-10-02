import { apiError, requireTenant } from '@/lib/server/supabaseAdmin';
import { asaasEnvironment, getAsaasBalance, getParentAsaasApiKey } from '@/lib/server/asaas';

export const runtime='nodejs';

export async function POST(request:Request){
  try{
    const {admin,member,organization}=await requireTenant(request,['owner','admin']);

    const apiKey=getParentAsaasApiKey();
    const balance=await getAsaasBalance(apiKey);
    const now=new Date().toISOString();

    const metadata={
      platform:'asaas',
      mode:'direct',
      environment:asaasEnvironment(),
      accountName:organization.name,
      walletId:'principal'
    };

    const {error:connectionError}=await admin.from('provider_connections').upsert({
      organization_id:member.organization_id,
      provider:'baas',
      status:'connected',
      external_account_id:'asaas-principal',
      connected_at:now,
      metadata
    },{onConflict:'organization_id,provider'});
    if(connectionError) throw connectionError;

    await admin.from('provider_secrets')
      .delete()
      .eq('organization_id',member.organization_id)
      .eq('provider','baas');

    const {error:walletError}=await admin.from('wallet_accounts').update({
      balance_cents:balance.balanceCents,
      updated_at:now
    }).eq('organization_id',member.organization_id);
    if(walletError) throw walletError;

    return Response.json({
      ok:true,
      provider:'asaas',
      mode:'direct',
      environment:asaasEnvironment(),
      balance:balance.balance,
      balanceCents:balance.balanceCents
    });
  }catch(error){
    return apiError(error);
  }
}
