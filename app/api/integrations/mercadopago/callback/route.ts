import { exchangeAuthorizationCode, saveMercadoPagoTokens } from '@/lib/server/mercadopago';
import { getSupabaseAdmin } from '@/lib/server/supabaseAdmin';

export const runtime='nodejs';

function appUrl(request:Request){
  return (process.env.APP_URL||new URL(request.url).origin).replace(/\/$/,'');
}

export async function GET(request:Request){
  const requestUrl=new URL(request.url);
  const code=requestUrl.searchParams.get('code');
  const state=requestUrl.searchParams.get('state');
  const oauthError=requestUrl.searchParams.get('error');
  const admin=getSupabaseAdmin();

  if(oauthError) return Response.redirect(appUrl(request)+'/sistema?mp=error&reason='+encodeURIComponent(oauthError));
  if(!code||!state) return Response.redirect(appUrl(request)+'/?mp=error&reason=callback_invalido');

  try{
    const {data:stored,error}=await admin.from('oauth_states')
      .select('*')
      .eq('state',state)
      .eq('provider','mercadopago')
      .maybeSingle();
    if(error) throw error;
    if(!stored) throw new Error('Estado OAuth inválido ou já utilizado.');
    if(new Date(stored.expires_at).getTime()<Date.now()) throw new Error('Autorização expirada. Conecte novamente.');

    await admin.from('oauth_states').delete().eq('state',state);

    const tokens=await exchangeAuthorizationCode(code,stored.code_verifier);
    await saveMercadoPagoTokens(stored.organization_id,tokens);

    return Response.redirect(appUrl(request)+'/sistema?mp=connected');
  }catch(error){
    const message=error instanceof Error?error.message:'Falha ao conectar Mercado Pago.';
    return Response.redirect(appUrl(request)+'/sistema?mp=error&reason='+encodeURIComponent(message));
  }
}
