const CACHE_NAME='agenpro-shell-v51-mobile-redesign-20261023';
const SHELL=['/','/manifest.webmanifest','/icons/app-icon.svg','/icons/app-icon-maskable.svg','/brand/agenda-pro-original.svg','/icons/agenda-pro-192-new.png','/icons/agenda-pro-512-new.png'];

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
