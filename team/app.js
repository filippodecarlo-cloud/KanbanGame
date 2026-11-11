/* Fattoria LEGO a squadre — client del browser (W2).
   Il server fa girare la simulazione e invia istantanee S + eventi ev via SSE; qui si disegna e si inviano le azioni. */
(function(){
'use strict';
const KG=window.KG||{};
const TYPES=KG.TYPES||['cow','horse','sheep','duck'];
const COMPS=KG.COMPS||['legs','body','head'];
const PN=KG.PN||(()=>{const a=[];COMPS.forEach(c=>TYPES.forEach(ty=>a.push(c+'-'+ty)));return a;})();
const MEAN=KG.MEAN||{legs:{cow:3,horse:4,sheep:3,duck:2},body:{cow:5.5,horse:5.5,sheep:7,duck:5},head:{cow:3,horse:3,sheep:2,duck:3}};
const P=KG.P||{takt:8,asm:5,travel:3,swap:1.4,handle:0.4,cart:8,pitch:20,pitchFast:10,ptsDone:10,ptsBacklog:5,ptsWip:1};
const INK='#1c2427';
const ROLES=['legs','body','head','mizu','asm'];
const IMPS=['heijunka','pitch','smed','std'];
const DUR_OPTS=[120,180,240,300];
const EST={LP:{legs:4,body:10,head:4},LW:{legs:34,body:34,head:34}};
const ALPHA=0.1;

/* ---------- Modelli LEGO (da animal.js) ---------- */
const BW={'2x4':4,'2x3':3,'2x2':2,'1x2':1};
const BCOL={k:'#2b2b2b',w:'#f3f0e8',t:'#d8c690',b:'#9b5a2c',d:'#6b3a17',r:'#cc2f27',c:'#f6eccf',o:'#ee8a22',y:'#f4c430'};
const B=(s,x,y,c)=>({s,x,y,c});
const MODEL={
 cow:{legs:[B('1x2',0,0,'k'),B('1x2',3,0,'k')],body:[B('2x4',0,1,'w'),B('2x4',0,2,'k')],head:[B('2x2',3,3,'w'),B('1x2',3,4,'t')]},
 horse:{legs:[B('1x2',0,0,'b'),B('1x2',3,0,'b'),B('1x2',0,1,'b'),B('1x2',3,1,'b')],body:[B('2x4',0,2,'b'),B('2x2',1,3,'r')],head:[B('1x2',3,3,'b'),B('2x2',3,4,'d')]},
 sheep:{legs:[B('1x2',0,0,'k'),B('1x2',3,0,'k')],body:[B('2x4',0,1,'c'),B('2x4',0,2,'c'),B('2x2',1,3,'c')],head:[B('2x2',3,3,'k')]},
 duck:{legs:[B('2x2',1,0,'o')],body:[B('2x4',0,1,'y'),B('2x2',0,2,'y')],head:[B('2x2',3,2,'o'),B('2x2',2,3,'y')]}
};
const BU=10,BH=9;
function brickRect(b,ox,base,ghost){
  const w=BW[b.s]*BU,x=ox+b.x*BU,y=base-(b.y+1)*BH;
  if(ghost)return'<rect x="'+x+'" y="'+y+'" width="'+w+'" height="'+BH+'" fill="none" stroke="#6f7c82" stroke-width=".8" stroke-dasharray="2 1.6" opacity=".7"/>';
  let s='';for(let i=0;i<BW[b.s];i++)s+='<rect x="'+(x+i*BU+2.5)+'" y="'+(y-1.8)+'" width="5" height="2" fill="'+BCOL[b.c]+'" stroke="'+INK+'" stroke-width=".6"/>';
  return s+'<rect x="'+x+'" y="'+y+'" width="'+w+'" height="'+BH+'" fill="'+BCOL[b.c]+'" stroke="'+INK+'" stroke-width=".8"/>';
}
function drawModel(type,o){
  o=o||{};const m=MODEL[type];if(!m)return'';const comps=o.only?[o.only]:['legs','body','head'];
  let list=[];comps.forEach(c=>m[c].forEach((b,i)=>list.push({b,c,i})));
  list.sort((p,q)=>p.b.y-q.b.y);
  let x0=0,x1=5,y1=5;
  if(o.only){x0=Math.min(...list.map(e=>e.b.x));x1=Math.max(...list.map(e=>e.b.x+BW[e.b.s]));}
  const ymin=o.only?Math.min(...list.map(e=>e.b.y)):0;y1=o.only?Math.max(...list.map(e=>e.b.y))+1:5;
  const base=(y1)*BH+4,ox=2-x0*BU,W=(x1-x0)*BU+4,H=(y1-ymin)*BH+5;
  let out='';
  list.forEach(e=>{
    const present=o.only?(o.n==null||e.i<o.n):(!o.have||o.have.includes(e.c));
    if(present)out+=brickRect(e.b,ox,base,false);else if(o.ghost!==false)out+=brickRect(e.b,ox,base,true);
  });
  if(!o.only||o.only==='head'){
    const hb=m.head.filter(b=>b.s==='2x2').pop();const idx=m.head.indexOf(hb);
    const shown=o.only?(o.n==null||idx<o.n):(!o.have||o.have.includes('head'));
    if(hb&&shown)out+='<circle cx="'+(ox+(hb.x+1.4)*BU)+'" cy="'+(base-(hb.y+1)*BH+3.6)+'" r="1.3" fill="'+((hb.c==='k'||hb.c==='d')?'#fff':INK)+'"/>';
  }
  const w=o.w||50,vy=base-(y1)*BH-3;
  return'<svg viewBox="0 '+vy+' '+W+' '+H+'" width="'+w+'" height="'+Math.round(w*H/W)+'" aria-hidden="true">'+out+'</svg>';
}
function brickChip(s,c){return'<svg viewBox="0 0 '+(BW[s]*BU+4)+' 15" width="'+Math.round((BW[s]*BU+4)*1.1)+'" height="16" aria-hidden="true">'+brickRect({s,x:0,y:0,c},2,13,false)+'</svg>';}

/* ---------- Testi (solo italiano) ---------- */
const TXT={
 title:'Fattoria LEGO a squadre',kicker:'Serious game a squadre · Lean production',
 lead:'Tre reparti costruiscono zampe, corpi e teste; un supermarket li separa dall\'assemblaggio finale. Ognuno della squadra prende un ruolo dal proprio telefono: due cartellini, uno di produzione e uno di prelievo, governano tutto lo stabilimento senza un programma centrale.',
 t_cow:'Mucca',t_horse:'Cavallo',t_sheep:'Pecora',t_duck:'Papera',ab_cow:'Mu',ab_horse:'Ca',ab_sheep:'Pe',ab_duck:'Pa',
 c_legs:'Zampe',c_body:'Corpo',c_head:'Testa',d_legs:'Reparto Zampe',d_body:'Reparto Corpi',d_head:'Reparto Teste',
 bomT:'Distinta base',bomD:'Ogni animale è fatto esattamente di questi mattoncini: i disegni del gioco li mostrano uno per uno. Più mattoncini ha un componente, più tempo richiede.',
 r1t:'Push',r2t:'Doppio kanban',r3t:'Kaizen',
 r1d:'I reparti producono su previsione. Il Mizusumashi porta alla linea tutto quello che trova.',
 r2d:'Decidete insieme quanti kanban di produzione (P) e di prelievo (W) mettere in circolo. Si produce e si movimenta solo con un cartellino.',
 r3d:'Misurate i lead time dei due anelli, ricalcolate i cartellini e scegliete due miglioramenti.',
 role_legs:'Reparto Zampe',role_body:'Reparto Corpi',role_head:'Reparto Teste',role_mizu:'Mizusumashi',role_asm:'Assemblaggio finale',
 role_legs_d:'Costruisci le zampe: un pezzo alla volta.',role_body_d:'Costruisci i corpi: i pezzi più lunghi da montare.',role_head_d:'Costruisci le teste.',
 role_mizu_d:'Fai il giro tra linea e supermarket e scambi i cartellini P ↔ W.',role_asm_d:'Monti l\'animale ordinato quando i tre pezzi sono a bordo linea.',
 scoring:'Punteggio: +10 per ogni animale spedito, −5 per ogni ordine non evaso a fine round, −1 per ogni contenitore di scorta rimasto in stabilimento.',
 demand:'Il cliente ordina un animale ogni 8 secondi (takt time).',
 credit:'Ispirato al <a href="https://www.organizeagile.com/update/lego-kanban-game" target="_blank" rel="noopener">Lego Animal Farm Kanban Game</a> di Organize Agile; ciclo a due cartellini secondo Monden, <i>Toyota Production System</i>.',
 round:'Round',shipped:'Spediti',waiting:'In attesa',stock:'Scorte',
 z_dept:'Reparti',z_super:'Supermarket',z_mizu:'Mizusumashi',z_line:'Bordo linea',z_asm:'Assemblaggio finale',
 you:'Tu',auto:'auto',
 st_lobby:'Sala',st_g1:'Round 1',st_s1:'Esito 1',st_inter:'Intermezzo',st_g2:'Round 2',st_s2:'Esito 2',st_retro:'Retrospettiva',st_g3:'Round 3',st_s3:'Esito 3',st_debrief:'Debriefing',
 animOn:'Animazioni: sì',animOff:'Animazioni: no',postP:'Cassetta kanban P',postW:'Cassetta kanban W',emptiesL:'Vuoti',ci_legs:'Z',ci_body:'C',ci_head:'T',kPn:'Kanban di produzione',kWn:'Kanban di prelievo',cFull:'Pieni',cW:'Kanban W in mano',stopS:'supermarket',stopL:'bordo linea',swapCap:x=>'Scambio '+x+': stacca P, attacca W',
 legend:(a,b)=>'Come leggere i cartellini: '+a+' kanban di produzione per Zampe Mucca · '+b+' kanban di prelievo per Corpo Papera. Z = zampe, C = corpo, T = testa.',
 idle:'Fermo: nessun kanban',idlePush:'In attesa',working:'Costruisce',setup:x=>'cambio tipo +'+x+' s',last:(d,m)=>'ultimo pezzo: '+d+' s (standard '+m+' s)',
 nextTrip:s=>'prossimo giro tra '+s+' s',
 m_deliver:'Consegna a bordo linea',m_collect:'Raccoglie kanban W e vuoti',m_goSuper:'Va al supermarket',m_goLine:'Torna alla linea',m_swap:'Scambia i cartellini',m_loadAll:'Carica i contenitori',m_wait:'Aspetta il prossimo giro',m_idle:'Fermo',
 asmWork:x=>'Assembla: '+x,asmWait:'In attesa di ordini',asmStarve:'Linea ferma. Manca:',asmReady:x=>'Pezzi pronti per: '+x,next:'Prossimi ordini',truck:'Spediti',
 b_take:'Prendi il kanban P e costruisci',b_deliver:'Consegna i pieni',b_collect:'Raccogli kanban W e vuoti',b_goSuper:'Vai al supermarket',b_swap:'Scambia P ↔ W',b_loadAll:'Carica i contenitori',b_goLine:'Torna alla linea',b_asm:'Assembla il prossimo ordine',
 h_push:'Nessun cartellino: decidi tu che cosa costruire, guardando gli ordini in arrivo.',h_noCard:'Cassetta vuota: nessun kanban, nessuna produzione.',h_nextCard:x=>'Prossimo kanban nella cassetta: '+x+'.',h_building:(x,s)=>'Stai costruendo '+x+'… ancora '+s+' s.',
 h_m_busy:(x,s)=>x+'… '+s+' s.',h_m_line:'Sei a bordo linea.',h_m_super:'Sei al supermarket.',h_m_noMatch:'Nessuno scambio possibile: i pezzi richiesti non sono nel supermarket.',
 h_a_busy:(x,s)=>'Stai assemblando: '+x+'… ancora '+s+' s.',h_a_none:'Nessun ordine in attesa.',h_a_miss:x=>'Non puoi assemblare: manca '+x+'.',h_a_ready:x=>'Pezzi pronti: assembla '+x+'!',
 e_made:(o,x,k)=>o+' deposita '+x+' nel supermarket'+(k?' con il suo kanban P':''),e_pTake:x=>'Kanban P preso dalla cassetta: '+x,e_swap:x=>'Scambio su '+x+': kanban P alla cassetta del reparto, kanban W sul contenitore',
 e_mGo:n=>'Il Mizusumashi parte per il supermarket con '+n+' kanban W',e_mCollect:n=>'Raccolti '+n+' kanban W e vuoti',e_mDeliver:n=>'Consegnati '+n+' contenitori a bordo linea',e_mLoad:n=>'Caricati '+n+' contenitori',e_short:x=>'Mancante a bordo linea: '+x,e_ship:x=>'Spedito: '+x,
 sumTitle:n=>'Fine del round '+n,pts:'Punti',row_done:'Animali spediti',row_bl:'Ordini non evasi',row_wip:'Contenitori di scorta',total:'Totale',
 m_lead:'Lead time ordine',m_leadS:'dall\'ordine alla spedizione',m_serv:'Ordini senza attesa',m_servS:'pezzi già a bordo linea',m_wip:'Scorta media',m_wipS:'contenitori in stabilimento',m_trips:'Giri del Mizusumashi',m_tripsS:n=>n+' scambi di cartellini',sec:'s',
 ch_inv:'Scorte nel tempo (contenitori)',ch_bl:'Ordini in attesa nel tempo',l_sup:'Supermarket',l_line:'Bordo linea',l_tr:'Sul carrello',cap:n=>'tetto dei cartellini: '+n,
 util:'Utilizzo delle risorse',famT:'I due anelli, misurati',f_fam:'Famiglia',f_LP:'L_P medio',f_LW:'L_W medio',f_short:'Linea ferma per mancante',
 pushNote:(u,w,d)=>'Reparti occupati al '+u+'% e '+w+' contenitori di scorta, ma solo '+d+(d===1?' animale spedito.':' animali spediti.')+' Si è prodotto molto, ma non quello che serviva.',
 kanNote:(c,w)=>'Con '+c+' cartellini in circolo la scorta non può superare '+c+' contenitori: a fine round erano '+w+'.',
 next1:'Vai all\'intermezzo',next2:'Vai alla retrospettiva',next3:'Vai al debriefing',anyoneNext:'Chiunque della squadra può proseguire: si va avanti tutti insieme.',
 imTitle:'Intermezzo: il sistema a due cartellini',
 loopP:'Anello di produzione',loopW:'Anello di prelievo',lp1:'kanban P alla cassetta del reparto',lp2:'pezzo + kanban P',lw1:'kanban W + contenitore vuoto',lw2:'pieno + kanban W',
 kP:'<span class="kc p">P</span> <b>Kanban di produzione</b>: autorizza il reparto a produrre un contenitore. Gira solo tra reparto e supermarket.',
 kW:'<span class="kc w">W</span> <b>Kanban di prelievo (o movimentazione)</b>: autorizza a spostare un contenitore dal supermarket alla linea. Gira solo tra supermarket e bordo linea.',
 cycT:'Il ciclo, passo per passo',
 cyc:['A bordo linea, quando si inizia a usare un contenitore, il suo kanban W viene staccato e messo nella cassetta dei kanban W.','A intervalli regolari il Mizusumashi raccoglie i kanban W e i contenitori vuoti e va al supermarket del reparto a monte.','Per ogni kanban W prende un contenitore pieno dello stesso codice: stacca il kanban P e lo mette nella cassetta del reparto, attacca il kanban W al suo posto e lascia il vuoto.','Riporta i pieni a bordo linea.','Il reparto produce seguendo i kanban P nell\'ordine di arrivo. Il pezzo finito torna nel supermarket con il suo kanban P.'],
 rulT:'Tre regole',rul:['Niente kanban, niente produzione e niente trasporto.','Ogni contenitore pieno porta sempre un cartellino: il numero di cartellini è il tetto delle scorte.','Il kanban P non esce mai dall\'anello di produzione; il kanban W non entra mai nel reparto.'],
 forT:'Quanti cartellini?',forD:'D = domanda del codice · L = lead time dell\'anello · α = margine di sicurezza (10%) · a = pezzi per contenitore (1)',
 forDem:'Ogni codice è richiesto in media una volta ogni 32 s (takt 8 s × 4 animali).',estNote:'I lead time qui sotto sono stime: li verificherete con i dati del round 2.',measNote:'Lead time misurati nel round 2.',
 f_calc:'calcolo',f_your:'La vostra scelta',capNow:n=>'Scorta massima con questa scelta: '+n+' contenitori.',
 sharedNote:'Scelta condivisa: ogni modifica si vede subito sui telefoni di tutta la squadra.',
 start2:'Inizia il round 2',start3:'Inizia il round 3',
 retroTitle:'Retrospettiva',retroLead:'Guardate dove la linea si è fermata, ricalcolate i cartellini e scegliete che cosa migliorare.',
 i_short:(x,s)=>'Mancante più grave: '+x+', linea ferma per '+s+' s.',i_noShort:'Nessun mancante: la linea non si è mai fermata. Potete togliere cartellini?',
 i_serv:p=>'Ordini evasi senza attesa: '+p+'%.',i_alpha:'La formula usa la domanda media. Con ordini casuali la domanda di un codice oscilla molto: o alzate α (più cartellini), oppure riducete la variabilità.',
 chooseImp:'Scegliete fino a 2 miglioramenti',maxImp:'Al massimo 2: toglietene uno per sceglierne un altro.',
 imp_heijunka:'Heijunka',imp_heijunka_d:'Livella la sequenza degli ordini all\'assemblaggio: mucca, pecora, cavallo, papera e così via.',
 imp_pitch:'Giri più frequenti',imp_pitch_d:'Il Mizusumashi automatico parte ogni 10 s invece di 20: si accorcia L_W.',
 imp_smed:'SMED',imp_smed_d:'Cambio tipo nei reparti ridotto del 70%: si accorcia L_P.',
 imp_std:'Lavoro standard',imp_std_d:'Tempi di costruzione molto più regolari: la variabilità scende da ±25% a ±8%.',
 adjust:'Regolate i cartellini',notes:'Note (solo su questo dispositivo)',
 dbTitle:'Debriefing',cmp:'Confronto tra i round',h_round:'Round',h_pts:'Punti',h_done:'Spediti',h_bl:'Non evasi',h_wip:'Scorta finale',h_lead:'Lead time',h_serv:'Senza attesa',h_cards:'Cartellini',ptsChart:'Punti per round',
 insTitle:'Che cosa dicono i dati',d1:(a,b)=>'Dal push al kanban: scorta finale da '+a+' a '+b+' contenitori.',d2:(a,b)=>'Animali spediti: '+a+' nel round 1, '+b+' nel round 3.',d3:(a,b)=>'Lead time dell\'ordine: '+a+' s nel round 2, '+b+' s nel round 3.',
 d_heij:'Con la heijunka la domanda di ogni codice diventa regolare: bastano i cartellini della formula con α = 10%.',d_noheij:'Senza livellamento servono cartellini in più per coprire i picchi: è il motivo per cui Toyota tiene α sotto il 10% solo dopo aver livellato.',
 qTitle:'Domande per la discussione',
 q:['Nel round 1 i reparti erano sempre occupati: perché sono stati spediti così pochi animali?','Nel sistema kanban, chi autorizza la produzione? E chi autorizza il trasporto?','Perché servono due cartellini diversi? Che cosa succederebbe con uno solo?','Che relazione c\'è tra numero di cartellini e scorta massima?','La formula bastava a evitare i mancanti? Che cosa copre il margine α?','Quale miglioramento vi ha permesso di togliere cartellini, e perché?','Che cosa succede a valle se il Mizusumashi salta un giro?','Come vi siete coordinati tra ruoli? Chi aveva bisogno di sapere che cosa?'],
 lTitle:'Cosa portarsi a casa',
 l:['In push l\'utilizzo è alto e le scorte crescono, ma i mancanti restano: si produce il mix sbagliato.','Due anelli: il kanban P autorizza a produrre, il kanban W autorizza a movimentare. Si incontrano solo al supermarket.','Il numero di cartellini fissa la scorta massima di ogni codice.','N = D · L · (1 + α) / a: per togliere cartellini si accorcia il lead time o si riduce la variabilità.','Il livellamento (heijunka) è il presupposto del kanban, non un accessorio.','Togliere un cartellino alla volta fa emergere i problemi: è il kanban come strumento di kaizen.'],
 copy:'Copia i risultati',copied:'Copiato negli appunti.',copyFail:'Copia non riuscita: seleziona il testo qui sotto.',team:'Squadra',none:'nessuno',impL:'Miglioramenti',
 /* ingresso e sala */
 fTeam:'Nome della squadra',fName:'Il tuo nome',enter:'Entra nello stabilimento',sameTeam:'Chi scrive lo stesso nome di squadra entra nello stesso stabilimento.',
 errTeam:'Scrivi il nome della squadra (lettere o numeri).',errName:'Scrivi il tuo nome.',
 noServer:'Il server di gioco non risponde. Riprova tra qualche secondo (al primo avvio può servire fino a un minuto) oppure gioca la versione a giocatore singolo.',
 soloLink:'Versione a giocatore singolo',retry:'Riprova',checking:'Collegamento al server…',
 teacherQ:'Sei il docente?',pinL:'PIN docente',openReg:'Apri la regia',resetMsg:'Il docente ha azzerato la sessione: rientrate con il nome della squadra.',
 lobbyT:'Sala della squadra',lobbyLead:'Tocca un ruolo per prenderlo o lasciarlo; puoi tenerne più di uno. I ruoli liberi lavorano in automatico.',
 members:'In squadra',take:'Tocca per prendere',leave:'Tuo · tocca per lasciare',free:'Libero · automatico',heldBy:x=>'Preso da '+x,
 start1:'Inizia il round 1',startNote:'Chiunque della squadra può far partire il round: mettetevi d\'accordo!',durNote:s=>'Ogni round dura '+clock(s)+' minuti.',
 roleStrip:'Ruoli',noRole:'Non hai un ruolo: tocca un ruolo libero qui sopra per entrare in gioco.',spect:'Spettatore',spectNote:'Modalità spettatore: solo visione.',
 starting:'Lo stabilimento si sta avviando…',waitRes:'In attesa dei risultati…',offline:'offline · riconnessione…',online:'in linea',
 err_taken:'Ruolo già preso da un compagno.',err_net:'Connessione assente: riprova.',err_generic:'Operazione non riuscita.',
 /* regia */
 tvTitle:'Regia del docente',tvLink:'Link per gli studenti',tvCopy:'Copia',tvDur:'Durata dei round',tvDurNote:'Vale per i round che partono da adesso.',
 tvReset:'Azzera la sessione',tvResetQ:'Tutte le squadre e tutti i risultati verranno cancellati. Confermi?',tvResetYes:'Sì, azzera tutto',tvCancel:'Annulla',tvResetDone:'Sessione azzerata.',
 tvBoard:'Classifica dal vivo',tvTeams:n=>n===1?'1 squadra':n+' squadre',tvNone:'Nessuna squadra collegata. Proiettate il link qui sopra e fate entrare gli studenti.',
 th_rank:'#',th_team:'Squadra',th_phase:'Fase',th_cards:'Cartellini',th_imp:'Miglioramenti',th_live:'In partita',th_view:'',tvWatch:'Guarda',
 tvPinBad:'PIN docente non valido.',tvPinHelp:'Controlla il PIN (variabile DOCENTE_PIN del server) e riprova.',tvNoSrv:'Server non raggiungibile: nuovo tentativo tra poco…',tvUpd:s=>'aggiornato alle '+s,tvDurSet:s=>'Durata dei prossimi round: '+clock(s)+' minuti.',
 tvLiveTxt:(r,d,w,s)=>r+' rimasti · '+d+' spediti · '+w+' in attesa · '+s+' scorte'
};
const t=(k,...a)=>{const v=TXT[k];return typeof v==='function'?v(...a):(v===undefined?k:v);};
const esc=s=>String(s==null?'':s).replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
function clock(s){s=Math.max(0,Math.ceil(s||0));return Math.floor(s/60)+':'+String(s%60).padStart(2,'0');}
const nf=(x,d)=>x==null||isNaN(x)?'–':Number(x).toLocaleString('it-IT',{maximumFractionDigits:d==null?1:d,minimumFractionDigits:0});
const tn=ty=>t('t_'+ty);
const secs=x=>x==null||isNaN(x)?'–':nf(x,1)+' s';
const pnName=p=>{const a=String(p).split('-');return t('c_'+a[0])+' '+tn(a[1]);};
const full=(ty,w)=>drawModel(ty,{w});
const CART='<svg viewBox="0 0 40 24" width="40" height="24" aria-hidden="true"><rect x="3" y="4" width="26" height="12" rx="1.5" fill="#3d5a80" stroke="'+INK+'"/><path d="M29 14h8" stroke="'+INK+'" stroke-width="2"/><circle cx="10" cy="19" r="3.4" fill="'+INK+'"/><circle cx="24" cy="19" r="3.4" fill="'+INK+'"/></svg>';

/* ---------- Archiviazione locale (sempre protetta) ---------- */
function lsGet(k){try{return localStorage.getItem(k);}catch(e){return null;}}
function lsSet(k,v){try{localStorage.setItem(k,v);}catch(e){}}
function ssGet(k){try{return sessionStorage.getItem(k);}catch(e){return null;}}
function ssSet(k,v){try{sessionStorage.setItem(k,v);}catch(e){}}

/* ---------- Stato del client ---------- */
const Q=new URLSearchParams(location.search);
const G={
  base:String(Q.get('server')||window.KG_SERVER||'').replace(/\/+$/,''),
  cid:ssGet('kg_cid')||('c'+Math.random().toString(36).slice(2,10)+Date.now().toString(36).slice(-4)),
  me:lsGet('kg_name')||'',team:Q.get('room')||lsGet('kg_team')||'',
  view:Q.get('view')==='1',pin:Q.get('docente'),
  room:null,es:null,online:false,everOnline:false,R:null,peers:[],sess:{dur:180},S:null,
  anim:lsGet('kg_anim')!=='0',screen:'entry',notes:'',pend:{},entryMsg:'',ping:null,abarKey:'',retryT:null
};
ssSet('kg_cid',G.cid);
const cache={};
const $=s=>document.querySelector(s);
const enc=encodeURIComponent;

function api(p,body){
  const opt=body===undefined?{cache:'no-store'}:{method:'POST',headers:{'Content-Type':'text/plain;charset=utf-8'},body:JSON.stringify(body)};
  return fetch(G.base+p,opt).then(r=>r.json());
}
function op(o){
  if(!G.room||G.view)return Promise.resolve({ok:false});
  return api('/api/op?room='+enc(G.room),Object.assign({c:G.cid},o)).then(r=>{if(r&&!r.ok&&o.a!=='act'&&!(o.a==='next'&&r.error==='phase'))toast(errText(r.error));return r;}).catch(()=>{toast(t('err_net'));return{ok:false};});
}
function errText(e){if(!e)return t('err_generic');if(/taken|occup|preso/i.test(e))return t('err_taken');return t('err_generic')+' ('+e+')';}
let toastT=null;
function toast(msg){const el=$('#toast');if(!el)return;el.textContent=msg;el.hidden=false;el.classList.toggle('up',!!document.getElementById('abar'));clearTimeout(toastT);toastT=setTimeout(()=>{el.hidden=true;},2600);}
function teamLabel(n){n=String(n||'');return /^squadra\b/i.test(n)?n:t('team')+' '+n;}
function soloHref(){return /\/team(\/|\/index\.html)?$/.test(location.pathname)?'../index.html':'/solo/';}
function roomIdOf(s){return String(s||'').normalize('NFD').replace(/[̀-ͯ]/g,'').toUpperCase().trim().replace(/\s+/g,'-').replace(/[^A-Z0-9_-]/g,'').slice(0,24);}

/* ---------- Ruoli e operatori ---------- */
const R=()=>G.R||{roles:{},cfg:{nP:{legs:2,body:2,head:2},nW:{legs:2,body:2,head:2},imp:[]},results:[],phase:'lobby',round:0};
function peerName(c){const p=G.peers.find(x=>x.c===c);return p?p.name:'giocatore';}
const holder=r=>(R().roles||{})[r]||null;
const mine=r=>!G.view&&holder(r)===G.cid;
const myRoles=()=>ROLES.filter(mine);
function opChip(r){
  const h=holder(r);
  if(!h)return'<span class="op auto">'+t('auto')+'</span>';
  if(h===G.cid&&!G.view)return'<span class="op you">'+t('you')+'</span>';
  return'<span class="op" title="'+esc(peerName(h))+'">'+esc(peerName(h))+'</span>';
}
const opName=r=>{const h=holder(r);return !h?t('auto'):(h===G.cid&&!G.view?t('you'):peerName(h));};

/* ---------- Connessione SSE ---------- */
function setOnline(on){
  G.online=on;if(on)G.everOnline=true;
  const ob=$('#offbar');if(ob)ob.hidden=on||!G.room;
  renderTop();
}
function connect(){
  if(G.es){try{G.es.close();}catch(e){}}
  clearTimeout(G.retryT);
  const u=G.base+'/api/events?room='+enc(G.room)+'&c='+enc(G.cid)+'&name='+enc(G.view?t('spect'):G.me)+(G.view?'&view=1':'');
  let es;try{es=new EventSource(u);}catch(e){setOnline(false);G.retryT=setTimeout(()=>{if(G.room)connect();},3000);return;}
  G.es=es;
  es.onopen=()=>{if(G.es===es)setOnline(true);};
  es.onerror=()=>{if(G.es!==es)return;setOnline(false);
    if(es.readyState===2)G.retryT=setTimeout(()=>{if(G.es===es&&G.room)connect();},3000);}; /* chiusa per errore HTTP: riprova a mano */
  es.onmessage=e=>{if(G.es!==es)return;let m;try{m=JSON.parse(e.data);}catch(x){return;}onMsg(m);};
}
function onMsg(m){
  switch(m.type){
    case'init':{
      G.R=m.room;G.peers=m.peers||[];if(m.session)G.sess=m.session;
      G.S=(m.room&&m.room.phase&&m.room.phase[0]==='g'&&m.S)?m.S:null;
      setOnline(true);clearFx();
      if(!G.view&&G.team&&m.room&&(!m.room.name||m.room.name===m.room.id)&&G.team.trim()!==m.room.id&&roomIdOf(G.team)===m.room.id)op({a:'name',name:G.team.trim().slice(0,24)});
      render();break;}
    case'peers':G.peers=m.peers||[];refresh();break;
    case'state':{
      const old=G.R?G.R.phase:null;G.R=m.room;
      if(old!==G.R.phase){if(G.R.phase[0]==='g')G.S=null;render();}
      else refresh();
      break;}
    case'tick':{
      if(!G.R||!G.R.phase||G.R.phase[0]!=='g'||!m.S)break;
      const had=!!G.S;G.S=m.S;
      if(!had||!document.getElementById('z-dept')){render();break;}
      if(G.anim&&Array.isArray(m.ev))m.ev.forEach(e=>{try{handleEv(e);}catch(x){}});
      updateGame();break;}
    case'reset':onReset();break;
  }
}
function onReset(){
  if(G.es){try{G.es.close();}catch(e){}}G.es=null;clearTimeout(G.retryT);
  G.room=null;G.R=null;G.S=null;G.view=false;G.notes='';clearFx();ssSet('kg_joined','');
  G.entryMsg=t('resetMsg');
  try{history.replaceState(null,'',location.pathname+(Q.get('server')?'?server='+enc(Q.get('server')):''));}catch(e){}
  setOnline(true);render();
}
function join(team,name){
  G.team=team;G.me=name;lsSet('kg_team',team);lsSet('kg_name',name);
  G.room=roomIdOf(team);ssSet('kg_joined',G.room);
  try{const q=new URLSearchParams(location.search);q.set('room',team);q.delete('view');history.replaceState(null,'',location.pathname+'?'+q.toString());}catch(e){}
  G.entryMsg='';G.R=null;render();connect();
}

/* ---------- Partita: cartellini, contenitori, reparti ---------- */
const hidden=new Set(),pendingM=new Map();let swapTok=0;
const hid=k=>hidden.has(k)?' hid':'';
const code=p=>{const a=String(p).split('-');return t('ci_'+a[0])+'·'+t('ab_'+a[1]);};
function cardHTML(k,pn,id,noHide){return'<span class="kc '+(k==='P'?'p':'w')+(noHide?'':hid('k'+id))+'" title="'+esc(t(k==='P'?'kPn':'kWn')+': '+pnName(pn))+'"><b>'+k+'</b>'+code(pn)+'</span>';}
function partHTML(pn){const a=String(pn).split('-');return drawModel(a[1],{only:a[0],w:a[0]==='head'?13:22});}
function boxHTML(c,noHide){return'<span class="cw'+(noHide?'':hid('c'+c.id))+'"><span class="ct">'+partHTML(c.pn)+'</span>'+(c.card?cardHTML(c.card.k,c.pn,c.card.id,noHide):'')+'</span>';}
const EMPTY='<span class="ct e"></span>';
function boxes(list,max){list=list||[];let h=list.slice(0,max).map(c=>boxHTML(c)).join('');if(list.length>max)h+='<span class="more">+'+(list.length-max)+'</span>';return h;}
function empties(n){return n?Array(Math.min(n,6)).fill(EMPTY).join('')+(n>6?'<span class="more">+'+(n-6)+'</span>':''):'<span class="muted mini">—</span>';}
function gridHTML(store,pre,alert){
  let h='<div class="grid"><span></span>'+TYPES.map(ty=>'<span class="gh">'+full(ty,26)+'<br>'+tn(ty)+'</span>').join('');
  COMPS.forEach(c=>{h+='<span class="gr">'+t('c_'+c)+'</span>';TYPES.forEach(ty=>{const p=c+'-'+ty;h+='<span class="gc'+(alert&&alert.includes(p)?' alert':'')+'" id="'+pre+p+'" title="'+esc(pnName(p))+'">'+boxes(store[p],3)+'</span>';});});
  return h+'</div>';
}
function deptHTML(c){
  const S=G.S,cell=S.cells[c]||{post:[]},j=cell.job,you=mine(c),kan=S.mode==='kanban';
  let h='<div class="dept'+(you?' you':'')+'"><div class="dh"><span>'+t('d_'+c)+'</span>'+opChip(c)+'</div>';
  if(kan){const post=cell.post||[];h+='<div class="post" id="post-'+c+'"><span class="pl">'+t('postP')+'</span>'+post.slice(0,6).map(cd=>cardHTML('P',cd.pn,cd.id)).join('')+(post.length>6?'<span class="more">+'+(post.length-6)+'</span>':'')+'</div>';}
  if(j){const pct=1-Math.max(0,j.rem)/(j.dur||1),ty=j.type||String(j.pn).split('-')[1];
    h+='<div class="jl"><span class="st-work">'+t('working')+': '+pnName(j.pn)+'</span><span>'+(j.setup?t('setup',nf(j.setup,1)):'')+'</span></div><div class="build" id="mach-'+c+'">'+drawModel(ty,{only:c,n:Math.floor(pct*MODEL[ty][c].length+1e-6),w:c==='head'?30:54})+(j.card?cardHTML('P',j.pn,j.card.id):'')+'</div><span class="bar"><b style="width:'+Math.round(pct*100)+'%"></b></span>';
  } else h+='<div class="jl"><span class="st-idle">'+(kan?t('idle'):t('idlePush'))+'</span></div><div class="build" id="mach-'+c+'"></div><span class="bar"><b style="width:0"></b></span>';
  h+='<span class="last">'+(cell.last?t('last',nf(cell.last.dur,1),nf((cell.last.mean||0)+(cell.last.setup||0),1)):'&nbsp;')+'</span>';
  if(kan)h+='<div class="ebox" id="dbox-'+c+'"><span class="pl">'+t('emptiesL')+'</span>'+empties(cell.boxes||0)+'</div>';
  return h+'</div>';
}
function evText(e){
  const a=e.a||[];
  switch(e.k){
    case'made':return t('e_made',opName(String(a[0]).split('-')[0]),pnName(a[0]),a[2]);
    case'pTake':return t('e_pTake',pnName(a[0]));
    case'swap':return t('e_swap',pnName(a[0]));
    case'short':return t('e_short',pnName(a[0]));
    case'ship':return t('e_ship',tn(a[0]));
    default:{const v=TXT['e_'+e.k];return typeof v==='function'?v(a[0]):(v||e.k);}
  }
}
/* --- cartellini e contenitori in volo (stessa logica della versione singola) --- */
function center(id){const el=document.getElementById(id);if(!el)return null;const r=el.getBoundingClientRect();if(!r.width&&!r.height)return null;return{x:r.left+r.width/2,y:r.top+r.height/2};}
function fly(html,from,to,ms,delay){
  if(!G.anim)return;const a=center(from),b=center(to),layer=document.getElementById('flylayer');if(!a||!b||!layer)return;
  const el=document.createElement('div');el.className='fly';el.innerHTML=html;el.style.left=a.x+'px';el.style.top=a.y+'px';layer.appendChild(el);
  try{
    const an=el.animate([{transform:'translate(-50%,-50%) scale(1.25)'},{transform:'translate(calc(-50% + '+(b.x-a.x)+'px),calc(-50% + '+(b.y-a.y)+'px)) scale(1.25)'}],{duration:ms,delay:delay||0,easing:'ease-in-out',fill:'both'});
    an.onfinish=()=>el.remove();an.oncancel=()=>el.remove();
  }catch(e){el.remove();}
  setTimeout(()=>{if(el.parentNode)el.remove();},(ms||0)+(delay||0)+1500); /* rete di sicurezza */
}
const wall=s=>Math.max(280,(s||0)*1000);
function hideFor(keys,ms){if(!G.anim)return;keys.forEach(k=>hidden.add(k));setTimeout(()=>keys.forEach(k=>hidden.delete(k)),ms);}
/* nascosti fino a mDone; scadenza di sicurezza se un evento va perso */
function hideM(k,maxMs){if(!G.anim)return;hidden.add(k);pendingM.set(k,performance.now()+Math.max(2500,maxMs||0));}
function sweepHidden(){
  if(!pendingM.size)return;const now=performance.now(),M=G.S&&G.S.mizu;
  const idle=M&&!M.act;
  pendingM.forEach((exp,k)=>{if(idle||now>exp){hidden.delete(k);pendingM.delete(k);}});
}
function handleEv(e){
  switch(e.k){
    case'consume':(e.items||[]).forEach(it=>{fly('<span class="ct">'+partHTML(it.pn)+'</span>','ln-'+it.pn,'asm-now',wall(.7));
      if(it.kid!=null){hideFor(['k'+it.kid],wall(.7));fly(cardHTML('W',it.pn,it.kid,true),'ln-'+it.pn,'wpost',wall(.7));}});break;
    case'prodStart':hideFor(['k'+e.kid],wall(.45));fly(cardHTML('P',e.pn,e.kid,true),'post-'+e.c,'mach-'+e.c,wall(.45));break;
    case'prodDone':hideFor(['c'+e.cid],wall(.7));fly(boxHTML({id:e.cid,pn:e.pn,card:e.kid!=null?{k:'P',id:e.kid}:null},true),'mach-'+e.c,'sp-'+e.pn,wall(.7));break;
    case'collectStart':{const D=wall(e.dur),its=e.items||[],n=Math.max(1,its.length);its.forEach((it,i)=>{hideM('k'+it.kid,D+1500);fly(cardHTML('W',it.pn,it.kid,true),'wpost','cart',D*.6,i*D*.4/n);});fly(EMPTY,'lbox','cart',D*.8);break;}
    case'deliverStart':{const D=wall(e.dur),its=e.items||[],n=Math.max(1,its.length);its.forEach((it,i)=>{hideM('c'+it.cid,D+1500);fly(boxHTML({id:it.cid,pn:it.pn,card:it.kid!=null?{k:'W',id:it.kid}:null},true),'cart','ln-'+it.pn,D*.6,i*D*.4/n);});break;}
    case'loadStart':{const D=wall(e.dur),its=e.items||[],n=Math.max(1,its.length);its.forEach((it,i)=>{hideM('c'+it.cid,D+1500);fly(boxHTML({id:it.cid,pn:it.pn,card:null},true),'sp-'+it.pn,'cart',D*.6,i*D*.4/n);});break;}
    case'swapStart':{const D=wall(e.dur),c=String(e.pn).split('-')[0],tok=++swapTok;
      hideM('k'+e.pk,D+1500);hideM('k'+e.wk,D+1500);
      fly(cardHTML('P',e.pn,e.pk,true),'sp-'+e.pn,'post-'+c,D*.48);fly(cardHTML('W',e.pn,e.wk,true),'cart','sp-'+e.pn,D*.48);
      setTimeout(()=>{if(tok!==swapTok||!pendingM.size)return;hideM('c'+e.fc,D+1500);
        fly(boxHTML({id:e.fc,pn:e.pn,card:{k:'W',id:e.wk}},true),'sp-'+e.pn,'cart',D*.45);fly(EMPTY,'cart','dbox-'+c,D*.45);},D*.5);break;}
    case'mDone':pendingM.forEach((x,k)=>hidden.delete(k));pendingM.clear();break;
  }
}
function clearFx(){hidden.clear();pendingM.clear();swapTok++;const l=document.getElementById('flylayer');if(l)l.innerHTML='';}

/* --- schermata di gioco --- */
function roleStripHTML(){
  return'<span class="rl">'+t('roleStrip')+'</span>'+ROLES.map(r=>{
    const h=holder(r),me=mine(r),cls=me?'mine':(h?'other':'free'),dis=G.view||(h&&!me);
    return'<button class="rchip '+cls+'" data-act="role" data-r="'+r+'"'+(dis?' disabled':'')+' aria-pressed="'+me+'" title="'+esc(me?t('leave'):(h?t('heldBy',peerName(h)):t('take')))+'"><b>'+t('role_'+r)+'</b>'+(me?'· '+t('you'):(h?'· '+esc(peerName(h)):'· '+t('auto')))+'</button>';}).join('');
}
function gameSkeleton(){
  const S=G.S,n=R().round||+String(R().phase).slice(1),kan=S.mode==='kanban';
  let h='<section><div class="hud"><span class="pill">'+t('round')+' '+n+'/3<span class="pt"> · '+t('r'+n+'t')+'</span></span><span class="clock" id="u-clock"></span>'+
   '<span class="hstat"><span>'+t('shipped')+'</span><b id="u-ship">0</b></span><span class="hstat"><span>'+t('waiting')+'</span><b id="u-wait">0</b></span><span class="hstat"><span>'+t('stock')+'</span><b id="u-stock">0</b></span><span class="sp"></span>'+
   '</div>';
  h+='<div class="rstrip" id="rstrip">'+roleStripHTML()+'</div>';
  if(kan)h+='<p class="legendk small">'+t('legend',cardHTML('P','legs-cow',-1,true),cardHTML('W','body-duck',-2,true))+'</p>';
  h+='<div class="floor" id="floor">'+
   '<div class="zone za-dept"><div class="zh"><span class="tape">'+t('z_dept')+'</span></div><div id="z-dept" class="stack" style="gap:8px"></div></div>'+
   '<div class="zone za-super"><div class="zh"><span class="tape">'+t('z_super')+'</span></div><div id="z-super"></div></div>'+
   '<div class="zone za-mizu" id="zone-mizu"><div class="zh"><span class="tape">'+t('z_mizu')+'</span><span class="small muted" id="z-trip"></span><span id="op-mizu"></span></div><div class="corr"><span class="stop l">◀ '+t('stopS')+'</span><span class="stop r">'+t('stopL')+' ▶</span><div class="cartp" id="cart"><div id="z-cart"></div></div></div></div>'+
   '<div class="zone za-line"><div class="zh"><span class="tape">'+t('z_line')+'</span></div><div id="z-line"></div><div id="z-wpost"></div></div>'+
   '<div class="zone za-asm" id="zone-asm"><div class="zh"><span class="tape">'+t('z_asm')+'</span><span id="op-asm"></span></div><div id="z-asm"></div></div></div>'+
   '<ul class="ticker" id="z-tick" aria-live="off"></ul>';
  if(!G.view)h+='<div class="abar" id="abar"></div>';
  else h+='<p class="note" style="margin-top:12px">'+t('spectNote')+'</p>';
  return h+'</section>';
}
function abarHTML(kan){
  const mr=myRoles();
  if(!mr.length)return'<p class="none">'+t('noRole')+'</p>';
  return mr.map(r=>{
    let b='';
    if(COMPS.includes(r)){
      if(!kan)b=TYPES.map(ty=>'<button class="btn" data-act="act" data-r="'+r+'" data-a="produceType" data-arg="'+ty+'" id="b-'+r+'-'+ty+'"><span class="bc">'+t('c_'+r)+' </span>'+tn(ty)+'</button>').join('');
      else b='<button class="btn pk wide" data-act="act" data-r="'+r+'" data-a="produce" id="b-'+r+'-produce">'+t('b_take')+'</button>';
    } else if(r==='mizu'){
      b='<button class="btn" data-act="act" data-r="mizu" data-a="deliver" id="b-mizu-deliver">'+t('b_deliver')+'</button>';
      if(kan)b+='<button class="btn wk" data-act="act" data-r="mizu" data-a="collect" id="b-mizu-collect">'+t('b_collect')+'</button>';
      b+='<button class="btn" data-act="act" data-r="mizu" data-a="goSuper" id="b-mizu-goSuper">'+t('b_goSuper')+'</button>';
      b+=kan?'<button class="btn pk" data-act="act" data-r="mizu" data-a="swap" id="b-mizu-swap">'+t('b_swap')+'</button>':'<button class="btn" data-act="act" data-r="mizu" data-a="loadAll" id="b-mizu-loadAll">'+t('b_loadAll')+'</button>';
      b+='<button class="btn" data-act="act" data-r="mizu" data-a="goLine" id="b-mizu-goLine">'+t('b_goLine')+'</button>';
    } else if(r==='asm'){
      b='<button class="btn primary wide" data-act="act" data-r="asm" data-a="assemble" id="b-asm-assemble">'+t('b_asm')+'</button>';
    }
    return'<div class="grp"><div class="gh"><span class="tape">'+t('role_'+r)+'</span></div><div class="acts">'+b+'</div><span class="bar" id="a-bar-'+r+'"><b style="width:0"></b></span><p class="hint" id="a-hint-'+r+'"></p></div>';
  }).join('');
}
function setHTML(id,html){if(cache[id]===html&&document.getElementById(id))return;cache[id]=html;const el=document.getElementById(id);if(el)el.innerHTML=html;}
function setText(id,x){const el=document.getElementById(id);if(el&&el.textContent!==x)el.textContent=x;}
function setDis(id,d){const el=document.getElementById(id);if(el&&el.disabled!==d)el.disabled=d;}
function setBarW(id,p){const el=document.querySelector('#'+id+' b');if(el)el.style.width=Math.round(Math.max(0,Math.min(1,p))*100)+'%';}
function canOK(role,a){const S=G.S;return!!(S&&S.can&&S.can[role]&&S.can[role][a]==='');}
function updateGame(){
  if(G.screen!=='game'||!G.S)return;
  sweepHidden();
  const S=G.S,rem=S.dur-S.t,ck=document.getElementById('u-clock'),kan=S.mode==='kanban';
  if(ck){ck.textContent=clock(rem);ck.classList.toggle('low',rem<=15);}
  const dn=S.delivered&&S.delivered.n!=null?S.delivered.n:0,qn=S.queueN!=null?S.queueN:(S.queue||[]).length;
  setText('u-ship',String(dn));setText('u-wait',String(qn));setText('u-stock',String(S.wip!=null?S.wip:0));
  setHTML('z-dept',COMPS.map(deptHTML).join(''));
  setHTML('z-super',gridHTML(S.super,'sp-'));
  const A=S.asm||{},queue=S.queue||[];
  setHTML('z-line',gridHTML(S.line,'ln-',A.missing));
  const emp=S.empties||[];
  if(kan)setHTML('z-wpost','<div class="post w" id="wpost"><span class="pl">'+t('postW')+'</span>'+emp.slice(0,9).map(c=>cardHTML('W',c.pn,c.card?c.card.id:0)).join('')+(emp.length>9?'<span class="more">+'+(emp.length-9)+'</span>':'')+'</div><div class="ebox" id="lbox"><span class="pl">'+t('emptiesL')+'</span>'+empties(emp.length)+'</div>');
  const M=S.mizu||{full:[],empty:[]},ak=M.act?M.act.kind:null,cart=document.getElementById('cart');
  if(cart)cart.style.setProperty('--pos',Number(M.pos||0).toFixed(3));
  let cap=ak?t('m_'+ak):t('m_idle');
  if(ak==='swap'&&M.act.data&&M.act.data.pn)cap=t('swapCap',code(M.act.data.pn));
  let mh='<div class="carth">'+CART+'<span><b>'+esc(opName('mizu'))+'</b><br><span class="capt">'+cap+'</span></span></div>'+
    '<div class="cl"><span class="pl">'+t('cFull')+'</span>'+((M.full||[]).length?M.full.map(c=>boxHTML(c)).join(''):'<span class="muted mini">—</span>')+'</div>';
  if(kan)mh+='<div class="cl"><span class="pl">'+t('cW')+'</span>'+((M.empty||[]).length?M.empty.map(c=>cardHTML('W',c.pn,c.card?c.card.id:0)).join(''):'<span class="muted mini">—</span>')+'</div><div class="cl"><span class="pl">'+t('emptiesL')+'</span>'+empties((M.empty||[]).length)+'</div>';
  setHTML('z-cart',mh);
  const humanM=(S.human||[]).includes('mizu');
  setText('z-trip',(!humanM&&M.loc==='line'&&ak==='wait'&&M.nextDepart!=null)?t('nextTrip',Math.max(0,Math.ceil(M.nextDepart-S.t))):'');
  setHTML('op-mizu',opChip('mizu'));setHTML('op-asm',opChip('asm'));
  const zm=document.getElementById('zone-mizu'),za=document.getElementById('zone-asm');
  if(zm)zm.classList.toggle('you',mine('mizu'));if(za)za.classList.toggle('you',mine('asm'));
  let ah='<div id="asm-now">';
  if(A.job){const ty=A.job.order&&A.job.order.type;ah+='<div class="jl"><span class="st-work">'+t('asmWork',tn(ty))+'</span></div><div>'+full(ty,64)+'</div><span class="bar"><b style="width:'+Math.round((1-Math.max(0,A.job.rem)/(A.job.dur||1))*100)+'%"></b></span>';}
  else if((A.missing||[]).length&&queue.length)ah+='<p class="alarm">'+t('asmStarve')+' '+A.missing.map(pnName).join(', ')+'</p><div>'+drawModel(queue[0].type,{w:64,have:COMPS.filter(c=>!A.missing.includes(c+'-'+queue[0].type))})+'</div><span class="bar"><b style="width:0"></b></span>';
  else if(A.ready&&queue.length)ah+='<div class="jl"><span class="st-work">'+t('asmReady',tn(queue[0].type))+'</span></div><div>'+full(queue[0].type,64)+'</div><span class="bar"><b style="width:0"></b></span>';
  else ah+='<div class="jl"><span class="st-idle">'+t('asmWait')+'</span></div><div style="height:48px"></div><span class="bar"><b style="width:0"></b></span>';
  const last=(S.delivered&&S.delivered.last)||[];
  ah+='</div><p class="mini muted" style="margin-top:8px">'+t('next')+' ('+qn+')</p><div class="orders">'+(queue.length?queue.slice(0,6).map(o=>full(o.type,34)).join('')+(qn>6?'<span class="more">+'+(qn-6)+'</span>':''):'<span class="muted mini">—</span>')+'</div>'+
    '<p class="mini muted" style="margin-top:6px">'+t('truck')+': <b style="color:var(--ink)">'+dn+'</b></p><div class="orders">'+last.slice(-5).map(o=>full(o.type,30)).join('')+'</div>';
  setHTML('z-asm',ah);
  setHTML('z-tick',(S.log||[]).slice(-4).reverse().map(e=>'<li><time>'+clock(e.t)+'</time>'+esc(evText(e))+'</li>').join(''));
  setHTML('rstrip',roleStripHTML());
  /* su schermi stretti (una colonna) prima le postazioni del giocatore */
  const fl=document.getElementById('floor'),mr=myRoles(),fk=mr.join(',');
  if(fl&&fl.dataset.k!==fk){fl.dataset.k=fk;
    const ord=[];const add=(...z)=>z.forEach(x=>{if(!ord.includes(x))ord.push(x);});
    if(mr.includes('mizu'))add('mizu','super','line');
    if(mr.includes('asm'))add('asm','line');
    if(mr.some(r=>COMPS.includes(r)))add('dept','super');
    add('dept','super','mizu','line','asm');
    ord.forEach((z,i)=>{const el=fl.querySelector('.za-'+z);if(el)el.style.setProperty('--o',String(i+1));});}
  /* barra azioni */
  const ab=document.getElementById('abar');if(!ab)return;
  const key=myRoles().join(',')+'|'+S.mode;
  if(key!==G.abarKey){G.abarKey=key;ab.innerHTML=abarHTML(kan);}
  const now=performance.now(),pend=r=>now-(G.pend[r]||0)<450;
  myRoles().forEach(r=>{
    let hint='',pr=0;
    if(COMPS.includes(r)){
      const cell=S.cells[r]||{post:[]},j=cell.job;
      if(!kan)TYPES.forEach(ty=>setDis('b-'+r+'-'+ty,!canOK(r,'produceType')||pend(r)));
      else setDis('b-'+r+'-produce',!canOK(r,'produce')||pend(r));
      pr=j?1-Math.max(0,j.rem)/(j.dur||1):0;
      if(j)hint=t('h_building',pnName(j.pn),nf(Math.max(0,j.rem),1));
      else if(!kan)hint=t('h_push');
      else hint=(cell.post||[]).length?t('h_nextCard',pnName(cell.post[0].pn)):t('h_noCard');
    } else if(r==='mizu'){
      ['deliver','collect','goSuper','swap','loadAll','goLine'].forEach(a=>{setDis('b-mizu-'+a,!canOK('mizu',a)||pend('mizu'));
        const el=document.getElementById('b-mizu-'+a),away=(M.loc==='super')!==(a==='swap'||a==='loadAll'||a==='goLine');if(el&&el.classList.contains('away')!==away)el.classList.toggle('away',away);});
      const busy=M.act&&M.act.kind!=='wait';
      pr=busy?1-Math.max(0,M.act.rem)/(M.act.dur||1):0;
      if(busy)hint=t('h_m_busy',t('m_'+M.act.kind),nf(Math.max(0,M.act.rem),1));
      else if(M.loc==='super'&&kan&&(M.empty||[]).length&&!S.swapPossible)hint=t('h_m_noMatch');
      else hint=M.loc==='line'?t('h_m_line'):t('h_m_super');
    } else if(r==='asm'){
      const ok=canOK('asm','assemble');setDis('b-asm-assemble',!ok||pend('asm'));
      const bt=document.getElementById('b-asm-assemble');if(bt)bt.classList.toggle('ready',ok);
      pr=A.job?1-Math.max(0,A.job.rem)/(A.job.dur||1):0;
      if(A.job)hint=t('h_a_busy',tn(A.job.order.type),nf(Math.max(0,A.job.rem),1));
      else if(!queue.length)hint=t('h_a_none');
      else if((A.missing||[]).length)hint=t('h_a_miss',A.missing.map(pnName).join(', '));
      else hint=t('h_a_ready',tn(queue[0].type));
    }
    setBarW('a-bar-'+r,pr);setText('a-hint-'+r,hint);
  });
}

/* ---------- Grafici (dalla versione singola) ---------- */
function niceStep(max){const c=[1,2,5,10,20,25,50,100];for(const s of c)if(max/s<=6)return s;return 200;}
function invSVG(r){
  const sm=r.samples||[];if(!sm.length)return'';
  const W=640,H=230,pl=36,pr=12,pt=14,pb=30,tmax=r.dur||sm[sm.length-1].t||1;
  const mx=Math.max(r.cards||0,...sm.map(s=>s.sup+s.line+s.tr),5),st=niceStep(mx),ymax=Math.ceil(mx/st)*st;
  const X=v=>pl+(Math.min(v,tmax)/tmax)*(W-pl-pr),Y=v=>pt+(1-v/ymax)*(H-pt-pb);
  let o='';
  for(let v=0;v<=ymax;v+=st)o+='<line x1="'+pl+'" x2="'+(W-pr)+'" y1="'+Y(v)+'" y2="'+Y(v)+'" class="g"/><text x="'+(pl-6)+'" y="'+(Y(v)+4)+'" text-anchor="end" class="ax">'+v+'</text>';
  const xs=tmax>180?60:(tmax>60?30:10);for(let v=0;v<=tmax;v+=xs)o+='<text x="'+X(v)+'" y="'+(H-10)+'" text-anchor="middle" class="ax">'+clock(v)+'</text>';
  const lay=[[s=>s.sup+s.line+s.tr,'--a-tr'],[s=>s.sup+s.line,'--a-line'],[s=>s.sup,'--a-sup']];
  const last=sm[sm.length-1];
  lay.forEach(l=>{o+='<polygon points="'+X(sm[0].t)+','+Y(0)+' '+sm.map(s=>X(s.t).toFixed(1)+','+Y(l[0](s)).toFixed(1)).join(' ')+' '+X(last.t)+','+Y(0)+'" style="fill:var('+l[1]+')"/>';});
  if(r.cards)o+='<line x1="'+pl+'" x2="'+(W-pr)+'" y1="'+Y(r.cards)+'" y2="'+Y(r.cards)+'" stroke="'+INK+'" stroke-width="1.5" stroke-dasharray="5 4"/><text x="'+(W-pr-4)+'" y="'+(Y(r.cards)-5)+'" text-anchor="end" class="lbl">'+esc(t('cap',r.cards))+'</text>';
  o+='<line x1="'+pl+'" x2="'+(W-pr)+'" y1="'+Y(0)+'" y2="'+Y(0)+'" class="base"/>';
  return'<svg viewBox="0 0 '+W+' '+H+'" class="chart" role="img" aria-label="'+esc(t('ch_inv'))+'">'+o+'</svg><div class="legend"><span><i style="background:var(--a-sup)"></i>'+t('l_sup')+'</span><span><i style="background:var(--a-line)"></i>'+t('l_line')+'</span><span><i style="background:var(--a-tr)"></i>'+t('l_tr')+'</span></div>';
}
function blSVG(r){
  const sm=r.samples||[];if(!sm.length)return'';
  const W=640,H=170,pl=36,pr=30,pt=14,pb=30,tmax=r.dur||sm[sm.length-1].t||1;
  const mx=Math.max(4,...sm.map(s=>s.bl)),st=niceStep(mx),ymax=Math.ceil(mx/st)*st;
  const X=v=>pl+(Math.min(v,tmax)/tmax)*(W-pl-pr),Y=v=>pt+(1-v/ymax)*(H-pt-pb);
  let o='';
  for(let v=0;v<=ymax;v+=st)o+='<line x1="'+pl+'" x2="'+(W-pr)+'" y1="'+Y(v)+'" y2="'+Y(v)+'" class="g"/><text x="'+(pl-6)+'" y="'+(Y(v)+4)+'" text-anchor="end" class="ax">'+v+'</text>';
  const xs=tmax>180?60:(tmax>60?30:10);for(let v=0;v<=tmax;v+=xs)o+='<text x="'+X(v)+'" y="'+(H-10)+'" text-anchor="middle" class="ax">'+clock(v)+'</text>';
  const l=sm[sm.length-1];
  o+='<line x1="'+pl+'" x2="'+(W-pr)+'" y1="'+Y(0)+'" y2="'+Y(0)+'" class="base"/><polyline points="'+sm.map(s=>X(s.t).toFixed(1)+','+Y(s.bl).toFixed(1)).join(' ')+'" fill="none" style="stroke:var(--bad)" stroke-width="2.5" stroke-linejoin="round"/><circle cx="'+X(l.t)+'" cy="'+Y(l.bl)+'" r="4" style="fill:var(--bad)"/><text x="'+(X(l.t)+7)+'" y="'+(Y(l.bl)+4)+'" class="lbl">'+l.bl+'</text>';
  return'<svg viewBox="0 0 '+W+' '+H+'" class="chart" role="img" aria-label="'+esc(t('ch_bl'))+'">'+o+'</svg>';
}
function resultsList(){return(R().results||[]).map((r,i)=>r?Object.assign({round:i+1},r):null);}
function pointsSVG(){
  const rs=resultsList().filter(Boolean);if(!rs.length)return'';
  const W=520,H=230,pl=44,pr=12,pt=22,pb=34,vals=rs.map(r=>r.points);
  let vmax=Math.max(10,...vals),vmin=Math.min(0,...vals);const st=niceStep((vmax-vmin));
  vmax=Math.ceil(vmax/st)*st;vmin=Math.floor(vmin/st)*st;
  const Y=v=>pt+(vmax-v)/(vmax-vmin)*(H-pt-pb),bw=(W-pl-pr)/3;let o='';
  for(let v=vmin;v<=vmax;v+=st)o+='<line x1="'+pl+'" x2="'+(W-pr)+'" y1="'+Y(v)+'" y2="'+Y(v)+'" class="g"/><text x="'+(pl-6)+'" y="'+(Y(v)+4)+'" text-anchor="end" class="ax">'+v+'</text>';
  rs.forEach(r=>{const i=r.round-1,x=pl+i*bw+bw*.22,w=bw*.56,y0=Y(0),y1=Y(r.points),col=r.points<0?'--bad':(i===2?'--accent':'--ink');
    o+='<rect x="'+x+'" y="'+Math.min(y0,y1)+'" width="'+w+'" height="'+Math.max(1,Math.abs(y1-y0))+'" rx="2" style="fill:var('+col+')"/><text x="'+(x+w/2)+'" y="'+(r.points<0?y1+15:y1-6)+'" text-anchor="middle" class="lbl">'+r.points+'</text><text x="'+(x+w/2)+'" y="'+(H-10)+'" text-anchor="middle" class="ax">'+t('round')+' '+r.round+' · '+t('r'+r.round+'t')+'</text>';});
  o+='<line x1="'+pl+'" x2="'+(W-pr)+'" y1="'+Y(0)+'" y2="'+Y(0)+'" class="base"/>';
  return'<svg viewBox="0 0 '+W+' '+H+'" class="chart" role="img" aria-label="'+esc(t('ptsChart'))+'">'+o+'</svg>';
}
function utilHTML(r){
  const u0=r.util||{};
  const rows=[['legs',t('d_legs')],['body',t('d_body')],['head',t('d_head')],['asm',t('z_asm')],['mizu',t('z_mizu')]];
  return rows.map(x=>{const u=Math.round((u0[x[0]]||0)*100);return'<div class="urow"><span>'+x[1]+'</span><div class="ubar"><b style="width:'+u+'%"></b></div><span class="uval">'+u+'%</span></div>';}).join('');
}
function loopSVG(){
  const b=(x,l)=>'<rect class="bx" x="'+x+'" y="92" width="150" height="50" rx="4"/><text class="bt" x="'+(x+75)+'" y="122" text-anchor="middle">'+esc(l)+'</text>';
  const arc=(x1,x2,up,col,id)=>'<path d="M'+x1+' '+(up?92:142)+' C'+x1+' '+(up?30:204)+','+x2+' '+(up?30:204)+','+x2+' '+(up?92:142)+'" fill="none" stroke="'+col+'" stroke-width="3" marker-end="url(#'+id+')"/>';
  const mk=(id,col)=>'<marker id="'+id+'" viewBox="0 0 10 10" refX="8" refY="5" markerWidth="7" markerHeight="7" orient="auto"><path d="M0 0L10 5L0 10z" fill="'+col+'"/></marker>';
  const kp='#d6336c',kw='#1f78c8';
  return'<svg viewBox="0 0 720 236" class="chart loop" role="img" aria-label="'+esc(t('loopP')+', '+t('loopW'))+'"><defs>'+mk('ap',kp)+mk('aw',kw)+'</defs>'+
   arc(330,120,true,kp,'ap')+arc(120,330,false,kp,'ap')+arc(600,390,true,kw,'aw')+arc(390,600,false,kw,'aw')+
   b(20,t('z_dept'))+b(285,t('z_super'))+b(550,t('z_line'))+
   '<text x="225" y="34" text-anchor="middle">'+esc(t('lp1'))+'</text><text x="225" y="212" text-anchor="middle">'+esc(t('lp2'))+'</text>'+
   '<text x="495" y="34" text-anchor="middle">'+esc(t('lw1'))+'</text><text x="495" y="212" text-anchor="middle">'+esc(t('lw2'))+'</text>'+
   '<text x="225" y="16" text-anchor="middle" style="fill:'+kp+';font-weight:700">'+esc(t('loopP'))+'</text><text x="495" y="16" text-anchor="middle" style="fill:'+kw+';font-weight:700">'+esc(t('loopW'))+'</text></svg>';
}
function colName(c){return({k:'nero',w:'bianco',t:'beige',b:'marrone',d:'marrone scuro',r:'rosso',c:'panna',o:'arancione',y:'giallo'})[c];}
function bomHTML(){
  return'<div class="bom">'+TYPES.map(ty=>{
    let h='<div class="bomc"><div class="bomh">'+full(ty,84)+'<h3>'+tn(ty)+'</h3></div>';
    COMPS.forEach(c=>{const g={};MODEL[ty][c].forEach(b=>{const k=b.s+'|'+b.c;g[k]=(g[k]||0)+1;});
      h+='<div class="bomr"><span class="bomp">'+drawModel(ty,{only:c,w:c==='head'?24:40})+'</span><span><b>'+t('c_'+c)+'</b><br>'+Object.keys(g).map(k=>{const a=k.split('|');return'<span class="bomb">'+g[k]+' × '+brickChip(a[0],a[1])+' '+a[0].replace('x','×')+' '+colName(a[1])+'</span>';}).join('')+'</span></div>';});
    return h+'</div>';}).join('')+'</div>';
}

/* ---------- Schermate ---------- */
function entryHTML(){
  const p=G.ping;
  let h='<div class="stack entry"><div><p class="kicker">'+t('kicker')+'</p><h1>'+t('title')+'</h1><p class="lead">'+t('lead')+'</p></div>';
  if(G.entryMsg)h+='<p class="note">'+esc(G.entryMsg)+'</p>';
  if(p===false)h+='<div class="warnbox"><p>'+t('noServer')+'</p><div class="row"><button class="btn" data-act="retry">'+t('retry')+'</button><a class="btn" href="'+esc(soloHref())+'">'+t('soloLink')+'</a></div></div>';
  h+='<form class="panel" id="f-join" autocomplete="on"><div class="field"><label for="f-team">'+t('fTeam')+'</label><input type="text" id="f-team" name="team" maxlength="24" autocapitalize="characters" value="'+esc(G.team)+'" required></div>'+
    '<div class="field"><label for="f-name">'+t('fName')+'</label><input type="text" id="f-name" name="nickname" maxlength="20" value="'+esc(G.me)+'" required></div>'+
    '<p class="small muted" style="margin-top:8px">'+t('sameTeam')+'</p><p class="err" id="f-err"></p>'+
    '<button class="btn primary" type="submit" id="b-join">'+(p==null?t('checking'):t('enter'))+'</button></form>'+
    '<details class="teach"><summary>'+t('teacherQ')+'</summary><form class="row" id="f-pin"><input type="text" id="f-pinv" aria-label="'+t('pinL')+'" placeholder="'+t('pinL')+'" autocomplete="off"><button class="btn" type="submit">'+t('openReg')+'</button></form></details>'+
    '<p class="credit">'+t('credit')+' · <a href="'+esc(soloHref())+'">'+t('soloLink')+'</a></p></div>';
  return h;
}
function roleCardsHTML(){
  return ROLES.map(r=>{
    const h=holder(r),me=mine(r),cls=me?' mine':(h?' other':''),dis=G.view||(h&&!me);
    const st=me?t('leave'):(h?t('heldBy',esc(peerName(h))):t('free'));
    return'<button class="rcardb'+cls+'" data-act="role" data-r="'+r+'" aria-pressed="'+me+'"'+(dis?' disabled':'')+'><span class="rh"><span>'+t('role_'+r)+'</span>'+opChip(r)+'</span><small>'+t('role_'+r+'_d')+'</small><span class="rs">'+st+'</span></button>';
  }).join('');
}
function membersHTML(){
  if(!G.peers.length)return'<span class="muted small">—</span>';
  return G.peers.map(p=>'<span class="op'+(p.c===G.cid&&!G.view?' you':'')+'">'+esc(p.name)+(p.c===G.cid&&!G.view?' ('+t('you')+')':'')+'</span>').join('');
}
function lobbyHTML(){
  const rounds=[1,2,3].map(i=>'<div class="panel rcard"><span class="num">'+i+'</span><h3>'+t('r'+i+'t')+'</h3><p>'+t('r'+i+'d')+'</p></div>').join('');
  return'<div class="stack"><div><p class="kicker">'+esc(teamLabel(R().name||R().id||G.room))+'</p><h1>'+t('lobbyT')+'</h1><p class="lead">'+t('lobbyLead')+'</p></div>'+
   '<section class="panel"><div class="rcards" id="lobby-roles">'+roleCardsHTML()+'</div><p class="flabel" style="margin-top:14px">'+t('members')+'</p><div class="members" id="lobby-members">'+membersHTML()+'</div></section>'+
   '<section class="panel"><p>'+t('demand')+' '+t('durNote',G.sess.dur||180)+'</p><p style="margin-top:8px" class="small">'+t('scoring')+'</p>'+
    (G.view?'':'<div class="row" style="margin-top:14px"><button class="btn primary" data-act="next">'+t('start1')+'</button><span class="small muted">'+t('startNote')+'</span></div>')+'</section>'+
   '<section><div class="rounds">'+rounds+'</div></section>'+
   '<section class="two"><div class="panel">'+loopSVG()+'<p class="small" style="margin-top:6px">'+t('kP')+'</p><p class="small" style="margin-top:6px">'+t('kW')+'</p></div>'+
    '<div class="panel"><h3>'+t('cycT')+'</h3><ol class="steps">'+t('cyc').map(x=>'<li>'+x+'</li>').join('')+'</ol></div></section>'+
   '<section class="panel"><h3>'+t('bomT')+'</h3><p class="small muted">'+t('bomD')+'</p>'+bomHTML()+'</section>'+
   '<p class="credit">'+t('credit')+'</p></div>';
}
function famTable(r){
  const sT=r.stockT||{},st=c=>TYPES.reduce((s,ty)=>s+(sT[c+'-'+ty]||0),0);
  return'<div class="tablewrap"><table><thead><tr><th>'+t('f_fam')+'</th><th>'+t('f_LP')+'</th><th>'+t('f_LW')+'</th><th>'+t('f_short')+'</th></tr></thead><tbody>'+
   COMPS.map(c=>'<tr><td>'+t('c_'+c)+'</td><td>'+secs((r.LPf||{})[c])+'</td><td>'+secs((r.LWf||{})[c])+'</td><td class="'+(st(c)>0?'neg':'')+'">'+nf(st(c),0)+' s</td></tr>').join('')+'</tbody></table></div>';
}
function nextBtn(label){return G.view?'':'<div class="row"><button class="btn primary" data-act="next">'+label+'</button><span class="small muted">'+t('anyoneNext')+'</span></div>';}
function summaryHTML(n){
  const r0=(R().results||[])[n-1];
  if(!r0)return'<div class="waitbox"><div class="spin"></div><p>'+t('waitRes')+'</p></div>';
  const r=Object.assign({round:n},r0),u=r.util||{};
  const rows=[[t('row_done'),r.delivered,'+10',r.delivered*10],[t('row_bl'),r.backlog,'−5',-r.backlog*5],[t('row_wip'),r.wip,'−1',-r.wip]];
  let h='<div class="stack"><div><p class="kicker">'+esc(R().name||R().id||'')+' · '+t('round')+' '+n+' · '+t('r'+n+'t')+'</p><h1>'+t('sumTitle',n)+'</h1></div>';
  h+='<div class="scorebox"><div class="score"><div class="small">'+t('pts')+'</div><div class="v'+(r.points<0?' neg':'')+'" id="countup" data-v="'+r.points+'">'+r.points+'</div></div><div class="panel"><div class="tablewrap"><table><thead><tr><th></th><th>n</th><th>×</th><th>'+t('pts')+'</th></tr></thead><tbody>'+
    rows.map(x=>'<tr><td>'+x[0]+'</td><td>'+x[1]+'</td><td>'+x[2]+'</td><td class="'+(x[3]<0?'neg':(x[3]>0?'pos':''))+'">'+(x[3]>0?'+':'')+String(x[3]).replace('-','−')+'</td></tr>').join('')+'</tbody><tfoot><tr><td>'+t('total')+'</td><td></td><td></td><td>'+r.points+'</td></tr></tfoot></table></div></div></div>';
  const ud=Math.round(((u.legs||0)+(u.body||0)+(u.head||0))/3*100);
  h+='<p class="note">'+(r.mode==='push'?t('pushNote',ud,r.wip,r.delivered):t('kanNote',r.cards,r.wip))+'</p>';
  h+='<div class="tiles"><div class="tile"><span>'+t('m_lead')+'</span><b>'+nf(r.lead,0)+' '+t('sec')+'</b><small>'+t('m_leadS')+'</small></div><div class="tile"><span>'+t('m_serv')+'</span><b>'+Math.round((r.noWait||0)*100)+'%</b><small>'+t('m_servS')+'</small></div><div class="tile"><span>'+t('m_wip')+'</span><b>'+nf(r.wipAvg,0)+'</b><small>'+t('m_wipS')+'</small></div><div class="tile"><span>'+t('m_trips')+'</span><b>'+(r.trips||0)+'</b><small>'+(r.mode==='kanban'?t('m_tripsS',r.swaps||0):'&nbsp;')+'</small></div></div>';
  h+='<div class="two"><div class="panel"><h3>'+t('ch_inv')+'</h3>'+invSVG(r)+'</div><div class="panel"><h3>'+t('ch_bl')+'</h3>'+blSVG(r)+'<h3 style="margin-top:14px">'+t('util')+'</h3>'+utilHTML(r)+'</div></div>';
  if(r.mode==='kanban')h+='<div class="panel"><h3>'+t('famT')+'</h3>'+famTable(r)+'</div>';
  return h+nextBtn(t('next'+n))+'</div>';
}
const cfg=()=>R().cfg||{nP:{legs:2,body:2,head:2},nW:{legs:2,body:2,head:2},imp:[]};
const capOf=()=>{const c=cfg();return 4*COMPS.reduce((s,k)=>s+(c.nP[k]||0)+(c.nW[k]||0),0);};
function formulaHTML(LP,LW,note){
  const D=1/(4*P.takt),calc=L=>D*L*(1+ALPHA),c0=cfg();
  const stp=(k,c)=>{const v=c0['n'+k][c];return'<span class="stp"><button data-act="kn" data-k="'+k+'" data-c="'+c+'" data-d="-1" id="kd-'+k+'-'+c+'" aria-label="'+k+' '+t('c_'+c)+' −"'+(G.view||v<=1?' disabled':'')+'>−</button><b id="kn-'+k+'-'+c+'">'+v+'</b><button data-act="kn" data-k="'+k+'" data-c="'+c+'" data-d="1" id="ku-'+k+'-'+c+'" aria-label="'+k+' '+t('c_'+c)+' +"'+(G.view||v>=5?' disabled':'')+'>+</button></span>';};
  const cell=L=>L==null?'<td>–</td><td>–</td>':'<td>'+nf(L,0)+' s</td><td>'+nf(calc(L),2)+' → <b>'+Math.max(1,Math.ceil(calc(L)-1e-9))+'</b></td>';
  return'<p class="formula">N = D · L · (1 + α) / a</p><p class="small muted" style="margin-top:6px">'+t('forD')+'</p><p class="small" style="margin-top:6px">'+t('forDem')+' '+note+'</p>'+
   '<div class="tablewrap" style="margin-top:10px"><table><thead><tr><th>'+t('f_fam')+'</th><th>L_P</th><th><span class="kc p">P</span> '+t('f_calc')+'</th><th><span class="kc p">P</span> '+t('f_your')+'</th><th>L_W</th><th><span class="kc w">W</span> '+t('f_calc')+'</th><th><span class="kc w">W</span> '+t('f_your')+'</th></tr></thead><tbody>'+
   COMPS.map(c=>'<tr><td>'+t('c_'+c)+'</td>'+cell(LP[c])+'<td>'+stp('P',c)+'</td>'+cell(LW[c])+'<td>'+stp('W',c)+'</td></tr>').join('')+'</tbody></table></div><p class="small" id="cap-now" style="margin-top:8px">'+t('capNow',capOf())+'</p>'+
   '<p class="shared" style="margin-top:4px">'+t('sharedNote')+'</p>';
}
function interHTML(){
  return'<div class="stack'+(G.view?' ro':'')+'"><div><p class="kicker">'+t('round')+' 1 → 2</p><h1>'+t('imTitle')+'</h1></div>'+
   '<div class="panel"><h3>'+t('forT')+'</h3>'+formulaHTML(EST.LP,EST.LW,t('estNote'))+'</div>'+
   nextBtn(t('start2'))+
   '<div class="two"><div class="panel">'+loopSVG()+'<p class="small" style="margin-top:6px">'+t('kP')+'</p><p class="small" style="margin-top:6px">'+t('kW')+'</p></div>'+
   '<div class="panel"><h3>'+t('cycT')+'</h3><ol class="steps">'+t('cyc').map(x=>'<li>'+x+'</li>').join('')+'</ol></div></div>'+
   '<div class="panel"><h3>'+t('rulT')+'</h3><ol class="steps">'+t('rul').map(x=>'<li>'+x+'</li>').join('')+'</ol></div></div>';
}
function retroHTML(){
  const r=(R().results||[])[1];let ins='';
  if(r){
    const sT=r.stockT||{};let worst=null;PN.forEach(p=>{if(sT[p]>0&&(!worst||sT[p]>sT[worst]))worst=p;});
    ins='<ul class="ins"><li>'+(worst?t('i_short',pnName(worst),nf(sT[worst],0)):t('i_noShort'))+'</li><li>'+t('i_serv',Math.round((r.noWait||0)*100))+'</li><li>'+t('i_alpha')+'</li></ul>';
  }
  const imp=cfg().imp||[];
  return'<div class="stack'+(G.view?' ro':'')+'"><div><p class="kicker">'+t('round')+' 2 → 3</p><h1>'+t('retroTitle')+'</h1><p class="lead">'+t('retroLead')+'</p></div>'+
   (r?'<div class="two"><div class="panel">'+ins+'</div><div class="panel"><h3>'+t('famT')+'</h3>'+famTable(r)+'</div></div>':'')+
   '<div class="panel"><h3>'+t('chooseImp')+'</h3><div class="opts c2">'+IMPS.map(k=>'<button class="opt" data-act="imp" data-k="'+k+'" aria-pressed="'+imp.includes(k)+'"'+(G.view?' disabled':'')+'><b>'+t('imp_'+k)+'</b><small>'+t('imp_'+k+'_d')+'</small></button>').join('')+'</div><p class="hint" id="imp-hint" style="margin-top:8px"></p><p class="shared">'+t('sharedNote')+'</p></div>'+
   '<div class="panel"><h3>'+t('adjust')+'</h3>'+formulaHTML(r&&r.LPf?r.LPf:EST.LP,r&&r.LWf?r.LWf:EST.LW,r?t('measNote'):t('estNote'))+'</div>'+
   nextBtn(t('start3'))+
   '<div class="panel"><label for="f-notes"><h3>'+t('notes')+'</h3></label><textarea id="f-notes" style="margin-top:8px">'+esc(G.notes)+'</textarea></div></div>';
}
function updateShared(){
  const c0=cfg();
  ['P','W'].forEach(k=>COMPS.forEach(c=>{const v=c0['n'+k][c];setText('kn-'+k+'-'+c,String(v));setDis('kd-'+k+'-'+c,G.view||v<=1);setDis('ku-'+k+'-'+c,G.view||v>=5);}));
  setText('cap-now',t('capNow',capOf()));
  document.querySelectorAll('[data-act=imp]').forEach(b=>b.setAttribute('aria-pressed',String((c0.imp||[]).includes(b.dataset.k))));
}
function resultsText(){
  const L=[t('title')+' · '+t('team')+': '+(R().name||R().id||'')+' · '+G.peers.map(p=>p.name).join(', ')];
  resultsList().forEach(r=>{if(!r)return;
    let s=t('round')+' '+r.round+' ('+t('r'+r.round+'t')+'): '+r.points+' punti · '+t('h_done')+' '+r.delivered+' · '+t('h_bl')+' '+r.backlog+' · '+t('h_wip')+' '+r.wip+' · '+t('h_lead')+' '+nf(r.lead,0)+' s · '+t('h_serv')+' '+Math.round((r.noWait||0)*100)+'%';
    if(r.mode==='kanban'&&r.nP&&r.nW)s+=' · P '+COMPS.map(c=>r.nP[c]).join('/')+' · W '+COMPS.map(c=>r.nW[c]).join('/')+' ('+r.cards+')';
    if(r.round===3)s+=' · '+t('impL')+': '+((r.imp||[]).length?r.imp.map(k=>t('imp_'+k)).join(', '):t('none'));
    L.push(s);});
  if(G.notes)L.push('Note: '+G.notes);
  return L.join('\n');
}
function debriefHTML(){
  const rs=resultsList(),r1=rs[0],r2=rs[1],r3=rs[2],ins=[];
  if(r1&&r2)ins.push(t('d1',r1.wip,r2.wip));
  if(r1&&r3)ins.push(t('d2',r1.delivered,r3.delivered));
  if(r2&&r3){ins.push(t('d3',nf(r2.lead,0),nf(r3.lead,0)));ins.push((r3.imp||[]).includes('heijunka')?t('d_heij'):t('d_noheij'));}
  const tbl='<div class="tablewrap"><table><thead><tr><th>'+t('h_round')+'</th><th>'+t('h_pts')+'</th><th>'+t('h_done')+'</th><th>'+t('h_bl')+'</th><th>'+t('h_wip')+'</th><th>'+t('h_lead')+'</th><th>'+t('h_serv')+'</th><th>'+t('h_cards')+'</th></tr></thead><tbody>'+
   rs.filter(Boolean).map(r=>'<tr><td>'+r.round+' · '+t('r'+r.round+'t')+'</td><td class="'+(r.points<0?'neg':'')+'">'+r.points+'</td><td>'+r.delivered+'</td><td>'+r.backlog+'</td><td>'+r.wip+'</td><td>'+nf(r.lead,0)+' s</td><td>'+Math.round((r.noWait||0)*100)+'%</td><td>'+(r.cards||'–')+'</td></tr>').join('')+'</tbody></table></div>';
  return'<div class="stack"><div><p class="kicker">'+esc(teamLabel(R().name||R().id||''))+'</p><h1>'+t('dbTitle')+'</h1></div>'+
   '<div class="two"><div class="panel"><h3>'+t('ptsChart')+'</h3>'+pointsSVG()+'</div><div class="panel"><h3>'+t('insTitle')+'</h3><ul class="ins">'+ins.map(x=>'<li>'+x+'</li>').join('')+'</ul></div></div>'+
   '<div class="panel"><h3>'+t('cmp')+'</h3>'+tbl+'</div>'+
   '<div class="two"><div class="panel"><h3>'+t('qTitle')+'</h3><ol class="steps">'+t('q').map(x=>'<li>'+x+'</li>').join('')+'</ol></div><div class="panel"><h3>'+t('lTitle')+'</h3><ol class="steps">'+t('l').map(x=>'<li>'+x+'</li>').join('')+'</ol></div></div>'+
   '<div class="panel"><div class="row"><button class="btn primary" data-act="copy">'+t('copy')+'</button><span id="copy-msg" class="small"></span></div><textarea class="copyarea" id="f-copy" readonly aria-label="'+esc(t('copy'))+'">'+esc(resultsText())+'</textarea></div>'+
   '<p class="credit">'+t('credit')+'</p></div>';
}

/* ---------- Barra superiore, navigazione, rendering ---------- */
const STEPS=['lobby','g1','s1','inter','g2','s2','retro','g3','s3','debrief'];
function renderTop(){
  const tb=$('#tb');if(!tb)return;
  if(G.pin!=null){tb.innerHTML='<span class="tb-who"><b>'+t('tvTitle')+'</b></span>';return;}
  let h='';
  if(G.room){
    h+='<span class="tb-who"><b>'+esc(teamLabel(R().name||G.room))+'</b> · '+(G.view?t('spect'):esc(G.me))+'</span>';
    h+='<span class="conn'+(G.online?'':' off')+'" title="'+(G.online?t('online'):t('offline'))+'"><i></i>'+(G.online?'':t('offline'))+'</span>';
  }
  h+='<button class="langbtn" data-act="anim" id="tb-anim" aria-pressed="'+G.anim+'">'+t(G.anim?'animOn':'animOff')+'</button>';
  if(cache.tb!==h){cache.tb=h;tb.innerHTML=h;}
}
function navHTML(){
  const c=STEPS.indexOf(R().phase);
  return'<ol class="steps-nav">'+STEPS.map((st,i)=>'<li><span class="stepb'+(i===c?' cur':'')+(i<c?' done':'')+'"'+(i===c?' aria-current="step"':'')+'>'+t('st_'+st)+'</span></li>').join('')+'</ol>';
}
function screenOf(){
  if(G.pin!=null)return'teacher';
  if(!G.room)return'entry';
  if(!G.R)return'connecting';
  const ph=G.R.phase||'lobby';
  if(ph[0]==='g')return'game';
  if(ph[0]==='s')return'summary';
  return ph;
}
function render(){
  Object.keys(cache).forEach(k=>delete cache[k]);
  const prev=G.screen,prevPh=G.lastPhase;G.screen=screenOf();G.lastPhase=G.R?G.R.phase:null;G.abarKey='';
  renderTop();
  const nv=$('#nav');
  if(nv){const show=!!G.R&&G.screen!=='teacher';nv.hidden=!show;if(show){nv.innerHTML=navHTML();const cur=nv.querySelector('.cur');if(cur&&cur.scrollIntoView)try{cur.scrollIntoView({block:'nearest',inline:'center'});}catch(e){}}}
  try{document.body.classList.toggle('ingame',G.screen==='game');document.body.classList.toggle('inroom',!!G.room);}catch(e){}
  const app=$('#app');
  const top=(prev!==G.screen||prevPh!==G.lastPhase);
  clearFx();
  switch(G.screen){
    case'teacher':renderTeacher();break;
    case'entry':app.innerHTML=entryHTML();if(G.ping==null)doPing();break;
    case'connecting':app.innerHTML='<div class="waitbox"><div class="spin"></div><p>'+t('checking')+'</p></div>';break;
    case'lobby':app.innerHTML=lobbyHTML();break;
    case'game':
      if(!G.S){app.innerHTML='<div class="waitbox"><div class="spin"></div><p>'+t('starting')+'</p></div>';break;}
      app.innerHTML=gameSkeleton();updateGame();break;
    case'summary':app.innerHTML=summaryHTML(+G.R.phase.slice(1));countUp();break;
    case'inter':app.innerHTML=interHTML();break;
    case'retro':app.innerHTML=retroHTML();break;
    case'debrief':app.innerHTML=debriefHTML();break;
    default:app.innerHTML='<div class="waitbox"><p>'+esc(G.screen)+'</p></div>';
  }
  if(top)try{window.scrollTo(0,0);}catch(e){}
}
/* aggiornamento parziale (stessa fase): niente sfarfallio negli input */
function refresh(){
  renderTop();
  switch(G.screen){
    case'lobby':setHTML('lobby-roles',roleCardsHTML());setHTML('lobby-members',membersHTML());break;
    case'game':if(G.S)updateGame();break;
    case'inter':case'retro':updateShared();break;
    case'debrief':{const ta=document.getElementById('f-copy');if(ta)ta.value=resultsText();break;}
  }
}
function countUp(){
  const el=document.getElementById('countup');if(!el||!G.anim)return;
  const v=+el.dataset.v,t0=performance.now();
  const f=now=>{const p=Math.min(1,(now-t0)/900),e=1-Math.pow(1-p,3);el.textContent=Math.round(v*e);if(p<1)requestAnimationFrame(f);};
  el.textContent='0';requestAnimationFrame(f);
}
function doPing(){
  G.ping=null;
  const done=ok=>{G.ping=ok;if(G.screen==='entry'){const btn=document.getElementById('b-join');
    if(ok&&btn){btn.textContent=t('enter');}else render();}};
  let fin=false;const to=setTimeout(()=>{if(!fin){fin=true;done(false);}},8000);
  api('/api/ping').then(r=>{if(fin)return;fin=true;clearTimeout(to);done(!!(r&&r.ok));}).catch(()=>{if(fin)return;fin=true;clearTimeout(to);done(false);});
}

/* ---------- Regia docente ---------- */
const TV={ok:null,rooms:[],sess:{dur:180},err:false,upd:'',confirm:false,timer:null};
const PH_LABEL={lobby:'In sala',g1:'Round 1 in corso',s1:'Esito 1',inter:'Intermezzo',g2:'Round 2 in corso',s2:'Esito 2',retro:'Retrospettiva',g3:'Round 3 in corso',s3:'Esito 3',debrief:'Debriefing'};
function studentLink(){return location.origin+location.pathname+(Q.get('server')?'?server='+enc(Q.get('server')):'');}
function renderTeacher(){
  const app=$('#app');
  if(TV.ok===null){app.innerHTML='<div class="waitbox"><div class="spin"></div><p>'+t('checking')+'</p></div>';checkPin();return;}
  if(TV.ok===false){
    app.innerHTML='<div class="panel bigerr"><h2>'+t('tvPinBad')+'</h2><p>'+t('tvPinHelp')+'</p><form class="row" id="f-pin"><input type="text" id="f-pinv" aria-label="'+t('pinL')+'" placeholder="'+t('pinL')+'" autocomplete="off"><button class="btn primary" type="submit">'+t('openReg')+'</button></form>'+
      (TV.err?'<p class="err">'+t('tvNoSrv')+'</p>':'')+'</div>';return;}
  app.innerHTML='<div class="stack tv"><div><p class="kicker">'+t('kicker')+'</p><h1>'+t('tvTitle')+'</h1></div>'+
   '<div class="ctrl"><div class="panel"><h3>'+t('tvLink')+'</h3><div class="link"><input type="text" id="tv-link" readonly value="'+esc(studentLink())+'" aria-label="'+t('tvLink')+'"><button class="btn primary" data-act="tvcopy">'+t('tvCopy')+'</button></div></div>'+
   '<div class="panel"><h3>'+t('tvDur')+'</h3><select id="tv-dur" aria-label="'+t('tvDur')+'">'+DUR_OPTS.map(d=>'<option value="'+d+'"'+(d===TV.sess.dur?' selected':'')+'>'+clock(d)+' minuti</option>').join('')+'</select><p class="small muted">'+t('tvDurNote')+'</p></div>'+
   '<div class="panel" id="tv-reset">'+resetBoxHTML()+'</div></div>'+
   '<section class="panel"><div class="row" style="justify-content:space-between"><h2>'+t('tvBoard')+'</h2><span class="small muted" id="tv-upd"></span></div><div id="tv-board" style="margin-top:10px"></div></section></div>';
  drawBoard();
}
function resetBoxHTML(){
  if(!TV.confirm)return'<h3>'+t('tvReset')+'</h3><p class="small muted">Cancella tutte le squadre e genera una nuova sequenza di ordini.</p><div><button class="btn danger" data-act="tvreset">'+t('tvReset')+'</button></div>';
  return'<div class="confirm"><b>'+t('tvResetQ')+'</b><div class="row"><button class="btn danger" data-act="tvresetyes">'+t('tvResetYes')+'</button><button class="btn" data-act="tvresetno">'+t('tvCancel')+'</button></div></div>';
}
function checkPin(){
  api('/api/pin?pin='+enc(G.pin)).then(r=>{TV.ok=!!(r&&r.ok);TV.err=false;render();if(TV.ok)poll();})
   .catch(()=>{TV.err=true;setTimeout(checkPin,3000);const app=$('#app');if(app)app.innerHTML='<div class="panel bigerr"><p class="err">'+t('tvNoSrv')+'</p></div>';});
}
function poll(){
  clearTimeout(TV.timer);
  api('/api/rooms').then(r=>{TV.rooms=(r&&r.rooms)||[];const first=!TV.loaded;TV.loaded=true;
    if(r&&r.session&&r.session.dur&&r.session.dur!==TV.sess.dur){TV.sess=r.session;const s=document.getElementById('tv-dur');if(s&&document.activeElement!==s)s.value=String(TV.sess.dur);}
    TV.err=false;TV.upd=new Date().toLocaleTimeString('it-IT');drawBoard();if(first)drawBoard();})
   .catch(()=>{TV.err=true;drawBoard();})
   .then(()=>{TV.timer=setTimeout(poll,2000);});
}
function drawBoard(){
  setText('tv-upd',TV.err?t('tvNoSrv'):(TV.upd?t('tvTeams',TV.rooms.length)+' · '+t('tvUpd',TV.upd):''));
  const el=document.getElementById('tv-board');if(!el)return;
  if(!TV.rooms.length){setHTML('tv-board','<p class="muted">'+t('tvNone')+'</p>');return;}
  const pts=(x,i)=>{const r=(x.results||[])[i];return r&&r.points!=null?r.points:-Infinity;};
  const rows=TV.rooms.slice().sort((a,b)=>(pts(b,2)-pts(a,2))||(pts(b,1)-pts(a,1))||(pts(b,0)-pts(a,0))||String(a.name||a.room).localeCompare(String(b.name||b.room)));
  const best=[0,1,2].map(i=>Math.max(...rows.map(x=>pts(x,i))));
  const watch=id=>'?room='+enc(id)+'&view=1'+(Q.get('server')?'&server='+enc(Q.get('server')):'');
  let h='<div class="tablewrap board"><table><thead><tr><th>'+t('th_rank')+'</th><th>'+t('th_team')+'</th><th>'+t('th_phase')+'</th><th>R1</th><th>R2</th><th>R3</th><th>'+t('th_cards')+'</th><th>'+t('th_imp')+'</th><th>'+t('th_live')+'</th><th></th></tr></thead><tbody>';
  rows.forEach((x,i)=>{
    const roles=x.roles||{},assigned=ROLES.filter(r=>roles[r]).map(r=>t('role_'+r).replace('Reparto ','')+': '+esc(roles[r]));
    const named=new Set(ROLES.map(r=>roles[r]).filter(Boolean)),idle=(x.peers||[]).filter(p=>!named.has(p));
    const mem=(assigned.length?assigned.join(' · '):'tutti i ruoli automatici')+(idle.length?' · senza ruolo: '+idle.map(esc).join(', '):'');
    const ph=x.phase||'lobby',play=ph[0]==='g';
    const pc=k=>{const r=(x.results||[])[k];if(!r||r.points==null)return'<td class="pt muted">–</td>';return'<td class="pt'+(r.points===best[k]&&rows.length>1?' best':'')+(r.points<0?' neg':'')+'">'+r.points+'</td>';};
    const lv=x.live;
    h+='<tr><td class="rk">'+(i+1)+'</td><td class="tn">'+esc(x.name||x.room)+'<span class="mem">'+((x.peers||[]).length)+' in squadra · '+mem+'</span></td>'+
      '<td><span class="ph'+(play?' play':'')+'">'+esc(PH_LABEL[ph]||ph)+'</span></td>'+pc(0)+pc(1)+pc(2)+
      '<td>'+(x.cards!=null&&x.cards!==''?esc(x.cards):'–')+'</td><td class="small" style="text-align:left">'+((x.imp||[]).length?x.imp.map(k=>esc(t('imp_'+k))).join(', '):'–')+'</td>'+
      '<td class="live">'+(lv?esc(t('tvLiveTxt',clock((lv.dur||0)-(lv.t||0)),lv.delivered,lv.waiting,lv.stock)):'–')+'</td>'+
      '<td><a class="btn" href="'+esc(watch(x.room))+'" target="_blank" rel="noopener">'+t('tvWatch')+'</a></td></tr>';
  });
  setHTML('tv-board',h+'</tbody></table></div>');
}

/* ---------- Azioni ---------- */
function act(a,el){
  switch(a){
    case'anim':G.anim=!G.anim;lsSet('kg_anim',G.anim?'1':'0');if(!G.anim)clearFx();cache.tb=null;renderTop();setText('u-anim',t(G.anim?'animOn':'animOff'));break;
    case'retry':G.ping=null;render();break;
    case'role':{if(G.view)break;const r=el.dataset.r,h=holder(r);
      if(h===G.cid)op({a:'unrole',role:r});else if(!h)op({a:'role',role:r});else toast(t('err_taken'));break;}
    case'next':el.disabled=true;setTimeout(()=>{el.disabled=false;},1500);op({a:'next',from:R().phase});break;
    case'act':{const r=el.dataset.r;if(!mine(r))break;G.pend[r]=performance.now();el.disabled=true;
      const body={a:'act',role:r,action:el.dataset.a};if(el.dataset.arg)body.arg=el.dataset.arg;
      op(body).then(()=>{});break;}
    case'kn':{if(G.view||!G.R)break;const k=el.dataset.k,c=el.dataset.c,c0=cfg();
      const nP=Object.assign({},c0.nP),nW=Object.assign({},c0.nW),o=k==='P'?nP:nW;o[c]=Math.max(1,Math.min(5,(o[c]||1)+(+el.dataset.d)));
      G.R.cfg=Object.assign({},c0,{nP,nW});updateShared();op({a:'cfg',nP,nW});break;}
    case'imp':{if(G.view||!G.R)break;const k=el.dataset.k,c0=cfg(),imp=(c0.imp||[]).slice(),i=imp.indexOf(k),hint=document.getElementById('imp-hint');
      if(i>=0)imp.splice(i,1);else if(imp.length<2)imp.push(k);else{if(hint)hint.textContent=t('maxImp');break;}
      if(hint)hint.textContent='';G.R.cfg=Object.assign({},c0,{imp});updateShared();op({a:'cfg',nP:c0.nP,nW:c0.nW,imp});break;}
    case'copy':{const msg=document.getElementById('copy-msg'),fail=()=>{if(msg)msg.textContent=t('copyFail');const ta=document.getElementById('f-copy');if(ta)ta.select();};
      try{navigator.clipboard.writeText(resultsText()).then(()=>{if(msg){msg.textContent=t('copied');msg.className='small flash';}},fail);}catch(e){fail();}break;}
    case'tvcopy':{const inp=document.getElementById('tv-link'),v=studentLink(),ok=()=>toast('Link copiato.'),fail=()=>{if(inp){inp.focus();inp.select();}toast('Copia non riuscita: seleziona il link.');};
      try{navigator.clipboard.writeText(v).then(ok,fail);}catch(e){fail();}break;}
    case'tvreset':TV.confirm=true;setHTML('tv-reset',resetBoxHTML());break;
    case'tvresetno':TV.confirm=false;setHTML('tv-reset',resetBoxHTML());break;
    case'tvresetyes':TV.confirm=false;setHTML('tv-reset',resetBoxHTML());
      api('/api/reset?pin='+enc(G.pin),{}).then(r=>{toast(r&&r.ok!==false?t('tvResetDone'):t('err_generic'));poll();}).catch(()=>toast(t('err_net')));break;
  }
}
document.addEventListener('click',e=>{const b=e.target.closest('[data-act]');if(!b||b.disabled)return;act(b.dataset.act,b);});
document.addEventListener('submit',e=>{
  const f=e.target;e.preventDefault();
  if(f.id==='f-join'){
    const team=(document.getElementById('f-team').value||'').trim(),name=(document.getElementById('f-name').value||'').trim(),err=document.getElementById('f-err');
    if(!roomIdOf(team)){if(err)err.textContent=t('errTeam');return;}
    if(!name){if(err)err.textContent=t('errName');return;}
    join(team,name.slice(0,20));
  }
  if(f.id==='f-pin'){const v=(document.getElementById('f-pinv').value||'').trim();if(!v)return;
    try{const q=new URLSearchParams();q.set('docente',v);if(Q.get('server'))q.set('server',Q.get('server'));location.search='?'+q.toString();}catch(x){}}
});
document.addEventListener('input',e=>{if(e.target.id==='f-notes')G.notes=e.target.value;});
document.addEventListener('change',e=>{
  if(e.target.id==='tv-dur'){const d=+e.target.value;api('/api/session?pin='+enc(G.pin),{dur:d}).then(r=>{if(r&&r.ok!==false){TV.sess.dur=d;toast(t('tvDurSet',d));}else toast(t('err_generic'));}).catch(()=>toast(t('err_net')));}
});
/* rete di sicurezza: anche senza tick nuovi nessun pezzo resta nascosto */
setInterval(()=>{if(G.screen==='game'&&pendingM.size){const n=hidden.size;sweepHidden();if(hidden.size!==n)updateGame();}},1000);
window.addEventListener('pageshow',e=>{if(e.persisted&&G.room)connect();});
/* telefono sbloccato / scheda tornata in primo piano: se la connessione è morta, riapri subito */
document.addEventListener('visibilitychange',()=>{if(document.visibilityState==='visible'&&G.room&&(!G.es||G.es.readyState===2))connect();});

/* ---------- Avvio ---------- */
if(G.pin!=null){render();}
else if(G.view&&Q.get('room')){G.room=roomIdOf(Q.get('room'));render();connect();}
else if(G.me&&Q.get('room')&&ssGet('kg_joined')===roomIdOf(Q.get('room'))){join(Q.get('room'),G.me);} /* ricarica della pagina: rientra da solo */
else{render();}
})();
