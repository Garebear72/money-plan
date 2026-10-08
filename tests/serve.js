/* Minimal static server for tests. Serves the repo under /money-plan/ to mimic GitHub Pages.
   Refuses to serve anything gitignored as private, so tests can't depend on real data being public. */
const http=require('http'),fs=require('fs'),path=require('path');
const ROOT=path.resolve(__dirname,'..'),BASE='/money-plan/';
const TYPES={'.html':'text/html; charset=utf-8','.js':'text/javascript','.css':'text/css','.json':'application/json',
  '.webmanifest':'application/manifest+json','.png':'image/png','.woff2':'font/woff2','.txt':'text/plain'};
const BLOCK=/(^|\/)(private\/|my_plan|money_plan\.html|\.git\/)/;
function start(port=0){
  const server=http.createServer((req,res)=>{
    const u=new URL(req.url,'http://x');
    if(!u.pathname.startsWith(BASE)){res.writeHead(404);return res.end('not found');}
    let rel=decodeURIComponent(u.pathname.slice(BASE.length))||'index.html';
    if(rel.endsWith('/'))rel+='index.html';
    const file=path.resolve(ROOT,rel);
    if(!file.startsWith(ROOT)||BLOCK.test(rel)){res.writeHead(403);return res.end('forbidden');}
    fs.readFile(file,(err,buf)=>{
      if(err){res.writeHead(404);return res.end('not found');}
      res.writeHead(200,{'Content-Type':TYPES[path.extname(file)]||'application/octet-stream','Cache-Control':'no-cache'});
      res.end(buf);
    });
  });
  return new Promise(r=>server.listen(port,'127.0.0.1',()=>r({server,url:`http://127.0.0.1:${server.address().port}${BASE}`})));
}
module.exports={start};
if(require.main===module)start(Number(process.argv[2])||8080).then(s=>console.log('Serving at '+s.url));
