import { createClient } from '@supabase/supabase-js';

function required(name:string){
  const value=process.env[name];
  if(!value) throw new Error(name+' não configurado no servidor.');
  return value;
}

export function getSupabaseAdmin(){
  return createClient(
    required('NEXT_PUBLIC_SUPABASE_URL'),
    required('SUPABASE_SERVICE_ROLE_KEY'),
    {auth:{persistSession:false,autoRefreshToken:false}}
  );
}

export async function requireTenant(
  request:Request,
  allowedRoles:string[]=['owner','admin','finance','viewer','member']
){
  const header=request.headers.get('authorization')||'';
  const token=header.startsWith('Bearer ')?header.slice(7):'';
  if(!token) throw new Error('UNAUTHORIZED');

  const admin=getSupabaseAdmin();
  const {data:{user},error:userError}=await admin.auth.getUser(token);
  if(userError||!user) throw new Error('UNAUTHORIZED');

  const {data:member,error:memberError}=await admin
    .from('organization_members')
    .select('organization_id,role')
    .eq('user_id',user.id)
    .order('created_at',{ascending:true})
    .limit(1)
    .maybeSingle();

  if(memberError) throw memberError;
  if(!member) throw new Error('NO_ORGANIZATION');
  if(!allowedRoles.includes(member.role)) throw new Error('FORBIDDEN');

  const [{data:org,error:orgError},{data:sub,error:subError}]=await Promise.all([
    admin.from('organizations').select('id,name,status').eq('id',member.organization_id).single(),
    admin.from('subscriptions').select('status').eq('organization_id',member.organization_id).maybeSingle()
  ]);
  if(orgError) throw orgError;
  if(subError) throw subError;

  return {admin,user,member,organization:org,subscription:sub};
}

export function apiError(error:unknown){
  const message=error instanceof Error?error.message:'Erro inesperado.';
  if(message==='UNAUTHORIZED') return Response.json({error:'Sessão inválida.'},{status:401});
  if(message==='FORBIDDEN') return Response.json({error:'Sem permissão para esta operação.'},{status:403});
  if(message==='NO_ORGANIZATION') return Response.json({error:'Empresa não encontrada.'},{status:404});
  return Response.json({error:message},{status:400});
}
