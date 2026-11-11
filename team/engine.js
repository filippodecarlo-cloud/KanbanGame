/* ===== Motore di simulazione: sistema kanban a doppio cartellino (versione a squadre, UMD) ===== */
(function(root){
'use strict';
const TYPES=['cow','horse','sheep','duck'];
const COMPS=['legs','body','head'];
const PN=[];COMPS.forEach(c=>TYPES.forEach(ty=>PN.push(c+'-'+ty)));
const MEAN={legs:{cow:3,horse:4,sheep:3,duck:2},body:{cow:5.5,horse:5.5,sheep:7,duck:5},head:{cow:3,horse:3,sheep:2,duck:3}};
const SETUP={legs:1,body:2.5,head:1};
const P={takt:8,asm:5,travel:3,swap:1.4,handle:0.4,cart:8,pitch:20,pitchFast:10,cv:0.25,cvStd:0.08,smed:0.3,ptsDone:10,ptsBacklog:5,ptsWip:1};

function rng32(seed){return function(){seed|=0;seed=seed+0x6D2B79F5|0;let t=Math.imul(seed^seed>>>15,1|seed);t=t+Math.imul(t^t>>>7,61|t)^t;return((t^t>>>14)>>>0)/4294967296;};}
function makeSeq(seed,leveled,n){
  n=n||200;const out=[];
  if(leveled){const rot=['cow','sheep','horse','duck'];for(let i=0;i<n;i++)out.push(rot[i%4]);}
  else{const r=rng32(seed);for(let i=0;i<n;i++)out.push(TYPES[Math.floor(r()*4)]);}
  return out;
}

function makeSim(cfg){
  const R=Math.random, imp=new Set(cfg.imp||[]);
  const cv=imp.has('std')?P.cvStd:P.cv;
  const draw=m=>Math.max(0.35*m,m+(R()+R()-1)*cv*m*Math.sqrt(6));
  const pitch=imp.has('pitch')?P.pitchFast:P.pitch;
  let cid=1,kid=1;
  const H0=cfg.human==null?[]:(Array.isArray(cfg.human)?cfg.human.slice():[cfg.human]);
  const S={t:0,mode:cfg.mode,dur:cfg.dur,ended:false,imp,human:H0,pitch,cv,
    super:{},line:{},empties:[],cells:{},
    asm:{job:null,busy:0,starve:0,missing:[],ready:false},
    mizu:{loc:'line',pos:1,act:null,full:[],empty:[],nextDepart:pitch,busy:0,trips:0,swaps:0},
    queue:[],delivered:[],orderIdx:0,log:[],ev:[],samples:[],nextSample:0,
    LP:{},LW:{},stockT:{},shortN:{},produced:0,
    seq:makeSeq(cfg.seqSeed||1,imp.has('heijunka')),nP:cfg.nP,nW:cfg.nW};
  PN.forEach(p=>{S.super[p]=[];S.line[p]=[];S.LP[p]=[];S.LW[p]=[];S.stockT[p]=0;S.shortN[p]=0;});
  COMPS.forEach(c=>{S.cells[c]={post:[],job:null,busy:0,made:0,last:null,lastType:null,setups:0,boxes:0};});
  if(cfg.mode==='kanban'){
    PN.forEach(p=>{const c=p.split('-')[0];
      for(let i=0;i<cfg.nP[c];i++)S.super[p].push({id:cid++,pn:p,card:{k:'P',id:kid++,pn:p}});
      for(let i=0;i<cfg.nW[c];i++)S.line[p].push({id:cid++,pn:p,card:{k:'W',id:kid++,pn:p}});});
  } else PN.forEach(p=>S.line[p].push({id:cid++,pn:p,card:null}));

  const log=(k,a)=>{S.log.push({t:S.t,k,a:a||[]});if(S.log.length>60)S.log.shift();};
  const comp=p=>p.split('-')[0], typ=p=>p.split('-')[1];
  const sum=o=>PN.reduce((s,p)=>s+o[p].length,0);
  const load=()=>S.mizu.full.length+S.mizu.empty.length;
  /* S.human e' un array modificabile a partita in corso (accetta anche stringa/null per compatibilita') */
  const isH=r=>Array.isArray(S.human)?S.human.indexOf(r)>=0:S.human===r;
  const isHumanCell=c=>isH(c);
  const isHumanM=()=>isH('mizu');

  /* --- reparti --- */
  function startProd(c,card,ty){
    ty=card?typ(card.pn):ty;const cell=S.cells[c];
    const su=(cell.lastType&&cell.lastType!==ty)?SETUP[c]*(imp.has('smed')?P.smed:1):0;
    const d=draw(MEAN[c][ty])+su;cell.lastType=ty;if(su)cell.setups++;
    cell.job={pn:c+'-'+ty,card,rem:d,dur:d,setup:su,type:ty,start:S.t};
    if(card){cell.boxes=Math.max(0,cell.boxes-1);S.ev.push({k:'prodStart',c,kid:card.id,pn:card.pn});}
  }
  function finishProd(c){
    const cell=S.cells[c],j=cell.job;
    const nc={id:cid++,pn:j.pn,card:j.card};S.super[j.pn].push(nc);S.ev.push({k:'prodDone',c,pn:j.pn,cid:nc.id,kid:j.card?j.card.id:null});
    if(j.card)S.LP[j.pn].push(S.t-j.card.tPost);
    cell.last={pn:j.pn,dur:j.dur,setup:j.setup,mean:MEAN[c][j.type]};
    cell.job=null;cell.made++;S.produced++;
    log('made',[j.pn,j.dur,!!j.card]);
  }
  function cellsStep(dt){
    COMPS.forEach(c=>{const cell=S.cells[c];
      if(!cell.job&&!isHumanCell(c)){
        if(S.mode==='kanban'){if(cell.post.length)startProd(c,cell.post.shift());}
        else startProd(c,null,TYPES[Math.floor(R()*4)]);
      }
      if(cell.job){cell.busy+=dt;cell.job.rem-=dt;if(cell.job.rem<=0)finishProd(c);}
    });
  }
  /* --- assemblaggio finale --- */
  function asmMissing(){
    if(!S.queue.length)return null;
    const o=S.queue[0];return COMPS.map(c=>c+'-'+o.type).filter(p=>!S.line[p].length);
  }
  function startAsm(){
    const A=S.asm,o=S.queue.shift(),need=COMPS.map(c=>c+'-'+o.type);
    const its=[];need.forEach(p=>{const ct=S.line[p].shift();its.push({pn:p,kid:ct.card?ct.card.id:null});if(ct.card){ct.card.tEmpty=S.t;S.empties.push(ct);}});S.ev.push({k:'consume',type:o.type,items:its});
    const d=draw(P.asm);A.job={order:o,rem:d,dur:d};A.missing=[];A.ready=false;
  }
  function asmStep(dt){
    const A=S.asm;
    A.ready=false;
    if(!A.job&&S.queue.length){
      const o=S.queue[0],need=COMPS.map(c=>c+'-'+o.type),miss=need.filter(p=>!S.line[p].length);
      if(!miss.length){
        A.missing=[];
        if(isH('asm'))A.ready=true;   /* umano: aspetta l'azione 'assemble' */
        else startAsm();
      } else {
        if(A.missing.join()!==miss.join()){miss.filter(p=>!A.missing.includes(p)).forEach(p=>{S.shortN[p]++;log('short',[p]);});}
        A.missing=miss;o.waited=true;A.starve+=dt;miss.forEach(p=>S.stockT[p]+=dt);
      }
    }
    if(A.job){A.busy+=dt;A.job.rem-=dt;if(A.job.rem<=0){A.job.order.tDone=S.t;S.delivered.push(A.job.order);log('ship',[A.job.order.type]);A.job=null;}}
  }
  /* --- Mizusumashi --- */
  function findSwap(){
    for(const e of S.mizu.empty){const f=S.super[e.pn].find(x=>x.card&&x.card.k==='P');if(f)return{e,f};}
    return null;
  }
  function mCan(a){
    const M=S.mizu;
    if(S.ended)return'ended';
    if(M.act&&!(M.act.kind==='wait'&&isHumanM()))return'busy';
    switch(a){
      case'deliver':return M.loc!=='line'?'where':(!M.full.length?'nothing':'');
      case'collect':return M.loc!=='line'?'where':(S.mode!=='kanban'?'mode':(!S.empties.length?'noEmpty':(load()>=P.cart?'cartFull':'')));
      case'goSuper':return M.loc!=='line'?'where':'';
      case'swap':return M.loc!=='super'?'where':(S.mode!=='kanban'?'mode':(!M.empty.length?'noW':(!findSwap()?'noMatch':'')));
      case'loadAll':return M.loc!=='super'?'where':(S.mode!=='push'?'mode':(!sum(S.super)?'superEmpty':(load()>=P.cart?'cartFull':'')));
      case'goLine':return M.loc!=='super'?'where':'';
    }
    return'unknown';
  }
  function startM(kind,extra){
    const M=S.mizu;let d=0,data=null;
    if(kind==='deliver')d=Math.max(0.6,P.handle*M.full.length);
    if(kind==='collect'){const k=Math.min(S.empties.length,P.cart-load());d=Math.max(0.6,P.handle*k);data=k;}
    if(kind==='goSuper'||kind==='goLine'){d=P.travel*(0.9+R()*0.2);if(kind==='goSuper')M.trips++;}
    if(kind==='swap'){data=findSwap();d=P.swap;}
    if(kind==='loadAll'){const k=Math.min(P.cart-load(),sum(S.super));d=Math.max(0.6,P.handle*k);data=k;}
    if(kind==='wait')d=extra;
    M.act={kind,rem:d,dur:d,data};
    if(kind==='deliver')S.ev.push({k:'deliverStart',dur:d,items:M.full.map(c=>({pn:c.pn,cid:c.id,kid:c.card?c.card.id:null}))});
    if(kind==='collect')S.ev.push({k:'collectStart',dur:d,items:S.empties.slice(0,data).map(c=>({pn:c.pn,kid:c.card.id}))});
    if(kind==='swap'&&data)S.ev.push({k:'swapStart',dur:d,pn:data.f.pn,pk:data.f.card.id,wk:data.e.card.id,fc:data.f.id});
    if(kind==='loadAll'){const all=[];PN.forEach(p=>S.super[p].forEach(c=>all.push(c)));all.sort((x,y)=>x.id-y.id);S.ev.push({k:'loadStart',dur:d,items:all.slice(0,data).map(c=>({pn:c.pn,cid:c.id}))});}
    if(kind==='goSuper')log('mGo',[M.empty.length]);
  }
  function completeM(a){
    const M=S.mizu;
    switch(a.kind){
      case'deliver':
        M.full.forEach(f=>{S.line[f.pn].push(f);if(f.card&&f.card.tEmpty!=null){S.LW[f.pn].push(S.t-f.card.tEmpty);f.card.tEmpty=null;}});
        log('mDeliver',[M.full.length]);M.full=[];break;
      case'collect':{const got=S.empties.splice(0,a.data);M.empty.push(...got);log('mCollect',[got.length]);break;}
      case'goSuper':M.loc='super';M.pos=0;break;
      case'goLine':M.loc='line';M.pos=1;break;
      case'swap':{
        const{e,f}=a.data;const i=S.super[f.pn].indexOf(f),j=M.empty.indexOf(e);
        if(i<0||j<0)break;
        S.super[f.pn].splice(i,1);M.empty.splice(j,1);
        const pc=f.card;pc.tPost=S.t;S.cells[comp(f.pn)].post.push(pc);
        f.card=e.card;M.full.push(f);M.swaps++;S.cells[comp(f.pn)].boxes++;
        log('swap',[f.pn]);break;}
      case'loadAll':{
        const all=[];PN.forEach(p=>S.super[p].forEach(c=>all.push(c)));all.sort((x,y)=>x.id-y.id);
        all.slice(0,a.data).forEach(c=>{S.super[c.pn].splice(S.super[c.pn].indexOf(c),1);M.full.push(c);});
        log('mLoad',[a.data]);break;}
    }
    if(a.kind!=='wait')S.ev.push({k:'mDone',kind:a.kind});
  }
  function botMizu(){
    const M=S.mizu;
    if(M.loc==='line'){
      if(M.full.length)return startM('deliver');
      if(S.mode==='kanban'&&S.empties.length&&load()<P.cart)return startM('collect');
      if(S.t<M.nextDepart)return startM('wait',Math.min(0.5,M.nextDepart-S.t));
      while(M.nextDepart<=S.t)M.nextDepart+=S.pitch;
      if(S.mode==='kanban'&&!M.empty.length)return startM('wait',0.5);
      return startM('goSuper');
    }
    if(S.mode==='kanban'){if(findSwap())return startM('swap');}
    else if(sum(S.super)&&load()<P.cart)return startM('loadAll');
    return startM('goLine');
  }
  function mizuStep(dt){
    const M=S.mizu;
    if(M.act&&M.act.kind==='wait'&&isHumanM())M.act=null; /* ruolo appena preso da un umano: niente attese del bot */
    if(!M.act&&!isHumanM())botMizu();
    if(M.act){
      if(M.act.kind!=='wait')M.busy+=dt;
      M.act.rem-=dt;
      const pr=1-Math.max(0,M.act.rem)/M.act.dur;
      if(M.act.kind==='goSuper')M.pos=1-pr;
      if(M.act.kind==='goLine')M.pos=pr;
      if(M.act.rem<=0){const a=M.act;M.act=null;completeM(a);if(!isHumanM())botMizu();}
    }
  }
  function sample(){
    S.samples.push({t:S.t,sup:sum(S.super),line:sum(S.line),tr:S.mizu.full.length,bl:S.queue.length+(S.asm.job?1:0),post:COMPS.map(c=>S.cells[c].post.length)});
  }
  function step(dt){
    if(S.ended)return;
    S.t+=dt;
    while(S.orderIdx*P.takt<=S.t&&S.orderIdx*P.takt<S.dur){S.queue.push({id:S.orderIdx+1,type:S.seq[S.orderIdx],tArr:S.orderIdx*P.takt,waited:false});S.orderIdx++;}
    cellsStep(dt);asmStep(dt);mizuStep(dt);
    while(S.t>=S.nextSample){sample();S.nextSample+=2;}
    if(S.t>=S.dur){S.t=S.dur;S.ended=true;sample();}
  }
  /* --- azioni del giocatore --- */
  function can(role,a,arg){
    if(S.ended)return'ended';
    if(COMPS.indexOf(role)>=0){
      const cell=S.cells[role];
      if(a!=='produce'&&a!=='produceType')return'unknown';
      if(cell.job)return'busy';
      if(a==='produce')return S.mode!=='kanban'?'mode':(!cell.post.length?'noCard':'');
      if(a==='produceType')return S.mode!=='push'?'mode':((arg==null||TYPES.indexOf(arg)>=0)?'':'badType');
    }
    if(role==='asm'){
      if(a!=='assemble')return'unknown';
      if(S.asm.job)return'busy';
      const miss=asmMissing();
      if(!miss)return'noOrder';
      return miss.length?'missing':'';
    }
    if(role==='mizu')return mCan(a);
    return'unknown';
  }
  function act(role,a,arg){
    if(can(role,a,arg))return false;
    if(COMPS.indexOf(role)>=0){
      if(a==='produce'){const cd=S.cells[role].post.shift();startProd(role,cd);log('pTake',[cd.pn]);}
      else startProd(role,null,TYPES.indexOf(arg)>=0?arg:TYPES[0]);
      return true;
    }
    if(role==='asm'){startAsm();return true;}
    if(S.mizu.act&&S.mizu.act.kind==='wait')S.mizu.act=null;
    startM(a);return true;
  }
  function wip(){return sum(S.super)+sum(S.line)+S.mizu.full.length+COMPS.filter(c=>S.cells[c].job).length;}
  function result(){
    const bl=S.queue.length+(S.asm.job?1:0),w=wip(),d=S.delivered.length;
    const tt=Math.max(1,S.t);
    const pend=S.queue.concat(S.asm.job?[S.asm.job.order]:[]),nAll=d+pend.length;
    const lead=nAll?(S.delivered.reduce((s,o)=>s+(o.tDone-o.tArr),0)+pend.reduce((s,o)=>s+(S.t-o.tArr),0))/nAll:null;
    const noWait=nAll?S.delivered.filter(o=>!o.waited).length/nAll:0;
    const fam=o=>{const r={};COMPS.forEach(c=>{const a=[];TYPES.forEach(ty=>a.push(...o[c+'-'+ty]));r[c]=a.length?a.reduce((s,x)=>s+x,0)/a.length:null;});return r;};
    const util={};COMPS.forEach(c=>util[c]=Math.min(1,S.cells[c].busy/tt));util.asm=Math.min(1,S.asm.busy/tt);util.mizu=Math.min(1,S.mizu.busy/tt);
    return{mode:S.mode,t:tt,dur:S.dur,delivered:d,backlog:bl,wip:w,orders:S.orderIdx,
      points:d*P.ptsDone-bl*P.ptsBacklog-w*P.ptsWip,lead,noWait,
      LPf:fam(S.LP),LWf:fam(S.LW),stockT:Object.assign({},S.stockT),shortN:Object.assign({},S.shortN),
      util,produced:S.produced,setups:COMPS.reduce((o,c)=>(o[c]=S.cells[c].setups,o),{}),samples:S.samples,
      wipAvg:S.samples.length?S.samples.reduce((s,x)=>s+x.sup+x.line+x.tr,0)/S.samples.length:0,
      starve:S.asm.starve,trips:S.mizu.trips,swaps:S.mizu.swaps,
      nP:cfg.nP,nW:cfg.nW,imp:[...imp],human:S.human,cards:cfg.mode==='kanban'?COMPS.reduce((s,c)=>s+4*(cfg.nP[c]+cfg.nW[c]),0):0};
  }
  /* --- mappa delle azioni possibili (per abilitare i pulsanti) --- */
  const ACTIONS={legs:['produce','produceType'],body:['produce','produceType'],head:['produce','produceType'],asm:['assemble'],
    mizu:['deliver','collect','goSuper','swap','loadAll','goLine']};
  function canMap(){
    const o={};for(const r in ACTIONS){o[r]={};ACTIONS[r].forEach(a=>{o[r][a]=can(r,a);});}
    return o;
  }
  /* --- istantanea JSON pura per il client --- */
  function snapshot(){
    const M=S.mizu,A=S.asm;
    let act=null;
    if(M.act){
      act={kind:M.act.kind,rem:M.act.rem,dur:M.act.dur,data:null};
      const d=M.act.data;
      if(d&&typeof d==='object'&&d.e&&d.f)act.data={pn:d.f.pn,pk:d.f.card?d.f.card.id:null,wk:d.e.card?d.e.card.id:null,fc:d.f.id,ec:d.e.id};
      else if(typeof d==='number')act.data=d;
    }
    const v={t:S.t,dur:S.dur,mode:S.mode,ended:S.ended,pitch:S.pitch,cv:S.cv,human:Array.isArray(S.human)?S.human.slice():(S.human?[S.human]:[]),
      imp:[...imp],nP:S.nP,nW:S.nW,
      super:S.super,line:S.line,empties:S.empties,cells:S.cells,
      asm:{job:A.job,busy:A.busy,starve:A.starve,missing:A.missing,ready:A.ready},
      mizu:{loc:M.loc,pos:M.pos,act,full:M.full,empty:M.empty,nextDepart:M.nextDepart,busy:M.busy,trips:M.trips,swaps:M.swaps,load:load()},
      queue:S.queue.slice(0,10),queueN:S.queue.length,
      delivered:{n:S.delivered.length,last:S.delivered.slice(-6)},
      log:S.log,wip:wip(),orderIdx:S.orderIdx,produced:S.produced,
      can:canMap(),swapPossible:!!findSwap()};
    return JSON.parse(JSON.stringify(v));
  }
  return{S,step,can,act,result,wip,load,findSwap,snapshot,canMap};
}
const KG={makeSim,P,TYPES,COMPS,PN,MEAN,SETUP,makeSeq};
if(typeof module!=='undefined'&&module.exports)module.exports=KG;
if(typeof window!=='undefined')window.KG=KG;

})(typeof globalThis!=='undefined'?globalThis:this);
