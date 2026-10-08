import { createClient } from "npm:@supabase/supabase-js@2.95.0";

const cors={
  "Access-Control-Allow-Origin":"*",
  "Access-Control-Allow-Headers":"authorization, apikey, content-type, x-client-info",
  "Access-Control-Allow-Methods":"POST, OPTIONS"
};

function json(body:unknown,status=200){
  return new Response(JSON.stringify(body),{status,headers:{...cors,"Content-Type":"application/json"}});
}
function publishableKey(){
  const modern=Deno.env.get("SUPABASE_PUBLISHABLE_KEYS");
  if(modern){try{const p=JSON.parse(modern);if(p?.default)return p.default}catch{}}
  return Deno.env.get("SUPABASE_ANON_KEY")??"";
}
function secretKey(){
  const modern=Deno.env.get("SUPABASE_SECRET_KEYS");
  if(modern){try{const p=JSON.parse(modern);if(p?.default)return p.default}catch{}}
  return Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")??"";
}

Deno.serve(async(req)=>{
  if(req.method==="OPTIONS")return new Response("ok",{headers:cors});
  if(req.method!=="POST")return json({error:"Método não permitido"},405);
  try{
    const token=(req.headers.get("Authorization")??"").replace(/^Bearer\s+/i,"");
    if(!token)return json({error:"Sessão ausente"},401);

    const supabaseUrl=Deno.env.get("SUPABASE_URL")??"";
    const pub=publishableKey(),secret=secretKey();
    if(!supabaseUrl||!pub||!secret)return json({error:"Servidor não configurado"},500);

    const userClient=createClient(supabaseUrl,pub,{auth:{persistSession:false,autoRefreshToken:false}});
    const {data:authData,error:authError}=await userClient.auth.getUser(token);
    if(authError||!authData.user)return json({error:"Sessão inválida"},401);

    const admin=createClient(supabaseUrl,secret,{auth:{persistSession:false,autoRefreshToken:false}});
    const body=await req.json().catch(()=>({}));
    const action=String(body?.action??"").trim();
    const method=String(body?.method??"GET").toUpperCase();
    const payload=body?.payload??null;

    const allowed=new Set(["status","connect","pair-code","disconnect","send-catalog","send-queue","send-message"]);
    if(!allowed.has(action))return json({error:"Ação inválida"},400);
    if(!["GET","POST"].includes(method))return json({error:"Método inválido"},400);

    const {data:member,error:memberError}=await admin
      .from("agenda_members")
      .select("business_id")
      .eq("user_id",authData.user.id)
      .limit(1)
      .maybeSingle();
    if(memberError)throw memberError;
    if(!member)return json({error:"Conta sem empresa no Agenda Pro"},403);

    const {data:settings,error:settingsError}=await admin
      .from("agenda_platform_settings")
      .select("baileys_enabled,baileys_service_url")
      .eq("id",true)
      .maybeSingle();
    if(settingsError)throw settingsError;
    if(!settings?.baileys_enabled||!settings?.baileys_service_url){
      return json({error:"WhatsApp automático ainda não está disponível"},503);
    }

    let base=String(settings.baileys_service_url).trim().replace(/\/$/,"");
    const {data:route,error:routeError}=await admin
      .from("agenda_whatsapp_runtime_routes")
      .select("service_url,runtime_prefix")
      .eq("business_id",member.business_id)
      .maybeSingle();
    if(routeError)throw routeError;
    if(route?.service_url)base=String(route.service_url).replace(/\/$/,"");
    const target=base+"/v1/"+encodeURIComponent(member.business_id)+"/"+encodeURIComponent(action);
    const init:RequestInit={
      method,
      headers:{
        "Authorization":"Bearer "+token,
        "Content-Type":"application/json",
        "Accept":"application/json"
      }
    };
    if(method!=="GET"&&payload!==null)init.body=JSON.stringify(payload);

    async function callUpstream(url:string, requestInit:RequestInit){
      const response=await fetch(url,{...requestInit,signal:AbortSignal.timeout(45000)});
      const responseText=await response.text();
      let responseBody:any={};
      try{responseBody=responseText?JSON.parse(responseText):{}}catch{responseBody={message:responseText}}
      return {response,responseBody};
    }

    try{
      let result;

      if(action==="pair-code"&&route?.runtime_prefix!=="railway:"){
        const businessPath="/v1/"+encodeURIComponent(member.business_id);
        const connectTarget=base+businessPath+"/connect";
        const statusTarget=base+businessPath+"/status";

        // 1) inicia a sessão no Oracle
        try{
          await callUpstream(connectTarget,{
            method:"POST",
            headers:{
              "Authorization":"Bearer "+token,
              "Content-Type":"application/json",
              "Accept":"application/json"
            }
          });
        }catch(connectErr){
          console.warn("Baileys warmup connect failed",connectErr);
        }

        // 2) espera o socket realmente entrar em connecting/waiting_qr
        let ready=false;
        for(let i=0;i<12;i++){
          await new Promise(resolve=>setTimeout(resolve,i===0?900:600));
          try{
            const st=await callUpstream(statusTarget,{
              method:"GET",
              headers:{
                "Authorization":"Bearer "+token,
                "Accept":"application/json"
              }
            });
            const state=String(
              st.responseBody?.status ??
              st.responseBody?.state ??
              ""
            ).toLowerCase();
            const qrReady=!!(
              st.responseBody?.qr_svg ||
              st.responseBody?.qr ||
              st.responseBody?.qr_available
            );

            if(
              state==="connecting" ||
              state==="qr" ||
              state==="waiting_qr" ||
              state==="aguardando_qr" ||
              qrReady
            ){
              ready=true;
              break;
            }
            if(state==="connected"||state==="online"){
              return json({
                error:"Este WhatsApp já está conectado.",
                code:"already_connected"
              },409);
            }
          }catch(statusErr){
            console.warn("Baileys readiness check failed",statusErr);
          }
        }

        if(!ready){
          return json({
            error:"O Oracle ainda não deixou a conexão pronta. Aguarde alguns segundos e gere outro código.",
            code:"baileys_not_ready"
          },503);
        }

        // 3) só então solicita requestPairingCode no serviço Oracle
        result=await callUpstream(target,init);

        if(!result.response.ok){
          const raw=String(result.responseBody?.error??result.responseBody?.message??"");
          const lower=raw.toLowerCase();
          if(
            lower.includes("connection closed")||
            lower.includes("connection reset")||
            lower.includes("socket closed")||
            lower.includes("not open")
          ){
            await new Promise(resolve=>setTimeout(resolve,1500));
            result=await callUpstream(target,init);
          }
        }
      }else{
        result=await callUpstream(target,init);
      }

      if(!result.response.ok){
        const raw=String(result.responseBody?.error??result.responseBody?.message??"");
        const lower=raw.toLowerCase();
        if(action==="pair-code"&&(lower.includes("connection closed")||lower.includes("connection reset")||lower.includes("socket closed"))){
          return json({
            error:"O socket do WhatsApp fechou antes de gerar o código. Aguarde alguns segundos e gere um novo código.",
            code:"baileys_connection_preparing"
          },503);
        }
      }

      return json(result.responseBody,result.response.status);
    }catch(err){
      console.error("Baileys upstream fetch failed",err);
      return json({
        error:"Servidor do WhatsApp indisponível no momento. Verifique o servidor do WhatsApp e tente novamente.",
        code:"baileys_unreachable"
      },502);
    }
  }catch(err){
    console.error(err);
    return json({error:err instanceof Error?err.message:"Erro interno"},500);
  }
});
