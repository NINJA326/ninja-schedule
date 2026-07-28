'use strict';
const CACHE_NAME='ninja-schedule-v7';
const STATIC_FILES=['./manifest.json'];
self.addEventListener('install',event=>{self.skipWaiting();event.waitUntil(caches.open(CACHE_NAME).then(c=>c.addAll(STATIC_FILES)).catch(()=>{}))});
self.addEventListener('activate',event=>{event.waitUntil(caches.keys().then(keys=>Promise.all(keys.filter(k=>k!==CACHE_NAME).map(k=>caches.delete(k)))).then(()=>self.clients.claim()))});
self.addEventListener('fetch',event=>{
 const r=event.request;if(r.method!=='GET')return;
 const u=new URL(r.url);const dynamic=r.mode==='navigate'||r.destination==='document'||u.pathname.endsWith('/config.js')||u.hostname.includes('script.google.com');
 if(dynamic){event.respondWith(fetch(r,{cache:'no-store'}).catch(()=>caches.match(r)));return}
 event.respondWith(caches.match(r).then(hit=>hit||fetch(r).then(res=>{if(res&&res.status===200&&res.type!=='opaque'){const copy=res.clone();caches.open(CACHE_NAME).then(c=>c.put(r,copy)).catch(()=>{})}return res})));
});
