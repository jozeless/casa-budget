const CACHE = 'casa-shell-v16-logo-refresh';
const SHELL = ['./','./index.html','./styles.css','./app.js','./budget.js','./config.js','./manifest.webmanifest','./icon.svg','./icon-192.png','./icon-512.png','./receipt.js','./supabase/functions/_shared/receipt-core.js'];
const shellUrls = new Set(SHELL.map(path=>new URL(path,self.registration.scope).href));
self.addEventListener('install', event => {
  event.waitUntil((async()=>{
    const cache=await caches.open(CACHE);
    try{await cache.addAll(SHELL.map(path=>new Request(new URL(path,self.registration.scope),{cache:'reload'})));await self.skipWaiting();}
    catch(error){await caches.delete(CACHE);throw error;} // Keep the active old shell if an update is incomplete.
  })());
});
self.addEventListener('activate', event => {
  event.waitUntil(caches.keys().then(keys=>Promise.all(keys.filter(key=>key.startsWith('casa-shell-')&&key!==CACHE).map(key=>caches.delete(key)))).then(()=>self.clients.claim()));
});
self.addEventListener('fetch', event => {
  const url=new URL(event.request.url);
  if(url.pathname.endsWith('/receipt-core.js')&&url.searchParams.get('casa-module')==='v10')url.search='';
  if(event.request.method!=='GET'||url.origin!==self.location.origin||!shellUrls.has(url.href))return;
  event.respondWith((async()=>{
    const cache=await caches.open(CACHE);
    const cached=await cache.match(url.href);
    if(!url.pathname.endsWith('/config.js')&&cached)return cached; // One installed version, not a mix of network scripts.
    try{
      const request=url.pathname.endsWith('/config.js')?new Request(event.request,{cache:'no-store'}):event.request;
      const response=await fetch(request);
      if(response.ok){
        try{await cache.put(url.href,response.clone());}catch{/* Keep a successful network response if storage is unavailable. */}
        return response;
      }
      return (await cache.match(url.href))||response;
    }catch(error){
      const cached=await cache.match(url.href);
      if(cached)return cached;
      throw error;
    }
  })());
});
