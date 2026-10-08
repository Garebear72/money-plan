/* Money Plan service worker.
   Caches only the app's own files so it opens offline. It never reads, stores or sends your plan:
   your data lives in the page's localStorage, which a service worker cannot see.
   Bump VERSION whenever any file in SHELL changes so phones pick up the update. */
var VERSION='money-plan-v2';
var SHELL=[
  './','index.html','app.css','core.js','app.js','manifest.webmanifest',
  'icons/icon-192.png','icons/icon-512.png','icons/icon-maskable-192.png','icons/icon-maskable-512.png',
  'icons/apple-touch-icon.png','icons/favicon-32.png',
  'fonts/bricolage-grotesque-var.woff2','fonts/instrument-sans-var.woff2',
  'fonts/ibm-plex-mono-400.woff2','fonts/ibm-plex-mono-500.woff2','fonts/ibm-plex-mono-600.woff2'
];
var SHELL_URLS=SHELL.map(function(p){return new URL(p,self.registration.scope).href;});

self.addEventListener('install',function(e){
  e.waitUntil(caches.open(VERSION).then(function(c){return c.addAll(SHELL);}).then(function(){return self.skipWaiting();}));
});
self.addEventListener('activate',function(e){
  e.waitUntil(caches.keys().then(function(keys){
    return Promise.all(keys.filter(function(k){return k!==VERSION;}).map(function(k){return caches.delete(k);}));
  }).then(function(){return self.clients.claim();}));
});
self.addEventListener('fetch',function(e){
  var req=e.request;
  if(req.method!=='GET')return;
  var url=new URL(req.url);
  if(url.origin!==self.location.origin)return;
  url.search='';url.hash='';
  /* opening the app (any navigation inside the scope) gets the cached page */
  var key=req.mode==='navigate'?new URL('index.html',self.registration.scope).href:url.href;
  if(SHELL_URLS.indexOf(key)<0)return; /* not part of the app shell: let the browser handle it, never cache it */
  e.respondWith(caches.open(VERSION).then(function(c){
    return c.match(key).then(function(hit){return hit||fetch(req);});
  }));
});
