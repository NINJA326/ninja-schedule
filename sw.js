const CACHE_NAME='ninja-schedule-v6';
const STATIC_FILES=['./manifest.json'];

self.addEventListener('install',event=>{
  self.skipWaiting();
  event.waitUntil(
    caches.open(CACHE_NAME)
      .then(cache=>cache.addAll(STATIC_FILES))
      .catch(()=>{})
  );
});

self.addEventListener('activate',event=>{
  event.waitUntil(
    caches.keys()
      .then(keys=>
        Promise.all(
          keys
            .filter(key=>key!==CACHE_NAME)
            .map(key=>caches.delete(key))
        )
      )
      .then(()=>self.clients.claim())
  );
});

self.addEventListener('fetch',event=>{
  const request=event.request;

  if(request.method!=='GET')return;

  if(request.mode==='navigate'||request.destination==='document'){
    event.respondWith(
      fetch(request,{cache:'no-store'})
        .catch(()=>caches.match(request))
    );
    return;
  }

  event.respondWith(
    fetch(request)
      .then(response=>{
        const copy=response.clone();

        caches.open(CACHE_NAME)
          .then(cache=>cache.put(request,copy))
          .catch(()=>{});

        return response;
      })
      .catch(()=>caches.match(request))
  );
});
