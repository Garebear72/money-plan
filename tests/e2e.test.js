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
  assert.match(await txt(page,'#paydayCard'),/Suggested: to savings\s*\$820\.00/);
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
  assert.match(await txt(page,'#set-paycheck [data-errs]'),/Usual take-home per paycheck should be a number/);
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

const CSV=path.join(__dirname,'fixtures','chase-checking-example.csv');
async function loadBank(page,file){
  await page.setInputFiles('#bankFile',file);
  await page.waitForFunction(()=>document.querySelector('#bankResult').textContent.trim()!=='');
}
test('bank CSV import: review, add, undo, and no duplicates on re-import',async()=>{
  const {page,context,errors}=await open(env);
  await importFile(page,SAMPLE);
  await page.click('#bankCard summary');
  await loadBank(page,CSV);
  assert.match(await txt(page,'#bankResult'),/Found 8 payments from Oct 2 to Oct 7\. Left unticked: 1 bill, 1 already logged, 1 transfer, 1 cash withdrawal/);
  assert.equal(await txt(page,'#bankAdd'),'Add 4 purchases ($25.00)');
  /* rename one and untick another before adding */
  const music=page.locator('#bankResult .txn',{hasText:'MUSIC STORE'});
  await music.locator('[data-bank=pick]').uncheck();
  assert.equal(await txt(page,'#bankAdd'),'Add 3 purchases ($14.00)');
  await page.locator('#bankResult .txn',{hasText:'MAPLE BAKERY'}).locator('[data-bank=note]').fill('Bakery treat');
  await page.click('#bankAdd');
  assert.match(await txt(page,'#weekCard'),/\$88\.00/);          // 140 - (42 + 4 + 6); the Oct 2 cafe is last week
  assert.match(await txt(page,'#recent'),/Bakery treat/);
  await page.locator('#toast .toast-btn').click();               // undo
  assert.match(await txt(page,'#weekCard'),/\$98\.00/);
  /* add all four this time, then the same file has nothing new */
  await page.click('#bankCard summary');
  await loadBank(page,CSV);
  await page.click('#bankAdd');
  await page.click('#bankCard summary');
  await loadBank(page,CSV);
  assert.match(await txt(page,'#bankResult'),/1 bill, 5 already logged, 1 transfer, 1 cash withdrawal/);
  assert.equal(await txt(page,'#bankAdd'),'Nothing ticked');
  /* the cafe now appears twice, so it becomes a one-tap button */
  await page.locator('#quick [data-act=quick]',{hasText:'Corner Cafe · $4.00'}).click();
  assert.match(await txt(page,'#weekCard'),/\$73\.00/);           // 140 - (42 + 4 + 6 + 11 + 4)
  await loadBank(page,path.join(__dirname,'..','sample-plan.json'));
  assert.match(await txt(page,'#bankResult'),/doesn't look like a bank activity file/);
  assert.deepEqual(errors,[]);
  await context.close();
});

test('paycheck: enter the real amount, split it, move savings, and limits follow',async()=>{
  const {page,context,dialogs}=await open(env);
  await importFile(page,SAMPLE);
  /* Today nudges you to enter the paycheck */
  assert.match(await txt(page,'#payBanner'),/Payday Fri Oct 2\./);
  assert.match(await txt(page,'#weekCard'),/spent of \$140\.00/);
  await page.click('#payBanner [data-act=goto-pay]');
  assert.ok(await page.locator('#tab-bills').isVisible());
  const card=()=>txt(page,'#payCard');
  assert.match(await card(),/Paycheck \(expected\)\s*\+\$1,200\.00/);
  assert.match(await card(),/Yours to split\s*\$1,100\.00[\s\S]*Suggested: to spend \(\$140\.00 a week\)\s*\$280\.00[\s\S]*Suggested: to savings\s*\$820\.00/);
  /* a bigger check: both buckets grow */
  await page.fill('#payAmt','1300');await page.click('[data-act=pay-save]');
  assert.match(await card(),/Paycheck Edit\s*\+\$1,300\.00/);
  assert.match(await card(),/Yours to split\s*\$1,200\.00/);
  assert.equal(await txt(page,'#spendVal'),'$305.45');assert.equal(await txt(page,'#saveVal'),'$894.55');
  await tab(page,'today');
  assert.equal(await page.locator('#payBanner').innerText(),'');
  assert.match(await txt(page,'#weekCard'),/spent of \$152\.73[\s\S]*follows your paychecks/);
  /* slide to a custom split and save it */
  await tab(page,'bills');
  await page.locator('#splitRange').evaluate(el=>{el.value='40000';el.dispatchEvent(new Event('input',{bubbles:true}));});
  assert.equal(await txt(page,'#spendVal'),'$400.00');assert.equal(await txt(page,'#saveVal'),'$800.00');
  await page.click('[data-act=split-save]');
  assert.match(await card(),/You chose this split/);
  await tab(page,'today');
  assert.match(await txt(page,'#weekCard'),/spent of \$200\.00/);
  /* the savings button really adds to the savings balance */
  await tab(page,'bills');
  await page.click('[data-act=moved]');
  assert.match(await card(),/Moved \$800\.00 to savings\./);
  assert.match(await txt(page,'#accountsCard'),/Savings on Oct 7\s*\$1,200\.00/);
  await page.locator('#toast .toast-btn').click();   // undo
  assert.match(await txt(page,'#accountsCard'),/\$400\.00/);
  assert.match(await card(),/I moved \$800\.00 to savings/);
  /* back to suggested, then remove the paycheck entirely */
  await page.click('[data-act=split-reset]');
  assert.equal(await txt(page,'#spendVal'),'$305.45');
  await page.click('[data-act=pay-edit]');await page.click('[data-act=pay-clear]');
  assert.match(await card(),/Paycheck \(expected\)/);
  /* exported files carry the paycheck */
  await page.fill('#payAmt','1250');await page.click('[data-act=pay-save]');
  await tab(page,'settings');
  const [d]=await Promise.all([page.waitForEvent('download'),page.click('#set-data [data-act=export]')]);
  assert.deepEqual(JSON.parse(fs.readFileSync(await d.path(),'utf8')).paychecks,[{date:'2026-10-02',amount:1250}]);
  assert.deepEqual(dialogs,[]);
  await context.close();
});
