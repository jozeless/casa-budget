const CACHE = 'casa-shell-v5-phase2';
const SHELL = ['./','./index.html','./styles.css','./app.js','./budget.js','./config.js','./manifest.webmanifest','./icon.svg'];
const shellUrls = new Set(SHELL.map(path=>new URL(path,self.registration.scope).href));
self.addEventListener('install', event => {
  event.waitUntil(caches.open(CACHE).then(cache=>cache.addAll(SHELL.map(path=>new Request(new URL(path,self.registration.scope),{cache:'reload'})))));
  self.skipWaiting();
});
self.addEventListener('activate', event => {
  event.waitUntil(caches.keys().then(keys=>Promise.all(keys.filter(key=>key.startsWith('casa-shell-')&&key!==CACHE).map(key=>caches.delete(key)))).then(()=>self.clients.claim()));
});
self.addEventListener('fetch', event => {
  const url=new URL(event.request.url);
  if(event.request.method!=='GET'||url.origin!==self.location.origin||!shellUrls.has(url.href))return;
  event.respondWith((async()=>{
    const cache=await caches.open(CACHE);
    try{
      const request=url.pathname.endsWith('/config.js')?new Request(event.request,{cache:'no-store'}):event.request;
      const response=await fetch(request);
      if(response.ok){
        try{await cache.put(event.request,response.clone());}catch{/* Keep a successful network response if storage is unavailable. */}
        return response;
      }
      return (await cache.match(event.request))||response;
    }catch(error){
      const cached=await cache.match(event.request);
      if(cached)return cached;
      throw error;
    }
  })());
});
