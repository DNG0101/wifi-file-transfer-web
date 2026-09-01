// Network first: an old installed app must receive the new protocol and interface.
const CACHE='wft-shell-v8';
const SHELL=['./','./index.html','./assets/app.css?v=4.2','./src/app.js?v=4.3','./src/room.js','./src/block-transfer.js','./src/storage.js','./src/presence-peer.js','./src/presence-db.js','./src/main-peer.js','./favicon.svg','./manifest.webmanifest','./connection-config.json'];
self.addEventListener('install',event=>event.waitUntil((async()=>{const cache=await caches.open(CACHE);await cache.addAll(SHELL);await self.skipWaiting();})()));
self.addEventListener('activate',event=>event.waitUntil((async()=>{for(const key of await caches.keys())if(key.startsWith('wft-shell-')&&key!==CACHE)await caches.delete(key);await self.clients.claim();})()));
self.addEventListener('fetch',event=>{
  const url=new URL(event.request.url);
  if(event.request.method!=='GET'||url.origin!==self.location.origin)return;
  event.respondWith((async()=>{const cache=await caches.open(CACHE);try{const response=await fetch(event.request);if(response.ok)await cache.put(event.request,response.clone());return response;}catch{const cached=await cache.match(event.request);if(cached)return cached;return new Response('Offline. Open this page online to connect devices.',{status:503,headers:{'Content-Type':'text/plain'}});}})());
});
