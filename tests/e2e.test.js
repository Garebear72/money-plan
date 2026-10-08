/* Browser tests with the fake sample plan.
   Run: npm install && npx playwright install chromium && npm test */
const test=require('node:test'),assert=require('node:assert/strict'),fs=require('fs'),path=require('path');
const {setup,open,importFile,tab,txt,saveSection}=require('./helpers');
const SAMPLE=path.join(__dirname,'..','sample-plan.json');
let env;
test.before(async()=>{env=await setup();});
test.after(async()=>{await env.close();});

test('first run shows only the import screen, with no numbers',async()=>{
  const {page,context}=await open(env);
  assert.ok(await page.locator('#tab-welcome').isVisible());
  assert.ok(await page.locator('.nav').isHidden());
  for(const t of ['today','bills','debts','partner','settings'])assert.ok(await page.locator('#tab-'+t).isHidden());
  assert.doesNotMatch(await page.locator('body').innerText(),/\$\s?\d/);
  assert.match(await txt(page,'#sync'),/No plan yet/);
  await context.close();
});

test('bad input shows specific errors and imports nothing',async()=>{
  const {page,context,dialogs}=await open(env);
  const check=async(text,re)=>{
    await page.fill('#impText',text);await page.click('#impValidate');
    assert.match(await txt(page,'#impResult'),re);
    assert.equal(await page.locator('[data-act=import]').count(),0);
  };
  await check('{"app":"money-plan","settings":{',/ends too early/);
  await check('{"app":"money-plan","settings":{},}',/comma right before/);
  await check('not json',/starts with \{/);
  const bad=JSON.parse(fs.readFileSync(SAMPLE,'utf8'));bad.bills[0].amount='twenty';
  await check(JSON.stringify(bad),/Bill 1 \("Gym"\): "amount" should be a number/);
  assert.ok(await page.locator('#tab-welcome').isVisible());
  assert.equal(await page.evaluate(()=>localStorage.getItem('money-plan:data:v1')),null);
  assert.deepEqual(dialogs,[]);
  await context.close();
});

test('import via file picker; every tab shows the expected numbers',async()=>{
  const {page,context,errors}=await open(env);
  await page.setInputFiles('#impFile',SAMPLE);
  assert.match(await txt(page,'#impResult'),/Bills: 8 \(7 active\)/);
  await page.click('[data-act=import]');
  assert.match(await txt(page,'#weekCard'),/\$98\.00/);
  await tab(page,'bills');
  assert.match(await txt(page,'#billsSummary'),/\$10\.00[\s\S]*\$1,165\.00/);
  assert.match(await txt(page,'#paydayCard'),/Move \$40\.00 to savings/);
  await tab(page,'debts');
  assert.match(await txt(page,'#debtSummary'),/\$155\.00/);
  await tab(page,'partner');
  assert.match(await txt(page,'#parCard'),/You owe Partner[\s\S]*\$285\.00[\s\S]*\$385\.00\s*after Nov 20/i);
  await page.reload();
  assert.ok(await page.locator('#tab-partner').isVisible(),'data and tab survive a reload');
  assert.deepEqual(errors,[]);
  await context.close();
});

test('editing settings updates every tab',async()=>{
  const {page,context}=await open(env);
  await importFile(page,SAMPLE);
  await tab(page,'settings');
  await saveSection(page,'set-partner',{'partner.label':'Sam'});
  assert.equal(await txt(page,'#partnerTab'),'Sam');
  await saveSection(page,'set-general',{weeklyLimit:200});
  await saveSection(page,'set-paycheck',{'paycheck.amount':1500});
  await tab(page,'today');
  assert.match(await txt(page,'#weekCard'),/\$158\.00/);
  await tab(page,'bills');
  assert.match(await txt(page,'#billsList'),/\+\$1,500\.00/);
  assert.match(await txt(page,'#billsSummary'),/\$10\.00/);
  await tab(page,'debts');
  assert.match(await txt(page,'#debtSummary'),/Sam is separate/);
  await tab(page,'partner');
  assert.match(await txt(page,'#parCard'),/You owe Sam/i);
  /* a bad value is rejected in the page with a readable message */
  await tab(page,'settings');
  await saveSection(page,'set-paycheck',{'paycheck.amount':'abc'});
  assert.match(await txt(page,'#set-paycheck [data-errs]'),/Take-home per paycheck should be a number/);
  await context.close();
});

test('purchases, bills, debts and the partner log are editable',async()=>{
  const {page,context,dialogs}=await open(env);
  await importFile(page,SAMPLE);
  /* edit a purchase */
  await page.locator('#recent li',{hasText:'Fuel'}).locator('[data-act=edit]').click();
  await page.locator('#recent .editor [data-f=amount]').fill('50');
  await page.locator('#recent .editor [data-f=category]').selectOption('fun');
  await page.locator('#recent .editor [data-act=save-rec]').click();
  assert.match(await txt(page,'#weekCard'),/\$78\.00/);
  assert.match(await txt(page,'#recent'),/Fun · /);
  /* pause a bill */
  await tab(page,'settings');
  await page.locator('#set-bills li',{hasText:'Streaming service'}).locator('[data-act=pause]').click();
  await tab(page,'bills');
  assert.match(await txt(page,'#billsSummary'),/^Coming due\s*\$0\.00/i);
  /* add a bill, then delete it with the two-tap confirm */
  await tab(page,'settings');
  await page.click('[data-act=add-rec][data-kind=bill]');
  const ed=page.locator('#set-bills .editor');
  await ed.locator('[data-f=name]').fill('Test bill');await ed.locator('[data-f=amount]').fill('7');await ed.locator('[data-f=day]').fill('8');
  await ed.locator('[data-act=save-rec]').click();
  assert.match(await txt(page,'#set-bills'),/Test bill/);
  await page.locator('#set-bills li',{hasText:'Test bill'}).locator('[data-act=edit]').click();
  await page.locator('#set-bills .editor [data-act=del]').click();
  await page.locator('#set-bills .editor [data-act=del]').click();
  assert.doesNotMatch(await txt(page,'#set-bills'),/Test bill/);
  /* edit a debt from the Debts tab */
  await tab(page,'debts');
  await page.locator('#debtCards .card',{hasText:'Personal loan'}).locator('[data-act=goto-edit]').click();
  await page.locator('#set-debts .editor [data-f=balance]').fill('2500');
  await page.locator('#set-debts .editor [data-f=aprPct]').fill('7.5');
  await page.locator('#set-debts .editor [data-act=save-rec]').click();
  await tab(page,'debts');
  assert.match(await txt(page,'#debtCards'),/\$2,500\.00[\s\S]*7\.5%/);
  /* partner: edit an entry, then set an exact balance */
  await tab(page,'partner');
  await page.locator('#parLog li',{hasText:'first payment back'}).locator('[data-act=edit]').click();
  await page.locator('#parLog .editor [data-f=amount]').fill('75');
  await page.locator('#parLog .editor [data-act=save-rec]').click();
  assert.match(await txt(page,'#parCard'),/\$235\.00/);
  await page.click('#setBalSummary');
  await page.fill('#setBal','500');await page.click('#saveSetBal');
  assert.match(await txt(page,'#parCard'),/\$500\.00/);
  assert.match(await txt(page,'#parLog'),/Balance adjustment[\s\S]*\+\$265\.00/);
  assert.deepEqual(dialogs,[]);
  await context.close();
});

test('export then re-import round-trips exactly; reset and replace use in-page confirmations',async()=>{
  const {page,context,dialogs}=await open(env);
  await importFile(page,SAMPLE);
  await tab(page,'settings');
  const exp=async()=>{const [d]=await Promise.all([page.waitForEvent('download'),page.click('#set-data [data-act=export]')]);return fs.readFileSync(await d.path(),'utf8');};
  const first=await exp();
  assert.deepEqual(JSON.parse(first),JSON.parse(fs.readFileSync(SAMPLE,'utf8')));
  /* replace-all shows an in-page confirmation */
  await page.setInputFiles('#impFile',SAMPLE);
  await page.click('[data-act=import]');
  assert.match(await txt(page,'#impResult'),/Replace everything\?/);
  await page.click('[data-act=import-cancel]');
  /* reset */
  await page.click('[data-act=reset]');
  assert.match(await txt(page,'#resetConfirm'),/Delete everything on this device\?/);
  await page.click('[data-act=confirm-reset]');
  assert.ok(await page.locator('#tab-welcome').isVisible());
  assert.equal(await page.evaluate(()=>localStorage.getItem('money-plan:data:v1')),null);
  /* re-import the exported file by pasting it */
  await page.fill('#impText',first);await page.click('#impValidate');await page.click('[data-act=import]');
  await tab(page,'settings');
  assert.equal(await exp(),first);
  assert.deepEqual(dialogs,[]);
  await context.close();
});

test('works offline after the first load and makes no outside requests',async()=>{
  const {page,context,requests}=await open(env);
  await importFile(page,SAMPLE);
  await page.evaluate(()=>navigator.serviceWorker.ready);
  await page.waitForFunction(()=>!!navigator.serviceWorker.controller);
  await context.setOffline(true);
  await page.reload();
  assert.match(await txt(page,'#weekCard'),/\$98\.00/);
  assert.equal(await page.evaluate(()=>document.fonts.check('16px "Instrument Sans"')),true);
  const origin=new URL(env.url).origin;
  assert.deepEqual(requests.filter(u=>!u.startsWith(origin)&&!u.startsWith('blob:')&&!u.startsWith('data:')),[]);
  await context.close();
});
