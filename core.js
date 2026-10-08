/* Money Plan core: plan validation, normalisation, export and all schedule maths.
   Pure functions, no DOM and no storage, so the same code runs in the page and in Node tests. */
(function(root,factory){
  if(typeof module==='object'&&module.exports)module.exports=factory();
  else root.MoneyPlanCore=factory();
})(typeof self!=='undefined'?self:this,function(){
'use strict';

var APP='money-plan',VERSION=1;
var KINDS=['subscription','debt','insurance','other'];
var KIND_ALIASES={sub:'subscription',subscriptions:'subscription',streaming:'subscription',ins:'insurance',loan:'debt'};
var WEEKDAYS=['sunday','monday','tuesday','wednesday','thursday','friday','saturday'];

/* ---------- dates and numbers ---------- */
var pad=function(n){return String(n).padStart(2,'0');};
var ds=function(d){return d.getFullYear()+'-'+pad(d.getMonth()+1)+'-'+pad(d.getDate());};
var pd=function(s){var p=String(s).split('-').map(Number);return new Date(p[0],p[1]-1,p[2]||1);};
var sod=function(d){return new Date(d.getFullYear(),d.getMonth(),d.getDate());};
var addDays=function(d,n){return new Date(d.getFullYear(),d.getMonth(),d.getDate()+n);};
var dayDiff=function(a,b){return Math.round((sod(b)-sod(a))/86400000);};
var round2=function(n){return Math.round(n*100)/100;};
var monthKey=function(d){return d.getFullYear()+'-'+pad(d.getMonth()+1);};
var lastDay=function(y,m){return new Date(y,m+1,0).getDate();};
var toDate=function(v){return v instanceof Date?sod(v):pd(v);};
function isDateStr(s){return typeof s==='string'&&/^\d{4}-\d{2}-\d{2}$/.test(s)&&ds(pd(s))===s;}
function isMonthStr(s){return typeof s==='string'&&/^\d{4}-(0[1-9]|1[0-2])$/.test(s);}
function uid(){return Date.now().toString(36)+Math.random().toString(36).slice(2,8);}
function clone(o){return JSON.parse(JSON.stringify(o));}
function isObj(v){return v!==null&&typeof v==='object'&&!Array.isArray(v);}
function describe(v){
  if(v===undefined)return 'missing';
  var s=JSON.stringify(v);
  if(s&&s.length>40)s=s.slice(0,37)+'…';
  return s;
}

/* ---------- field readers: tolerant, with plain-language errors ---------- */
function Ctx(){this.errors=[];this.warnings=[];}
function blank(v){return v===undefined||v===null||(typeof v==='string'&&v.trim()==='');}

function readNum(ctx,obj,key,where,o){
  var raw=obj[key],v=raw;
  if(blank(v)){
    if(o.required){ctx.errors.push(where+': "'+key+'" is missing. '+(o.hint||'It should be a number'+(o.example?' like '+o.example:'')+'.'));return undefined;}
    return o.def;
  }
  if(typeof v==='string'){var s=v.replace(/[$,\s]/g,'');if(s!==''&&isFinite(Number(s)))v=Number(s);}
  if(typeof v!=='number'||!isFinite(v)){
    ctx.errors.push(where+': "'+key+'" should be a number'+(o.example?' like '+o.example:'')+', but it is '+describe(raw)+'.');return undefined;
  }
  if(o.int&&Math.round(v)!==v){ctx.errors.push(where+': "'+key+'" should be a whole number, but it is '+describe(raw)+'.');return undefined;}
  if(o.positive&&v<=0){ctx.errors.push(where+': "'+key+'" must be more than 0, but it is '+describe(raw)+'.');return undefined;}
  if(o.min!=null&&v<o.min){ctx.errors.push(where+': "'+key+'" can\'t be '+(o.min===0?'negative':'less than '+o.min)+', but it is '+describe(raw)+'.');return undefined;}
  if(o.max!=null&&v>o.max){ctx.errors.push(where+': "'+key+'" can\'t be more than '+o.max+', but it is '+describe(raw)+'.');return undefined;}
  return o.money?round2(v):v;
}
function readStr(ctx,obj,key,where,o){
  var v=obj[key];
  if(blank(v)){
    if(o.required){ctx.errors.push(where+': "'+key+'" is missing. '+(o.hint||'It should be some text.'));return undefined;}
    return o.def;
  }
  if(typeof v==='number')v=String(v);
  if(typeof v!=='string'){ctx.errors.push(where+': "'+key+'" should be text in quotes, but it is '+describe(v)+'.');return undefined;}
  v=v.trim();
  if(o.max&&v.length>o.max)v=v.slice(0,o.max);
  return v;
}
function readDate(ctx,obj,key,where,o){
  var v=obj[key];
  if(blank(v)){
    if(o.required){ctx.errors.push(where+': "'+key+'" is missing. It should be a date written as YYYY-MM-DD, for example "2026-10-16".');return undefined;}
    return o.def===undefined?null:o.def;
  }
  if(typeof v==='string')v=v.trim();
  if(!isDateStr(v)){ctx.errors.push(where+': "'+key+'" should be a real date written as YYYY-MM-DD (for example "2026-10-16"), but it is '+describe(obj[key])+'.');return undefined;}
  return v;
}
function readMonthish(ctx,obj,key,where){
  /* "2029-08" or a full date; used for projected payoff dates */
  var v=obj[key];
  if(blank(v))return null;
  if(typeof v==='string')v=v.trim();
  if(isMonthStr(v)||isDateStr(v))return v;
  ctx.errors.push(where+': "'+key+'" should be a month like "2029-08" or a date like "2029-08-11", but it is '+describe(obj[key])+'.');
  return undefined;
}
function readBool(ctx,obj,key,where,def){
  var v=obj[key];
  if(blank(v))return def;
  if(v===true||v==='true'||v===1||v==='yes'||v==='on')return true;
  if(v===false||v==='false'||v===0||v==='no'||v==='off')return false;
  ctx.errors.push(where+': "'+key+'" should be true or false, but it is '+describe(v)+'.');
  return def;
}
function asObj(ctx,v,where,required){
  if(v===undefined||v===null){if(required)ctx.errors.push(where+' is missing.');return {};}
  if(!isObj(v)){ctx.errors.push(where+' should be a group of fields in { curly braces }, but it is '+describe(v)+'.');return {};}
  return v;
}
function asArr(ctx,v,where){
  if(v===undefined||v===null)return [];
  if(!Array.isArray(v)){ctx.errors.push('"'+where+'" should be a list in [ square brackets ], but it is '+describe(v)+'.');return [];}
  return v;
}
function keepId(v){return typeof v==='string'&&v.length>0&&v.length<40?v:uid();}

/* ---------- record normalisers (shared by import and the edit forms) ---------- */
function normExtra(ctx,e,where){
  e=asObj(ctx,e,where,true);
  return {
    dueMonth:(function(){
      var v=e.dueMonth;
      if(typeof v==='string'&&isDateStr(v.trim()))return v.trim().slice(0,7);
      if(typeof v==='string'&&isMonthStr(v.trim()))return v.trim();
      ctx.errors.push(where+': "dueMonth" should be the month the rent is due, like "2026-11", but it is '+describe(v)+'.');
      return undefined;
    })(),
    amount:readNum(ctx,e,'amount',where,{required:true,money:true,example:'50'}),
    note:readStr(ctx,e,'note',where,{def:'',max:120})
  };
}
function normSettings(ctx,s){
  var W='settings';
  s=asObj(ctx,s,'The "settings" section',true);
  var pay=asObj(ctx,s.paycheck,'settings.paycheck',true);
  var rent=asObj(ctx,s.rent,'settings.rent',false);
  var chk=asObj(ctx,s.checking,'settings.checking',false);
  var sav=asObj(ctx,s.savings,'settings.savings',false);
  var par=asObj(ctx,s.partner,'settings.partner',false);
  var wso=s.weekStartsOn==null?'monday':String(s.weekStartsOn).trim().toLowerCase();
  var wIdx=WEEKDAYS.findIndex(function(d){return d===wso||d.slice(0,3)===wso;});
  if(wIdx<0){ctx.errors.push(W+': "weekStartsOn" should be a day name like "monday" or "sunday", but it is '+describe(s.weekStartsOn)+'.');wIdx=1;}
  var hol=asArr(ctx,s.holidays,'settings.holidays').map(function(h,i){
    return readDate(ctx,{h:h},'h','settings.holidays item '+(i+1),{required:true});
  }).filter(Boolean);
  hol=hol.filter(function(h,i){return hol.indexOf(h)===i;}).sort();
  return {
    weeklyLimit:readNum(ctx,s,'weeklyLimit',W,{def:0,min:0,money:true,example:'175'}),
    weekStartsOn:WEEKDAYS[wIdx],
    warnBelow:readNum(ctx,s,'warnBelow',W,{def:0,money:true,example:'100'}),
    paycheck:{
      amount:readNum(ctx,pay,'amount','settings.paycheck',{required:true,min:0,money:true,example:'1200',hint:'Add your take-home pay per paycheck, for example "amount": 1200.'}),
      knownPayday:readDate(ctx,pay,'knownPayday','settings.paycheck',{required:true}),
      everyDays:readNum(ctx,pay,'everyDays','settings.paycheck',{def:14,int:true,min:1,max:62,example:'14'})
    },
    savingsPerPayday:readNum(ctx,s,'savingsPerPayday',W,{def:0,min:0,money:true,example:'50'}),
    rent:{
      amount:readNum(ctx,rent,'amount','settings.rent',{def:0,min:0,money:true,example:'800'}),
      dueDay:readNum(ctx,rent,'dueDay','settings.rent',{def:1,int:true,min:1,max:31,example:'1'}),
      paidInHalvesOnLastTwoPaydaysBeforeDue:readBool(ctx,rent,'paidInHalvesOnLastTwoPaydaysBeforeDue','settings.rent',true),
      extras:asArr(ctx,rent.extras,'settings.rent.extras').map(function(e,i){return normExtra(ctx,e,'Rent extra '+(i+1));})
    },
    checking:{
      balance:readNum(ctx,chk,'balance','settings.checking',{def:0,money:true,example:'1000'}),
      asOf:readDate(ctx,chk,'asOf','settings.checking',{})
    },
    savings:{
      balance:readNum(ctx,sav,'balance','settings.savings',{def:0,money:true,example:'400'}),
      asOf:readDate(ctx,sav,'asOf','settings.savings',{})
    },
    partner:{
      label:readStr(ctx,par,'label','settings.partner',{def:'Partner',max:30})||'Partner',
      monthlyPayment:readNum(ctx,par,'monthlyPayment','settings.partner',{def:0,min:0,money:true,example:'25'})
    },
    holidays:hol
  };
}
function normBill(ctx,b,where){
  b=asObj(ctx,b,where,true);
  var kind=b.kind==null||b.kind===''?'other':String(b.kind).trim().toLowerCase();
  kind=KIND_ALIASES[kind]||kind;
  if(KINDS.indexOf(kind)<0){ctx.warnings.push(where+': kind '+describe(b.kind)+' isn\'t one of '+KINDS.join(', ')+', so it was set to "other".');kind='other';}
  return {
    id:keepId(b.id),
    name:readStr(ctx,b,'name',where,{required:true,max:60,hint:'Give the bill a name, for example "Phone".'}),
    amount:readNum(ctx,b,'amount',where,{required:true,min:0,money:true,example:'9.50'}),
    day:readNum(ctx,b,'day',where,{required:true,int:true,min:1,max:31,example:'15',hint:'It should be the day of the month the bill is paid, from 1 to 31.'}),
    end:readDate(ctx,b,'end',where,{}),
    kind:kind,
    shiftToBusinessDay:readBool(ctx,b,'shiftToBusinessDay',where,false),
    active:readBool(ctx,b,'active',where,true)
  };
}
function normDebt(ctx,d,where){
  d=asObj(ctx,d,where,true);
  var apr=readNum(ctx,d,'apr',where,{def:null,min:0,example:'0.2 for 20%'});
  if(apr!=null&&apr>1){ctx.warnings.push(where+': "apr" of '+apr+' looks like a percentage, so it was read as '+apr+'% ('+round2(apr/100*1e4)/1e4+').');apr=apr/100;}
  return {
    id:keepId(d.id),
    name:readStr(ctx,d,'name',where,{required:true,max:60,hint:'Give the debt a name.'}),
    billName:readStr(ctx,d,'billName',where,{def:null,max:60}),
    balance:readNum(ctx,d,'balance',where,{def:0,min:0,money:true,example:'1500'}),
    balanceAsOf:readDate(ctx,d,'balanceAsOf',where,{}),
    paymentsLeft:readNum(ctx,d,'paymentsLeft',where,{def:null,int:true,min:0,example:'12'}),
    apr:apr,
    projectedPayoff:readMonthish(ctx,d,'projectedPayoff',where),
    projectedPayoffWithExtra:readMonthish(ctx,d,'projectedPayoffWithExtra',where),
    note:readStr(ctx,d,'note',where,{def:'',max:300})
  };
}
function normLedger(ctx,e,where){
  e=asObj(ctx,e,where,true);
  var type=e.type==null?'':String(e.type).trim().toLowerCase();
  if(type!=='charge'&&type!=='payment'){ctx.errors.push(where+': "type" should be "charge" (they covered something for you) or "payment" (you paid them back), but it is '+describe(e.type)+'.');type=undefined;}
  return {
    id:keepId(e.id),
    type:type,
    amount:readNum(ctx,e,'amount',where,{required:true,positive:true,money:true,example:'50'}),
    date:readDate(ctx,e,'date',where,{required:true}),
    note:readStr(ctx,e,'note',where,{def:'',max:120}),
    ts:typeof e.ts==='number'?e.ts:0
  };
}
function normPurchase(ctx,p,where){
  p=asObj(ctx,p,where,true);
  var cat=readStr(ctx,p,'category',where,{def:'other',max:30});
  return {
    id:keepId(p.id),
    amount:readNum(ctx,p,'amount',where,{required:true,positive:true,money:true,example:'12.50'}),
    note:readStr(ctx,p,'note',where,{def:'',max:60}),
    category:(cat||'other').toLowerCase(),
    date:readDate(ctx,p,'date',where,{required:true}),
    ts:typeof p.ts==='number'?p.ts:0
  };
}
function nameOf(x){return isObj(x)&&typeof x.name==='string'&&x.name.trim()?' ("'+x.name.trim().slice(0,30)+'")':'';}

/* ---------- whole-plan parse / normalise ---------- */
function jsonErrorMessage(text,e){
  var msg=String(e&&e.message||''),pos=null,m;
  if((m=/position (\d+)/.exec(msg)))pos=Number(m[1]);
  var line=null,col=null;
  if((m=/line (\d+) column (\d+)/.exec(msg))){line=Number(m[1]);col=Number(m[2]);}
  else if(pos!=null){var before=text.slice(0,pos).split('\n');line=before.length;col=before[before.length-1].length+1;}
  var out='This isn\'t valid JSON, so nothing was imported.';
  if(line!=null){
    var src=(text.split('\n')[line-1]||'').trim();
    if(src.length>70)src=src.slice(0,67)+'…';
    out+=' The problem is on line '+line+', around character '+col+(src?': '+src:'')+'.';
  }
  var hints=[];
  if(/[“”‘’]/.test(text))hints.push('It contains curly quotes (“ ” or ‘ ’). Some apps change straight quotes into curly ones; JSON needs plain " quotes.');
  if(/,\s*[}\]]/.test(text))hints.push('There is a comma right before a closing } or ]. JSON doesn\'t allow a comma after the last item.');
  var opens=(text.match(/[{[]/g)||[]).length,closes=(text.match(/[}\]]/g)||[]).length;
  if(/Unexpected end|end of JSON|Unterminated/i.test(msg)||opens>closes)hints.push('The text ends too early, so part of the file is probably missing. Make sure you copied all of it, down to the final }.');
  if(/'[^'\n]*'\s*:/.test(text))hints.push('Names and text must use double quotes ("name"), not single quotes.');
  return out+(hints.length?' '+hints.join(' '):'');
}
function fail(errors,warnings){return {ok:false,errors:errors,warnings:warnings||[]};}

function parsePlan(input){
  if(typeof input!=='string')return normalizePlan(input);
  var t=input.replace(/^﻿/,'').trim();
  if(!t)return fail(['There\'s nothing to import yet. Choose your plan file, or paste its contents into the box.']);
  if(t[0]==='[')return fail(['This is a list ([ … ]), but a plan file is one object that starts with { and contains "settings", "bills" and so on.']);
  if(t[0]!=='{')return fail(['This doesn\'t look like a Money Plan file. A plan file starts with { . Make sure you copied the whole file, starting from the first {.']);
  var obj;
  try{obj=JSON.parse(t);}catch(e){return fail([jsonErrorMessage(t,e)]);}
  return normalizePlan(obj);
}

function normalizePlan(obj){
  var ctx=new Ctx();
  if(!isObj(obj))return fail(['A plan file must be one object in { curly braces }.']);
  if(obj.app!==undefined&&obj.app!==APP)return fail(['This file is for '+describe(obj.app)+', not Money Plan ("app" should be "money-plan").']);
  if(obj.app===undefined)ctx.warnings.push('The file has no "app": "money-plan" line. It was read as a Money Plan file anyway.');
  if(obj.version!==undefined){
    var v=Number(obj.version);
    if(!isFinite(v))return fail(['"version" should be 1, but it is '+describe(obj.version)+'.']);
    if(v>VERSION)return fail(['This file was made by a newer version of Money Plan (version '+v+'). This app reads version '+VERSION+'. Reload the app to update it, then try again.']);
  }
  if(obj.settings===undefined)return fail(['The file has no "settings" section, so there\'s no paycheck to plan around. Add a "settings" section with at least "paycheck": { "amount": …, "knownPayday": "YYYY-MM-DD" }.']);

  var settings=normSettings(ctx,obj.settings);
  var bills=asArr(ctx,obj.bills,'bills').map(function(b,i){return normBill(ctx,b,'Bill '+(i+1)+nameOf(b));});
  var debts=asArr(ctx,obj.debts,'debts').map(function(d,i){return normDebt(ctx,d,'Debt '+(i+1)+nameOf(d));});
  var ledger=asArr(ctx,obj.partnerLedger,'partnerLedger').map(function(e,i){return normLedger(ctx,e,(settings.partner.label||'Partner')+' log entry '+(i+1));});
  var purchases=asArr(ctx,obj.purchases,'purchases').map(function(p,i){return normPurchase(ctx,p,'Purchase '+(i+1));});
  if(obj.bills===undefined)ctx.warnings.push('The file has no "bills" list, so it starts with no bills.');

  var seen={};
  bills.forEach(function(b){if(b.name){var k=b.name.toLowerCase();if(seen[k])ctx.warnings.push('Two bills are both called "'+b.name+'". Debts link to bills by name, so give them different names.');seen[k]=1;}});
  debts.forEach(function(d){
    if(d.billName&&!bills.some(function(b){return b.name===d.billName;}))
      ctx.warnings.push('Debt "'+d.name+'" points to a bill named "'+d.billName+'", but no bill has that exact name, so its payments can\'t be counted.');
  });
  /* give every log entry a stable order key */
  var t0=Date.now();
  ledger.forEach(function(e,i){if(!e.ts)e.ts=t0+i;});
  purchases.forEach(function(p,i){if(!p.ts)p.ts=t0+i;});

  if(ctx.errors.length){
    var errs=ctx.errors.slice(0,12);
    if(ctx.errors.length>12)errs.push('…and '+(ctx.errors.length-12)+' more problems.');
    return fail(errs,ctx.warnings);
  }
  return {ok:true,errors:[],warnings:ctx.warnings,plan:{app:APP,version:VERSION,settings:settings,bills:bills,debts:debts,partnerLedger:ledger,purchases:purchases}};
}

/* Same field order and optional-field rules as the documented format, so export → import → export is identical. */
function exportPlan(plan){
  var s=plan.settings;
  var sortLog=function(a,b){return (a.date<b.date?-1:a.date>b.date?1:0)||(a.ts-b.ts);};
  return {
    app:APP,version:VERSION,
    settings:{
      weeklyLimit:s.weeklyLimit,weekStartsOn:s.weekStartsOn,warnBelow:s.warnBelow,
      paycheck:{amount:s.paycheck.amount,knownPayday:s.paycheck.knownPayday,everyDays:s.paycheck.everyDays},
      savingsPerPayday:s.savingsPerPayday,
      rent:{amount:s.rent.amount,dueDay:s.rent.dueDay,paidInHalvesOnLastTwoPaydaysBeforeDue:s.rent.paidInHalvesOnLastTwoPaydaysBeforeDue,
        extras:s.rent.extras.map(function(e){return {dueMonth:e.dueMonth,amount:e.amount,note:e.note};})},
      checking:{balance:s.checking.balance,asOf:s.checking.asOf},
      savings:{balance:s.savings.balance,asOf:s.savings.asOf},
      partner:{label:s.partner.label,monthlyPayment:s.partner.monthlyPayment},
      holidays:s.holidays.slice()
    },
    bills:plan.bills.map(function(b){
      var o={name:b.name,amount:b.amount,day:b.day,end:b.end,kind:b.kind};
      if(b.shiftToBusinessDay)o.shiftToBusinessDay=true;
      o.active=b.active;return o;
    }),
    debts:plan.debts.map(function(d){
      var o={name:d.name,billName:d.billName,balance:d.balance,balanceAsOf:d.balanceAsOf,paymentsLeft:d.paymentsLeft,apr:d.apr};
      if(d.projectedPayoff)o.projectedPayoff=d.projectedPayoff;
      if(d.projectedPayoffWithExtra)o.projectedPayoffWithExtra=d.projectedPayoffWithExtra;
      o.note=d.note;return o;
    }),
    partnerLedger:plan.partnerLedger.slice().sort(sortLog).map(function(e){return {type:e.type,amount:e.amount,date:e.date,note:e.note};}),
    purchases:plan.purchases.slice().sort(sortLog).map(function(p){return {amount:p.amount,note:p.note,category:p.category,date:p.date};})
  };
}

/* ---------- schedule ---------- */
function holidaySet(plan){var h={};plan.settings.holidays.forEach(function(x){h[x]=1;});return h;}
function shiftBiz(d,hol){var x=d;while(x.getDay()===0||x.getDay()===6||hol[ds(x)])x=addDays(x,1);return x;}

function paydays(plan,from,to){
  var p=plan.settings.paycheck,a=pd(p.knownPayday),step=p.everyDays,out=[];
  from=toDate(from);to=toDate(to);
  for(var k=Math.ceil(dayDiff(a,from)/step);;k++){var d=addDays(a,k*step);if(d>to)break;out.push(d);}
  return out;
}

function billOccurrences(plan,bill,from,to,hol){
  from=toDate(from);to=toDate(to);hol=hol||holidaySet(plan);
  var out=[],end=bill.end?pd(bill.end):null;
  if(!bill.active)return out;
  /* start a month early so a date shifted forward across a month boundary is not missed */
  for(var y=from.getFullYear(),m=from.getMonth()-1;;m++){
    var first=new Date(y,m,1);
    if(first>to)break;
    var d=new Date(first.getFullYear(),first.getMonth(),Math.min(bill.day,lastDay(first.getFullYear(),first.getMonth())));
    if(bill.shiftToBusinessDay)d=shiftBiz(d,hol);
    if(end&&d>end)break;
    if(d<from||d>to)continue;
    out.push({date:d,name:bill.name,amount:bill.amount,kind:bill.kind,note:'',billId:bill.id});
  }
  return out;
}

function rentOccurrences(plan,from,to){
  from=toDate(from);to=toDate(to);
  var r=plan.settings.rent,out=[];
  if(!(r.amount>0)&&!r.extras.length)return out;
  var fMon=new Intl.DateTimeFormat('en-US',{month:'short'});
  for(var y=from.getFullYear(),m=from.getMonth();;m++){
    var mStart=new Date(y,m,1);
    var due=new Date(mStart.getFullYear(),mStart.getMonth(),Math.min(r.dueDay,lastDay(mStart.getFullYear(),mStart.getMonth())));
    if(addDays(due,-31)>to)break;
    var key=monthKey(due),extra=0,notes=[];
    r.extras.forEach(function(e){if(e.dueMonth===key){extra+=e.amount;if(e.note)notes.push(e.note);}});
    var total=round2(r.amount+extra);
    if(total<=0)continue;
    var dueLabel=fMon.format(due)+' '+due.getDate();
    var pays=r.paidInHalvesOnLastTwoPaydaysBeforeDue?paydays(plan,addDays(due,-30),addDays(due,-1)).slice(-2):[];
    if(!pays.length){
      if(due>=from&&due<=to)out.push({date:due,name:'Rent for '+dueLabel,amount:total,kind:'rent',note:extra?'Includes '+money(extra)+' extra'+(notes.length?': '+notes.join('; '):''):''});
      continue;
    }
    var share=round2(total/pays.length),last=round2(total-share*(pays.length-1));
    pays.forEach(function(p,i){
      if(p<from||p>to)return;
      var amt=i===pays.length-1?last:share;
      out.push({date:p,name:(pays.length===2?'Rent half for ':'Rent for ')+dueLabel,amount:amt,kind:'rent',
        note:extra?'Includes '+money(extra/pays.length)+' extra'+(notes.length?': '+notes.join('; '):''):''});
    });
  }
  return out;
}

function billsBetween(plan,from,to){
  from=toDate(from);to=toDate(to);
  var hol=holidaySet(plan),out=[];
  plan.bills.forEach(function(b){out=out.concat(billOccurrences(plan,b,from,to,hol));});
  out=out.concat(rentOccurrences(plan,from,to));
  out.sort(function(a,b){return (a.date-b.date)||(b.amount-a.amount);});
  return out;
}
function totalBetween(plan,from,to){
  return round2(billsBetween(plan,from,to).reduce(function(s,b){return s+b.amount;},0));
}

/* ---------- spending ---------- */
function weekWindow(plan,today){
  var t=sod(today),start=WEEKDAYS.indexOf(plan.settings.weekStartsOn);
  if(start<0)start=1;
  var ws=addDays(t,-((t.getDay()-start+7)%7));
  return {ws:ws,we:addDays(ws,6)};
}
function weekData(plan,today){
  var t=sod(today),w=weekWindow(plan,t),a=ds(w.ws),b=ds(w.we),t0=ds(t),spent=0,todaySpent=0;
  plan.purchases.forEach(function(p){
    if(p.date>=a&&p.date<=b)spent+=p.amount;
    if(p.date===t0)todaySpent+=p.amount;
  });
  spent=round2(spent);
  return {ws:w.ws,we:w.we,spent:spent,today:round2(todaySpent),limit:plan.settings.weeklyLimit,
    left:round2(plan.settings.weeklyLimit-spent),daysLeft:dayDiff(t,w.we)+1};
}

/* ---------- partner ---------- */
function partnerData(plan,today){
  var t0=ds(sod(today)),bal=0,sched=0,charged=0,paid=0,lastSched=null;
  plan.partnerLedger.forEach(function(e){
    var sign=e.type==='payment'?-1:1,future=e.date>t0;
    if(future){sched+=sign*e.amount;if(!lastSched||e.date>lastSched)lastSched=e.date;}else bal+=sign*e.amount;
    if(e.type==='payment'){if(!future)paid+=e.amount;}else charged+=e.amount;
  });
  return {bal:round2(bal),sched:round2(sched),total:round2(bal+sched),paid:round2(paid),charged:round2(charged),lastScheduled:lastSched};
}
function monthsToRepay(total,per,today){
  var n=Math.ceil(total/per-1e-9),t=sod(today);
  return {n:n,end:new Date(t.getFullYear(),t.getMonth()+n,1)};
}

/* ---------- debts ---------- */
function findBill(plan,name){
  if(!name)return null;
  for(var i=0;i<plan.bills.length;i++)if(plan.bills[i].name===name)return plan.bills[i];
  return null;
}
function debtInfo(plan,debt,today){
  var t=sod(today),bill=findBill(plan,debt.billName),hol=holidaySet(plan);
  var info={debt:debt,bill:bill,left:debt.paymentsLeft,next:null,last:null,monthly:0,paused:false,linked:!!bill};
  if(!bill)return info;
  if(!bill.active){info.paused=true;return info;}
  var occ;
  if(bill.end){
    occ=billOccurrences(plan,bill,t,pd(bill.end),hol);
    info.left=occ.length;
  }else if(debt.paymentsLeft!=null){
    var since=debt.balanceAsOf?pd(debt.balanceAsOf):t;
    var made=since<t?billOccurrences(plan,bill,since,addDays(t,-1),hol).length:0;
    info.left=Math.max(0,debt.paymentsLeft-made);
    occ=info.left?billOccurrences(plan,bill,t,new Date(t.getFullYear(),t.getMonth()+info.left+2,1),hol).slice(0,info.left):[];
  }else{
    occ=billOccurrences(plan,bill,t,new Date(t.getFullYear(),t.getMonth()+2,1),hol).slice(0,1);
    info.left=null;
  }
  info.next=occ.length?occ[0].date:null;
  info.last=info.left!=null&&occ.length?occ[occ.length-1].date:null;
  info.monthly=info.left===0?0:bill.amount;
  return info;
}

/* ---------- checking projection ---------- */
function cashProjection(plan,today,days){
  var s=plan.settings;
  if(!s.checking.asOf)return null;
  var t=sod(today),start=pd(s.checking.asOf),end=addDays(t,days);
  if(start>end)return null;
  var ev={},add=function(d,a){var k=ds(d);ev[k]=(ev[k]||0)+a;};
  var from=addDays(start,1);
  paydays(plan,from,end).forEach(function(d){add(d,s.paycheck.amount-s.savingsPerPayday);});
  billsBetween(plan,from,end).forEach(function(b){add(b.date,-b.amount);});
  plan.purchases.forEach(function(p){if(p.date>s.checking.asOf&&p.date<=ds(end))add(pd(p.date),-p.amount);});
  var bal=s.checking.balance,now=null,low=null,lowDate=null;
  if(start>=t){now=bal;low=bal;lowDate=start;}
  for(var d=from;d<=end;d=addDays(d,1)){
    bal+=ev[ds(d)]||0;
    if(d<t)continue;
    if(now===null)now=bal;
    if(low===null||bal<low-1e-9){low=bal;lowDate=d;}
  }
  if(now===null){now=bal;low=bal;lowDate=t;}
  return {now:round2(now),low:round2(low),lowDate:lowDate,end:round2(bal),days:days};
}

/* ---------- per-paycheck plan ---------- */
/* Splits time into pay periods (payday up to the day before the next one) and budgets each paycheck:
   bills and rent due in the period, the savings move, and planned spending at the weekly limit. */
function payPeriods(plan,today,count){
  var s=plan.settings,t=sod(today),step=s.paycheck.everyDays,out=[];
  var start=paydays(plan,addDays(t,-step+1),t)[0];
  var spending=round2(s.weeklyLimit*step/7);
  for(var i=0;i<count;i++){
    var st=addDays(start,i*step),en=addDays(st,step-1),a=ds(st),b=ds(en);
    var bills=billsBetween(plan,st,en).filter(function(x){return x.amount>0;});
    var billTotal=round2(bills.reduce(function(sum,x){return sum+x.amount;},0));
    var spent=round2(plan.purchases.reduce(function(sum,p){return p.date>=a&&p.date<=b?sum+p.amount:sum;},0));
    out.push({start:st,end:en,pay:s.paycheck.amount,bills:bills,billTotal:billTotal,savings:s.savingsPerPayday,
      spending:spending,spent:spent,current:st<=t&&t<=en,
      left:round2(s.paycheck.amount-billTotal-s.savingsPerPayday-spending),keepForNext:0,carryIn:0});
  }
  /* if the next period comes up short, suggest holding back some of this one's surplus */
  for(i=0;i<out.length;i++){
    var p=out[i],avail=round2(p.left+p.carryIn);
    if(i+1<out.length&&out[i+1].left<0&&avail>0){
      p.keepForNext=round2(Math.min(avail,-out[i+1].left));
      out[i+1].carryIn=p.keepForNext;
    }
    p.afterCarry=round2(p.left+p.carryIn);
  }
  return out;
}

/* ---------- bank CSV import ---------- */
function parseCSV(text){
  var rows=[],row=[],f='',q=false,i=0,c;
  text=String(text).replace(/^﻿/,'');
  for(;i<text.length;i++){
    c=text[i];
    if(q){
      if(c==='"'){if(text[i+1]==='"'){f+='"';i++;}else q=false;}
      else f+=c;
    }else if(c==='"')q=true;
    else if(c===','){row.push(f);f='';}
    else if(c==='\n'||c==='\r'){
      if(c==='\r'&&text[i+1]==='\n')i++;
      row.push(f);f='';
      if(row.some(function(x){return x.trim()!=='';}))rows.push(row);
      row=[];
    }else f+=c;
  }
  row.push(f);
  if(row.some(function(x){return x.trim()!=='';}))rows.push(row);
  return rows;
}
function csvDate(s){
  s=String(s||'').trim();var m;
  if((m=/^(\d{4})-(\d{1,2})-(\d{1,2})/.exec(s)))return new Date(+m[1],m[2]-1,+m[3]);
  if((m=/^(\d{1,2})\/(\d{1,2})\/(\d{2,4})$/.exec(s))){var y=+m[3];if(y<100)y+=2000;return new Date(y,m[1]-1,+m[2]);}
  return null;
}
function csvAmount(s){
  s=String(s||'').trim();if(!s)return null;
  var neg=/^\(.*\)$/.test(s)||/^-/.test(s)||/-$/.test(s);
  var n=parseFloat(s.replace(/[()$,\s-]/g,''));
  return isFinite(n)?(neg?-n:n):null;
}
/* Reads Chase checking or card activity CSVs, and most other banks' that have date, description and amount (or debit/credit) columns. */
function readBankCsv(text){
  var rows=parseCSV(text);
  if(!rows.length)return {ok:false,errors:['The file is empty.']};
  var head=rows[0].map(function(h){return h.trim().toLowerCase();});
  var col=function(names){for(var i=0;i<names.length;i++){var k=head.indexOf(names[i]);if(k>=0)return k;}return -1;};
  var iDate=col(['transaction date','trans. date','trans date','date','posting date','post date','posted date']);
  var iDesc=col(['description','payee','merchant','name','details','memo']);
  if(head[iDesc]==='details'&&col(['description'])>=0)iDesc=col(['description']);
  var iAmt=col(['amount']),iDebit=col(['debit','withdrawal','withdrawals','debit amount']),iCredit=col(['credit','deposit','deposits','credit amount']);
  var iType=col(['type']);
  if(iDate<0||iDesc<0||(iAmt<0&&iDebit<0)){
    return {ok:false,errors:['This doesn\'t look like a bank activity file. It needs Date, Description and Amount columns, but the first row has: '+rows[0].slice(0,8).map(function(h){return '"'+h.trim()+'"';}).join(', ')+'. On chase.com, download your account activity as a CSV file (not a PDF statement).']};
  }
  var txns=[],bad=0;
  rows.slice(1).forEach(function(r){
    var posted=csvDate(r[iDate]),desc=String(r[iDesc]||'').replace(/\s+/g,' ').trim(),amt;
    if(iAmt>=0)amt=csvAmount(r[iAmt]);
    else{var d=csvAmount(r[iDebit]),cr=csvAmount(r[iCredit]);amt=d?-Math.abs(d):cr?Math.abs(cr):null;}
    if(!posted||!desc||amt==null||amt===0){bad++;return;}
    /* card purchases often carry the real purchase date in the description, e.g. "... OH 10/06" */
    var date=posted,m=/(?:^|\s)(\d{2})\/(\d{2})(?:\s|$)/.exec(desc);
    if(m){
      var cand=new Date(posted.getFullYear(),m[1]-1,+m[2]);
      if(cand>posted)cand=new Date(posted.getFullYear()-1,m[1]-1,+m[2]);
      var gap=dayDiff(cand,posted);if(gap>=0&&gap<=10)date=cand;
    }
    txns.push({date:ds(date),posted:ds(posted),desc:desc,amount:round2(Math.abs(amt)),out:amt<0,type:iType>=0?String(r[iType]||'').trim():''});
  });
  if(!txns.length)return {ok:false,errors:['No transactions could be read from this file'+(bad?' ('+bad+' rows had a missing date, description or amount).':'.')]};
  return {ok:true,txns:txns,skippedRows:bad};
}

var STATES='AL AK AZ AR CA CO CT DE FL GA HI ID IL IN IA KS KY LA ME MD MA MI MN MS MO MT NE NV NH NJ NM NY NC ND OH OK OR PA RI SC SD TN TX UT VT VA WA WV WI WY DC'.split(' ');
function titleCase(s){return s.toLowerCase().replace(/(^|[\s\-\/&])([a-z])/g,function(m,a,b){return a+b.toUpperCase();});}
/* "POS DEBIT CORNER CAFE LLC SPRINGFIELD IL 10/05" -> "Corner Cafe" */
function cleanMerchant(desc){
  var s=' '+String(desc).toUpperCase().replace(/\s+/g,' ')+' ';
  if(/AMAZON|AMZN/.test(s))return 'Amazon';
  s=s.replace(/ (WEB ID|PPD ID|ID):.*$/,' ')
     .replace(/^ (POS DEBIT|POS PURCHASE|DEBIT CARD PURCHASE|CARD PURCHASE|PURCHASE AUTHORIZED ON \d\d\/\d\d|RECURRING CARD PURCHASE|PAYPAL PURCHASE|PAYPAL \*|CHECKCARD \d*) /,' ')
     .replace(/^ [A-Z]{2,5} ?\*/,' ')
     .replace(/ \d{1,2}\/\d{1,2}(\/\d{2,4})? /g,' ')
     .replace(/ [\d\-().]{7,} /g,' ')
     .replace(/ #?\d{3,}\S* /g,' ');
  var cut=/ (LLC|INC|CORP|CO|LTD)\b/.exec(s);
  if(cut)s=s.slice(0,cut.index);
  else{
    var comma=s.indexOf(',')>0;
    if(comma)s=s.slice(0,s.indexOf(','));
    var w=s.trim().split(' ');
    /* "SHOP NAME CITY, ST" or "SHOP NAME CITY ST": drop the state, then the city word */
    if(comma){if(w.length>=3)w.pop();}
    else if(w.length>=2&&STATES.indexOf(w[w.length-1])>=0){w.pop();if(w.length>=3)w.pop();}
    s=w.join(' ');
  }
  s=s.replace(/[*#]+/g,' ').replace(/\s+/g,' ').trim();
  return s?titleCase(s).slice(0,60):titleCase(String(desc).trim()).slice(0,60);
}
var CAT_RULES=[
  ['food',/CAFE|COFFEE|STARBUCKS|DUNKIN|RESTAURANT|PIZZA|GRILL|DINER|MCDONALD|TACO|SUBWAY|WENDY|BURGER|CHIPOTLE|KITCHEN|BAKERY|HOMEMADE|DELI|DOORDASH|GRUBHUB|UBER ?EATS|CHICK|DOMINO|SONIC|ARBY|PANERA|BAR & |TAVERN|DONUT/],
  ['gas',/SHELL|SPEEDWAY|MARATHON|SUNOCO|EXXON|MOBIL|CIRCLE K|CHEVRON|\bBP\b|CITGO|VALERO|FUEL|GAS ?STATION|SHEETZ|WAWA/],
  ['groceries',/KROGER|MEIJER|ALDI|GROCERY|MARKET|FOOD ?LION|PUBLIX|SAFEWAY|WHOLE FOODS|TRADER JOE|SAVE A LOT|WALMART|COSTCO|SAM'?S CLUB/],
  ['shopping',/AMAZON|AMZN|TARGET|EBAY|ETSY|BEST ?BUY|DOLLAR|WALGREENS|CVS|HOME DEPOT|LOWE'?S/],
  ['fun',/STEAM|PLAYSTATION|NINTENDO|GAMES?\b|CINEMA|THEATER|THEATRE|SPOTIFY|TWITCH|AMC /],
  ['tobacco',/TOBACCO|SMOKE|VAPE|CIGAR/]
];
function guessCategory(plan,note,desc){
  var n=String(note||'').toLowerCase(),best=null;
  plan.purchases.forEach(function(p){if(p.note&&p.note.toLowerCase()===n&&(!best||p.date>=best.date))best=p;});
  if(best)return best.category;
  var d=' '+String(desc||note).toUpperCase()+' ';
  for(var i=0;i<CAT_RULES.length;i++)if(CAT_RULES[i][1].test(d))return CAT_RULES[i][0];
  return 'other';
}
var GENERIC=/^(the|and|bill|payment|plan|premium|debt|management|insurance|credit|card|pass|service|car|loan|half|rent|for)$/i;
/* For each money-out transaction: a suggested purchase, plus a reason to leave it unticked
   (it's a bill, it's already logged, it's a transfer or a cash withdrawal). */
function matchBankTxns(plan,txns){
  var used={},out=[];
  var outs=txns.filter(function(x){return x.out;}).sort(function(a,b){return a.date<b.date?1:a.date>b.date?-1:0;});
  var purchases=plan.purchases.slice();
  outs.forEach(function(x){
    var d=pd(x.date),desc=' '+x.desc.toUpperCase()+' ',flag=null,reason='';
    var near=billsBetween(plan,addDays(d,-4),addDays(d,4));
    var bill=near.filter(function(b){return Math.abs(b.amount-x.amount)<0.005;})[0];
    if(!bill)bill=near.filter(function(b){
      var words=b.name.split(/[^A-Za-z]+/).filter(function(w){return w.length>=4&&!GENERIC.test(w);});
      return words.some(function(w){return desc.indexOf(' '+w.toUpperCase())>=0;})&&Math.abs(b.amount-x.amount)<=b.amount*0.25;
    })[0];
    if(bill){flag='bill';reason='Bill: '+bill.name;}
    if(!flag){
      var best=-1,bestGap=99;
      purchases.forEach(function(p,i){
        if(used[i]||Math.abs(p.amount-x.amount)>=0.005)return;
        var g=Math.abs(dayDiff(pd(p.date),d));
        if(g<=3&&g<bestGap){best=i;bestGap=g;}
      });
      if(best>=0){used[best]=1;flag='logged';reason='Already logged'+(purchases[best].note?': '+purchases[best].note:'');}
    }
    if(!flag&&/ATM|CASH WITHDRAWAL|WITHDRAWAL CASH/.test(desc)){flag='cash';reason='Cash withdrawal';}
    if(!flag&&(/ZELLE|TRANSFER|XFER|VENMO|CASH APP|PAYMENT THANK YOU|ONLINE PAYMENT|AUTOPAY|E-PAYMENT|EPAY/.test(desc)||/TRANSFER|XFER|LOAN_PMT/i.test(x.type))){flag='transfer';reason='Transfer or payment';}
    var note=cleanMerchant(x.desc);
    out.push({txn:x,note:note,category:guessCategory(plan,note,x.desc),flag:flag,reason:reason,pick:!flag});
  });
  return out;
}

/* ---------- quick-add repeats ---------- */
function frequentPurchases(plan,today,max){
  var since=ds(addDays(sod(today),-90)),g={};
  plan.purchases.forEach(function(p){
    if(p.date<since)return;
    var k=(p.note||'').toLowerCase()+'|'+p.category+'|'+p.amount.toFixed(2);
    var e=g[k]||(g[k]={note:p.note,category:p.category,amount:p.amount,count:0,last:''});
    e.count++;if(p.date>e.last)e.last=p.date;
  });
  return Object.keys(g).map(function(k){return g[k];}).filter(function(e){return e.count>=2;})
    .sort(function(a,b){return (b.count-a.count)||(a.last<b.last?1:-1);}).slice(0,max||6);
}

var fmtMoney=new Intl.NumberFormat('en-US',{style:'currency',currency:'USD'});
function money(n){return fmtMoney.format(round2(n));}

return {
  APP:APP,VERSION:VERSION,KINDS:KINDS,WEEKDAYS:WEEKDAYS,
  ds:ds,pd:pd,sod:sod,addDays:addDays,dayDiff:dayDiff,round2:round2,isDateStr:isDateStr,isMonthStr:isMonthStr,uid:uid,clone:clone,money:money,
  Ctx:Ctx,parsePlan:parsePlan,normalizePlan:normalizePlan,exportPlan:exportPlan,
  normSettings:normSettings,normBill:normBill,normDebt:normDebt,normLedger:normLedger,normPurchase:normPurchase,normExtra:normExtra,
  paydays:paydays,billOccurrences:billOccurrences,rentOccurrences:rentOccurrences,billsBetween:billsBetween,totalBetween:totalBetween,
  weekWindow:weekWindow,weekData:weekData,partnerData:partnerData,monthsToRepay:monthsToRepay,findBill:findBill,debtInfo:debtInfo,cashProjection:cashProjection,
  payPeriods:payPeriods,parseCSV:parseCSV,readBankCsv:readBankCsv,cleanMerchant:cleanMerchant,guessCategory:guessCategory,
  matchBankTxns:matchBankTxns,frequentPurchases:frequentPurchases
};
});
