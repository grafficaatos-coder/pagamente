import { apiError, requireTenant } from '@/lib/server/supabaseAdmin';

export const runtime='nodejs';

export async function POST(request:Request){
  try{
    const {admin,member}=await requireTenant(request,['owner','admin','finance']);
    const body=await request.json().catch(()=>({}));
    const recipientName=String(body?.recipientName||'').trim();
    const destinationKey=String(body?.destinationKey||'').trim();
    const amountCents=Number(body?.amountCents||0);
    const description=String(body?.description||'Transferência Pix').trim()||'Transferência Pix';

    if(!recipientName) throw new Error('Informe o nome do destinatário.');
    if(!destinationKey) throw new Error('Informe a chave Pix.');
    if(!Number.isInteger(amountCents)||amountCents<=0) throw new Error('Informe um valor válido.');

    const {data:wallet,error:walletError}=await admin.from('wallet_accounts')
      .select('balance_cents')
      .eq('organization_id',member.organization_id)
      .single();
    if(walletError) throw walletError;
    if(Number(wallet.balance_cents)<amountCents) throw new Error('Saldo insuficiente.');

    const {data:connection,error:connectionError}=await admin.from('provider_connections')
      .select('status,metadata')
      .eq('organization_id',member.organization_id)
      .eq('provider','baas')
      .maybeSingle();
    if(connectionError) throw connectionError;

    if(connection?.status!=='connected'){
      return Response.json({
        error:'Conta digital ainda não está conectada a uma instituição financeira BaaS. Nenhum Pix foi enviado.'
      },{status:503});
    }

    return Response.json({
      error:'A conta BaaS está cadastrada, mas o conector de Pix externo ainda precisa ser configurado antes de enviar dinheiro.'
    },{status:501});
  }catch(error){
    return apiError(error);
  }
}
