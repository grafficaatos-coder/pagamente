/* AgendaJP - respostas de clientes e avisos Push, isolado da agenda e do WhatsApp. */
(function(){
  "use strict";
  const FUNCTION_URL="https://zmrihyzwsyxjikdknfug.supabase.co/functions/v1/agenda-pwa-push";
  let activeKey="",channel=null,poll=null,alerts=[],modal=null,subscribed=false,loading=false,openingFromPush=false;
  let preferences={confirmed:true,declined:true,rescheduled:true};
  const byId=id=>document.getElementById(id);
  const escapeText=x=>String(x??"").replace(/[&<>"']/g,c=>({"&":"&amp;","<":"&lt;",">":"&gt;",'"':"&quot;","'":"&#39;"}[c]));
  const current=()=>typeof sb!=="undefined"&&sb&&typeof companyCtx!=="undefined"&&companyCtx?.business?.id&&typeof authUser!=="undefined"&&authUser?.id&&typeof appMode!=="undefined"&&appMode==="company";
  function preferenceKey(){return "agendajp-push-events:"+authUser?.id+":"+companyCtx?.business?.id}
  function loadPreferences(){
    try{
      const stored=JSON.parse(localStorage.getItem(preferenceKey())||"{}");
      return {confirmed:stored.confirmed!==false,declined:stored.declined!==false,rescheduled:stored.rescheduled!==false};
    }catch(_){return {confirmed:true,declined:true,rescheduled:true}}
  }
  function isIOSBrowser(){return /iPhone|iPad|iPod/i.test(navigator.userAgent||"")}
  function isInstalled(){return navigator.standalone===true||window.matchMedia?.("(display-mode: standalone)").matches===true}
  const apiHeaders=async()=>{
    const {data}=await sb.auth.getSession();
    if(!data?.session?.access_token)throw Error("Entre novamente no AgendaJP para ativar os avisos.");
    return {"Content-Type":"application/json","Authorization":"Bearer "+data.session.access_token,"apikey":SUPABASE_KEY};
  };
  const b64urlToBytes=x=>Uint8Array.from(atob(x.replace(/-/g,"+").replace(/_/g,"/")+"=".repeat((4-x.length%4)%4)),c=>c.charCodeAt(0));
  function updateBadge(){
    const b=byId("agenpro-response-bell");
    if(!b)return;
    const n=alerts.filter(a=>!a.read_at).length;
    let chip=b.querySelector(".agenpro-response-count");
    if(!chip&&n){chip=document.createElement("span");chip.className="agenpro-response-count";b.append(chip)}
    if(chip){chip.textContent=String(n>9?"9+":n);chip.hidden=n===0}
    b.title=n?n+" respostas de clientes não lidas":"Notificações dos clientes";
    b.setAttribute("aria-label",b.title);
  }
  function humanDate(value){
    const d=new Date(value);
    return isNaN(d.getTime())?"":d.toLocaleString("pt-BR",{day:"2-digit",month:"2-digit",hour:"2-digit",minute:"2-digit"});
  }
  function draw(){
    if(!modal)return;
    const list=modal.querySelector(".agenpro-response-items");
    if(!list)return;
    list.innerHTML=alerts.length?alerts.map(a=>{
      const yes=a.outcome==="confirmed";
      const rescheduled=a.outcome==="rescheduled";
      const description=yes?" confirmou o horário":rescheduled?" teve o horário reagendado":" informou que não poderá comparecer";
      return '<div class="agenpro-response-item '+(a.read_at?"read":"unread")+'"><span class="agenpro-response-icon '+(yes||rescheduled?"ok":"no")+'">'+(yes?"✓":rescheduled?"↻":"!")+'</span><div><strong>'+escapeText(a.customer_name||"Cliente")+description+'</strong><small>Horário: '+humanDate(a.appointment_starts_at)+'</small><small>Aviso: '+humanDate(a.created_at)+'</small></div></div>';
    }).join(""):'<div class="agenpro-response-empty">Ainda não há respostas de clientes para mostrar.</div>';
    const enable=modal.querySelector(".agenpro-response-enable");
    const status=modal.querySelector(".agenpro-response-permission");
    const supported=("serviceWorker" in navigator)&&("PushManager" in window)&&("Notification" in window)&&window.isSecureContext;
    const permission=("Notification" in window)?Notification.permission:"unsupported";
    const needsInstall=isIOSBrowser()&&!isInstalled();
    modal.querySelectorAll("[data-push-event]").forEach(box=>{
      box.checked=preferences[box.dataset.pushEvent]!==false;
    });
    if(enable){
      enable.hidden=(!supported&&!needsInstall)||(permission==="denied"&&!needsInstall);
      enable.textContent=needsInstall?"Como instalar o AgendaJP":subscribed?"Notificações ativadas":"Ativar notificações neste celular";
      enable.disabled=subscribed&&!needsInstall;
    }
    if(status){
      status.textContent=needsInstall
        ?"No iPhone, notificações com o aplicativo fechado exigem o AgendaJP instalado na Tela de Início. Abra pelo ícone após instalar."
        :!supported?"Este navegador não permite notificações push."
        :permission==="denied"?"Notificações bloqueadas: libere o AgendaJP nos Ajustes do celular."
        :subscribed?"Notificações ativas neste dispositivo. Personalize os eventos abaixo."
        :"Ative os avisos para receber respostas mesmo com o aplicativo fechado.";
    }
    const mark=modal.querySelector(".agenpro-response-read");
    if(mark)mark.disabled=!alerts.some(a=>!a.read_at);
  }
  async function refresh(){
    if(!current()||loading)return;
    loading=true;
    try{
      const {data,error}=await sb.from("agenda_response_notifications")
        .select("id,outcome,customer_name,appointment_starts_at,created_at,read_at")
        .eq("recipient_user_id",authUser.id)
        .eq("business_id",companyCtx.business.id)
        .order("created_at",{ascending:false}).limit(50);
      if(error)throw error;
      alerts=data||[];
      updateBadge();draw();
    }catch(e){console.warn("Notificações AgendaJP:",e.message||e)}
    finally{loading=false}
  }
  function tearDown(){
    if(channel&&typeof sb!=="undefined"&&sb)void sb.removeChannel(channel);
    channel=null;activeKey="";
    if(poll){clearInterval(poll);poll=null}
    alerts=[];subscribed=false;loading=false;
    modal?.remove();modal=null;
  }
  async function registerSubscription(subscription){
    const json=subscription.toJSON();
    const headers=await apiHeaders();
    const resp=await fetch(FUNCTION_URL,{method:"POST",headers,
      body:JSON.stringify({action:"subscribe",business_id:companyCtx.business.id,
        subscription:{endpoint:subscription.endpoint,p256dh:json.keys?.p256dh,auth:json.keys?.auth},
        events:preferences})
    });
    const out=await resp.json().catch(()=>({}));
    if(!resp.ok)throw Error(out.error||"Falha ao salvar preferências de avisos");
    subscribed=true;draw();
  }
  async function savePreference(eventType,value){
    if(!current()||!Object.hasOwn(preferences,eventType))return;
    const previous={...preferences};
    preferences[eventType]=value;
    try{localStorage.setItem(preferenceKey(),JSON.stringify(preferences))}catch(_){}
    draw();
    if(!subscribed)return;
    try{
      const reg=await navigator.serviceWorker.ready;
      const sub=await reg.pushManager.getSubscription();
      if(sub)await registerSubscription(sub);
    }catch(e){
      preferences=previous;
      try{localStorage.setItem(preferenceKey(),JSON.stringify(preferences))}catch(_){}
      draw();
      if(typeof toast==="function")toast("Não foi possível salvar a preferência. Tente novamente.");
    }
  }
  async function syncPreviousSubscription(){
    if(!current()||!("serviceWorker" in navigator)||!("PushManager" in window)||
      !("Notification" in window)||Notification.permission!=="granted")return;
    try{
      const registration=await navigator.serviceWorker.ready;
      const sub=await registration.pushManager.getSubscription();
      if(!sub)return;
      await registerSubscription(sub);
    }catch(e){console.warn("Notificação PWA:",e.message||e)}
  }
  function detect(){
    if(!current()){if(activeKey)tearDown();return}
    const identity=authUser.id+":"+companyCtx.business.id;
    updateBadge();
    if(activeKey===identity)return;
    tearDown();activeKey=identity;
    preferences=loadPreferences();
    void refresh();
    channel=sb.channel("agenpro-response-"+authUser.id+"-"+Date.now())
      .on("postgres_changes",
        {event:"INSERT",schema:"public",table:"agenda_response_notifications",filter:"recipient_user_id=eq."+authUser.id},
        payload=>{if(payload.new?.business_id===companyCtx?.business?.id)void refresh()}
      ).subscribe();
    poll=setInterval(()=>{if(current())void refresh();else tearDown()},20000);
    void syncPreviousSubscription();
    if(new URLSearchParams(location.search).get("avisos")==="1"&&!openingFromPush){
      openingFromPush=true;
      setTimeout(()=>{if(current())openCenter()},400);
      try{
        const url=new URL(location.href);url.searchParams.delete("avisos");
        history.replaceState(history.state,"",url.pathname+url.search+url.hash);
      }catch(_){}
    }
  }
  function openCenter(){
    detect();
    if(!current())return;
    if(modal){draw();return}
    modal=document.createElement("div");
    modal.className="agenpro-response-overlay";
    modal.setAttribute("role","presentation");
    modal.innerHTML='<section class="agenpro-response-dialog" role="dialog" aria-modal="true" aria-labelledby="agenpro-response-title">'+
      '<div class="agenpro-response-head"><div><small>AVISOS AUTOMÁTICOS</small><h2 id="agenpro-response-title">Respostas dos clientes</h2></div><button class="agenpro-response-close" type="button" aria-label="Fechar">×</button></div>'+
      '<p class="agenpro-response-help">Veja confirmações, cancelamentos e reagendamentos. Os avisos ficam registrados aqui mesmo quando as notificações do celular estão desativadas.</p>'+
      '<div class="agenpro-response-subscribe"><span class="agenpro-response-permission"></span>'+
      '<button class="btn primary agenpro-response-enable" type="button">Ativar notificações neste celular</button></div>'+
      '<fieldset class="agenpro-response-preferences"><legend>Quais notificações deseja receber neste aparelho?</legend>'+
      '<label><input type="checkbox" data-push-event="confirmed"> Confirmação de agendamento</label>'+
      '<label><input type="checkbox" data-push-event="declined"> Cancelamento / recusa</label>'+
      '<label><input type="checkbox" data-push-event="rescheduled"> Reagendamento de horário</label></fieldset>'+
      '<div class="agenpro-response-items"></div>'+
      '<div class="agenpro-response-footer"><button type="button" class="btn secondary agenpro-response-read">Marcar como lidas</button>'+
      '<button type="button" class="btn primary agenpro-response-agenda">Abrir agenda</button></div>'+
      '</section>';
    document.body.append(modal);
    modal.addEventListener("click",e=>{if(e.target===modal)closeCenter()});
    modal.querySelector(".agenpro-response-close").onclick=closeCenter;
    modal.querySelector(".agenpro-response-enable").onclick=enable;
    modal.querySelectorAll("[data-push-event]").forEach(box=>{
      box.addEventListener("change",()=>void savePreference(box.dataset.pushEvent,box.checked));
    });
    modal.querySelector(".agenpro-response-read").onclick=markRead;
    modal.querySelector(".agenpro-response-agenda").onclick=()=>{closeCenter();go("agenda")};
    draw();void refresh();
  }
  function closeCenter(){modal?.remove();modal=null}
  async function enable(){
    const button=modal?.querySelector(".agenpro-response-enable");
    if(!current())return;
    if(isIOSBrowser()&&!isInstalled()){
      if(typeof installAgendaApp==="function")installAgendaApp();
      else if(typeof toast==="function")toast("Abra no Safari e use Compartilhar > Adicionar à Tela de Início.");
      return;
    }
    if(!("Notification" in window)||!("PushManager" in window)||!("serviceWorker" in navigator)){
      if(typeof toast==="function")toast("Notificações não disponíveis neste navegador.");
      return;
    }
    if(subscribed)return;
    if(button){button.disabled=true;button.textContent="Ativando..."}
    try{
      const permission=await Notification.requestPermission();
      if(permission!=="granted")throw Error("Permissão não concedida. Verifique os Ajustes do celular.");
      const registration=await navigator.serviceWorker.ready;
      const pub=await fetch(FUNCTION_URL,{cache:"no-store"}).then(async r=>{
        if(!r.ok)throw Error("Servidor de notificações indisponível");
        return r.json();
      });
      if(!pub.publicKey)throw Error("Chave de notificações indisponível");
      let subscription=await registration.pushManager.getSubscription();
      if(!subscription){
        subscription=await registration.pushManager.subscribe({
          userVisibleOnly:true,applicationServerKey:b64urlToBytes(pub.publicKey)
        });
      }
      await registerSubscription(subscription);
      if(typeof toast==="function")toast("Notificações ativadas neste celular!");
    }catch(e){
      if(typeof toast==="function")toast(e.message||"Falha ao ativar notificações");
      console.warn("AgendaJP Push:",e);
    }finally{if(button)button.disabled=false;draw()}
  }
  async function markRead(){
    if(!current())return;
    const ids=alerts.filter(a=>!a.read_at).map(a=>a.id);
    if(!ids.length)return;
    const {error}=await sb.from("agenda_response_notifications").update({read_at:new Date().toISOString()})
      .eq("recipient_user_id",authUser.id).eq("business_id",companyCtx.business.id).in("id",ids);
    if(error){console.warn("AgendaJP marcar como lida:",error);return}
    await refresh();
  }
  window.AgenProPush={openCenter,enable,refresh};
  document.addEventListener("keydown",e=>{if(e.key==="Escape"&&modal)closeCenter()});
  setInterval(detect,2500);
  document.addEventListener("visibilitychange",()=>{if(!document.hidden){detect();void refresh()}});
  detect();
})();
