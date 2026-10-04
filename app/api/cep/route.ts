export const runtime='nodejs';

export async function GET(request:Request){
  try{
    const url=new URL(request.url);
    const cep=String(url.searchParams.get('cep')||'').replace(/\D/g,'');
    if(cep.length!==8){
      return Response.json({error:'CEP inválido.'},{status:400});
    }

    const response=await fetch('https://viacep.com.br/ws/'+cep+'/json/',{
      headers:{accept:'application/json'},
      cache:'no-store'
    });

    if(!response.ok){
      return Response.json({error:'Não foi possível consultar o CEP.'},{status:502});
    }

    const data:any=await response.json();
    if(data?.erro){
      return Response.json({error:'CEP não encontrado.'},{status:404});
    }

    return Response.json({
      ok:true,
      cep,
      street_name:String(data?.logradouro||''),
      neighborhood:String(data?.bairro||''),
      city:String(data?.localidade||''),
      state:String(data?.uf||'').toUpperCase().slice(0,2)
    });
  }catch{
    return Response.json({error:'Não foi possível consultar o CEP.'},{status:500});
  }
}
