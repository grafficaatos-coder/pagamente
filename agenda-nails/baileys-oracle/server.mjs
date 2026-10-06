import http from "node:http";
import path from "node:path";
import { mkdir, rm } from "node:fs/promises";
import P from "pino";
import QRCode from "qrcode";
import { Boom } from "@hapi/boom";
import makeWASocket, {
  Browsers,
  DisconnectReason,
  jidNormalizedUser,
  useMultiFileAuthState
} from "@whiskeysockets/baileys";

const SUPABASE_URL=String(process.env.SUPABASE_URL||"").replace(/\/$/,"");
const SERVICE_KEY=process.env.SUPABASE_SERVICE_ROLE_KEY||"";
const PUBLISHABLE_KEY=process.env.SUPABASE_PUBLISHABLE_KEY||"";
const PORT=Number(process.env.PORT||8080);
const DATA_DIR=process.env.DATA_DIR||"/data";
const AGENDA_ORIGIN=process.env.AGENDA_ORIGIN||"https://agenda-nails-grafficaatos-3591.vercel.app";
const logger=P({level:process.env.LOG_LEVEL||"warn"});

if(!SUPABASE_URL||!SERVICE_KEY||!PUBLISHABLE_KEY){
  throw new Error("Configuração do Supabase incompleta.");
}

const sessions=new Map();

function sleep(ms){return new Promise(r=>setTimeout(r,ms))}
function json(res,status,body){
  const data=JSON.stringify(body);
  res.writeHead(status,{
    "content-type":"application/json; charset=utf-8",
    "content-length":Buffer.byteLength(data),
    "cache-control":"no-store",
    "access-control-allow-origin":AGENDA_ORIGIN,
    "access-control-allow-headers":"authorization,content-type",
    "access-control-allow-methods":"GET,POST,OPTIONS"
  });
  res.end(data);
}
async function bodyJson(req){
  const chunks=[];
  for await(const chunk of req)chunks.push(chunk);
  if(!chunks.length)return {};
  return JSON.parse(Buffer.concat(chunks).toString("utf8"));
}
function serviceHeaders(extra={}){
  const headers={
    apikey:SERVICE_KEY,
    "content-type":"application/json"
  };
  // Supabase secret keys (sb_secret_...) are used as API keys only.
  // Legacy service_role JWTs can also be sent as Bearer tokens.
  if(!SERVICE_KEY.startsWith("sb_secret_")){
    headers.authorization="Bearer "+SERVICE_KEY;
  }
  return {...headers,...extra};
}
async function db(pathname,options={}){
  return fetch(SUPABASE_URL+pathname,{
    ...options,
    headers:serviceHeaders(options.headers||{})
  });
}
async function rpc(name,args={}){
  const r=await db("/rest/v1/rpc/"+name,{
    method:"POST",
    body:JSON.stringify(args)
  });
  if(!r.ok)throw new Error(name+": "+r.status+" "+await r.text());
  if(r.status===204)return null;
  return r.json();
}
async function fetchOne(pathname){
  const r=await db(pathname);
  if(!r.ok)throw new Error("Banco: "+r.status+" "+await r.text());
  const rows=await r.json();
  return rows[0]||null;
}
async function verifyMember(req,businessId){
  const bearer=req.headers.authorization||"";
  if(!bearer.toLowerCase().startsWith("bearer "))throw Object.assign(new Error("Sessão ausente"),{status:401});
  const userRes=await fetch(SUPABASE_URL+"/auth/v1/user",{
    headers:{apikey:PUBLISHABLE_KEY,authorization:bearer}
  });
  if(!userRes.ok)throw Object.assign(new Error("Sessão inválida"),{status:401});
  const user=await userRes.json();
  const m=await fetchOne(
    "/rest/v1/agenda_members?business_id=eq."+encodeURIComponent(businessId)+
    "&user_id=eq."+encodeURIComponent(user.id)+"&select=role&limit=1"
  );
  if(!m)throw Object.assign(new Error("Sem acesso a esta empresa"),{status:403});
  return {user,role:m.role};
}
function normalizePhone(value){
  let n=String(value||"").replace(/\D/g,"").replace(/^0+/,"");
  if((n.length===10||n.length===11)&&!n.startsWith("55"))n="55"+n;
  return n;
}
function formatAppointment(iso){
  const d=new Date(iso);
  return {
    date:new Intl.DateTimeFormat("pt-BR",{timeZone:"America/Sao_Paulo",day:"2-digit",month:"2-digit",year:"numeric"}).format(d),
    time:new Intl.DateTimeFormat("pt-BR",{timeZone:"America/Sao_Paulo",hour:"2-digit",minute:"2-digit",hour12:false}).format(d)
  };
}
function messageText(kind,business,customer,service,appointment){
  const first=String(customer.name||"").trim().split(/\s+/)[0]||"Cliente";
  const when=formatAppointment(appointment.starts_at);
  const professional=String(appointment.professional_name||"").trim();
  const proLine=professional?"\n👤 Profissional: *"+professional+"*":"";
  if(kind==="reminder"){
    return "Olá, "+first+"! 😊\n\nPassando para lembrar do seu horário na *"+business.name+"*."+
      "\n\n📅 Data: *"+when.date+"*\n🕐 Horário: *"+when.time+"*\n✨ Serviço: *"+service.name+"*"+proLine+
      "\n\nSe precisar alterar, fale com a gente por aqui.";
  }
  if(kind==="followup"){
    return "Olá, "+first+"! 😊\n\nObrigado pelo seu atendimento na *"+business.name+"*."+
      "\n\nEsperamos que tenha gostado. Quando quiser agendar novamente, é só chamar a gente por aqui. 💛";
  }
  return "Olá, "+first+"! ✨"+
    "\nSeu horário na *"+business.name+"* está confirmado."+
    "\n\n📅 *Data:* "+when.date+
    "\n🕐 *Horário:* "+when.time+
    "\n💇‍♀️ *Serviço:* "+service.name+
    (professional?"\n👤 *Profissional:* "+professional:"")+
    "\n\nSe precisar alterar o horário, é só *entrar em contato por aqui*. 💖"+
    "\n*Te esperamos! ✨*";
}
async function cancelClaimed(businessId,job,reason){
  await rpc("agenda_baileys_cancel_job",{
    p_business_id:businessId,
    p_job_id:job.id,
    p_reservation_token:job.reservation_token,
    p_reason:reason
  });
}
async function claimAndValidate(businessId,leaseId){
  for(let pass=0;pass<5;pass++){
    const job=await rpc("agenda_baileys_claim_next",{
      p_business_id:businessId,
      p_lease_id:leaseId
    });
    if(!job)return null;

    const appointment=await fetchOne(
      "/rest/v1/agenda_appointments?id=eq."+encodeURIComponent(job.appointment_id)+
      "&business_id=eq."+encodeURIComponent(businessId)+
      "&select=id,business_id,customer_id,service_id,professional_name,starts_at,status&limit=1"
    );
    if(!appointment){await cancelClaimed(businessId,job,"Agendamento não existe mais.");continue}
    if(appointment.status==="cancelled"||appointment.status==="no_show"){
      await cancelClaimed(businessId,job,"Agendamento cancelado ou marcado como falta.");continue;
    }
    if(job.message_type==="followup"&&appointment.status!=="completed"){
      await cancelClaimed(businessId,job,"Pós-atendimento cancelado porque o atendimento não foi concluído.");continue;
    }
    if(job.message_type==="reminder"&&new Date(appointment.starts_at).getTime()<=Date.now()){
      await cancelClaimed(businessId,job,"Lembrete expirou porque o horário já passou.");continue;
    }

    const [customer,service,business]=await Promise.all([
      fetchOne("/rest/v1/agenda_customers?id=eq."+encodeURIComponent(appointment.customer_id)+"&business_id=eq."+encodeURIComponent(businessId)+"&select=id,name,phone&limit=1"),
      fetchOne("/rest/v1/agenda_services?id=eq."+encodeURIComponent(appointment.service_id)+"&business_id=eq."+encodeURIComponent(businessId)+"&select=id,name,duration_minutes&limit=1"),
      fetchOne("/rest/v1/agenda_businesses?id=eq."+encodeURIComponent(businessId)+"&select=id,name&limit=1")
    ]);
    if(!customer||!service||!business){
      await cancelClaimed(businessId,job,"Cliente, serviço ou empresa não encontrado na revalidação.");continue;
    }
    const currentPhone=normalizePhone(customer.phone);
    const queuedPhone=normalizePhone(job.customer_phone);
    if(!currentPhone){await cancelClaimed(businessId,job,"Cliente está sem WhatsApp cadastrado.");continue}
    if(queuedPhone&&queuedPhone!==currentPhone){
      await cancelClaimed(businessId,job,"Telefone do cliente mudou depois que a mensagem entrou na fila.");continue;
    }
    return {
      id:job.id,
      reservation_token:job.reservation_token,
      delivery_semantics:job.delivery_semantics||"AT_MOST_ONCE",
      phone:currentPhone,
      text:messageText(job.message_type,business,customer,service,appointment)
    };
  }
  return null;
}
async function upsertSession(businessId,patch){
  const row={business_id:businessId,...patch,updated_at:new Date().toISOString()};
  const r=await db("/rest/v1/agenda_baileys_sessions?on_conflict=business_id",{
    method:"POST",
    headers:{Prefer:"resolution=merge-duplicates,return=minimal"},
    body:JSON.stringify(row)
  });
  if(!r.ok)throw new Error("Falha ao atualizar sessão: "+await r.text());
}
class WhatsSession{
  constructor(businessId){
    this.businessId=businessId;
    this.authDir=path.join(DATA_DIR,"sessions",businessId);
    this.leaseId=process.pid+"-"+Date.now()+"-"+businessId.slice(0,8)+"-"+Math.random().toString(36).slice(2,8);
    this.sock=null;this.state="offline";this.error="";this.phone=null;this.qrSvg=null;
    this.leaseOwned=false;this.connectBusy=false;this.dispatchBusy=false;this.stopped=false;
    this.timers=[];
  }
  async start(){
    this.stopped=false;
    await mkdir(this.authDir,{recursive:true});
    await upsertSession(this.businessId,{desired_online:true,status:"connecting",last_error:null});
    await this.leaseCycle();
    this.timers.push(setInterval(()=>this.leaseCycle().catch(e=>logger.warn(e)),5000));
    this.timers.push(setInterval(()=>this.heartbeat().catch(()=>{}),5000));
    this.timers.push(setInterval(()=>this.dispatchCycle().catch(e=>logger.warn(e)),2500));
  }
  async acquireLease(){
    const owned=await rpc("agenda_baileys_acquire_lease",{
      p_business_id:this.businessId,p_lease_id:this.leaseId,p_ttl_seconds:20
    });
    this.leaseOwned=Boolean(owned);
    return this.leaseOwned;
  }
  async leaseCycle(){
    if(this.stopped)return;
    const owned=await this.acquireLease();
    if(!owned){
      this.state="standby_lease";
      if(this.sock){try{this.sock.end(new Error("Lease ocupado"))}catch{};this.sock=null}
      return;
    }
    if(!this.sock&&!this.connectBusy)await this.connectSocket();
  }
  async connectSocket(){
    if(this.stopped||!this.leaseOwned||this.connectBusy)return;
    this.connectBusy=true;this.state="connecting";this.error="";this.qrSvg=null;
    try{
      const auth=await useMultiFileAuthState(this.authDir);
      const sock=makeWASocket({
        auth:auth.state,
        logger,
        browser:Browsers.ubuntu("Agenda Pro"),
        printQRInTerminal:false,
        markOnlineOnConnect:false,
        syncFullHistory:false,
        generateHighQualityLinkPreview:false,
        maxMsgRetryCount:1,
        connectTimeoutMs:30000,
        defaultQueryTimeoutMs:30000,
        keepAliveIntervalMs:15000
      });
      this.sock=sock;
      sock.ev.on("creds.update",auth.saveCreds);
      sock.ev.on("connection.update",async update=>{
        if(this.sock!==sock)return;
        try{
          if(update.qr){
            this.qrSvg=await QRCode.toString(update.qr,{type:"svg",width:320,margin:1});
            this.state="waiting_qr";this.error="";
            await upsertSession(this.businessId,{status:"qr",last_error:null});
          }
          if(update.connection==="open"){
            this.state="online";this.error="";this.qrSvg=null;
            const normalized=jidNormalizedUser(String(sock.user?.id||""));
            this.phone=normalized?normalized.split("@")[0].split(":")[0]:null;
            await upsertSession(this.businessId,{
              status:"connected",phone:this.phone,connected_at:new Date().toISOString(),
              last_seen_at:new Date().toISOString(),last_error:null
            });
          }
          if(update.connection==="close"){
            const code=Number(new Boom(update.lastDisconnect?.error).output?.statusCode||0);
            this.sock=null;
            if(this.stopped)return;
            if(code===DisconnectReason.loggedOut){
              this.state="waiting_qr";this.phone=null;
              this.error="WhatsApp desconectado pelo aparelho. Gere um novo QR.";
              await rm(this.authDir,{recursive:true,force:true});
              await mkdir(this.authDir,{recursive:true});
              await upsertSession(this.businessId,{status:"qr",phone:null,last_error:this.error});
              setTimeout(()=>this.connectSocket().catch(()=>{}),1500);
            }else{
              this.state="connecting";
              this.error=String(update.lastDisconnect?.error?.message||"Conexão interrompida. Reconectando.").slice(0,1200);
              await upsertSession(this.businessId,{status:"connecting",last_error:this.error});
              setTimeout(()=>this.connectSocket().catch(()=>{}),3000);
            }
          }
        }catch(e){logger.error(e)}
      });
    }catch(e){
      this.sock=null;this.state="error";this.error=String(e?.message||e).slice(0,1200);
      await upsertSession(this.businessId,{status:"error",last_error:this.error}).catch(()=>{});
    }finally{this.connectBusy=false}
  }
  async heartbeat(){
    if(this.stopped||!this.leaseOwned)return;
    await rpc("agenda_baileys_heartbeat",{
      p_business_id:this.businessId,p_lease_id:this.leaseId,
      p_agent_id:"oracle-vm-"+process.pid,p_status:this.state,
      p_phone:this.phone||null,p_error:this.error||null,p_checkpoint_at:null
    });
  }
  async dispatchCycle(){
    if(this.dispatchBusy||this.state!=="online"||!this.sock||!this.leaseOwned||this.stopped)return;
    this.dispatchBusy=true;
    try{
      const message=await claimAndValidate(this.businessId,this.leaseId);
      if(!message)return;
      let started=false;
      try{
        const found=await this.sock.onWhatsApp(message.phone).catch(()=>[]);
        const target=Array.isArray(found)?found.find(x=>x?.exists):null;
        if(!target?.jid)throw Object.assign(new Error("Número não possui WhatsApp ativo."),{noRetry:true});
        const ok=await rpc("agenda_baileys_mark_dispatch_started",{
          p_business_id:this.businessId,p_job_id:message.id,p_reservation_token:message.reservation_token
        });
        if(!ok)throw Object.assign(new Error("Reserva da mensagem expirou."),{noRetry:true});
        started=true;
        const sent=await this.sock.sendMessage(target.jid,{text:message.text});
        const done=await rpc("agenda_baileys_complete_job",{
          p_business_id:this.businessId,p_job_id:message.id,
          p_reservation_token:message.reservation_token,p_message_ref:sent?.key?.id||null
        });
        if(!done)throw new Error("Mensagem enviada, mas não foi possível confirmar no banco.");
      }catch(e){
        const noRetry=started||e?.noRetry===true||String(message.delivery_semantics).toUpperCase()==="AT_MOST_ONCE";
        await rpc("agenda_baileys_fail_job",{
          p_business_id:this.businessId,p_job_id:message.id,
          p_reservation_token:message.reservation_token,
          p_error:(started?"Envio iniciado; retry automático bloqueado para evitar duplicidade. ":"")+String(e?.message||e).slice(0,1000),
          p_no_retry:noRetry
        }).catch(()=>{});
        throw e;
      }
    }finally{this.dispatchBusy=false}
  }
  status(){
    return {
      status:this.state==="online"?"connected":
        this.state==="waiting_qr"?"qr":
        this.state==="error"?"error":"connecting",
      phone:this.phone,qr_svg:this.state==="waiting_qr"?this.qrSvg:null,
      last_error:this.error||null
    };
  }
  async disconnect(){
    this.stopped=true;
    for(const t of this.timers)clearInterval(t);
    this.timers=[];
    if(this.sock){try{await this.sock.logout()}catch{};try{this.sock.end(new Error("logout"))}catch{}}
    this.sock=null;this.state="offline";this.qrSvg=null;this.phone=null;
    await rm(this.authDir,{recursive:true,force:true});
    await mkdir(this.authDir,{recursive:true});
    await rpc("agenda_baileys_release_lease",{p_business_id:this.businessId,p_lease_id:this.leaseId}).catch(()=>{});
    await upsertSession(this.businessId,{
      status:"disconnected",desired_online:false,phone:null,qr:null,pairing_code:null,
      runtime_lease_id:null,runtime_lease_expires_at:null,last_error:null
    });
  }
}
async function ensureSession(businessId){
  let s=sessions.get(businessId);
  if(s&&!s.stopped)return s;
  s=new WhatsSession(businessId);
  sessions.set(businessId,s);
  await s.start();
  return s;
}
async function restoreDesiredSessions(){
  const r=await db("/rest/v1/agenda_baileys_sessions?desired_online=eq.true&select=business_id");
  if(!r.ok)throw new Error(await r.text());
  const rows=await r.json();
  for(const row of rows){
    if(!sessions.has(row.business_id)){
      ensureSession(row.business_id).catch(e=>logger.error({business:row.business_id,error:String(e)}));
      await sleep(100);
    }
  }
}
await mkdir(path.join(DATA_DIR,"sessions"),{recursive:true});
await restoreDesiredSessions();
setInterval(()=>restoreDesiredSessions().catch(e=>logger.warn(e)),30000).unref?.();

const server=http.createServer(async(req,res)=>{
  if(req.method==="OPTIONS")return json(res,204,{});
  try{
    const url=new URL(req.url||"/","http://localhost");
    if(url.pathname==="/health")return json(res,200,{ok:true,service:"agenda-pro-baileys-oracle",sessions:sessions.size});
    const match=url.pathname.match(/^\/v1\/([^/]+)\/(status|connect|disconnect)$/);
    if(!match)return json(res,404,{error:"Rota não encontrada"});
    const businessId=decodeURIComponent(match[1]);
    const action=match[2];
    const access=await verifyMember(req,businessId);
    if((action==="connect"||action==="disconnect")&&!["owner","admin"].includes(access.role)){
      return json(res,403,{error:"Somente o administrador da empresa pode conectar o WhatsApp"});
    }
    if(action==="connect"){
      const s=await ensureSession(businessId);
      const start=Date.now();
      while(Date.now()-start<12000&&!["online","waiting_qr","error"].includes(s.state))await sleep(250);
      return json(res,200,{ok:true,...s.status()});
    }
    if(action==="status"){
      const s=sessions.get(businessId);
      if(s&&!s.stopped)return json(res,200,{ok:true,...s.status()});
      const row=await fetchOne(
        "/rest/v1/agenda_baileys_sessions?business_id=eq."+encodeURIComponent(businessId)+
        "&select=status,desired_online,phone,last_error&limit=1"
      );
      if(row?.desired_online){
        const restored=await ensureSession(businessId);
        return json(res,200,{ok:true,...restored.status()});
      }
      return json(res,200,{ok:true,status:row?.status||"disconnected",phone:row?.phone||null,qr_svg:null,last_error:row?.last_error||null});
    }
    const s=sessions.get(businessId);
    if(s)await s.disconnect();
    else await upsertSession(businessId,{status:"disconnected",desired_online:false,phone:null,last_error:null});
    sessions.delete(businessId);
    return json(res,200,{ok:true,status:"disconnected"});
  }catch(e){
    logger.error(e);
    return json(res,e?.status||500,{error:String(e?.message||"Erro interno")});
  }
});

server.listen(PORT,"0.0.0.0",()=>logger.info({port:PORT},"Agenda Pro Baileys Oracle ready"));

async function shutdown(signal){
  logger.info({signal},"shutdown");
  const all=[...sessions.values()];
  await Promise.allSettled(all.map(async s=>{
    for(const t of s.timers)clearInterval(t);
    await s.heartbeat().catch(()=>{});
    await rpc("agenda_baileys_release_lease",{p_business_id:s.businessId,p_lease_id:s.leaseId}).catch(()=>{});
    try{s.sock?.end(new Error("shutdown"))}catch{}
  }));
  server.close(()=>process.exit(0));
  setTimeout(()=>process.exit(0),5000).unref?.();
}
process.on("SIGINT",()=>void shutdown("SIGINT"));
process.on("SIGTERM",()=>void shutdown("SIGTERM"));
