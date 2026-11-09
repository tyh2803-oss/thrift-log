/* Cache only public assets. Never cache private pages, auth, APIs, photos, or records. */
const CACHE='thrift-log-public-v1';
const ASSETS=['/offline.html','/icon.svg','/icons/icon-192.png','/icons/icon-512.png'];
self.addEventListener('install',event=>{event.waitUntil(caches.open(CACHE).then(cache=>cache.addAll(ASSETS)));self.skipWaiting();});
self.addEventListener('activate',event=>{event.waitUntil(caches.keys().then(keys=>Promise.all(keys.filter(k=>k!==CACHE).map(k=>caches.delete(k)))).then(()=>self.clients.claim()));});
self.addEventListener('fetch',event=>{const url=new URL(event.request.url);if(url.origin!==self.location.origin||event.request.method!=='GET')return;if(ASSETS.includes(url.pathname)){event.respondWith(caches.match(event.request).then(hit=>hit||fetch(event.request)));return;}if(event.request.mode==='navigate')event.respondWith(fetch(event.request).catch(()=>caches.match('/offline.html')));});
