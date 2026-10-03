import { apiError, requireTenant } from '@/lib/server/supabaseAdmin';

export const runtime='nodejs';

export async function POST(request:Request){
  try{
    const {admin,member}=await requireTenant(request,['owner','admin']);
    const orgId=member.organization_id;

    const {error:secretError}=await admin.from('provider_secrets')
      .delete()
      .eq('organization_id',orgId)
      .eq('provider','mercadopago');
    if(secretError) throw secretError;

    const {error:connectionError}=await admin.from('provider_connections').upsert({
      organization_id:orgId,
      provider:'mercadopago',
      status:'not_configured',
      external_account_id:null,
      metadata:{oauth:true},
      connected_at:null,
      updated_at:new Date().toISOString()
    },{onConflict:'organization_id,provider'});
    if(connectionError) throw connectionError;

    return Response.json({ok:true});
  }catch(error){
    return apiError(error);
  }
}
