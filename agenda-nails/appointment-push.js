/* AgendaJP - respostas de clientes e avisos Push, isolado da agenda e do WhatsApp. */
(function(){
  "use strict";
  const FUNCTION_URL="https://zmrihyzwsyxjikdknfug.supabase.co/functions/v1/agenda-pwa-push";
  let activeKey="",channel=null,poll=null,alerts=[],modal=null,subscribed=false,loading=false,openingFromPush=false;
  const byId=id=>document.getElementById(id);
  const escapeText=x=>String(x??"").replace(/[&<>"']/g,c=>({"&":"&amp;","<":"&lt;",">":"&gt;",'"':"&quot;","'":"&#39;"}[c]));
  const current=()=>typeof sb!=="undefined"&&sb&&typeof companyCtx!=="undefined"&&companyCtx?.business?.id&&typeof authUser!=="undefined"&&authUser?.id&&typeof appMode!=="undefined"&&appMode==="company";
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
      return '<div class="agenpro-response-item '+(a.read_at?"read":"unread")+'"><span class="agenpro-response-icon '+(yes?"ok":"no")+'">'+(yes?"✓":"!")+'</span><div><strong>'+escapeText(a.customer_name||"Cliente")+(yes?" confirmou o horário":" recusou o horário")+'</strong><small>Agendamento: '+humanDate(a.appointment_starts_at)+'</small><small>Resposta: '+humanDate(a.created_at)+'</small></div></div>';
    }).join(""):'<div class="agenpro-response-empty">Ainda não há respostas de clientes para mostrar.</div>';
    const enable=modal.querySelector(".agenpro-response-enable");
    const status=modal.querySelector(".agenpro-response-permission");
    const supported=("serviceWorker" in navigator)&&("PushManager" in window)&&("Notification" in window)&&window.isSecureContext;
    if(enable){
      enable.hidden=!supported||subscribed||Notification.permission==="denied";
      enable.textContent=Notification.permission==="granted"?"Conectar notificações neste celular":"Ativar notificações neste celular";
    }
    if(status){
      status.textContent=!supported
        ?"Este navegador não oferece notificações PWA. No iPhone, instale o AgendaJP na Tela de Início e abra o aplicativo instalado."
        :Notification.permission==="denied"
          ?"As notificações foram bloqueadas nas configurações do navegador/celular."
          :subscribed?"Notificações do aplicativo ativadas neste dispositivo.":"Ative as notificações para receber respostas mesmo com o aplicativo fechado.";
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
  async function syncPreviousSubscription(){
    if(!current()||!("serviceWorker" in navigator)||!("PushManager" in window)||
      !("Notification" in window)||Notification.permission!=="granted")return;
    try{
      const registration=await navigator.serviceWorker.ready;
      const sub=await registration.pushManager.getSubscription();
      if(!sub)return;
      const json=sub.toJSON();
      const headers=await apiHeaders();
      const resp=await fetch(FUNCTION_URL,{
        method:"POST",headers,
        body:JSON.stringify({action:"subscribe",business_id:companyCtx.business.id,
          subscription:{endpoint:sub.endpoint,p256dh:json.keys?.p256dh,auth:json.keys?.auth}})
      });
      subscribed=resp.ok;draw();
    }catch(e){console.warn("Notificação PWA:",e.message||e)}
  }
  function detect(){
    if(!current()){if(activeKey)tearDown();return}
    const identity=authUser.id+":"+companyCtx.business.id;
    updateBadge();
    if(activeKey===identity)return;
    tearDown();activeKey=identity;
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
      '<p class="agenpro-response-help">Aqui você vê quem confirmou ou informou que não poderá comparecer. Os dados também ficam salvos na agenda.</p>'+
      '<div class="agenpro-response-subscribe"><span class="agenpro-response-permission"></span>'+
      '<button class="btn primary agenpro-response-enable" type="button">Ativar notificações neste celular</button></div>'+
      '<div class="agenpro-response-items"></div>'+
      '<div class="agenpro-response-footer"><button type="button" class="btn secondary agenpro-response-read">Marcar como lidas</button>'+
      '<button type="button" class="btn primary agenpro-response-agenda">Abrir agenda</button></div>'+
      '</section>';
    document.body.append(modal);
    modal.addEventListener("click",e=>{if(e.target===modal)closeCenter()});
    modal.querySelector(".agenpro-response-close").onclick=closeCenter;
    modal.querySelector(".agenpro-response-enable").onclick=enable;
    modal.querySelector(".agenpro-response-read").onclick=markRead;
    modal.querySelector(".agenpro-response-agenda").onclick=()=>{closeCenter();go("agenda")};
    draw();void refresh();
  }
  function closeCenter(){modal?.remove();modal=null}
  async function enable(){
    const button=modal?.querySelector(".agenpro-response-enable");
    if(!current())return;
    if(!("Notification" in window)||!("PushManager" in window)||!("serviceWorker" in navigator))return;
    if(button){button.disabled=true;button.textContent="Ativando..."}
    try{
      const permission=await Notification.requestPermission();
      if(permission!=="granted")throw Error("Permissão não concedida. Verifique as configurações do celular.");
      const registration=await navigator.serviceWorker.ready;
      const pub=await fetch(FUNCTION_URL,{cache:"no-store"}).then(async r=>{
        if(!r.ok)throw Error("Servidor de notificações indisponível");
        return r.json()
      });
      if(!pub.publicKey)throw Error("Chave de notificações indisponível");
      let subscription=await registration.pushManager.getSubscription();
      if(!subscription){
        subscription=await registration.pushManager.subscribe({
          userVisibleOnly:true,applicationServerKey:b64urlToBytes(pub.publicKey)
        });
      }
      const serialized=subscription.toJSON();
      const headers=await apiHeaders();
      const response=await fetch(FUNCTION_URL,{method:"POST",headers,body:JSON.stringify({
        action:"subscribe",business_id:companyCtx.business.id,
        subscription:{endpoint:subscription.endpoint,p256dh:serialized.keys?.p256dh,auth:serialized.keys?.auth}
      })});
      const outcome=await response.json().catch(()=>({}));
      if(!response.ok)throw Error(outcome.error||"Não foi possível registrar o dispositivo");
      subscribed=true;
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
