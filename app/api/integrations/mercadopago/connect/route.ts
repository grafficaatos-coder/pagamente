import { randomBytes, randomUUID } from 'crypto';
import { apiError, requireTenant } from '@/lib/server/supabaseAdmin';
import { mercadoPagoRedirectUri, pkceChallenge } from '@/lib/server/mercadopago';

export const runtime='nodejs';

export async function POST(request:Request){
  try{
    const {admin,user,member}=await requireTenant(request,['owner','admin']);
    const clientId=process.env.MERCADOPAGO_CLIENT_ID;
    if(!clientId) throw new Error('MERCADOPAGO_CLIENT_ID não configurado no servidor.');

    const state=randomUUID();
    const verifier=randomBytes(48).toString('base64url');
    const expiresAt=new Date(Date.now()+10*60*1000).toISOString();

    const {error}=await admin.from('oauth_states').insert({
      state,
      provider:'mercadopago',
      organization_id:member.organization_id,
      user_id:user.id,
      code_verifier:verifier,
      expires_at:expiresAt
    });
    if(error) throw error;

    const url=new URL('https://auth.mercadopago.com/authorization');
    url.searchParams.set('client_id',clientId);
    url.searchParams.set('response_type','code');
    url.searchParams.set('state',state);
    url.searchParams.set('redirect_uri',mercadoPagoRedirectUri());
    url.searchParams.set('code_challenge',pkceChallenge(verifier));
    url.searchParams.set('code_challenge_method','S256');

    return Response.json({url:url.toString()});
  }catch(error){
    return apiError(error);
  }
}
