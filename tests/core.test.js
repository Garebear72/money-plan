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
