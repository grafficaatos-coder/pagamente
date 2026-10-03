import { apiError, requireTenant } from '@/lib/server/supabaseAdmin';

export const runtime='nodejs';

export async function GET(request:Request){
  try{
    const {admin,member}=await requireTenant(request);

    const [{data:connection,error:connectionError},{data:secret,error:secretError}]=await Promise.all([
      admin.from('provider_connections')
        .select('provider,status,external_account_id,connected_at,metadata,updated_at')
        .eq('organization_id',member.organization_id)
        .eq('provider','mercadopago')
        .maybeSingle(),
      admin.from('provider_secrets')
        .select('external_account_id,expires_at')
        .eq('organization_id',member.organization_id)
        .eq('provider','mercadopago')
        .maybeSingle()
    ]);

    if(connectionError) throw connectionError;
    if(secretError) throw secretError;

    if(!secret){
      if(connection?.status==='connected'){
        await admin.from('provider_connections').update({
          status:'error',
          metadata:{...(connection.metadata||{}),reason:'missing_secret'},
          updated_at:new Date().toISOString()
        })
        .eq('organization_id',member.organization_id)
        .eq('provider','mercadopago');
      }

      return Response.json({
        provider:'mercadopago',
        status:connection?'error':'not_configured',
        external_account_id:connection?.external_account_id||null,
        connected_at:connection?.connected_at||null,
        metadata:{...(connection?.metadata||{}),reason:'missing_secret'},
        needs_reconnect:true
      });
    }

    if(connection?.status!=='connected'){
      await admin.from('provider_connections').upsert({
        organization_id:member.organization_id,
        provider:'mercadopago',
        status:'connected',
        external_account_id:secret.external_account_id||connection?.external_account_id||null,
        metadata:{...(connection?.metadata||{}),oauth:true},
        connected_at:connection?.connected_at||new Date().toISOString(),
        updated_at:new Date().toISOString()
      },{onConflict:'organization_id,provider'});
    }

    return Response.json({
      provider:'mercadopago',
      status:'connected',
      external_account_id:secret.external_account_id||connection?.external_account_id||null,
      connected_at:connection?.connected_at||null,
      metadata:{...(connection?.metadata||{}),oauth:true},
      expires_at:secret.expires_at||null,
      needs_reconnect:false
    });
  }catch(error){
    return apiError(error);
  }
}
