// Network first: an old installed app must receive the new protocol and interface.
const CACHE='wft-shell-v2';
self.addEventListener('install',()=>self.skipWaiting());
self.addEventListener('activate',event=>event.waitUntil((async()=>{for(const key of await caches.keys())if(key.startsWith('wft-shell-')&&key!==CACHE)await caches.delete(key);await self.clients.claim();})()));
self.addEventListener('fetch',event=>{
  const url=new URL(event.request.url);
  if(event.request.method!=='GET'||url.origin!==self.location.origin)return;
  event.respondWith((async()=>{const cache=await caches.open(CACHE);try{const response=await fetch(event.request);if(response.ok)await cache.put(event.request,response.clone());return response;}catch{const cached=await cache.match(event.request);if(cached)return cached;return new Response('Offline. Open this page online to connect devices.',{status:503,headers:{'Content-Type':'text/plain'}});}})());
});
