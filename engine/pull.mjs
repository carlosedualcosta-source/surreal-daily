// Coleta o Daily do ClickUp via REST e escreve ./data.json. Token = env CLICKUP_TOKEN.
// Roda no GitHub Actions (2x/dia + a cada 2h + botão). Sem limite de tempo, sem créditos.
import { readFileSync, writeFileSync, existsSync } from "fs";

const TOKEN = process.env.CLICKUP_TOKEN;
if (!TOKEN) { console.error("sem CLICKUP_TOKEN"); process.exit(1); }
const TEAM = "90132926391", CF = "907150c8-59d6-47e5-a118-06d5804b2e34";
const H = { Authorization: TOKEN, "Content-Type": "application/json" };
const LISTS = {"901324364086":"Audiovisual","901324364102":"Desenvolvimento Web","901324364256":"Design & Branding","901324364981":"Tráfego Pago","901324365091":"CRM / Kommo","901324364831":"GMN & SEO Local","901324365318":"Social Media","901324364033":"Gestão & CS","901324197822":"RH / Contratação","901324197825":"Jurídico","901324197826":"Comercial","901324197840":"Growth","901324197839":"Growth · NPS","901324197856":"Processos","901324197859":"Processos · Upgrade","901324197843":"Educacional"};
const ACTIVE = ["a fazer","em produção","em aprovação","revisão interna","ajustes/refação","impedimento","enviado para o cliente","contrato","assinatura","abertura de vaga"];
const ORDER = ["a fazer","em produção","revisão interna","ajustes/refação","em aprovação","assinatura","contrato","abertura de vaga","enviado para o cliente","impedimento"];
const F_AB=["a fazer","em produção","revisão interna","ajustes/refação","abertura de vaga","contrato"],F_AP=["em aprovação","assinatura"],F_CL=["enviado para o cliente"],F_BL=["impedimento"];
const OFF=-3*3600*1000, two=n=>(n<10?"0":"")+n;
const fB=ms=>{if(!ms)return"";const d=new Date(Number(ms)+OFF);return two(d.getUTCDate())+"/"+two(d.getUTCMonth()+1)+"/"+d.getUTCFullYear()+" "+two(d.getUTCHours())+":"+two(d.getUTCMinutes());};
const fS=ms=>{if(!ms)return"";const d=new Date(Number(ms)+OFF);return two(d.getUTCDate())+"/"+two(d.getUTCMonth()+1)+" "+two(d.getUTCHours())+":"+two(d.getUTCMinutes());};
let inflight=0; const MAXC=6; const sleep=ms=>new Promise(r=>setTimeout(r,ms));
async function api(url,opts,tr){tr=tr||0;while(inflight>=MAXC)await sleep(40);inflight++;try{const r=await fetch(url,Object.assign({headers:H},opts||{}));if(r.status===429){const ra=parseInt(r.headers.get("retry-after")||"5",10);inflight--;await sleep((ra||5)*1000);return api(url,opts,tr+1);}const t=await r.text();let d;try{d=JSON.parse(t);}catch(e){d={_raw:t};}inflight--;if(r.status>=500&&tr<3){await sleep(1000*(tr+1));return api(url,opts,tr+1);}return{status:r.status,d};}catch(e){inflight--;if(tr<3){await sleep(1000*(tr+1));return api(url,opts,tr+1);}return{status:0,d:{_err:String(e)}};}}
async function pool(items,fn){const out=new Array(items.length);let i=0;async function w(){while(i<items.length){const k=i++;out[k]=await fn(items[k],k);}}const ws=[];for(let k=0;k<MAXC;k++)ws.push(w());await Promise.all(ws);return out;}

const now=Date.now(), dN=new Date(now+OFF);
const gp={iso:new Date().toISOString(), brt:two(dN.getUTCDate())+"/"+two(dN.getUTCMonth()+1)+"/"+dN.getUTCFullYear()+" "+two(dN.getUTCHours())+":"+two(dN.getUTCMinutes()), hour:dN.getUTCHours()};
const slot=gp.hour<14?"manhã":"noite";

let today={};
for(const lid of Object.keys(LISTS)){let page=0,last=false;while(!last){const r=await api("https://api.clickup.com/api/v2/list/"+lid+"/task?archived=false&subtasks=false&include_closed=false&page="+page);const ts=(r.d&&r.d.tasks)||[];last=(r.d&&r.d.last_page)||ts.length===0;for(const t of ts){const st=t.status&&t.status.status;if(ACTIVE.indexOf(st)<0)continue;let cl="—";const cf=(t.custom_fields||[]).find(f=>f.id===CF);if(cf&&Array.isArray(cf.value)&&cf.value[0]&&cf.value[0].name)cl=cf.value[0].name;today[t.id]={id:t.id,name:t.name,status:st,area:LISTS[lid],assignees:(t.assignees||[]).map(a=>a.username),url:t.url,dueMs:t.due_date?Number(t.due_date):0,client:cl,timeMs:0,daysIn:0,history:[],lastComment:null};}page++;if(page>20)break;}}
const ids=Object.keys(today);
console.log("ativas:",ids.length);

await pool(ids,async id=>{const t=today[id];const[gt,tis]=await Promise.all([api("https://api.clickup.com/api/v2/task/"+id+"?custom_fields=true&include_subtasks=true"),api("https://api.clickup.com/api/v2/task/"+id+"/time_in_status")]);if(gt.d){var base=Number(gt.d.time_spent||0);(gt.d.subtasks||[]).forEach(function(s){base+=Number(s.time_spent||0);});t.timeMs=base;const cf=(gt.d.custom_fields||[]).find(f=>f.id===CF);if(cf&&Array.isArray(cf.value)&&cf.value[0]&&cf.value[0].name)t.client=cf.value[0].name;}if(tis.d&&tis.d.current_status){const by=tis.d.current_status.total_time&&tis.d.current_status.total_time.by_minute;if(by!=null)t.daysIn=Math.max(0,Math.floor(by/1440));const h=(tis.d.status_history||[]).slice().sort((a,b)=>Number((a.total_time&&a.total_time.since)||0)-Number((b.total_time&&b.total_time.since)||0));t.history=h.filter(x=>x.total_time&&x.total_time.since).map(x=>({brt:fB(x.total_time.since),s:x.status}));const cs=tis.d.current_status;if(cs.total_time&&cs.total_time.since){const l=t.history[t.history.length-1];if(!l||l.s!==cs.status)t.history.push({brt:fB(cs.total_time.since),s:cs.status});}}});

const imps=ids.map(id=>today[id]).filter(t=>t.status==="impedimento").sort((a,b)=>b.daysIn-a.daysIn).slice(0,25);
await pool(imps,async t=>{const r=await api("https://api.clickup.com/api/v2/task/"+t.id+"/comment");const cs=(r.d&&r.d.comments)||[];if(cs.length){cs.sort((a,b)=>Number(b.date||0)-Number(a.date||0));const c=cs[0];const tx=(c.comment_text||"").trim().slice(0,160);if(tx)t.lastComment={text:tx,by:(c.user&&c.user.username)||"?",brt:fS(c.date)};}});

let prev={tasks:{},runs:[],brt:""};
if(existsSync("./data.json")){try{const j=JSON.parse(readFileSync("./data.json","utf8"));prev.runs=j.runs||[];prev.brt=(j.generatedAt&&j.generatedAt.brt)||"";const pt=j.tasks||{};for(const id in pt){if(pt[id].status!=="concluída")prev.tasks[id]={s:pt[id].status};}}catch(e){}}
const prevIds=Object.keys(prev.tasks);
const novas=ids.filter(id=>!prev.tasks[id]), mud=[], pa=[];
ids.forEach(id=>{const p=prev.tasks[id];if(p&&p.s&&p.s!==today[id].status){const m={id,from:p.s,to:today[id].status};if(p.s==="em produção"&&today[id].status==="em aprovação")pa.push(m);else mud.push(m);}});
const novosImp=ids.filter(id=>today[id].status==="impedimento"&&(!prev.tasks[id]||prev.tasks[id].s!=="impedimento"));
const gone=prevIds.filter(id=>!today[id]).slice(0,40), concl=[];
await pool(gone,async id=>{const r=await api("https://api.clickup.com/api/v2/task/"+id);if(r.d&&r.d.date_closed){today[id]={id,name:r.d.name||id,url:r.d.url||"#",status:"concluída",area:(LISTS[(r.d.list&&r.d.list.id)]||"—"),assignees:(r.d.assignees||[]).map(a=>a.username),client:"—",timeMs:Number(r.d.time_spent||0),daysIn:0,history:[],lastComment:null};concl.push(id);}});

const act=ids.map(id=>today[id]), inS=(s,set)=>set.indexOf(s)>-1;
const totals={ativas:act.length,aberto:act.filter(t=>inS(t.status,F_AB)).length,aprovacao:act.filter(t=>inS(t.status,F_AP)).length,cliente:act.filter(t=>inS(t.status,F_CL)).length,bloqueado:act.filter(t=>inS(t.status,F_BL)).length};
const tt=totals.ativas||1, pct={aberto:Math.round(totals.aberto/tt*100),aprovacao:Math.round(totals.aprovacao/tt*100),cliente:Math.round(totals.cliente/tt*100),bloqueado:Math.round(totals.bloqueado/tt*100)};
const acc={};act.forEach(t=>acc[t.area]=(acc[t.area]||0)+1);const byArea=Object.keys(acc).map(a=>({area:a,n:acc[a]})).sort((a,b)=>b.n-a.n);
const board=ORDER.map(s=>({status:s,ids:ids.filter(id=>today[id].status===s)})).filter(c=>c.ids.length>0);
const runs=prev.runs.slice();runs.push({ts:now,brt:gp.brt,slot,ativas:totals.ativas,novas:novas.length,concluidas:concl.length,prodAprov:pa.length,novosImped:novosImp.length});while(runs.length>40)runs.shift();
const tasks={};Object.keys(today).forEach(id=>{const t=today[id];tasks[id]={name:t.name,url:t.url,status:t.status,area:t.area,client:t.client,assignees:t.assignees,timeMs:t.timeMs,dueMs:t.dueMs,daysIn:t.daysIn,lastComment:t.lastComment,history:t.history};});
const DATA={generatedAt:{iso:gp.iso,brt:gp.brt,slot},prev:prev.brt?{brt:prev.brt}:null,totals,faixaPct:pct,day:{novas:novas.length,concluidas:concl.length,prodAprov:pa.length,novosImped:novosImp.length},sections:{concluidas:concl,prodAprov:pa,mudancas:mud,novas,novosImped:novosImp},byArea,board,tasks,runs};
writeFileSync("./data.json",JSON.stringify(DATA));
const nAtr=act.filter(t=>t.dueMs&&t.dueMs<now).length, nTime=act.filter(t=>t.timeMs).length;
console.log("OK: ativas="+totals.ativas+" atrasadas="+nAtr+" comTempo="+nTime+" novas="+novas.length+" concl="+concl.length);
