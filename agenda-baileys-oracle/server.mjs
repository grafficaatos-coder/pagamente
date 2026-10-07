import makeWASocket,{Browsers,DisconnectReason,useMultiFileAuthState}from'@whiskeysockets/baileys';
import{createClient}from'@supabase/supabase-js';
import pino from'pino';
import QRCode from'qrcode';
import http from'node:http';
import path from'node:path';
import{access,mkdir,rm}from'node:fs/promises';
import{randomUUID}from'node:crypto';

const PORT=Number(process.env.PORT||3000);
const DATA_DIR=process.env.DATA_DIR||'/data/sessions';
const SUPABASE_URL=String(process.env.SUPABASE_URL||'').replace(/\/$/,'');
const SUPABASE_ANON_KEY=String(process.env.SUPABASE_ANON_KEY||'');
const SUPABASE_SERVICE_ROLE_KEY=String(process.env.SUPABASE_SERVICE_ROLE_KEY||'');
const AGENT_NAME=process.env.AGENT_NAME||'agenda-pro-oracle';
const LEASE_SECONDS=Number(process.env.RUNTIME_LEASE_SECONDS||20);
const logger=pino({level:process.env.WHATSAPP_LOG_LEVEL||'silent'});
if(!SUPABASE_URL||!SUPABASE_ANON_KEY||!SUPABASE_SERVICE_ROLE_KEY){console.error('Defina SUPABASE_URL, SUPABASE_ANON_KEY e SUPABASE_SERVICE_ROLE_KEY.');process.exit(1)}
const admin=createClient(SUPABASE_URL,SUPABASE_SERVICE_ROLE_KEY,{auth:{persistSession:false,autoRefreshToken:false}});
const runtimes=new Map();

function respond(res,status,payload){const body=JSON.stringify(payload);res.writeHead(status,{'content-type':'application/json; charset=utf-8','cache-control':'no-store','access-control-allow-origin':'*','access-control-allow-headers':'authorization, content-type, apikey, x-client-info','access-control-allow-methods':'GET, POST, OPTIONS','content-length':String(Buffer.byteLength(body))});res.end(body)}
function phone(v){let x=String(v||'').replace(/\D/g,'');if(!x)return'';if(!x.startsWith('55')&&(x.length===10||x.length===11))x='55'+x;return x}
function businessId(v){const x=String(v||'').trim().toLowerCase();return/^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/.test(x)?x:''}
function disconnectCode(last){const e=last?.error;return Number(e?.output?.statusCode||e?.data?.statusCode||e?.statusCode||0)||0}
function displayName(v){return String(v||'Agenda Pro').replace(/^\s*by\s+/i,'').trim()||'Agenda Pro'}

async function authorize(req,bid){
  const token=String(req.headers.authorization||'').replace(/^Bearer\s+/i,'');
  if(!token)throw Object.assign(new Error('Sessão ausente'),{status:401});
  const r=await fetch(SUPABASE_URL+'/auth/v1/user',{headers:{apikey:SUPABASE_ANON_KEY,authorization:'Bearer '+token},signal:AbortSignal.timeout(12000)});
  if(!r.ok)throw Object.assign(new Error('Sessão inválida'),{status:401});
  const user=await r.json();
  const{data,error}=await admin.from('agenda_members').select('business_id').eq('business_id',bid).eq('user_id',user.id).limit(1).maybeSingle();
  if(error)throw error;
  if(!data)throw Object.assign(new Error('Acesso negado a esta empresa'),{status:403});
}
async function hasCreds(dir){try{await access(path.join(dir,'creds.json'));return true}catch{return false}}
async function queueMessage(job){
  const first=String(job.customer_name||'').trim().split(/\s+/)[0]||'';
  const d=new Date(job.starts_at);
  const date=d.toLocaleDateString('pt-BR',{timeZone:'America/Sao_Paulo'});
  const time=d.toLocaleTimeString('pt-BR',{timeZone:'America/Sao_Paulo',hour:'2-digit',minute:'2-digit'});
  const[{data:b},{data:a}]=await Promise.all([
    admin.from('agenda_businesses').select('name').eq('id',job.business_id).maybeSingle(),
    admin.from('agenda_appointments').select('confirmation_code,confirmation_token').eq('id',job.appointment_id).maybeSingle()
  ]);
  const name=displayName(b?.name),service=job.service_name||'atendimento',professional=job.professional_name||'';
  const key=a?.confirmation_code||a?.confirmation_token||'';
  const link=key?'https://agenda-pro-iucw.vercel.app/?'+(String(key).length<=20?'c=':'confirm=')+encodeURIComponent(key):'';
  if(job.message_type==='reminder')return[`Olá${first?', '+first:''}! 😊`,'',`Lembrando do seu horário com *${name}*.`,'',`📅 Data: *${date}*`,`🕐 Horário: *${time}*`,`✨ Serviço: *${service}*`,professional?`👤 Profissional: *${professional}*`:null,link?'':null,link?'*Confirme seu horário:*':null,link?`✅ ${link}`:null].filter(v=>v!==null).join('\n');
  if(job.message_type==='followup')return[`Olá${first?', '+first:''}! 😊`,'',`Obrigado pelo seu atendimento com *${name}*.`,'','Esperamos que tenha gostado. Quando quiser agendar novamente, é só chamar a gente por aqui. 💛'].join('\n');
  return[`Olá${first?', '+first:''}! 😊`,'',`Seu horário com *${name}* foi agendado.`,'',`📅 Data: *${date}*`,`🕐 Horário: *${time}*`,`✨ Serviço: *${service}*`,professional?`👤 Profissional: *${professional}*`:null].filter(v=>v!==null).join('\n');
}

class Runtime{
  constructor(bid){
    this.bid=bid;this.authDir=path.join(DATA_DIR,bid);this.agentId=`${AGENT_NAME}:${bid}`;this.leaseId=`${process.pid}-${Date.now()}-${randomUUID().slice(0,8)}:${bid}`;
    this.socket=null;this.state='disconnected';this.phone='';this.qr='';this.qrSvg='';this.pairingCode='';this.lastError='';this.desired=false;this.starting=null;this.reconnectTimer=null;this.reconnectAttempts=0;this.pairRequest=null;this.pairTriggered=false;this.lastCheckpointAt=null;this.dispatchBusy=false;this.leaseOwned=false;
  }
  payload(){
    const status=this.state==='online'?'connected':(this.state==='waiting_pairing'||this.state==='waiting_qr')?'qr':(this.state==='connecting'||this.state==='restarting')?'connecting':this.state==='error'?'error':'disconnected';
    return{ok:true,status,phone:this.phone||null,qr_svg:this.qrSvg||null,pairing_code:this.pairingCode||null,last_error:this.lastError||null,engine:'baileys-oracle',agent_id:this.agentId,desired_online:this.desired};
  }
  async acquire(){
    const{data,error}=await admin.rpc('agenda_baileys_acquire_lease',{p_business_id:this.bid,p_lease_id:this.leaseId,p_ttl_seconds:LEASE_SECONDS});
    if(error)throw error;this.leaseOwned=data===true;return this.leaseOwned;
  }
  async heartbeat(){
    if(!this.desired)return false;
    if(!await this.acquire().catch(e=>{this.lastError=String(e?.message||e).slice(0,1000);return false}))return false;
    const{data,error}=await admin.rpc('agenda_baileys_heartbeat',{p_business_id:this.bid,p_lease_id:this.leaseId,p_agent_id:this.agentId,p_status:this.state,p_phone:this.phone||null,p_error:this.lastError||null,p_checkpoint_at:this.lastCheckpointAt});
    if(error)throw error;return data===true;
  }
  async persist(){
    await admin.from('agenda_baileys_sessions').upsert({business_id:this.bid,status:this.state==='online'?'connected':this.state==='waiting_pairing'?'qr':this.state,phone:this.phone||null,qr:this.qr||null,pairing_code:this.pairingCode||null,last_error:this.lastError||null,desired_online:this.desired,agent_id:this.agentId,profile_key:'oracle:'+this.bid,last_seen_at:new Date().toISOString(),updated_at:new Date().toISOString()},{onConflict:'business_id'});
  }
  async clearAuth(){await rm(this.authDir,{recursive:true,force:true}).catch(()=>{});await mkdir(this.authDir,{recursive:true})}
  schedule(delay=1000){if(!this.desired)return;if(this.reconnectTimer)clearTimeout(this.reconnectTimer);this.reconnectTimer=setTimeout(()=>{this.reconnectTimer=null;void this.startSocket().catch(e=>{this.lastError=String(e?.message||e).slice(0,1000)})},delay);this.reconnectTimer.unref?.()}
  async stop(){const s=this.socket;this.socket=null;try{s?.end(new Error('Restarting Agenda Pro runtime'))}catch{}}
  async startSocket({pairPhone=''}={}){
    if(this.starting)return this.starting;
    this.starting=(async()=>{
      if(!this.desired)return;
      if(!await this.acquire()){this.state='disconnected';this.lastError='Esta conexão já está ativa em outro runtime.';return}
      await mkdir(this.authDir,{recursive:true});
      this.state='connecting';this.lastError='';this.qr='';this.qrSvg='';this.pairTriggered=false;await this.persist().catch(()=>{});
      const{state,saveCreds}=await useMultiFileAuthState(this.authDir);
      const registered=Boolean(state.creds.registered);
      const sock=makeWASocket({auth:state,logger,browser:Browsers.macOS('Desktop'),printQRInTerminal:false,markOnlineOnConnect:false,syncFullHistory:false,generateHighQualityLinkPreview:false,connectTimeoutMs:30000,defaultQueryTimeoutMs:30000,keepAliveIntervalMs:15000});
      this.socket=sock;

      const requestPair=async update=>{
        if(!pairPhone||registered||this.pairTriggered||this.socket!==sock)return;
        if(!(update?.connection==='connecting'||update?.qr))return;
        this.pairTriggered=true;this.state='waiting_pairing';this.phone=pairPhone;this.qr='';this.qrSvg='';
        try{
          const code=await sock.requestPairingCode(pairPhone);
          this.pairingCode=String(code||'').replace(/\s/g,'').toUpperCase();this.lastError='';await this.persist().catch(()=>{});this.pairRequest?.resolve?.(this.pairingCode);
        }catch(e){this.lastError=String(e?.message||e).slice(0,1000);this.state='error';await this.persist().catch(()=>{});this.pairRequest?.reject?.(e)}
      };

      sock.ev.on('creds.update',async()=>{try{await saveCreds();this.lastCheckpointAt=new Date().toISOString();await this.persist().catch(()=>{})}catch(e){this.lastError=('Falha ao salvar credenciais: '+String(e?.message||e)).slice(0,1000)}});
      sock.ev.on('connection.update',update=>{
        if(this.socket!==sock)return;
        void requestPair(update);
        if(update.qr&&!pairPhone){
          this.qr=String(update.qr);this.state='waiting_qr';this.lastError='';
          void QRCode.toString(this.qr,{type:'svg',margin:1,width:360}).then(svg=>{this.qrSvg=svg;void this.persist()}).catch(()=>{});
        }
        if(update.connection==='connecting'&&this.state!=='waiting_pairing'&&this.state!=='waiting_qr')this.state='connecting';
        if(update.connection==='open'){
          this.state='online';this.lastError='';this.qr='';this.qrSvg='';this.pairingCode='';this.phone=String(sock?.user?.id||'').split(':')[0].split('@')[0]||this.phone;this.reconnectAttempts=0;this.pairRequest?.resolve?.('connected');void this.persist();void this.heartbeat();
        }
        if(update.connection==='close'){
          const code=disconnectCode(update.lastDisconnect);if(this.socket===sock)this.socket=null;
          if(!this.desired){this.state='disconnected';return}
          if(code===DisconnectReason.loggedOut){this.state='disconnected';this.lastError='Sessão removida pelo WhatsApp; conecte novamente.';this.pairingCode='';this.phone='';void this.clearAuth().then(()=>this.persist());return}
          if(code===DisconnectReason.restartRequired||code===515){this.state='restarting';this.lastError='';this.pairingCode='';this.pairRequest?.resolve?.('accepted');void this.persist();this.schedule(250);return}
          this.reconnectAttempts+=1;this.state='connecting';this.lastError=code?`Conexão reiniciando (${code}).`:'Conexão reiniciando.';void this.persist();this.schedule(Math.min(15000,1000*Math.max(1,this.reconnectAttempts)));
        }
      });
    })();
    try{return await this.starting}finally{this.starting=null}
  }
  async pair(v){
    const p=phone(v);if(p.length<12||p.length>13)throw new Error('Informe o número com DDD e código do país.');
    this.desired=true;this.phone=p;this.pairingCode='';this.lastError='';if(this.reconnectTimer)clearTimeout(this.reconnectTimer);await this.stop();await this.clearAuth();
    let timeout;
    const promise=new Promise((resolve,reject)=>{this.pairRequest={resolve,reject};timeout=setTimeout(()=>reject(new Error('O WhatsApp demorou para gerar o código. Tente novamente.')),25000);timeout.unref?.()});
    await this.startSocket({pairPhone:p});
    try{await promise;if(!this.pairingCode&&this.state!=='online'&&this.state!=='restarting')throw new Error('O servidor não gerou um código de conexão.');return this.payload()}finally{clearTimeout(timeout);this.pairRequest=null}
  }
  async qrConnect(){
    this.desired=true;this.phone='';this.pairingCode='';this.lastError='';await this.stop();await this.clearAuth();await this.startSocket();
    const end=Date.now()+15000;while(Date.now()<end){if(this.qrSvg||this.state==='online')break;await new Promise(r=>setTimeout(r,250))}return this.payload();
  }
  async disconnect(){
    this.desired=false;if(this.reconnectTimer)clearTimeout(this.reconnectTimer);
    try{if(this.socket?.user)await this.socket.logout();else this.socket?.end(new Error('Manual disconnect'))}catch{}
    this.socket=null;this.state='disconnected';this.phone='';this.qr='';this.qrSvg='';this.pairingCode='';this.lastError='';await this.clearAuth();
    await admin.from('agenda_baileys_sessions').upsert({business_id:this.bid,status:'disconnected',desired_online:false,phone:null,qr:null,pairing_code:null,last_error:null,runtime_lease_id:null,runtime_lease_expires_at:null,updated_at:new Date().toISOString()},{onConflict:'business_id'});
    await admin.rpc('agenda_baileys_release_lease',{p_business_id:this.bid,p_lease_id:this.leaseId}).catch(()=>{});return this.payload();
  }
  async send(phoneValue,text){
    if(this.state!=='online'||!this.socket)throw new Error('WhatsApp não está conectado.');
    const p=phone(phoneValue);if(!p)throw new Error('Telefone inválido.');
    const found=await this.socket.onWhatsApp(p);const jid=found?.[0]?.jid;if(!jid)throw new Error('Número não encontrado no WhatsApp.');
    const sent=await this.socket.sendMessage(jid,{text:String(text||'')});return sent?.key?.id||null;
  }
  async dispatchOne(){
    if(this.dispatchBusy||this.state!=='online'||!this.socket||!this.leaseOwned)return;
    this.dispatchBusy=true;
    try{
      const{data:job,error}=await admin.rpc('agenda_baileys_claim_next',{p_business_id:this.bid,p_lease_id:this.leaseId});if(error)throw error;if(!job?.id)return;
      const reservation=job.reservation_token;
      try{
        const text=await queueMessage(job);
        await admin.rpc('agenda_baileys_mark_dispatch_started',{p_business_id:this.bid,p_job_id:job.id,p_reservation_token:reservation});
        const ref=await this.send(job.customer_phone,text);
        await admin.rpc('agenda_baileys_complete_job',{p_business_id:this.bid,p_job_id:job.id,p_reservation_token:reservation,p_message_ref:ref});
      }catch(e){
        await admin.rpc('agenda_baileys_fail_job',{p_business_id:this.bid,p_job_id:job.id,p_reservation_token:reservation,p_error:String(e?.message||e).slice(0,1400),p_no_retry:true});
      }
    }catch(e){this.lastError=String(e?.message||e).slice(0,1000)}finally{this.dispatchBusy=false}
  }
}
function runtime(bid){let r=runtimes.get(bid);if(!r){r=new Runtime(bid);runtimes.set(bid,r)}return r}
async function restore(){
  await mkdir(DATA_DIR,{recursive:true});
  const{data,error}=await admin.from('agenda_baileys_sessions').select('business_id,desired_online').eq('desired_online',true);
  if(error){console.error('[Oracle WhatsApp] restore:',error.message);return}
  for(const row of data||[]){const r=runtime(row.business_id);if(!await hasCreds(r.authDir))continue;r.desired=true;void r.startSocket().catch(e=>{r.lastError=String(e?.message||e).slice(0,1000)})}
}
async function body(req){let raw='';for await(const chunk of req){raw+=chunk;if(raw.length>1048576)throw new Error('Corpo da requisição muito grande.')}if(!raw)return{};try{return JSON.parse(raw)}catch{throw new Error('JSON inválido.')}}

const server=http.createServer(async(req,res)=>{
  if(req.method==='OPTIONS'){res.writeHead(204,{'access-control-allow-origin':'*','access-control-allow-headers':'authorization, content-type, apikey, x-client-info','access-control-allow-methods':'GET, POST, OPTIONS'});return res.end()}
  try{
    const url=new URL(req.url||'/','http://localhost');
    if(url.pathname==='/ready')return respond(res,200,{ok:true,service:'agenda-pro-baileys-oracle',runtimes:runtimes.size});
    const m=url.pathname.match(/^\/v1\/([0-9a-f-]{36})\/(status|connect|pair-code|disconnect|send-message|send-queue)$/i);
    if(!m)return respond(res,404,{error:'Not found'});
    const bid=businessId(m[1]);if(!bid)return respond(res,400,{error:'Empresa inválida'});await authorize(req,bid);
    const action=m[2].toLowerCase(),r=runtime(bid),payload=req.method==='POST'?await body(req):{};
    if(action==='status')return respond(res,200,r.payload());
    if(action==='pair-code'&&req.method==='POST')return respond(res,200,await r.pair(payload.phone));
    if(action==='connect'&&req.method==='POST')return respond(res,200,await r.qrConnect());
    if(action==='disconnect'&&req.method==='POST')return respond(res,200,await r.disconnect());
    if(action==='send-message'&&req.method==='POST')return respond(res,200,{sent:true,message_ref:await r.send(payload.phone,payload.text)});
    if(action==='send-queue'&&req.method==='POST'){await r.dispatchOne();return respond(res,200,{ok:true})}
    return respond(res,405,{error:'Método não permitido'});
  }catch(e){console.error('[Oracle WhatsApp]',e);return respond(res,Number(e?.status||500),{error:String(e?.message||e)})}
});
server.listen(PORT,'0.0.0.0',()=>console.log('[Oracle WhatsApp] ouvindo na porta '+PORT));
await restore();
setInterval(()=>{for(const r of runtimes.values())if(r.desired)void r.heartbeat().catch(e=>{r.lastError=String(e?.message||e).slice(0,1000)})},5000).unref();
setInterval(()=>{for(const r of runtimes.values())void r.dispatchOne()},2500).unref();

async function shutdown(signal){
  console.log('[Oracle WhatsApp] encerrando por '+signal);
  for(const r of runtimes.values()){r.desired=false;if(r.reconnectTimer)clearTimeout(r.reconnectTimer);try{r.socket?.end(new Error(signal))}catch{}await admin.rpc('agenda_baileys_release_lease',{p_business_id:r.bid,p_lease_id:r.leaseId}).catch(()=>{})}
  server.close(()=>process.exit(0));setTimeout(()=>process.exit(0),4000).unref?.();
}
process.on('SIGTERM',()=>void shutdown('SIGTERM'));
process.on('SIGINT',()=>void shutdown('SIGINT'));
