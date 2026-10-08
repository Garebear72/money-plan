/* Unit tests for core.js using the fake sample plan. Run: node --test tests/ */
const test=require('node:test'),assert=require('node:assert/strict'),fs=require('fs'),path=require('path');
const C=require('../core.js');
const SAMPLE=fs.readFileSync(path.join(__dirname,'..','sample-plan.json'),'utf8');
const plan=()=>{const r=C.parsePlan(SAMPLE);assert.ok(r.ok,r.errors.join('\n'));return r.plan;};
const D=C.pd;

test('sample plan imports cleanly with no warnings',()=>{
  const r=C.parsePlan(SAMPLE);
  assert.ok(r.ok);assert.deepEqual(r.warnings,[]);
});

test('bill totals per pay period, including rent halves and business-day shifts',()=>{
  const p=plan();
  assert.equal(C.totalBetween(p,'2026-10-07','2026-10-15'),40);    // streaming 10 + store card 30 (paused bill skipped)
  assert.equal(C.totalBetween(p,'2026-10-16','2026-10-29'),665);   // rent half 400 + internet 60 + insurance 80 + loan 125
  assert.equal(C.totalBetween(p,'2026-10-30','2026-11-12'),470);   // rent half 400 + gym 20 + phone 40 + streaming 10
  assert.equal(C.totalBetween(p,'2026-11-13','2026-11-27'),1115);  // Dec rent 820 in halves + 30 + 60 + 80 + 125
});

test('weekend and holiday shifts',()=>{
  const p=plan(),names=(a,b)=>C.billsBetween(p,a,b).map(x=>C.ds(x.date)+' '+x.name);
  assert.ok(names('2026-10-16','2026-10-29').includes('2026-10-19 Internet'));        // Sun 18th → Mon 19th
  assert.ok(names('2026-12-20','2026-12-31').includes('2026-12-28 Personal loan'));   // Fri 25th holiday → Mon 28th
  assert.ok(names('2026-10-07','2026-10-15').every(n=>!n.includes('Music app')));     // paused
});

test('paydays and rent halves on the last two paydays before the due date',()=>{
  const p=plan();
  assert.deepEqual(C.paydays(p,'2026-10-07','2026-11-30').map(C.ds),['2026-10-16','2026-10-30','2026-11-13','2026-11-27']);
  const rent=C.rentOccurrences(p,'2026-10-01','2026-11-30').map(r=>[C.ds(r.date),r.amount,r.name]);
  assert.deepEqual(rent,[['2026-10-16',400,'Rent half for Nov 1'],['2026-10-30',400,'Rent half for Nov 1'],
    ['2026-11-13',410,'Rent half for Dec 1'],['2026-11-27',410,'Rent half for Dec 1']]);
  p.settings.rent.paidInHalvesOnLastTwoPaydaysBeforeDue=false;
  assert.deepEqual(C.rentOccurrences(p,'2026-10-01','2026-11-30').map(r=>[C.ds(r.date),r.amount]),[['2026-10-01',800],['2026-11-01',800]]);
});

test('paycheck amount does not change bill totals',()=>{
  const p=plan();p.settings.paycheck.amount=1;
  assert.equal(C.totalBetween(p,'2026-10-16','2026-10-29'),665);
});

test('partner balance now and after scheduled entries',()=>{
  const d=C.partnerData(plan(),D('2026-10-07'));
  assert.equal(d.bal,285);assert.equal(d.total,385);assert.equal(d.lastScheduled,'2026-11-20');
  assert.equal(d.paid,25);
  const p=plan();p.partnerLedger.push({id:'adj',type:'payment',amount:85,date:'2026-10-07',note:C.ADJUSTMENT,ts:9});
  const a=C.partnerData(p,D('2026-10-07'));
  assert.equal(a.bal,200);assert.equal(a.paid,25);   // a balance correction changes what you owe, not what you've paid
});

test('debts: payments left from the bill end date or from paymentsLeft',()=>{
  const p=plan(),[card,loan]=p.debts;
  let i=C.debtInfo(p,card,D('2026-10-07'));
  assert.equal(i.left,9);assert.equal(C.ds(i.next),'2026-10-15');assert.equal(C.ds(i.last),'2027-06-15');
  i=C.debtInfo(p,loan,D('2026-10-07'));
  assert.equal(i.left,26);assert.equal(C.ds(i.next),'2026-10-26');
  i=C.debtInfo(p,loan,D('2026-10-27'));
  assert.equal(i.left,25);
});

test('week window and spending',()=>{
  const w=C.weekData(plan(),D('2026-10-07'));
  assert.equal(C.ds(w.ws),'2026-10-05');assert.equal(w.spent,42);assert.equal(w.left,98);assert.equal(w.daysLeft,5);
  const p=plan();p.settings.weekStartsOn='sunday';
  assert.equal(C.ds(C.weekData(p,D('2026-10-07')).ws),'2026-10-04');
});

test('export → import → export is identical, and matches the source file',()=>{
  const once=C.exportPlan(plan());
  assert.deepEqual(once,JSON.parse(SAMPLE));
  const again=C.exportPlan(C.parsePlan(JSON.stringify(once)).plan);
  assert.deepEqual(again,once);
});

test('tolerant: unknown fields ignored, optional fields defaulted',()=>{
  const r=C.parsePlan(JSON.stringify({app:'money-plan',version:1,extra:1,settings:{paycheck:{amount:'1,000',knownPayday:'2026-10-02'},whatever:true},bills:[{name:'X',amount:'$5',day:3,kind:'sub',foo:1}]}));
  assert.ok(r.ok,r.errors.join());
  assert.equal(r.plan.settings.paycheck.everyDays,14);
  assert.equal(r.plan.settings.paycheck.amount,1000);
  assert.equal(r.plan.settings.partner.label,'Partner');
  assert.deepEqual(r.plan.debts,[]);
  assert.equal(r.plan.bills[0].amount,5);assert.equal(r.plan.bills[0].kind,'subscription');assert.equal(r.plan.bills[0].active,true);
});

test('friendly, specific errors for bad input',()=>{
  const err=s=>{const r=C.parsePlan(s);assert.equal(r.ok,false);return r.errors.join(' | ');};
  assert.match(err(''),/nothing to import/);
  assert.match(err('hello'),/starts with \{/);
  assert.match(err('[1,2]'),/is a list/);
  assert.match(err('{"app":"money-plan",'),/ends too early/);
  assert.match(err('{"app":"money-plan","settings":{},}'),/comma right before/);
  assert.match(err('{“app”: "money-plan"}'),/curly quotes/);
  assert.match(err('{"app":"budget-thing","settings":{}}'),/not Money Plan/);
  assert.match(err('{"version":2,"settings":{}}'),/newer version/);
  assert.match(err('{"app":"money-plan"}'),/no "settings" section/);
  assert.match(err('{"settings":{"paycheck":{"amount":100}}}'),/"knownPayday" is missing/);
  assert.match(err('{"settings":{"paycheck":{"amount":100,"knownPayday":"2026-02-30"}}}'),/real date/);
  const bad=JSON.parse(SAMPLE);bad.bills[1].amount='lots';bad.bills[2].day=40;bad.partnerLedger[0].type='loan';
  const msg=err(JSON.stringify(bad));
  assert.match(msg,/Bill 2 \("Phone"\): "amount" should be a number like 9\.50, but it is "lots"/);
  assert.match(msg,/Bill 3 \("Streaming service"\): "day" can't be more than 31/);
  assert.match(msg,/Partner log entry 1: "type" should be "charge"/);
});

test('warnings for broken debt links and percent-style APR',()=>{
  const p=JSON.parse(SAMPLE);p.debts[0].billName='Nope';p.debts[1].apr=8;
  const r=C.parsePlan(JSON.stringify(p));
  assert.ok(r.ok);
  assert.match(r.warnings.join(' '),/no bill has that exact name/);
  assert.equal(r.plan.debts[1].apr,0.08);
});

/* ---------- paycheck plan ---------- */
const periods=(p,n=3)=>C.payPeriods(p,D('2026-10-07'),n).map(x=>[C.ds(x.start),x.pay,x.carryIn,x.keepForNext,x.free,x.spending,x.savings,x.short]);
const paid=(p,amount,moved=null)=>{p.paychecks=[{id:'a',date:'2026-10-02',amount,movedToSavings:moved}];return p;};
test('pay periods: bills first, then the rest split between spending and savings',()=>{
  assert.deepEqual(periods(plan(),4),[
    // start, pay, carry-in, held back, yours to split, spend (2 weeks at 140), save, short
    ['2026-10-02',1200,0,0,1100,280,820,0],
    ['2026-10-16',1200,0,0,535,280,255,0],
    ['2026-10-30',1200,0,0,730,280,450,0],
    ['2026-11-13',1200,0,0,495,280,215,0]]);
  const p=C.payPeriods(plan(),D('2026-10-07'),1)[0];
  assert.equal(p.current,true);assert.equal(p.recorded,false);assert.equal(p.spent,42);
});
test('a real paycheck scales spending and savings in proportion, and moves the weekly limit',()=>{
  let p=paid(plan(),1300);
  assert.deepEqual(periods(p)[0],['2026-10-02',1300,0,0,1200,305.45,894.55,0]);
  assert.equal(C.weekData(p,D('2026-10-07')).limit,152.73);
  p=paid(plan(),600);
  assert.deepEqual(periods(p)[0],['2026-10-02',600,0,0,500,127.27,372.73,0]);
  assert.equal(C.weekData(p,D('2026-10-07')).limit,63.64);
  assert.equal(C.weekData(plan(),D('2026-10-07')).limit,140);   // no paycheck entered: the usual target
});
test('what you move to savings sets the spending money: the rest of the paycheck',()=>{
  assert.deepEqual(periods(paid(plan(),1200,400))[0].slice(4,7),[1100,700,400]);
  assert.deepEqual(periods(paid(plan(),1200,0))[0].slice(4,7),[1100,1100,0]);
  assert.deepEqual(periods(paid(plan(),1200,5000))[0].slice(4,7),[1100,0,5000]);   // saved more than was left
});
test('a tight period ahead makes the paycheck before it hold money back',()=>{
  const p=plan();p.settings.paycheck.amount=800;
  assert.deepEqual(periods(p),[
    ['2026-10-02',800,0,185,515,280,235,0],
    ['2026-10-16',800,185,0,320,280,40,0],
    ['2026-10-30',800,0,225,105,65,40,0]]);
  const q=plan();q.settings.paycheck.amount=300;
  assert.deepEqual(periods(q)[1],['2026-10-16',300,200,0,-165,0,0,165]);
});
test('the weekly limit blends the two pay periods a week straddles',()=>{
  const p=plan();p.settings.paycheck.amount=800;
  /* Oct 12-18: 4 days of the Oct 2 period (280/14 a day) and 3 of Oct 16 (280/14) */
  assert.equal(C.weekLimit(p,D('2026-10-12'),D('2026-10-18')),140);
  paid(p,800,375);   /* save 375 of the 515 left: 140 to spend, 10 a day for those 4 days */
  assert.equal(C.weekLimit(p,D('2026-10-12'),D('2026-10-18')),100);
});
test('paychecks round-trip through export, and files without them are unchanged',()=>{
  const p=paid(plan(),1300,50);
  const out=C.exportPlan(p);
  assert.deepEqual(out.paychecks,[{date:'2026-10-02',amount:1300,movedToSavings:50}]);
  assert.deepEqual(C.exportPlan(C.parsePlan(JSON.stringify(out)).plan),out);
  assert.equal('paychecks' in C.exportPlan(plan()),false);
  const bad=JSON.parse(SAMPLE);bad.paychecks=[{date:'2026-10-02',amount:'lots'}];
  assert.match(C.parsePlan(JSON.stringify(bad)).errors.join(' '),/Paycheck 1: "amount" should be a number/);
});

/* ---------- bank CSV ---------- */
const CSV=fs.readFileSync(path.join(__dirname,'fixtures','chase-checking-example.csv'),'utf8');
test('reads a Chase checking CSV, using the purchase date from the description',()=>{
  const r=C.readBankCsv(CSV);
  assert.ok(r.ok);assert.equal(r.txns.length,9);
  const bakery=r.txns.find(t=>/BAKERY/.test(t.desc));
  assert.equal(bakery.date,'2026-10-06');assert.equal(bakery.posted,'2026-10-07');assert.equal(bakery.amount,6);assert.equal(bakery.out,true);
  assert.equal(r.txns.filter(t=>!t.out).length,1);
});
test('reads a card CSV with transaction dates, and rejects files that are not activity exports',()=>{
  const r=C.readBankCsv('Transaction Date,Post Date,Description,Category,Type,Amount,Memo\n10/05/2026,10/06/2026,GAS N GO #1234,Gas,Sale,-35.50,\n10/04/2026,10/05/2026,Payment Thank You-Mobile,,Payment,200.00,\n');
  assert.ok(r.ok);assert.deepEqual(r.txns.filter(t=>t.out).map(t=>[t.date,t.amount,C.cleanMerchant(t.desc)]),[['2026-10-05',35.5,'Gas N Go']]);
  const bad=C.readBankCsv('Name,Value\nx,1\n');
  assert.equal(bad.ok,false);assert.match(bad.errors[0],/needs Date, Description and Amount/);
  assert.equal(C.readBankCsv('').ok,false);
  const dc=C.readBankCsv('Date,Description,Debit,Credit\n2026-10-03,"Shop, The",12.50,\n2026-10-04,Pay,,500\n');
  assert.deepEqual(dc.txns.map(t=>[t.amount,t.out,t.desc]),[[12.5,true,'Shop, The'],[500,false,'Pay']]);
});
test('cleans merchant names',()=>{
  const cases={
    'POS DEBIT CORNER CAFE LLC SPRINGFIELD IL':'Corner Cafe',
    'SQ *MAPLE BAKERY SPRINGFIELD IL 10/06':'Maple Bakery',
    'PAYPAL PURCHASE MUSIC STORE WEB ID: PAYPALSI00':'Music Store',
    'FUEL STOP SPRINGFIELD, IL 10/05':'Fuel Stop',
    'TST* BIG GRILL 555-123-4567 OH 10/01':'Big Grill',
    'AMAZON MKTPL*AB12CD Amzn.com/bill WA':'Amazon',
    'GAS N GO #1234':'Gas N Go'
  };
  for(const [raw,want] of Object.entries(cases))assert.equal(C.cleanMerchant(raw),want,raw);
});
test('bank matching: skips bills, already-logged purchases, transfers and cash',()=>{
  const p=plan(),rows=C.matchBankTxns(p,C.readBankCsv(CSV).txns);
  assert.equal(rows.length,8);
  const by=n=>rows.find(r=>r.note===n);
  assert.equal(by('Corner Cafe').pick,true);assert.equal(by('Corner Cafe').category,'food');
  assert.equal(by('Maple Bakery').category,'food');
  assert.equal(by('Fuel Stop').flag,'logged');
  assert.equal(rows.find(r=>/VERIZON/.test(r.txn.desc)).flag,'bill');
  assert.match(rows.find(r=>/VERIZON/.test(r.txn.desc)).reason,/Bill: Phone/);
  assert.equal(rows.find(r=>/Zelle/.test(r.txn.desc)).flag,'transfer');
  assert.equal(rows.find(r=>/ATM/.test(r.txn.desc)).flag,'cash');
  assert.equal(rows.filter(r=>r.pick).length,4);
  /* once added, the same file finds nothing new */
  rows.filter(r=>r.pick).forEach((r,i)=>p.purchases.push({id:'b'+i,amount:r.txn.amount,note:r.note,category:r.category,date:r.txn.date,ts:i}));
  assert.equal(C.matchBankTxns(p,C.readBankCsv(CSV).txns).filter(r=>r.pick).length,0);
});
test('category guess prefers your own past choice',()=>{
  const p=plan();p.purchases.push({id:'x',amount:3,note:'Corner Cafe',category:'fun',date:'2026-10-01',ts:1});
  assert.equal(C.guessCategory(p,'Corner Cafe','POS DEBIT CORNER CAFE LLC'),'fun');
});
test('quick add lists purchases you repeat',()=>{
  const p=plan();
  for(let i=0;i<3;i++)p.purchases.push({id:'q'+i,amount:4,note:'Corner Cafe',category:'food',date:'2026-10-0'+(i+1),ts:i});
  const f=C.frequentPurchases(p,D('2026-10-07'),6);
  assert.deepEqual(f.map(x=>[x.note,x.amount,x.count]),[['Corner Cafe',4,3]]);
});

/* ---------- every number on a card comes from the same place ---------- */
test('the weekly limit always follows the pay period, whatever the Settings target says',()=>{
  assert.equal(C.weekData(paid(plan(),1200,5000),D('2026-10-07')).limit,0);   // all saved: nothing to spend, though a target is set
  const p=paid(plan(),1200,700);p.settings.weeklyLimit=0;
  assert.equal(C.weekData(p,D('2026-10-07')).limit,200);                     // no target, but 400 left to spend over 2 weeks
  const q=plan();q.settings.weeklyLimit=0;
  assert.equal(C.weekData(q,D('2026-10-07')).limit,0);
});
test('debts count payments made since the balance date, and a paid-off debt has none left',()=>{
  const p=plan(),[card,loan]=p.debts;
  assert.equal(C.debtInfo(p,loan,D('2026-10-27')).made,1);
  const done=C.debtInfo(p,card,D('2027-07-01'));
  assert.equal(done.left,0);assert.equal(done.made,9);
  const l=C.debtInfo(p,loan,D('2027-07-01'));
  assert.equal(l.made,9);assert.equal(l.left,17);
});
test('changing the payday keeps an entered paycheck with its new pay period',()=>{
  const p=paid(plan(),1300,45);
  p.settings.paycheck.knownPayday='2026-10-09';
  p.paychecks=C.alignPaychecks(p);
  assert.deepEqual(p.paychecks.map(r=>[r.date,r.amount,r.movedToSavings]),[['2026-09-25',1300,45]]);
  assert.equal(C.payPeriods(p,D('2026-10-07'),1)[0].recorded,true);
  /* two paychecks that now share one longer period are added together */
  const q=plan();q.paychecks=[{id:'a',date:'2026-10-02',amount:1200,movedToSavings:120},{id:'b',date:'2026-10-16',amount:1250,movedToSavings:null}];
  q.settings.paycheck.everyDays=56;
  assert.deepEqual(C.alignPaychecks(q).map(r=>[r.date,r.amount,r.movedToSavings]),[['2026-10-02',2450,120]]);
});
