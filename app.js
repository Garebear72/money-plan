/* Money Plan UI. All data lives in this device's localStorage; nothing is ever sent anywhere. */
(function(){
'use strict';
var C=window.MoneyPlanCore;
var $=function(s){return document.querySelector(s);};
var money=C.money,ds=C.ds,pd=C.pd,sod=C.sod,addDays=C.addDays,dayDiff=C.dayDiff,round2=C.round2;
var esc=function(s){return String(s==null?'':s).replace(/[&<>"']/g,function(c){return {'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c];});};
var fWeekday=new Intl.DateTimeFormat('en-US',{weekday:'short'});
var fMD=new Intl.DateTimeFormat('en-US',{month:'short',day:'numeric'});
var fMDY=new Intl.DateTimeFormat('en-US',{month:'short',day:'numeric',year:'numeric'});
var fMY=new Intl.DateTimeFormat('en-US',{month:'short',year:'numeric'});
var fFull=new Intl.DateTimeFormat('en-US',{weekday:'long',month:'long',day:'numeric'});
var wd=function(d){return fWeekday.format(d)+' '+fMD.format(d);};
var cap=function(s){return s.charAt(0).toUpperCase()+s.slice(1);};
var ordinal=function(n){var s=['th','st','nd','rd'],v=n%100;return n+(s[(v-20)%10]||s[v]||s[0]);};
var isObj=function(v){return v!==null&&typeof v==='object'&&!Array.isArray(v);};
var plural=function(n,one,many){return n+' '+(n===1?one:(many||one+'s'));};

var KEY='money-plan:data:v1',TAB_KEY='money-plan:tab';
var CATS=[['food','Food'],['gas','Gas'],['groceries','Groceries'],['shopping','Shopping'],['fun','Fun'],['other','Other']];
var COLL={bill:'bills',debt:'debts',purchase:'purchases',ledger:'partnerLedger'};
var NORM={bill:C.normBill,debt:C.normDebt,purchase:C.normPurchase,ledger:C.normLedger};

var plan=null,storageOK=true,loadError='';
var ui={tab:'today',editing:null,selCat:'other',showAll:false,confirmReset:false};
var imp={result:null,confirming:false};

/* ---------- storage: every call guarded ---------- */
function storageGet(k){try{return localStorage.getItem(k);}catch(e){storageOK=false;return null;}}
function storageSet(k,v){try{localStorage.setItem(k,v);return true;}catch(e){return false;}}
function storageRemove(k){try{localStorage.removeItem(k);return true;}catch(e){return false;}}
function checkStorage(){
  try{localStorage.setItem('money-plan:probe','1');localStorage.removeItem('money-plan:probe');return true;}catch(e){return false;}
}
function load(){
  var raw=storageGet(KEY);
  if(!raw)return null;
  try{
    var r=C.normalizePlan(JSON.parse(raw));
    if(r.ok)return r.plan;
    loadError=r.errors[0];
  }catch(e){loadError='the saved data is damaged';}
  return null;
}
function persist(next){return storageSet(KEY,JSON.stringify(next));}
function requestPersist(){
  var info=$('#storageInfo');
  if(!(navigator.storage&&navigator.storage.persist)){info.textContent='';return;}
  try{
    navigator.storage.persisted().then(function(p){return p||navigator.storage.persist();}).then(function(ok){
      info.textContent=ok?'Storage is marked persistent, so the browser won\'t clear it to free up space.':
        'The browser may clear storage if the device runs low on space. Installing the app and exporting a backup now and then keeps you safe.';
    }).catch(function(){});
  }catch(e){}
}

/* Apply a change to a copy, save it, then show it. A failed save leaves everything as it was. */
function commit(mutate,okMsg){
  var next=C.clone(plan),err=mutate(next);
  if(err){toast(err);return false;}
  if(!persist(next)){toast('Couldn\'t save. Storage may be full or blocked by the browser, so the change was not kept.');return false;}
  plan=next;ui.editing=null;renderAll();
  if(okMsg)toast(okMsg);
  return true;
}

/* ---------- small helpers ---------- */
function toast(msg){
  var t=$('#toast');t.textContent=msg;t.classList.add('show');
  clearTimeout(toast.t);toast.t=setTimeout(function(){t.classList.remove('show');},3200);
}
function parseAmount(v,allowZero){
  var n=parseFloat(String(v).replace(/[$,\s]/g,''));
  if(!isFinite(n)||n<0||(!allowZero&&n===0)||n>1000000)return null;
  return round2(n);
}
function dayLabel(s){
  var d=pd(s),n=dayDiff(new Date(),d);
  if(n===0)return 'Today';
  if(n===-1)return 'Yesterday';
  if(n===1)return 'Tomorrow';
  return wd(d)+(d.getFullYear()!==new Date().getFullYear()?', '+d.getFullYear():'');
}
function inDays(n){return n===0?'Today':n===1?'Tomorrow':n<0?Math.abs(n)+' days ago':'In '+n+' days';}
function monthish(s){return s.length===7?fMY.format(pd(s+'-01')):fMDY.format(pd(s));}
function label(){return plan?plan.settings.partner.label:'Partner';}
function catList(){
  var out=CATS.slice(),seen={};CATS.forEach(function(c){seen[c[0]]=1;});
  if(plan)plan.purchases.forEach(function(p){if(!seen[p.category]){seen[p.category]=1;out.splice(out.length-1,0,[p.category,cap(p.category)]);}});
  return out;
}
function catLabel(k){var l=catList();for(var i=0;i<l.length;i++)if(l[i][0]===k)return l[i][1];return k?cap(k):'';}
function isTyping(){var a=document.activeElement;return !!a&&/^(INPUT|TEXTAREA|SELECT)$/.test(a.tagName);}

/* ---------- form builders ---------- */
function fv(v){return v==null?'':esc(v);}
function fMoney(lbl,name,v,o){o=o||{};
  return '<label class="fld"'+(o.basis?' style="flex-basis:'+o.basis+'"':'')+'><span>'+esc(lbl)+'</span><span class="money-in"><input type="text" inputmode="decimal" data-f="'+name+'" value="'+(v==null||v===''?'':esc(Number(v).toFixed(2)))+'"'+(o.ph?' placeholder="'+esc(o.ph)+'"':'')+'></span></label>';}
function fText(lbl,name,v,o){o=o||{};
  return '<label class="fld'+(o.wide?' wide':'')+'"'+(o.basis?' style="flex-basis:'+o.basis+'"':'')+'><span>'+esc(lbl)+'</span><input type="text" data-f="'+name+'" value="'+fv(v)+'"'+(o.max?' maxlength="'+o.max+'"':'')+(o.mode?' inputmode="'+o.mode+'"':'')+(o.ph?' placeholder="'+esc(o.ph)+'"':'')+'></label>';}
function fDate(lbl,name,v,o){o=o||{};
  return '<label class="fld"'+(o.basis?' style="flex-basis:'+o.basis+'"':'')+'><span>'+esc(lbl)+'</span><input type="'+(o.month?'month':'date')+'" data-f="'+name+'" value="'+fv(v)+'"></label>';}
function fSelect(lbl,name,v,opts,o){o=o||{};
  return '<label class="fld"'+(o.basis?' style="flex-basis:'+o.basis+'"':'')+'><span>'+esc(lbl)+'</span><select data-f="'+name+'">'+opts.map(function(x){
    return '<option value="'+esc(x[0])+'"'+(String(x[0])===String(v==null?'':v)?' selected':'')+'>'+esc(x[1])+'</option>';}).join('')+'</select></label>';}
function fCheck(lbl,name,v){return '<label class="check"><input type="checkbox" data-f="'+name+'"'+(v?' checked':'')+'><span>'+esc(lbl)+'</span></label>';}
var ERRS='<ul class="msgs bad" data-errs hidden></ul>';

function setPath(o,path,v){var ks=path.split('.');for(var i=0;i<ks.length-1;i++){if(!isObj(o[ks[i]]))o[ks[i]]={};o=o[ks[i]];}o[ks[ks.length-1]]=v;}
function val(i){return i.type==='checkbox'?i.checked:i.value.trim();}
function readForm(root){
  var o={};
  root.querySelectorAll('[data-f]').forEach(function(i){if(!i.closest('[data-row]'))setPath(o,i.getAttribute('data-f'),val(i));});
  root.querySelectorAll('[data-rows]').forEach(function(box){
    var arr=[].map.call(box.querySelectorAll('[data-row]'),function(r){
      var x={};r.querySelectorAll('[data-f]').forEach(function(i){x[i.getAttribute('data-f')]=val(i);});
      return '_' in x?x._:x;
    });
    setPath(o,box.getAttribute('data-rows'),arr);
  });
  return o;
}
function labelsOf(root){
  var m={};
  root.querySelectorAll('[data-f]').forEach(function(i){
    var l=i.closest('label'),s=l&&l.querySelector('span');
    var path=i.getAttribute('data-f'),k=path.split('.').pop();
    if(!s)return;
    m[path]=s.textContent;
    if(!m[k])m[k]=s.textContent;
  });
  return m;
}
/* 'settings.savings: "balance" should be…' → 'Savings balance should be…' */
function friendly(msg,labels){
  var m=/^(.*?): "([^"]+)"/.exec(msg);
  if(!m)return msg;
  var where=m[1].replace(/^settings\.?/,''),k=m[2];
  var lbl=labels[(where?where+'.':'')+k]||labels[k];
  return lbl?lbl+msg.slice(m[0].length):msg.slice(m[1].length+2);
}
function showErrs(root,errs){
  var box=root.querySelector('[data-errs]');if(!box){toast(errs[0]);return;}
  var labels=labelsOf(root);
  box.innerHTML=errs.map(function(e){return '<li>'+esc(friendly(e,labels))+'</li>';}).join('');
  box.hidden=!errs.length;
  if(errs.length){toast('Please fix the problem shown in red.');box.scrollIntoView({block:'nearest'});}
}
function deepMerge(t,s){Object.keys(s).forEach(function(k){if(isObj(s[k])&&isObj(t[k]))deepMerge(t[k],s[k]);else t[k]=s[k];});return t;}

/* ---------- Today ---------- */
function renderWeek(){
  var t=new Date(),w=C.weekData(plan,t),lim=w.limit,el=$('#weekCard');
  var range=esc(fMD.format(w.ws))+' to '+esc(fMD.format(w.we));
  if(!(lim>0)){
    el.className='card';
    el.innerHTML='<h2>Spent this week · '+range+'</h2><div class="big">'+money(w.spent)+'</div>'+
      '<span class="status">No weekly limit set. Add one under "Weekly spending limit" below.</span>';
    return;
  }
  var pct=w.spent/lim,expected=lim*(8-w.daysLeft)/7,state='',msg='';
  var dl=plural(w.daysLeft,'day')+'.';
  if(w.left<0){state='state-bad';msg='Over the weekly limit by '+money(-w.left)+'. Pause everything extra until the week resets.';}
  else if(pct>=0.75){state='state-warn';msg='Close to the limit: '+money(w.left)+' left for '+dl;}
  else if(w.spent>expected+lim*0.15){state='state-warn';msg='Ahead of pace by '+money(w.spent-expected)+'. Slow down a little.';}
  else msg='On track. '+money(w.left)+' left for '+dl;
  var perDay=w.left>0?w.left/w.daysLeft:0;
  el.className='card '+state;
  el.innerHTML='<h2>'+(w.left<0?'Over by':'Left this week')+' · '+range+'</h2>'+
    '<div class="big">'+money(Math.abs(w.left))+'</div>'+
    '<div class="bar" role="img" aria-label="'+Math.round(Math.min(pct,1)*100)+' percent of the weekly limit spent"><i style="--w:'+Math.min(100,Math.round(pct*100))+'%"></i></div>'+
    '<span class="status">'+esc(msg)+'</span>'+
    '<div class="stats">'+
      '<div class="stat"><b>'+money(w.spent)+'</b><span>spent of '+money(lim)+'</span></div>'+
      '<div class="stat"><b>'+money(perDay)+'</b><span>per day, even pace</span></div>'+
      '<div class="stat"><b>'+money(w.today)+'</b><span>spent today</span></div>'+
    '</div>';
}
function renderCashWarn(){
  var s=plan.settings,p=C.cashProjection(plan,new Date(),45),el=$('#cashWarn');
  if(p&&s.warnBelow&&p.low<s.warnBelow){
    el.innerHTML='<div class="banner'+(p.low<0?' bad':'')+'">Checking could drop to '+money(p.low)+' on '+esc(wd(p.lowDate))+', below your '+money(s.warnBelow)+' warning line. See Bills for details.</div>';
  }else el.innerHTML='';
}
function purchaseEditor(p){
  return '<div class="editor" data-kind="purchase" data-id="'+esc(p?p.id:'new')+'">'+
    '<div class="row">'+fMoney('Amount','amount',p&&p.amount,{basis:'110px'})+fText('What for','note',p&&p.note,{max:60,basis:'152px'})+'</div>'+
    '<div class="row">'+fSelect('Category','category',p?p.category:'other',catList(),{basis:'130px'})+fDate('Date','date',p&&p.date,{basis:'152px'})+'</div>'+
    ERRS+editorButtons('purchase',p)+'</div>';
}
function editorButtons(kind,rec){
  return '<div class="btns"><button class="btn small" type="button" data-act="cancel">Cancel</button>'+
    (rec?'<button class="btn small" type="button" data-act="del" data-kind="'+kind+'" data-id="'+esc(rec.id)+'">Delete</button>':'')+
    '<button class="btn primary" type="button" data-act="save-rec" data-kind="'+kind+'" data-id="'+esc(rec?rec.id:'new')+'">Save</button></div>';
}
function rowButtons(kind,id){
  return '<span class="btns"><button class="btn small" type="button" data-act="edit" data-kind="'+kind+'" data-id="'+esc(id)+'">Edit</button>'+
    '<button class="btn small" type="button" data-act="del" data-kind="'+kind+'" data-id="'+esc(id)+'">Remove</button></span>';
}
function isEditing(kind,id){return ui.editing&&ui.editing.kind===kind&&ui.editing.id===id;}
function renderRecent(){
  var el=$('#recent'),more=$('#recentMore');
  var all=plan.purchases.slice().sort(function(a,b){return (b.date>a.date?1:b.date<a.date?-1:0)||(b.ts-a.ts);});
  var list=ui.showAll?all:all.slice(0,25);
  if(!all.length){el.innerHTML='<li class="empty">Nothing logged yet. Add your first purchase above and it counts against this week.</li>';more.innerHTML='';return;}
  el.innerHTML=list.map(function(p){
    if(isEditing('purchase',p.id))return '<li class="editor-li">'+purchaseEditor(p)+'</li>';
    var title=p.note||catLabel(p.category)||'Spending';
    var sub=(p.note&&catLabel(p.category)?catLabel(p.category)+' · ':'')+dayLabel(p.date);
    return '<li class="item"><div><div class="t">'+esc(title)+'</div><div class="s">'+esc(sub)+'</div></div>'+
      '<span class="a">'+money(p.amount)+'</span>'+rowButtons('purchase',p.id)+'</li>';
  }).join('');
  more.innerHTML=all.length>25?'<div class="row" style="margin-top:10px"><button class="btn small" type="button" data-act="toggle-all">'+(ui.showAll?'Show fewer':'Show all '+all.length+' purchases')+'</button></div>':'';
}
function renderNext(){
  var t=sod(new Date()),list=C.billsBetween(plan,t,addDays(t,30)).filter(function(b){return b.amount>0;}).slice(0,4);
  $('#nextUp').innerHTML=list.length?list.map(function(b){
    return '<li class="item"><div><div class="t">'+esc(b.name)+'</div><div class="s">'+inDays(dayDiff(t,b.date))+' · '+esc(wd(b.date))+'</div></div>'+
      '<span class="a">'+money(b.amount)+'</span><span></span></li>';
  }).join(''):'<li class="empty">No bills in the next 30 days.</li>';
}
function renderChips(){
  var box=$('#cats'),l=catList();
  if(!l.some(function(c){return c[0]===ui.selCat;}))ui.selCat='other';
  box.innerHTML=l.map(function(c){return '<button type="button" class="chip" data-cat="'+esc(c[0])+'" aria-pressed="'+(c[0]===ui.selCat)+'">'+esc(c[1])+'</button>';}).join('');
}

/* ---------- Bills ---------- */
function renderBills(){
  var s=plan.settings,t=sod(new Date()),end=addDays(t,45);
  var bills=C.billsBetween(plan,t,end).filter(function(b){return b.amount>0;});
  var save=s.savingsPerPayday;
  var pays=C.paydays(plan,t,end).map(function(d){
    return {date:d,name:'Payday',amount:s.paycheck.amount,kind:'pay',note:'Take-home'+(save>0?' · move '+money(save)+' to savings':'')};
  });
  var all=bills.concat(pays).sort(function(a,b){return (a.date-b.date)||((a.kind==='pay'?-1:0)-(b.kind==='pay'?-1:0));});
  var week=0,month=0;
  bills.forEach(function(b){var n=dayDiff(t,b.date);if(n<=6)week+=b.amount;if(n<=29)month+=b.amount;});
  var np=pays[0];

  /* payday reminder */
  var pc=$('#paydayCard');
  if(np&&save>0){
    var n=dayDiff(t,np.date);
    pc.innerHTML='<div class="card"><h2>Payday reminder</h2><p><b>'+(n===0?'Payday is today':'Next payday: '+esc(wd(np.date))+' ('+inDays(n).toLowerCase()+')')+'.</b></p>'+
      '<span class="status">Move '+money(save)+' to savings'+(n===0?' today.':' when it lands.')+'</span></div>';
  }else pc.innerHTML='';

  $('#billsSummary').innerHTML=
    '<h2>Coming due</h2><div class="big">'+money(week)+'</div><p class="muted small">due in the next 7 days</p>'+
    '<div class="stats two">'+
      '<div class="stat"><b>'+money(month)+'</b><span>due in 30 days</span></div>'+
      '<div class="stat"><b>'+(np?esc(wd(np.date)):'None')+'</b><span>next payday</span></div>'+
    '</div>';

  /* balances and projection */
  var p=C.cashProjection(plan,t,45),h='<h2>Accounts</h2>';
  h+='<div class="kv"><span>Checking'+(s.checking.asOf?' on '+esc(fMD.format(pd(s.checking.asOf))):'')+'</span><b>'+money(s.checking.balance)+'</b></div>';
  h+='<div class="kv"><span>Savings'+(s.savings.asOf?' on '+esc(fMD.format(pd(s.savings.asOf))):'')+'</span><b>'+money(s.savings.balance)+'</b></div>';
  if(p){
    if(s.checking.asOf<ds(t))h+='<div class="kv"><span>Checking today (estimate)</span><b>'+money(p.now)+'</b></div>';
    h+='<div class="kv"><span>Lowest point, next 45 days</span><b>'+money(p.low)+' · '+esc(fMD.format(p.lowDate))+'</b></div>';
    var low=s.warnBelow&&p.low<s.warnBelow;
    h+='<span class="status'+(p.low<0?' bad':low?' warn':'')+'">'+(low?'Could drop below your '+money(s.warnBelow)+' warning line. Hold off on extra spending until '+esc(fMD.format(p.lowDate))+' has passed.':'Stays above your warning line through '+esc(fMD.format(end))+'.')+'</span>';
    h+='<p class="muted small" style="margin-top:10px">Estimate from paychecks minus bills, rent, savings moves and logged purchases. Spending you haven\'t logged isn\'t included.</p>';
  }else{
    h+='<p class="muted small" style="margin-top:10px">Add your checking balance and its date in Settings to see a projection.</p>';
  }
  h+='<div class="row" style="margin-top:10px"><button class="btn small" type="button" data-act="goto" data-tab="settings" data-focus="set-accounts">Update balances</button></div>';
  $('#accountsCard').innerHTML=h;

  var html='',cur='';
  all.forEach(function(b){
    var key=fMY.format(b.date);
    if(key!==cur){cur=key;html+='<div class="group">'+esc(key)+'</div>';}
    html+='<div class="bill'+(b.kind==='pay'?' pay':'')+'"><div class="cal"><small>'+esc(fWeekday.format(b.date))+'</small><b>'+b.date.getDate()+'</b></div>'+
      '<div><div class="t">'+esc(b.name)+'</div><div class="s">'+inDays(dayDiff(t,b.date))+(b.note?' · '+esc(b.note):'')+'</div></div>'+
      '<div class="a">'+(b.kind==='pay'?'+':'')+money(b.amount)+'</div></div>';
  });
  $('#billsList').innerHTML=html||'<p class="empty">Nothing due in the next 45 days.</p>';
}

/* ---------- Debts ---------- */
function renderDebts(){
  var t=sod(new Date()),infos=plan.debts.map(function(d){return C.debtInfo(plan,d,t);});
  var active=infos.filter(function(i){return i.monthly>0&&!i.paused;});
  var monthly=active.reduce(function(s,i){return s+i.monthly;},0);
  var names=active.map(function(i){return i.debt.name;});
  var nameText=names.length>1?names.slice(0,-1).join(', ')+' and '+names[names.length-1]:names[0];
  $('#debtSummary').innerHTML='<h2>Monthly debt payments</h2><div class="big">'+money(monthly)+'</div>'+
    '<p class="muted small">'+(names.length?'Covers '+esc(nameText)+'. ':'No scheduled debt payments. ')+esc(label())+' is separate and shown on that tab.</p>';
  if(!infos.length){
    $('#debtCards').innerHTML='<div class="card flat"><p class="small">No debts in your plan. <a href="#" data-act="goto" data-tab="settings" data-focus="set-debts">Add one in Settings.</a></p></div>';
  }else $('#debtCards').innerHTML=infos.map(function(i){
    var d=i.debt,b=i.bill;
    var pill=i.paused?'Payments paused':i.left==null?'Ongoing':i.left===0?'Paid off':plural(i.left,'payment')+' left';
    var h='<div class="card debt"><div class="head"><h3>'+esc(d.name)+'</h3><span class="pill">'+esc(pill)+'</span></div>';
    h+='<div class="kv"><span>Balance'+(d.balanceAsOf?' on '+esc(fMD.format(pd(d.balanceAsOf))):'')+'</span><b>'+money(d.balance)+'</b></div>';
    h+='<div class="kv"><span>Payment</span><b>'+(b?money(b.amount)+' on the '+ordinal(b.day):'Not linked to a bill')+'</b></div>';
    h+='<div class="kv"><span>Next payment</span><b>'+(i.next?esc(wd(i.next)):i.paused?'Paused':i.left===0?'Done':'Not scheduled')+'</b></div>';
    if(b&&i.left)h+='<div class="kv"><span>Scheduled payments left</span><b>'+money(i.left*b.amount)+'</b></div>';
    if(i.last)h+='<div class="kv"><span>Last payment</span><b>'+esc(fMDY.format(i.last))+'</b></div>';
    if(d.apr!=null)h+='<div class="kv"><span>APR</span><b>'+esc(String(round2(d.apr*10000)/100))+'%</b></div>';
    if(d.projectedPayoff)h+='<div class="kv"><span>Done at current pace</span><b>'+esc(monthish(d.projectedPayoff))+'</b></div>';
    if(d.projectedPayoffWithExtra)h+='<div class="kv"><span>Done with extra money added</span><b>'+esc(monthish(d.projectedPayoffWithExtra))+'</b></div>';
    if(d.note)h+='<p class="muted small">'+esc(d.note)+'</p>';
    h+='<div class="btns"><button class="btn small" type="button" data-act="goto-edit" data-kind="debt" data-id="'+esc(d.id)+'">Edit</button></div></div>';
    return h;
  }).join('');

  /* payoff timeline */
  var items=[];
  infos.forEach(function(i){
    var d=i.debt,base=i.last||(d.projectedPayoff?pd(d.projectedPayoff.length===7?d.projectedPayoff+'-01':d.projectedPayoff):null);
    var baseText=i.last?fMDY.format(i.last):d.projectedPayoff?monthish(d.projectedPayoff):'';
    if(i.left===0&&!d.projectedPayoffWithExtra){items.push({date:t,title:d.name+' paid off',sub:'Done',right:'Done'});return;}
    if(d.projectedPayoffWithExtra){
      var x=pd(d.projectedPayoffWithExtra.length===7?d.projectedPayoffWithExtra+'-01':d.projectedPayoffWithExtra);
      items.push({date:x,title:d.name+' paid off, with extra money',sub:monthish(d.projectedPayoffWithExtra)+(baseText?' · '+baseText+' without extra':'')});
    }else if(base){
      items.push({date:base,title:d.name+' paid off',sub:baseText+(i.bill?' · frees '+money(i.bill.amount)+' a month':'')});
    }
  });
  items.sort(function(a,b){return a.date-b.date;});
  $('#timeline').innerHTML=items.length?items.map(function(x){
    var n=dayDiff(t,x.date);
    return '<li class="item"><div><div class="t">'+esc(x.title)+'</div><div class="s">'+esc(x.sub)+'</div></div><span class="a">'+(x.right||(n<=0?'Done':'In '+n+' days'))+'</span><span></span></li>';
  }).join(''):'<li class="empty">No payoff dates yet. Link a debt to a bill with an end date, or set "payments left".</li>';
}

/* ---------- Partner ---------- */
function ledgerEditor(e){
  var L=label();
  return '<div class="editor" data-kind="ledger" data-id="'+esc(e?e.id:'new')+'">'+
    '<div class="row">'+fSelect('Type','type',e?e.type:'payment',[['payment','I paid '+L],['charge',L+' covered something']],{basis:'100%'})+'</div>'+
    '<div class="row">'+fMoney('Amount','amount',e&&e.amount,{basis:'110px'})+fDate('Date','date',e&&e.date,{basis:'152px'})+'</div>'+
    '<div class="row">'+fText('Note','note',e&&e.note,{max:120,wide:true})+'</div>'+
    ERRS+editorButtons('ledger',e)+'</div>';
}
function renderPartner(){
  var L=label(),t=new Date(),c=C.partnerData(plan,t),per=plan.settings.partner.monthlyPayment;
  $('#partnerTab').textContent=L;
  $('#tab-partner').setAttribute('aria-label',L);
  $('#cPaid').textContent='I paid '+L;
  $('#cCharge').textContent=L+' covered more';
  $('#minSummary').textContent='Monthly payment to '+L;
  var pct=c.charged>0?Math.min(100,Math.round(c.paid/c.charged*100)):0;
  var h='<h2>You owe '+esc(L)+'</h2><div class="big">'+money(Math.max(0,c.bal))+'</div>';
  if(c.bal<0)h+='<p class="small" style="margin:-6px 0 10px">'+esc(L)+' owes you '+money(-c.bal)+'.</p>';
  h+='<div class="bar" role="img" aria-label="'+pct+' percent repaid"><i style="--w:'+pct+'%"></i></div>';
  h+='<div class="stats two">'+
     '<div class="stat"><b>'+money(c.paid)+'</b><span>repaid so far</span></div>'+
     '<div class="stat"><b>'+money(c.total)+'</b><span>'+(c.sched?'after '+esc(fMD.format(pd(c.lastScheduled))):'total to repay')+'</span></div></div>';
  if(c.total>0&&per>0){
    var m=C.monthsToRepay(c.total,per,t),m2=C.monthsToRepay(c.total,per*2,t);
    h+='<span class="status">At '+money(per)+' a month: about '+plural(m.n,'month')+', around '+esc(fMY.format(m.end))+'. At '+money(per*2)+' a month: '+plural(m2.n,'month')+'.</span>';
  }else if(c.total>0){
    h+='<span class="status warn">Set a monthly payment below to see a payoff estimate.</span>';
  }else{
    h+='<span class="status">'+(plan.partnerLedger.length?'Paid off. Nothing left to repay.':'Nothing logged yet. Add what '+esc(L)+' covered below.')+'</span>';
  }
  $('#parCard').innerHTML=h;
  var t0=ds(t);
  var list=plan.partnerLedger.slice().sort(function(a,b){return (b.date>a.date?1:b.date<a.date?-1:0)||(b.ts-a.ts);});
  $('#parLog').innerHTML=list.length?list.map(function(e){
    if(isEditing('ledger',e.id))return '<li class="editor-li">'+ledgerEditor(e)+'</li>';
    var pay=e.type==='payment';
    return '<li class="item"><div><div class="t">'+esc(e.note||(pay?'Payment to '+L:'Covered by '+L))+(e.date>t0?'<span class="tag">Scheduled</span>':'')+'</div>'+
      '<div class="s">'+esc(dayLabel(e.date))+'</div></div>'+
      '<span class="a'+(pay?' in':'')+'">'+(pay?'−':'+')+money(e.amount)+'</span>'+rowButtons('ledger',e.id)+'</li>';
  }).join(''):'<li class="empty">No entries yet.</li>';
}

/* ---------- Settings ---------- */
function section(id,title,body,saveLabel){
  return '<div class="card" id="'+id+'" data-sec="'+id+'"><h2>'+esc(title)+'</h2>'+body+ERRS+
    (saveLabel===false?'':'<div class="btns" style="margin-top:12px"><button class="btn primary" type="button" data-act="save-sec" data-sec="'+id+'">'+(saveLabel||'Save')+'</button></div>')+'</div>';
}
function extraRow(e){
  return '<div class="row" data-row style="padding-top:10px;border-top:1px solid var(--line)">'+
    fDate('Rent due month','dueMonth',e&&e.dueMonth,{month:true,basis:'140px'})+fMoney('Extra amount','amount',e&&e.amount,{basis:'100px'})+
    fText('Note','note',e&&e.note,{max:120,basis:'100%'})+
    '<button class="btn small" type="button" data-act="del-row">Remove</button></div>';
}
function holidayRow(h){
  return '<div class="row" data-row>'+fDate('Holiday','_',h,{basis:'170px'})+'<button class="btn small" type="button" data-act="del-row">Remove</button></div>';
}
var KIND_LABEL={subscription:'Subscription',debt:'Debt payment',insurance:'Insurance',other:'Other'};
function billEditor(b){
  return '<div class="editor" data-kind="bill" data-id="'+esc(b?b.id:'new')+'"><h3>'+(b?'Edit bill':'New bill')+'</h3>'+
    '<div class="row">'+fText('Name','name',b&&b.name,{max:60,wide:true})+'</div>'+
    '<div class="row">'+fMoney('Amount','amount',b&&b.amount,{basis:'110px'})+fText('Day of month (1–31)','day',b&&b.day,{mode:'numeric',basis:'110px'})+'</div>'+
    '<div class="row">'+fSelect('Kind','kind',b?b.kind:'subscription',C.KINDS.map(function(k){return [k,KIND_LABEL[k]];}),{basis:'140px'})+fDate('Last payment (optional)','end',b&&b.end,{basis:'152px'})+'</div>'+
    '<div class="row">'+fCheck('Moves to the next business day on weekends and holidays','shiftToBusinessDay',b&&b.shiftToBusinessDay)+fCheck('Active (uncheck to pause)','active',b?b.active:true)+'</div>'+
    ERRS+editorButtons('bill',b)+'</div>';
}
function debtEditor(d){
  var opts=[['','(none)']].concat(plan.bills.map(function(b){return [b.name,b.name];}));
  if(d&&d.billName&&!C.findBill(plan,d.billName))opts.push([d.billName,d.billName+' (missing)']);
  return '<div class="editor" data-kind="debt" data-id="'+esc(d?d.id:'new')+'"><h3>'+(d?'Edit debt':'New debt')+'</h3>'+
    '<div class="row">'+fText('Name','name',d&&d.name,{max:60,wide:true})+'</div>'+
    '<div class="row">'+fSelect('Paid by bill','billName',d&&d.billName,opts,{basis:'100%'})+'</div>'+
    '<div class="row">'+fMoney('Balance','balance',d&&d.balance,{basis:'120px'})+fDate('Balance as of','balanceAsOf',d&&d.balanceAsOf,{basis:'152px'})+'</div>'+
    '<div class="row">'+fText('Payments left','paymentsLeft',d&&d.paymentsLeft,{mode:'numeric',basis:'110px',ph:'Optional'})+
      fText('APR %','aprPct',d&&d.apr!=null?String(round2(d.apr*10000)/100):'',{mode:'decimal',basis:'110px',ph:'e.g. 19.99'})+'</div>'+
    '<div class="row">'+fText('Projected payoff','projectedPayoff',d&&d.projectedPayoff,{basis:'130px',ph:'YYYY-MM'})+
      fText('Payoff with extra','projectedPayoffWithExtra',d&&d.projectedPayoffWithExtra,{basis:'130px',ph:'YYYY-MM'})+'</div>'+
    '<div class="row">'+fText('Note','note',d&&d.note,{max:300,wide:true})+'</div>'+
    '<p class="muted small" style="margin-top:8px">If the linked bill has a last-payment date, payments left are counted from it. Otherwise "payments left" counts down from the balance date as payments go out.</p>'+
    ERRS+editorButtons('debt',d)+'</div>';
}
function renderSettings(){
  var s=plan.settings,L=label(),h='';
  h+=section('set-general','Spending',
    '<div class="row">'+fMoney('Weekly spending limit','weeklyLimit',s.weeklyLimit)+
    fSelect('Week starts on','weekStartsOn',s.weekStartsOn,C.WEEKDAYS.map(function(d){return [d,cap(d)];}))+'</div>'+
    '<div class="row">'+fMoney('Warn if checking could drop below','warnBelow',s.warnBelow)+fMoney('Move to savings each payday','savingsPerPayday',s.savingsPerPayday)+'</div>');
  h+=section('set-paycheck','Paycheck',
    '<div class="row">'+fMoney('Take-home per paycheck','paycheck.amount',s.paycheck.amount)+fText('Paid every (days)','paycheck.everyDays',s.paycheck.everyDays,{mode:'numeric'})+'</div>'+
    '<div class="row">'+fDate('Any payday (past or future)','paycheck.knownPayday',s.paycheck.knownPayday)+'</div>');
  h+=section('set-rent','Rent',
    '<div class="row">'+fMoney('Rent','rent.amount',s.rent.amount)+fText('Due day of month','rent.dueDay',s.rent.dueDay,{mode:'numeric'})+'</div>'+
    '<div class="row">'+fCheck('Pay it in two halves on the last two paydays before it\'s due','rent.paidInHalvesOnLastTwoPaydaysBeforeDue',s.rent.paidInHalvesOnLastTwoPaydaysBeforeDue)+'</div>'+
    '<p class="muted small" style="margin-top:10px">Extra amounts are added to rent in a given month.</p>'+
    '<div data-rows="rent.extras">'+s.rent.extras.map(extraRow).join('')+'</div>'+
    '<div class="row" style="margin-top:10px"><button class="btn small" type="button" data-act="add-row" data-tpl="extra">Add an extra amount</button></div>');
  h+=section('set-accounts','Balances',
    '<div class="row">'+fMoney('Checking balance','checking.balance',s.checking.balance)+fDate('As of','checking.asOf',s.checking.asOf)+'</div>'+
    '<div class="row">'+fMoney('Savings balance','savings.balance',s.savings.balance)+fDate('As of','savings.asOf',s.savings.asOf)+'</div>');
  h+=section('set-partner','Person you\'re repaying',
    '<div class="row">'+fText('Name shown in the app','partner.label',s.partner.label,{max:30})+fMoney('Monthly payment','partner.monthlyPayment',s.partner.monthlyPayment)+'</div>');
  h+=section('set-holidays','Bank holidays',
    '<p class="muted small">Bills set to move to the next business day skip these dates.</p>'+
    '<div data-rows="holidays">'+s.holidays.map(holidayRow).join('')+'</div>'+
    '<div class="row" style="margin-top:10px"><button class="btn small" type="button" data-act="add-row" data-tpl="holiday">Add a holiday</button></div>');

  var bl=plan.bills.map(function(b){
    if(isEditing('bill',b.id))return '<li class="editor-li">'+billEditor(b)+'</li>';
    return '<li class="item'+(b.active?'':' off')+'"><div><div class="t">'+esc(b.name)+(b.active?'':'<span class="tag">Paused</span>')+'</div>'+
      '<div class="s">'+esc(KIND_LABEL[b.kind])+' · the '+ordinal(b.day)+(b.end?' · until '+esc(fMDY.format(pd(b.end))):'')+'</div></div>'+
      '<span class="a">'+money(b.amount)+'</span>'+
      '<span class="btns"><button class="btn small" type="button" data-act="edit" data-kind="bill" data-id="'+esc(b.id)+'">Edit</button>'+
      '<button class="btn small" type="button" data-act="pause" data-id="'+esc(b.id)+'">'+(b.active?'Pause':'Resume')+'</button></span></li>';
  }).join('');
  if(isEditing('bill','new'))bl+='<li class="editor-li">'+billEditor(null)+'</li>';
  h+='<div class="card" id="set-bills"><h2>Bills</h2><ul class="list">'+(bl||'<li class="empty">No bills yet.</li>')+'</ul>'+
    '<div class="row" style="margin-top:10px"><button class="btn" type="button" data-act="add-rec" data-kind="bill">Add a bill</button></div></div>';

  var dl=plan.debts.map(function(d){
    if(isEditing('debt',d.id))return '<li class="editor-li">'+debtEditor(d)+'</li>';
    return '<li class="item"><div><div class="t">'+esc(d.name)+'</div><div class="s">'+(d.billName?'Paid by '+esc(d.billName):'Not linked to a bill')+'</div></div>'+
      '<span class="a">'+money(d.balance)+'</span>'+
      '<span class="btns"><button class="btn small" type="button" data-act="edit" data-kind="debt" data-id="'+esc(d.id)+'">Edit</button></span></li>';
  }).join('');
  if(isEditing('debt','new'))dl+='<li class="editor-li">'+debtEditor(null)+'</li>';
  h+='<div class="card" id="set-debts"><h2>Debts</h2><ul class="list">'+(dl||'<li class="empty">No debts yet.</li>')+'</ul>'+
    '<div class="row" style="margin-top:10px"><button class="btn" type="button" data-act="add-rec" data-kind="debt">Add a debt</button></div></div>';
  $('#settingsBody').innerHTML=h;
  renderResetConfirm();
}
function renderResetConfirm(){
  $('#resetConfirm').innerHTML=ui.confirmReset?
    '<div class="confirm" role="alert"><b>Delete everything on this device?</b> Your settings, bills, debts, logs and purchases will be erased. This can\'t be undone. Export a backup first if you might want it.'+
    '<div class="btns"><button class="btn danger" type="button" data-act="confirm-reset">Delete everything</button><button class="btn" type="button" data-act="cancel-reset">Cancel</button></div></div>':'';
}

/* ---------- import ---------- */
function summarize(p){
  var s=p.settings,t=new Date(),out=[];
  var np=C.paydays(p,t,addDays(t,s.paycheck.everyDays))[0];
  out.push('Paycheck: '+money(s.paycheck.amount)+' every '+s.paycheck.everyDays+' days'+(np?', next on '+wd(np):'')+'.');
  out.push('Weekly spending limit: '+(s.weeklyLimit>0?money(s.weeklyLimit)+', weeks start on '+cap(s.weekStartsOn):'none set')+'.');
  if(s.savingsPerPayday>0)out.push('Savings: move '+money(s.savingsPerPayday)+' each payday.');
  out.push(s.rent.amount>0?'Rent: '+money(s.rent.amount)+' due on the '+ordinal(s.rent.dueDay)+(s.rent.paidInHalvesOnLastTwoPaydaysBeforeDue?', paid in two halves':'')+(s.rent.extras.length?', with '+plural(s.rent.extras.length,'extra amount')+'.':'.'):'Rent: none.');
  var act=p.bills.filter(function(b){return b.active;});
  out.push('Bills: '+p.bills.length+(p.bills.length!==act.length?' ('+act.length+' active)':'')+', '+money(act.reduce(function(a,b){return a+b.amount;},0))+' a month in total.');
  out.push('Debts: '+p.debts.length+(p.debts.length?', total balance '+money(p.debts.reduce(function(a,d){return a+d.balance;},0)):'')+'.');
  var pc=C.partnerData(p,t);
  out.push(s.partner.label+': '+plural(p.partnerLedger.length,'log entry','log entries')+(p.partnerLedger.length?', you owe '+money(pc.bal)+' now'+(pc.sched?' and '+money(pc.total)+' after scheduled entries':''):'')+'.');
  out.push('Purchases: '+p.purchases.length+'.');
  out.push('Checking '+money(s.checking.balance)+(s.checking.asOf?' (as of '+fMDY.format(pd(s.checking.asOf))+')':'')+', savings '+money(s.savings.balance)+(s.savings.asOf?' (as of '+fMDY.format(pd(s.savings.asOf))+')':'')+'.');
  if(s.holidays.length)out.push('Bank holidays: '+s.holidays.length+'.');
  return out;
}
function renderImport(){
  var el=$('#impResult'),r=imp.result;
  if(!r){el.innerHTML='';return;}
  var warn=r.warnings&&r.warnings.length?'<p class="small" style="margin-top:12px"><b>Worth checking:</b></p><ul class="msgs warn">'+r.warnings.map(function(w){return '<li>'+esc(w)+'</li>';}).join('')+'</ul>':'';
  if(!r.ok){
    el.innerHTML='<span class="status bad">Can\'t import this yet. Nothing was changed.</span><ul class="msgs bad">'+r.errors.map(function(e){return '<li>'+esc(e)+'</li>';}).join('')+'</ul>'+warn;
    return;
  }
  var h='<span class="status">This looks good. Here\'s what will be imported:</span><ul class="msgs">'+summarize(r.plan).map(function(x){return '<li>'+esc(x)+'</li>';}).join('')+'</ul>'+warn;
  if(plan&&imp.confirming){
    h+='<div class="confirm" role="alert"><b>Replace everything?</b> This replaces all data on this device ('+plural(plan.bills.length,'bill')+', '+plural(plan.debts.length,'debt')+', '+plural(plan.purchases.length,'purchase')+', '+plural(plan.partnerLedger.length,'log entry','log entries')+'). There is no undo.'+
      '<div class="btns"><button class="btn danger" type="button" data-act="import-go">Replace everything</button><button class="btn" type="button" data-act="export">Export a backup first</button><button class="btn" type="button" data-act="import-cancel">Cancel</button></div></div>';
  }else{
    h+='<div class="row" style="margin-top:12px"><button class="btn primary" type="button" data-act="import" style="flex:1 1 100%">Import</button></div>';
  }
  el.innerHTML=h;
}
function doImport(){
  var p=imp.result&&imp.result.ok&&imp.result.plan;
  if(!p)return;
  if(!persist(p)){toast('Couldn\'t save the plan. This browser is blocking or out of storage, so nothing was imported.');return;}
  plan=p;loadError='';
  imp.result=null;imp.confirming=false;
  $('#impText').value='';
  try{$('#impFile').value='';}catch(e){}
  ui.editing=null;ui.confirmReset=false;
  requestPersist();
  renderAll();showTab('today');
  toast('Plan imported and saved on this device.');
}
function validateImport(){
  imp.confirming=false;
  imp.result=C.parsePlan($('#impText').value);
  renderImport();
  $('#impResult').scrollIntoView({block:'nearest'});
}

/* ---------- export ---------- */
function exportText(){return JSON.stringify(C.exportPlan(plan),null,2)+'\n';}
function exportName(){return 'money-plan-backup-'+ds(new Date())+'.json';}
function doExport(){
  try{
    var blob=new Blob([exportText()],{type:'application/json'});
    var url=URL.createObjectURL(blob),a=document.createElement('a');
    a.href=url;a.download=exportName();a.rel='noopener';
    document.body.appendChild(a);a.click();
    setTimeout(function(){URL.revokeObjectURL(url);a.remove();},2000);
    toast('Saved '+exportName()+' to your downloads.');
  }catch(e){toast('Couldn\'t create the file. Try "Copy as text" instead.');}
}

/* ---------- render ---------- */
var TABS=['today','bills','debts','partner','settings'];
function renderAll(){
  $('#today').textContent=fFull.format(new Date());
  var has=!!plan,sync=$('#sync');
  sync.textContent=has?'Saved on this device':'No plan yet';
  sync.classList.toggle('ok',has);
  document.querySelector('.nav').hidden=!has;
  var bn=$('#banner');
  if(!storageOK){bn.hidden=false;bn.className='banner bad';bn.textContent='This browser is blocking storage, so Money Plan can\'t save anything. Turn off private browsing or allow site data, then reload.';}
  else if(loadError&&!has){bn.hidden=false;bn.className='banner bad';bn.textContent='Your saved plan couldn\'t be read ('+loadError+'). Import your latest backup to continue.';}
  else bn.hidden=true;
  if(!has){
    $('#welcomeImport').appendChild($('#importer'));
    TABS.forEach(function(t){$('#tab-'+t).hidden=true;});
    $('#tab-welcome').hidden=false;
    renderImport();
    return;
  }
  $('#tab-welcome').hidden=true;
  $('#settingsImport').appendChild($('#importer'));
  renderChips();renderWeek();renderCashWarn();renderRecent();renderNext();renderBills();renderDebts();renderPartner();renderSettings();renderImport();
  syncInputs();
  showTab(ui.tab,true);
}
function syncInputs(){
  var s=plan.settings,w=$('#weekly'),m=$('#cmin');
  if(document.activeElement!==w)w.value=s.weeklyLimit.toFixed(2);
  if(document.activeElement!==m)m.value=s.partner.monthlyPayment.toFixed(2);
  var start=cap(s.weekStartsOn).slice(0,3),endDay=cap(C.WEEKDAYS[(C.WEEKDAYS.indexOf(s.weekStartsOn)+6)%7]).slice(0,3);
  $('#weeklyLabel').textContent='Dollars per week ('+start+' to '+endDay+')';
}
function showTab(name,keepScroll){
  if(!plan)return;
  if(TABS.indexOf(name)<0)name='today';
  ui.tab=name;
  TABS.forEach(function(t){$('#tab-'+t).hidden=t!==name;});
  document.querySelectorAll('.nav button').forEach(function(b){b.setAttribute('aria-selected',String(b.getAttribute('data-tab')===name));});
  storageSet(TAB_KEY,name);
  if(!keepScroll)window.scrollTo(0,0);
}
function setDefaultDates(){
  var d=ds(new Date());
  if(!$('#pDate').value)$('#pDate').value=d;
  if(!$('#cDate').value)$('#cDate').value=d;
}

/* ---------- record editing ---------- */
function saveRecord(kind,id,root){
  var raw=readForm(root),coll=COLL[kind],ctx=new C.Ctx();
  if(kind==='debt'){
    var a=raw.aprPct;delete raw.aprPct;
    raw.apr=a===''?null:(isFinite(Number(a))?Number(a)/100:a);
    if(raw.paymentsLeft==='')raw.paymentsLeft=null;
  }
  var old=id==='new'?null:plan[coll].filter(function(x){return x.id===id;})[0];
  if(old){raw.id=old.id;if('ts' in old)raw.ts=old.ts;}
  else if(kind==='purchase'||kind==='ledger')raw.ts=Date.now();
  var rec=NORM[kind](ctx,raw,'This entry');
  if(kind==='bill'&&rec.name&&plan.bills.some(function(b){return b.id!==rec.id&&b.name===rec.name;}))
    ctx.errors.push('"name": another bill is already called "'+rec.name+'". Use a different name so debts link to the right one.');
  if(ctx.errors.length){showErrs(root,ctx.errors);return;}
  commit(function(p){
    var arr=p[coll];
    if(old){
      for(var i=0;i<arr.length;i++)if(arr[i].id===id)arr[i]=rec;
      if(kind==='bill'&&old.name!==rec.name)p.debts.forEach(function(d){if(d.billName===old.name)d.billName=rec.name;});
    }else arr.push(rec);
  },old?'Saved':'Added');
}
function deleteRecord(kind,id){
  var coll=COLL[kind],linked=0,name='';
  commit(function(p){
    p[coll]=p[coll].filter(function(x){if(x.id===id)name=x.name;return x.id!==id;});
    if(kind==='bill')linked=p.debts.filter(function(d){return d.billName===name;}).length;
  },'Removed');
  if(linked)toast('Removed. '+plural(linked,'debt')+' still point to "'+name+'"; edit '+(linked===1?'it':'them')+' on the Settings tab.');
}
function saveSection(id){
  var root=document.getElementById(id),form=readForm(root);
  if(form.holidays)form.holidays=form.holidays.filter(Boolean);
  if(form.rent&&form.rent.extras)form.rent.extras=form.rent.extras.filter(function(e){return e.dueMonth||e.amount||e.note;});
  var raw=deepMerge(C.exportPlan(plan).settings,form),ctx=new C.Ctx();
  var s=C.normSettings(ctx,raw);
  if(ctx.errors.length){showErrs(root,ctx.errors);return;}
  commit(function(p){p.settings=s;},'Settings saved');
}

/* ---------- events ---------- */
$('#cats').addEventListener('click',function(e){
  var b=e.target.closest('[data-cat]');if(!b)return;
  ui.selCat=b.getAttribute('data-cat');
  this.querySelectorAll('.chip').forEach(function(x){x.setAttribute('aria-pressed',String(x===b));});
});
$('#addForm').addEventListener('submit',function(e){
  e.preventDefault();
  var amt=parseAmount($('#pAmt').value);
  if(!amt){toast('Enter an amount greater than zero.');$('#pAmt').focus();return;}
  var date=$('#pDate').value||ds(new Date());
  var rec={id:C.uid(),amount:amt,note:$('#pNote').value.trim().slice(0,60),category:ui.selCat,date:date,ts:Date.now()};
  if(commit(function(p){p.purchases.push(rec);},'Added '+money(amt))){
    $('#pAmt').value='';$('#pNote').value='';$('#pDate').value=ds(new Date());$('#pAmt').focus();
  }
});
function parAdd(type){
  var amt=parseAmount($('#cAmt').value);
  if(!amt){toast('Enter an amount greater than zero.');$('#cAmt').focus();return;}
  var rec={id:C.uid(),type:type,amount:amt,note:$('#cNote').value.trim().slice(0,60),date:$('#cDate').value||ds(new Date()),ts:Date.now()};
  if(commit(function(p){p.partnerLedger.push(rec);},type==='payment'?'Logged '+money(amt)+' paid to '+label():'Added '+money(amt)+' to what you owe')){
    $('#cAmt').value='';$('#cNote').value='';$('#cDate').value=ds(new Date());
  }
}
$('#cPaid').addEventListener('click',function(){
  var m=plan.settings.partner.monthlyPayment;
  if(!$('#cAmt').value&&m>0)$('#cAmt').value=m.toFixed(2);
  parAdd('payment');
});
$('#cCharge').addEventListener('click',function(){parAdd('charge');});
$('#saveWeekly').addEventListener('click',function(){
  var v=parseAmount($('#weekly').value,true);if(v==null){toast('Enter a weekly amount, or 0 for no limit.');return;}
  $('#weekly').blur();
  commit(function(p){p.settings.weeklyLimit=v;},v?'Weekly limit set to '+money(v):'Weekly limit turned off');
});
$('#saveMin').addEventListener('click',function(){
  var v=parseAmount($('#cmin').value,true);if(v==null){toast('Enter a monthly amount.');return;}
  $('#cmin').blur();
  commit(function(p){p.settings.partner.monthlyPayment=v;},'Monthly payment set to '+money(v));
});
$('#saveSetBal').addEventListener('click',function(){
  var v=parseAmount($('#setBal').value,true);if(v==null){toast('Enter what you owe right now, for example 250.00.');return;}
  var cur=C.partnerData(plan,new Date()).bal,diff=round2(v-cur);
  if(Math.abs(diff)<0.005){toast('The balance is already '+money(v)+'.');return;}
  var rec={id:C.uid(),type:diff>0?'charge':'payment',amount:Math.abs(diff),date:ds(new Date()),note:'Balance adjustment',ts:Date.now()};
  if(commit(function(p){p.partnerLedger.push(rec);},'Balance set to '+money(v)))$('#setBal').value='';
});

/* import controls */
$('#impText').addEventListener('input',function(){if(imp.result){imp.result=null;imp.confirming=false;renderImport();}});
$('#impValidate').addEventListener('click',validateImport);
$('#impClear').addEventListener('click',function(){$('#impText').value='';try{$('#impFile').value='';}catch(e){}imp.result=null;imp.confirming=false;renderImport();});
$('#impFile').addEventListener('change',function(){
  var f=this.files&&this.files[0];if(!f)return;
  if(f.size>5*1024*1024){imp.result={ok:false,errors:['That file is '+(f.size/1048576).toFixed(1)+' MB, which is far too big for a plan file. Choose your Money Plan .json file.'],warnings:[]};renderImport();return;}
  var r=new FileReader();
  r.onload=function(){$('#impText').value=String(r.result||'');validateImport();};
  r.onerror=function(){imp.result={ok:false,errors:['Couldn\'t read that file. Try choosing it again, or open it and paste the text instead.'],warnings:[]};renderImport();};
  r.readAsText(f);
});

/* one delegated handler for every data-act button */
document.addEventListener('click',function(e){
  var b=e.target.closest('[data-act]');if(!b)return;
  var act=b.getAttribute('data-act'),kind=b.getAttribute('data-kind'),id=b.getAttribute('data-id');
  if(b.tagName==='A')e.preventDefault();
  switch(act){
    case 'goto':
      showTab(b.getAttribute('data-tab'));
      var f=b.getAttribute('data-focus');if(f){var el=document.getElementById(f);if(el)el.scrollIntoView({block:'start'});}
      break;
    case 'goto-edit':
      ui.editing={kind:kind,id:id};renderSettings();showTab('settings');
      var ed=document.querySelector('.editor[data-kind="'+kind+'"]');if(ed){ed.scrollIntoView({block:'start'});}
      break;
    case 'edit':case 'add-rec':
      ui.editing={kind:kind,id:act==='add-rec'?'new':id};renderAll();
      var ed2=document.querySelector('.editor[data-kind="'+kind+'"]');
      if(ed2){ed2.scrollIntoView({block:'nearest'});var inp=ed2.querySelector('input,select');if(inp)inp.focus({preventScroll:true});}
      break;
    case 'cancel':ui.editing=null;renderAll();break;
    case 'save-rec':saveRecord(kind,id,b.closest('.editor'));break;
    case 'del':
      if(!b.classList.contains('armed')){
        var txt=b.textContent;b.classList.add('armed');b.textContent='Sure?';
        setTimeout(function(){if(b.isConnected){b.classList.remove('armed');b.textContent=txt;}},3000);
        return;
      }
      deleteRecord(kind,id);break;
    case 'pause':
      var bill=plan.bills.filter(function(x){return x.id===id;})[0];
      if(bill)commit(function(p){p.bills.forEach(function(x){if(x.id===id)x.active=!x.active;});},(bill.active?'Paused ':'Resumed ')+bill.name);
      break;
    case 'toggle-all':ui.showAll=!ui.showAll;renderRecent();break;
    case 'save-sec':saveSection(b.getAttribute('data-sec'));break;
    case 'add-row':
      var box=b.closest('[data-sec]').querySelector('[data-rows]');
      box.insertAdjacentHTML('beforeend',b.getAttribute('data-tpl')==='extra'?extraRow(null):holidayRow(null));
      var last=box.lastElementChild.querySelector('input');if(last)last.focus();
      break;
    case 'del-row':b.closest('[data-row]').remove();break;
    case 'export':doExport();break;
    case 'copy-export':
      try{
        navigator.clipboard.writeText(exportText()).then(function(){toast('Copied. Paste it into a note or email to yourself to keep a backup.');},
          function(){toast('Couldn\'t copy. Use "Export plan file" instead.');});
      }catch(err){toast('Couldn\'t copy. Use "Export plan file" instead.');}
      break;
    case 'import':
      if(plan){imp.confirming=true;renderImport();}else doImport();
      break;
    case 'import-go':doImport();break;
    case 'import-cancel':imp.confirming=false;renderImport();break;
    case 'reset':ui.confirmReset=true;renderResetConfirm();$('#resetConfirm').scrollIntoView({block:'nearest'});break;
    case 'cancel-reset':ui.confirmReset=false;renderResetConfirm();break;
    case 'confirm-reset':
      if(!storageRemove(KEY)){toast('Couldn\'t delete the saved data. The browser blocked it.');return;}
      storageRemove(TAB_KEY);
      plan=null;ui={tab:'today',editing:null,selCat:'other',showAll:false,confirmReset:false};imp={result:null,confirming:false};
      renderAll();window.scrollTo(0,0);toast('Everything was deleted from this device.');
      break;
  }
});
document.querySelector('.nav').addEventListener('click',function(e){
  var b=e.target.closest('[data-tab]');if(b)showTab(b.getAttribute('data-tab'));
});
document.addEventListener('visibilitychange',function(){
  if(document.hidden)return;
  setDefaultDates();
  if(plan&&!ui.editing&&!isTyping())renderAll();
});
window.addEventListener('storage',function(e){
  if(e.key!==KEY)return;
  plan=load();ui.editing=null;renderAll();
});

/* ---------- start ---------- */
storageOK=checkStorage();
plan=load();
ui.tab=storageGet(TAB_KEY)||'today';
setDefaultDates();
renderAll();
if(plan)requestPersist();

if('serviceWorker' in navigator){
  window.addEventListener('load',function(){
    navigator.serviceWorker.register('sw.js').then(function(reg){
      reg.addEventListener('updatefound',function(){
        var w=reg.installing;if(!w)return;
        w.addEventListener('statechange',function(){
          if(w.state==='installed'&&navigator.serviceWorker.controller)toast('An update is ready. Close and reopen Money Plan to use it.');
        });
      });
    }).catch(function(){});
  });
}
})();
