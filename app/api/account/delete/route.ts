import { apiError, requireTenant } from '@/lib/server/supabaseAdmin';
import { getAsaasBalance, getOrganizationAsaasApiKey } from '@/lib/server/asaas';

export const runtime='nodejs';

export async function POST(request:Request){
  try{
    const {admin,user,member,organization}=await requireTenant(request,['owner']);
    const body=await request.json().catch(()=>({}));
    const confirmation=String(body?.confirmation||'').trim().toUpperCase();

    if(confirmation!=='EXCLUIR'){
      throw new Error('Para excluir a conta, digite EXCLUIR exatamente como solicitado.');
    }

    const orgId=member.organization_id;

    const [{data:baasConnection,error:baasError},{data:wallet,error:walletError}]=await Promise.all([
      admin.from('provider_connections')
        .select('status')
        .eq('organization_id',orgId)
        .eq('provider','baas')
        .maybeSingle(),
      admin.from('wallet_accounts')
        .select('balance_cents')
        .eq('organization_id',orgId)
        .maybeSingle()
    ]);
    if(baasError) throw baasError;
    if(walletError) throw walletError;

    let balanceCents=Number(wallet?.balance_cents||0);

    if(baasConnection?.status==='connected'){
      try{
        const apiKey=await getOrganizationAsaasApiKey(admin,orgId);
        const balance=await getAsaasBalance(apiKey);
        balanceCents=Number(balance.balanceCents||0);

        await admin.from('wallet_accounts').update({
          balance_cents:balanceCents,
          updated_at:new Date().toISOString()
        }).eq('organization_id',orgId);
      }catch{
        throw new Error('Não foi possível confirmar o saldo da Conta Digital Asaas. Atualize o saldo e tente novamente antes de excluir a conta.');
      }
    }

    if(balanceCents!==0){
      throw new Error('A Conta Digital ainda possui saldo. Transfira todo o saldo antes de excluir a conta.');
    }

    const [{count:openCharges,error:chargeError},{count:pendingTransfers,error:transferError}]=await Promise.all([
      admin.from('charges')
        .select('id',{count:'exact',head:true})
        .eq('organization_id',orgId)
        .in('status',['draft','pending','overdue']),
      admin.from('transfers')
        .select('id',{count:'exact',head:true})
        .eq('sender_organization_id',orgId)
        .in('status',['pending','processing'])
    ]);
    if(chargeError) throw chargeError;
    if(transferError) throw transferError;

    if((openCharges||0)>0){
      throw new Error('Existem cobranças em aberto. Cancele ou conclua as cobranças pendentes antes de excluir a conta.');
    }

    if((pendingTransfers||0)>0){
      throw new Error('Existe transferência Pix em processamento. Aguarde a conclusão antes de excluir a conta.');
    }

    const now=new Date().toISOString();

    const {error:recurringError}=await admin.from('recurring_rules')
      .update({status:'cancelled',updated_at:now})
      .eq('organization_id',orgId)
      .in('status',['active','paused']);
    if(recurringError) throw recurringError;

    const {error:subscriptionError}=await admin.from('subscriptions')
      .update({status:'cancelled',updated_at:now})
      .eq('organization_id',orgId);
    if(subscriptionError) throw subscriptionError;

    const {error:organizationError}=await admin.from('organizations')
      .update({status:'cancelled',created_by:null,updated_at:now})
      .eq('id',orgId);
    if(organizationError) throw organizationError;

    const {error:secretError}=await admin.from('provider_secrets')
      .delete()
      .eq('organization_id',orgId);
    if(secretError) throw secretError;

    const {error:connectionError}=await admin.from('provider_connections')
      .update({status:'disconnected',connected_at:null,updated_at:now})
      .eq('organization_id',orgId);
    if(connectionError) throw connectionError;

    const {error:inviteError}=await admin.from('organization_invites')
      .delete()
      .eq('organization_id',orgId);
    if(inviteError) throw inviteError;

    const [{count:otherMemberships,error:otherMembershipError},{count:otherCreatedOrganizations,error:otherCreatedError}]=await Promise.all([
      admin.from('organization_members')
        .select('organization_id',{count:'exact',head:true})
        .eq('user_id',user.id)
        .neq('organization_id',orgId),
      admin.from('organizations')
        .select('id',{count:'exact',head:true})
        .eq('created_by',user.id)
        .neq('id',orgId)
    ]);
    if(otherMembershipError) throw otherMembershipError;
    if(otherCreatedError) throw otherCreatedError;

    const {error:memberError}=await admin.from('organization_members')
      .delete()
      .eq('organization_id',orgId);
    if(memberError) throw memberError;

    let authUserDeleted=false;
    if((otherMemberships||0)===0&&(otherCreatedOrganizations||0)===0){
      const {error:deleteUserError}=await admin.auth.admin.deleteUser(user.id);
      if(deleteUserError) throw deleteUserError;
      authUserDeleted=true;
    }

    return Response.json({
      ok:true,
      organizationId:orgId,
      organizationName:organization.name,
      authUserDeleted
    });
  }catch(error){
    return apiError(error);
  }
}
