/* Shared Playwright helpers. The clock is pinned so date-based numbers are stable. */
const {chromium}=require('playwright');
const {start}=require('./serve');

async function setup(){
  const srv=await start();
  const browser=await chromium.launch(process.env.PW_CHANNEL?{channel:process.env.PW_CHANNEL}:{});
  return {srv,browser,url:srv.url,async close(){await browser.close();srv.server.close();}};
}
async function open(env,{time='2026-10-07T12:00:00'}={}){
  const context=await env.browser.newContext({acceptDownloads:true,viewport:{width:390,height:844}});
  const page=await context.newPage();
  const requests=[],dialogs=[],errors=[];
  context.on('request',r=>requests.push(r.url()));
  page.on('dialog',d=>{dialogs.push(d.message());d.dismiss();});
  page.on('pageerror',e=>errors.push(e.message));
  await page.clock.setFixedTime(new Date(time));
  await page.goto(env.url);
  return {context,page,requests,dialogs,errors};
}
async function importFile(page,file){
  await page.setInputFiles('#impFile',file);
  await page.locator('[data-act=import]').click();
  if(await page.locator('[data-act=import-go]').count())await page.locator('[data-act=import-go]').click();
  await page.locator('#tab-today').waitFor({state:'visible'});
}
const tab=(page,name)=>page.locator('.nav [data-tab='+name+']').click();
const txt=(page,sel)=>page.locator(sel).innerText();
async function saveSection(page,sec,fields){
  for(const [k,v] of Object.entries(fields))await page.locator('#'+sec+' [data-f="'+k+'"]').fill(String(v));
  await page.locator('#'+sec+' [data-act=save-sec]').click();
}
module.exports={setup,open,importFile,tab,txt,saveSection};
