const CACHE_NAME='agendajp-shell-v59-ios-brand-20261024';
const SHELL=['/','/manifest.webmanifest?v=20261024-ios-v2','/apple-touch-icon.png','/brand/agendajp-logo.webp','/icons/agendajp-192.png','/icons/agendajp-512.png','/mobile-fit.css?v=20261023-10','/whatsapp-welcome.css?v=20261023-12'];

self.addEventListener('install',event=>{
  event.waitUntil(
    caches.open(CACHE_NAME).then(cache=>cache.addAll(SHELL)).catch(()=>{})
  );
  self.skipWaiting();
});

self.addEventListener('activate',event=>{
  event.waitUntil(
    caches.keys().then(keys=>Promise.all(keys.filter(k=>k!==CACHE_NAME).map(k=>caches.delete(k))))
  );
  self.clients.claim();
});

self.addEventListener('fetch',event=>{
  const req=event.request;
  if(req.method!=='GET')return;
  const url=new URL(req.url);
  if(url.origin!==self.location.origin)return;
  // Never cache the update manifest; check the real released version online.
  if(url.pathname==='/app-version.json'){
    event.respondWith(fetch(req,{cache:'no-store'}));
    return;
  }

  if(req.mode==='navigate'){
    event.respondWith(
      fetch(req,{cache:'no-store'})
        .then(res=>{
          const copy=res.clone();
          caches.open(CACHE_NAME).then(cache=>cache.put('/',copy)).catch(()=>{});
          return res;
        })
        .catch(()=>caches.match('/'))
    );
    return;
  }

  event.respondWith(
    fetch(req)
      .then(res=>{
        const copy=res.clone();
        caches.open(CACHE_NAME).then(cache=>cache.put(req,copy)).catch(()=>{});
        return res;
      })
      .catch(()=>caches.match(req))
  );
});


self.addEventListener('push',event=>{
  let data={};
  try { data=event.data?.json()||{}; }
  catch (_) { data={title:'AgendaJP · Resposta de agendamento',body:'Você recebeu uma nova resposta.'}; }
  const title=String(data.title||'AgendaJP · Nova resposta').slice(0,80);
  const options={
    body:String(data.body||'Uma cliente respondeu ao seu horário.').slice(0,160),
    icon:'/icons/agendajp-192.png',
    badge:'/icons/agendajp-192.png',
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
