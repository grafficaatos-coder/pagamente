"""Integra notificações de confirmação/recusa no PWA existente sem mudar o agendamento."""
from pathlib import Path
import json

base=Path("agenda-nails")
index=base/"index.html"
html=index.read_text(encoding="utf-8")
if "appointment-push.js?v=20261023-7" in html:
    print("Notificações PWA já integradas.")
    raise SystemExit(0)

def once(old,new):
    global html
    found=html.count(old)
    if found!=1:
        raise RuntimeError(f"Projeto divergiu no ponto de integração ({found}): {old[:80]}")
    html=html.replace(old,new,1)

once('<link rel="stylesheet" href="/messages-layout.css?v=20261023-6">',
     '<link rel="stylesheet" href="/messages-layout.css?v=20261023-6">\n  <link rel="stylesheet" href="/appointment-push.css?v=20261023-7">\n  <script defer src="/appointment-push.js?v=20261023-7"></script>')
once('class="dashboard-notification-button" title="Ver agendamentos pendentes" aria-label="Ver agendamentos pendentes" onclick="go(\'agenda\')"',
     'id="agenpro-response-bell" class="dashboard-notification-button" title="Avisos de respostas dos clientes" aria-label="Avisos de respostas dos clientes" onclick="window.AgenProPush?.openCenter()"')
once("const AGENDA_UI_VERSION='2026.10.23.6';",
     "const AGENDA_UI_VERSION='2026.10.23.7';")
once("/sw.js?v=20261023-ui-refresh-v4",
     "/sw.js?v=20261023-push-v1")
for f in ("appointment-push.js","appointment-push.css"):
    assert (base/f).is_file(), "Arquivo PWA ausente: "+f
index.write_text(html,encoding="utf-8")

swfile=base/"sw.js"
sw=swfile.read_text(encoding="utf-8")
old="agenpro-shell-v52-mensagens-20261023"
assert sw.count(old)==1,"Cache PWA divergente"
sw=sw.replace(old,"agenpro-shell-v53-push-confirmations-20261023")
sw+="""

self.addEventListener('push',event=>{
  let data={};
  try { data=event.data?.json()||{}; }
  catch (_) { data={title:'AgenPro · Resposta de agendamento',body:'Você recebeu uma nova resposta.'}; }
  const title=String(data.title||'AgenPro · Nova resposta').slice(0,80);
  const options={
    body:String(data.body||'Uma cliente respondeu ao seu horário.').slice(0,160),
    icon:'/icons/agenda-pro-192-new.png',
    badge:'/icons/agenda-pro-192-new.png',
    tag:String(data.tag||'agenpro-customer-response'),
    data:{url:'/?avisos=1'},
    renotify:true
  };
  event.waitUntil(self.registration.showNotification(title,options));
});

self.addEventListener('notificationclick',event=>{
  event.notification.close();
  const target=new URL('/?avisos=1',self.location.origin).href;
  event.waitUntil(self.clients.matchAll({type:'window',includeUncontrolled:true}).then(async clients=>{
    for(const client of clients){
      try{
        if(new URL(client.url).origin===self.location.origin){
          await client.navigate(target);
          await client.focus();
          return;
        }
      }catch(_){}
    }
    if(self.clients.openWindow)await self.clients.openWindow(target);
  }));
});
"""
swfile.write_text(sw,encoding="utf-8")

vpath=base/"app-version.json"
v=json.loads(vpath.read_text(encoding="utf-8"))
v.update(version="2026.10.23.7",released_at="2026-10-23",name="AgenPro",
         notes="Avisos PWA quando a cliente confirma ou recusa o agendamento; central de notificações e opção de ativar no celular.")
vpath.write_text(json.dumps(v,ensure_ascii=False,indent=2)+"\n",encoding="utf-8")
print("Notificações PWA de confirmação/recusa integradas ao AgenPro.")
