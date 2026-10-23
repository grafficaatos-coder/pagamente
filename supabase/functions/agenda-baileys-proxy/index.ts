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
      .select("business_id,role")
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

    // Outbound-only Supabase channel: no public Docker URL or Cloudflare token.
    // Requires an EXPLICIT tenant route and a recent allow-listed worker heartbeat.
    const localRoute=route?.runtime_prefix==="local-poll:"&&
      route?.service_url==="supabase-poll://local";
    if(localRoute){
      if(!["status","connect","disconnect","pair-code"].includes(action))
        return json({error:"Esta ação ainda não está liberada no Docker local",code:"local_action_disabled"},409);
      if(action!=="status"&&(!["owner","admin"].includes(String(member.role))))
        return json({error:"Somente o administrador pode gerenciar o WhatsApp"},403);

      const {data:heartbeat,error:heartbeatError}=await admin.from("agenda_whatsapp_local_status")
        .select("snapshot,updated_at").eq("business_id",member.business_id).maybeSingle();
      if(heartbeatError)throw heartbeatError;
      const fresh=heartbeat&&Date.now()-new Date(heartbeat.updated_at).getTime()<20000;
      if(!fresh)return json({error:"O Docker do WhatsApp está desligado ou não autorizou esta empresa",code:"local_worker_offline"},503);
      if(action==="status")return json(heartbeat.snapshot??{status:"disconnected"});

      const commandPayload=action==="pair-code"?
        {phone:String(payload?.phone??"").replace(/\D/g,"").slice(0,15),force_new:payload?.force_new===true}:{};
      if(action==="pair-code"&&commandPayload.phone.length<10)
        return json({error:"Informe um celular com DDD"},400);

      const {data:command,error:enqueueError}=await admin.from("agenda_whatsapp_local_commands")
        .insert({business_id:member.business_id,action,payload:commandPayload,
          expires_at:new Date(Date.now()+12000).toISOString()})
        .select("id").single();
      if(enqueueError)throw enqueueError;

      // Wait for the local poller to pick up and answer. Never retry automatically.
      const deadline=Date.now()+37000;
      while(Date.now()<deadline){
        await new Promise(resolve=>setTimeout(resolve,750));
        const {data:state,error:stateError}=await admin.from("agenda_whatsapp_local_commands")
          .select("status,result,http_status")
          .eq("id",command.id).eq("business_id",member.business_id).maybeSingle();
        if(stateError)throw stateError;
        if(state?.status==="completed"||state?.status==="failed")
          return json(state.result??{error:"Resposta vazia"},Number(state.http_status)||500);
      }
      return json({ok:false,pending:true,
        error:"O comando está em processamento. Consulte o status antes de solicitar novamente.",
        code:"local_poll_pending"},202);
    }

    if(route?.service_url)base=String(route.service_url).replace(/\/$/,"");
    // A rota padrao tambem pode apontar para Railway, mesmo sem uma linha por empresa.
    // Nesse caso, nao executar o warmup legado da Oracle.
    let isModernBackend=false;
    let cloudflareAccessHeaders:Record<string,string>={};
    try {
      const host=new URL(base).hostname.toLowerCase();
      isModernBackend=host.endsWith(".up.railway.app")||host==="whatsapp-agenda.parkingjp.com.br";
      // Credenciais Cloudflare Access são usadas apenas para o domínio conhecido.
      // Nunca as enviar para uma rota arbitrária cadastrada no banco.
      if(host==="whatsapp-agenda.parkingjp.com.br"){
        const id=Deno.env.get("AGENDA_CF_ACCESS_CLIENT_ID")??"";
        const secretToken=Deno.env.get("AGENDA_CF_ACCESS_CLIENT_SECRET")??"";
        if(!id||!secretToken)return json({error:"Credenciais do Cloudflare Access pendentes no servidor",code:"cloudflare_auth_not_configured"},503);
        cloudflareAccessHeaders={
          "CF-Access-Client-Id":id,
          "CF-Access-Client-Secret":secretToken
        };
      }
    } catch { /* URL inválida será tratada pelo fetch */ }
    const target=base+"/v1/"+encodeURIComponent(member.business_id)+"/"+encodeURIComponent(action);
    const init:RequestInit={
      method,
      headers:{
        "Authorization":"Bearer "+token,
        "Content-Type":"application/json",
        "Accept":"application/json",
        ...cloudflareAccessHeaders
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

      if(action==="pair-code"&&!isModernBackend&&route?.runtime_prefix!=="railway:"){
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