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
  assert.match(await txt(page,'#weekCard'),/\$495\.50/);
  await tab(page,'bills');
  assert.match(await txt(page,'#payCard'),/Paycheck \(expected\)\s*\+\$1,200\.00[\s\S]*Paid Partner\s*−\$25\.00[\s\S]*To spend · \$537\.50 a week\s*\$1,075\.00/);
  assert.match(await txt(page,'#billsList'),/Payday[\s\S]*\+\$1,200\.00/);
  for(const gone of ['#billsSummary','#nextUp','#timeline','#weekly','#cmin'])assert.equal(await page.locator(gone).count(),0,gone);
  await tab(page,'debts');
  assert.match(await txt(page,'#debtSummary'),/\$155\.00/);
  await tab(page,'partner');
  assert.match(await txt(page,'#parCard'),/You owe Partner\s*\$285\.00\s*At \$25\.00 a month, that's paid off in about 12 months[\s\S]*Plus \$100\.00 scheduled by Nov 20, making \$385\.00/i);
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
  await saveSection(page,'set-general',{warnBelow:5000});
  await tab(page,'today');
  assert.match(await txt(page,'#cashWarn'),/below your \$5,000\.00 warning line/);
  await tab(page,'bills');
  assert.match(await txt(page,'#accountsCard'),/Could drop below your \$5,000\.00 warning line/);
  await tab(page,'debts');
  assert.match(await txt(page,'#debtSummary'),/Sam is separate/);
  await tab(page,'partner');
  assert.match(await txt(page,'#parCard'),/You owe Sam/i);
  /* a bad value is rejected in the page with a readable message */
  await tab(page,'settings');
  await saveSection(page,'set-paycheck',{'paycheck.everyDays':'abc'});
  assert.match(await txt(page,'#set-paycheck [data-errs]'),/Paid every \(days\) should be a number/);
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
  assert.match(await txt(page,'#weekCard'),/\$475\.50/);
  assert.match(await txt(page,'#recent'),/Fun · /);
  /* pause a bill */
  await tab(page,'settings');
  await page.locator('#set-bills li',{hasText:'Streaming service'}).locator('[data-act=pause]').click();
  await tab(page,'bills');
  assert.doesNotMatch(await txt(page,'#billsList'),/Streaming service/);
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
  /* the payoff estimate follows the new balance, and a correction isn't counted as money paid */
  assert.match(await txt(page,'#parCard'),/that's paid off in about 20 months[\s\S]*making \$600\.00[\s\S]*You've paid Partner \$75\.00 so far/);
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
  assert.match(await txt(page,'#weekCard'),/\$495\.50/);
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
  assert.match(await txt(page,'#weekCard'),/\$485\.50/);        // 495.50 - (4 + 6); the Oct 2 cafe is last week
  assert.match(await txt(page,'#recent'),/Bakery treat/);
  await page.locator('#toast .toast-btn').click();               // undo
  assert.match(await txt(page,'#weekCard'),/\$495\.50/);
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
  assert.match(await txt(page,'#weekCard'),/\$470\.50/);          // 537.50 - (42 + 4 + 6 + 11 + 4)
  await loadBank(page,path.join(__dirname,'..','sample-plan.json'));
  assert.match(await txt(page,'#bankResult'),/doesn't look like a bank activity file/);
  assert.deepEqual(errors,[]);
  await context.close();
});

test('paycheck: enter what you got paid; savings moves and payments come out; the rest is spending',async()=>{
  const {page,context,dialogs,errors}=await open(env);
  await importFile(page,SAMPLE);
  assert.match(await txt(page,'#payBanner'),/Payday Fri Oct 2\. Enter your paycheck\./);
  assert.match(await txt(page,'#weekCard'),/Estimated from your last paycheck/);
  await page.click('#payBanner [data-act=goto-pay]');
  assert.ok(await page.locator('#tab-bills').isVisible());
  const sum=()=>txt(page,'#paySummary');
  /* typing the paycheck updates the preview before saving */
  await page.fill('#payAmt','1300');
  assert.match(await sum(),/Paycheck\s*\+\$1,300\.00[\s\S]*Paid Partner\s*−\$25\.00[\s\S]*To spend · \$587\.50 a week\s*\$1,175\.00/);
  await page.click('[data-act=pay-save]');
  assert.equal(await page.locator('#payAmt').count(),0);
  assert.match(await sum(),/Paycheck Edit\s*\+\$1,300\.00[\s\S]*Spent so far\s*\$42\.00\s*Left to spend\s*\$1,133\.00/);
  assert.match(await txt(page,'#payCard'),/expected \$1,300\.00, the same as your last paycheck/);
  /* moving money to savings: the balance goes up and this paycheck's spending money goes down */
  await page.fill('#sAmt','300');await page.click('#sIn');
  assert.match(await txt(page,'#savCard'),/\$700\.00[\s\S]*plus 1 move since then/);
  assert.match(await sum(),/Moved to savings\s*−\$300\.00[\s\S]*To spend · \$437\.50 a week\s*\$875\.00/);
  await tab(page,'today');
  assert.equal(await page.locator('#payBanner').innerText(),'');
  assert.match(await txt(page,'#weekCard'),/spent of \$437\.50/);
  assert.doesNotMatch(await txt(page,'#weekCard'),/Estimated/);
  await tab(page,'bills');
  await page.locator('#toast .toast-btn').click();   // undo the savings move
  assert.match(await txt(page,'#savCard'),/\$400\.00/);
  /* taking money out puts it back into spending money */
  await page.fill('#sAmt','45');await page.click('#sOut');
  assert.match(await txt(page,'#savCard'),/\$355\.00/);
  assert.match(await sum(),/Taken from savings\s*\+\$45\.00[\s\S]*To spend · \$610\.00 a week\s*\$1,220\.00/);
  /* the chart shows where this paycheck went, with spending by category */
  const hist=page.locator('#historyCard details').first();
  await hist.locator('summary').click();
  assert.match(await hist.innerText(),/Oct 2 · now\s*\+\$1,345\.00[\s\S]*Bills\s*\$100\.00[\s\S]*Paid Partner\s*\$25\.00[\s\S]*Spent\s*\$42\.00[\s\S]*Gas\s*\$30\.00[\s\S]*Food\s*\$12\.00[\s\S]*Not spent yet\s*\$1,178\.00/);
  /* exported files carry the paycheck, the savings move, and the paycheck as the new expected amount */
  await tab(page,'settings');
  const [d]=await Promise.all([page.waitForEvent('download'),page.click('#set-data [data-act=export]')]);
  const out=JSON.parse(fs.readFileSync(await d.path(),'utf8'));
  assert.deepEqual(out.paychecks,[{date:'2026-10-02',amount:1300}]);
  assert.deepEqual(out.savingsLog,[{type:'withdrawal',amount:45,date:'2026-10-07',note:''}]);
  assert.equal(out.settings.paycheck.amount,1300);
  assert.equal('weeklyLimit' in out.settings,false);
  assert.deepEqual(dialogs,[]);assert.deepEqual(errors,[]);
  await context.close();
});

test('every line on a card agrees with its headline',async()=>{
  let {page,context,errors}=await open(env);
  await importFile(page,SAMPLE);
  /* all of this paycheck's spare money moved to savings: there's no spending money this week */
  await page.click('#payBanner [data-act=goto-pay]');
  await page.fill('#payAmt','1200');await page.click('[data-act=pay-save]');
  await page.fill('#sAmt','1150');await page.click('#sIn');
  assert.match(await txt(page,'#paySummary'),/You moved or paid \$75\.00 more than this paycheck had left after bills/);
  await tab(page,'today');
  assert.match(await txt(page,'#weekCard'),/Over by[\s\S]*\$42\.00[\s\S]*No spending money this week/i);
  /* changing the payday keeps the paycheck you entered */
  await tab(page,'settings');
  await saveSection(page,'set-paycheck',{'paycheck.knownPayday':'2026-10-09'});
  await tab(page,'bills');
  assert.match(await txt(page,'#payCard'),/Paycheck Edit\s*\+\$1,200\.00/);
  assert.match(await txt(page,'#savCard'),/\$1,550\.00/);
  assert.equal(await page.locator('#payBanner').innerText(),'');
  /* with no warning line, the forecast is checked against $0 and the words match the colour */
  await tab(page,'settings');
  await saveSection(page,'set-general',{warnBelow:0});
  await saveSection(page,'set-accounts',{'checking.balance':-650});
  await tab(page,'bills');
  assert.match(await txt(page,'#accountsCard'),/Could drop below \$0\./);
  assert.equal(await page.locator('#accountsCard .status.bad').count(),1);
  await tab(page,'today');
  assert.match(await txt(page,'#cashWarn'),/below \$0\. See Bills/);
  assert.deepEqual(errors,[]);
  await context.close();

  /* months later: a debt whose payments are all made shows no leftover balance */
  ({page,context,errors}=await open(env,{time:'2027-07-01T12:00:00'}));
  await importFile(page,SAMPLE);
  await tab(page,'debts');
  const card=await txt(page,'#debtCards .card:has-text("Store card")');
  assert.match(card,/Paid off[\s\S]*Balance\s*\$0\.00/i);
  assert.equal(await page.locator('#debtCards .card:has-text("Store card") .kv',{hasText:/Paid off/i}).count(),0);   // only the pill says it
  assert.match(await txt(page,'#debtCards .card:has-text("Personal loan")'),/17 payments left[\s\S]*Balance on Oct 1\s*\$3,000\.00\s*9 payments of \$125\.00 have gone out since then/i);
  assert.deepEqual(errors,[]);
  await context.close();
});
