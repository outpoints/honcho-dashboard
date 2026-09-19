// Synthetic browser regression checks. Every data request is intercepted;
// no request can reach a configured Honcho server or operator database.
import assert from 'node:assert/strict';
import { mkdir } from 'node:fs/promises';
import { chromium } from 'playwright';
const base = process.env.DASHBOARD_TEST_URL ?? 'http://127.0.0.1:3108';
const output = process.env.DASHBOARD_TEST_OUTPUT ?? '/tmp/honcho32-dashboard-review';
const captures = process.env.DASHBOARD_TEST_CAPTURES !== '0';
await mkdir(output, {recursive:true});
const browser = await chromium.launch({headless:true});
const unexpected = [];
const errors = [];
const overflows = [];
const date = '2026-09-18T16:00:00Z';
const ws = {id:'synthetic-workspace',metadata:{},configuration:{},created_at:date};
const peer = {id:'alice',workspace_id:ws.id,metadata:{},configuration:{},created_at:date};
const session = {id:'session-1',workspace_id:ws.id,metadata:{},configuration:{},is_active:true,created_at:date};
const root = {id:'conclusion-derived',content:'Morning planning works best for Alice.',observer_id:'alice',observed_id:'alice',level:'deductive',source_ids:['conclusion-parent','deleted-parent'],times_derived:4,session_id:'session-1',created_at:date};
const parent = {...root,id:'conclusion-parent',content:'Alice prefers meetings before noon.',level:'explicit',source_ids:null,times_derived:2};
const evidence = {conclusions:[root],messages:[{id:'message-1',session_id:'session-1',peer_id:'alice',created_at:date}],tool_calls:[{tool_name:'query_memory',tool_input:{query:'planning preferences'}}],reasoning_trace_id:'synthetic-trace'};
const trace = {id:'synthetic-trace',type:'llm.call.traced',schema_version:2,metadata:{timestamp:date,source:'/honcho/synthetic/trace',workspace_name:ws.id,session_id:'session-1',model:'synthetic-model',outcome:'success',duration_ms:1420,attempt:1,retry_attempts:3,agent_type:'dialectic',system_prompt_ref:'sha256:synthetic-prompt',source_message_ids:['message-1']}};
const pageOf = items => ({items,total:items.length,page:1,size:25,pages:1});
async function contextFor(version, viewport) {
 const context = await browser.newContext({viewport,reducedMotion:'reduce'});
 await context.addInitScript(({ws}) => {
  localStorage.setItem('honcho-dashboard:instances',JSON.stringify([{id:'synthetic',name:'Synthetic fixture',baseUrl:'http://synthetic.invalid:8000'}]));
  localStorage.setItem('honcho-dashboard:activeId','synthetic');
  localStorage.setItem('honcho-dashboard:activeWorkspaceId',ws);
  localStorage.setItem('honcho-dashboard:theme','dark');
 },{ws:ws.id});
 const calls=[];
 const state={evidence,conclusionStatus:200,metricsStatus:200,messageStatus:200,traceStatus:'ready'};
 await context.route('**/*', async route => {
  const req=route.request(); const url=new URL(req.url());
  if(url.origin!==new URL(base).origin) {unexpected.push(url.href);return route.abort();}
  let path=url.pathname.replace(/^\/api\/honcho/,'');
  const isData=path.startsWith('/v3/')||url.pathname.startsWith('/api/')||['/health','/openapi.json'].includes(path);
  if(!isData) return route.continue();
  let body; try {body=req.postDataJSON();} catch {}
  calls.push({path,body,method:req.method()});
  const reply=(json,status=200)=>route.fulfill({json,status});
  if(path==='/openapi.json') return reply({info:{version}});
  if(path==='/health') return reply({status:'ok'});
  if(path==='/v3/workspaces/list') return reply(pageOf([ws]));
  if(path==='/v3/workspaces'||path===`/v3/workspaces/${ws.id}`) return reply(ws);
  if(path.endsWith('/peers/list')) return reply(pageOf([peer]));
  if(path.endsWith('/peers')) return reply(peer);
  if(path.endsWith('/sessions/list')) return reply(pageOf([session]));
  if(path.endsWith('/sessions')) return reply(session);
  if(path.endsWith('/scopes/list')) return reply(pageOf([]));
  if(path.endsWith('/queue/status')) return reply({total_work_units:5,completed_work_units:3,in_progress_work_units:1,pending_work_units:1});
  if(path.endsWith('/chat')) return reply({content:'Plan the morning around focused work.',...(body.include_evidence?{evidence:state.evidence}:{})});
  if(path.endsWith('/messages/message-1') && state.messageStatus!==200) return reply({detail:'Message unavailable'},state.messageStatus);
  if(path.endsWith('/messages/message-1')) return reply({...evidence.messages[0],workspace_id:ws.id,content:'Please schedule planning before noon.',token_count:8,metadata:{}});
  if(path.endsWith('/conclusions/list')) {
   const filters=body?.filters;
   return reply(pageOf(filters?.id ? [parent] : filters?.source_ids ? filters.source_ids.contains===parent.id?[root]:[] : [root,parent]));
  }
  if(path.endsWith('/conclusions/conclusion-derived')||path.endsWith('/conclusions/conclusion-parent')) {
   return state.conclusionStatus===200 ? reply(path.endsWith(root.id)?root:parent) : reply({detail:'Conclusion unavailable'},state.conclusionStatus);
  }
  if(path==='/deriver/metrics') return state.metricsStatus===200 ? reply({outstanding_work_seconds:125,eligible_work_units:3,claimed_work_units:1,pending_items:6,oldest_pending_age_seconds:90,embeddings_pending:2,embeddings_pending_due:1,dreams_due:2,measured_at:1789747200,measurement_age_seconds:2}) : reply({detail:'No measurement'},state.metricsStatus);
  if(path==='/api/operator/traces') return state.traceStatus==='error'?reply({detail:'fixture error'},500):reply({available:state.traceStatus!=='unconfigured',reason:'Set HONCHO_TRACE_FILE on the dashboard host.',entries:state.traceStatus==='empty'?[]:[trace],bytes_read:300,truncated:false,skipped:0,malformed:0,generated_at:date});
  if(path==='/api/operator/diagnostics') return reply({generated_at:date,probes:[]});
  if(path==='/api/operator/config') return reply({available:true,entries:[]});
  if(path==='/api/operator/logs') return reply({available:true,entries:[]});
  if(path==='/api/operator/db') return reply({available:false,reason:'Synthetic test has no operator DB'});
  if(path==='/api/operator/runtime') return reply({available:true});
  unexpected.push(`${req.method()} ${path}`);return route.abort();
 });
 const page=await context.newPage();page.on('pageerror',e=>errors.push(e.message));
 return {context,page,calls,state};
}
async function shot(page,name) {
 await page.waitForTimeout(400);
 await page.evaluate(()=>window.scrollTo(0,0));
 if(captures) await page.screenshot({path:`${output}/${name}.png`,fullPage:true});
 if(await page.evaluate(()=>document.documentElement.scrollWidth>innerWidth)) overflows.push(name);
}
try {
 for(const [label,viewport] of [['desktop',{width:1440,height:1050}],['mobile',{width:390,height:844}]]) {
  const {context,page,calls,state}=await contextFor('3.2.0',viewport);
  await page.goto(`${base}/#/chat?peer=alice`);
  await page.getByRole('checkbox').click();
  await page.locator('input[placeholder="ask alice…"]').fill('When should we plan?');
  await page.getByRole('button',{name:'SEND',exact:true}).click();
  await page.getByRole('button',{name:/SHOW_EVIDENCE/}).click();
  await page.getByText(root.content,{exact:true}).waitFor();
  state.messageStatus=404;
  const beforeMessage=calls.length;
  await page.getByRole('button',{name:'READ_MESSAGE',exact:true}).click();
  await page.getByText('This message is unavailable or has been deleted.').waitFor();
  state.messageStatus=200;
  await page.getByRole('button',{name:'RETRY',exact:true}).click();
  await page.getByText('Please schedule planning before noon.').waitFor();
  const messageCalls=calls.slice(beforeMessage).filter(c=>c.path.startsWith('/v3/'));
  assert.equal(messageCalls.length,2);
  assert.ok(messageCalls.every(c=>c.method==='GET'&&c.path.endsWith('/messages/message-1')));
  await page.getByText('query_memory',{exact:true}).click();
  await shot(page,`${label}-chat-evidence`);
  await page.getByRole('button',{name:'PROVENANCE',exact:true}).click();
  await page.getByText('deleted-parent · unavailable or deleted').waitFor();
  await shot(page,`${label}-provenance`);
  await page.keyboard.press('Tab');
  assert.ok(await page.evaluate(()=>document.activeElement?.closest('[role="dialog"]')));
  await page.getByRole('button',{name:'Inspect conclusion conclusion-parent'}).click();
  await page.getByRole('button',{name:'Inspect conclusion conclusion-derived'}).waitFor();
  await page.getByRole('button',{name:'Inspect conclusion conclusion-derived'}).click();
  await page.getByText('deleted-parent · unavailable or deleted').waitFor();
  await page.keyboard.press('Escape');
  await page.getByRole('dialog').waitFor({state:'hidden'});
  await page.getByRole('button',{name:'WORKSPACE',exact:true}).click();
  state.evidence={conclusions:[],messages:[],tool_calls:[],reasoning_trace_id:null};
  await page.locator('input[placeholder^="ask across"]').fill('What is happening?');
  await page.getByRole('button',{name:'SEND',exact:true}).click();
  await page.getByRole('button',{name:/SHOW_EVIDENCE/}).click();
  await page.getByText('No conclusions were recorded.').waitFor();
  assert.ok(calls.some(c=>c.path===`/v3/workspaces/${ws.id}/chat`&&c.body.include_evidence));
  await page.goto(`${base}/#/conclusions`);
  await page.getByRole('button',{name:'PROVENANCE',exact:true}).first().click();
  await page.getByText('deleted-parent · unavailable or deleted').waitFor();
  await page.keyboard.press('Escape');
  await page.evaluate(()=>{
   localStorage.setItem('honcho-dashboard:writeActions','true');
   window.dispatchEvent(new Event('honcho-dashboard:writeActions-change'));
  });
  await page.getByRole('button',{name:'NEW_CONCLUSION',exact:true}).click();
  const dropdown=page.getByRole('dialog').getByRole('button',{name:'select a peer…',exact:true});
  await dropdown.click();
  await page.getByRole('listbox').waitFor();
  await page.keyboard.press('Escape');
  await page.getByRole('listbox').waitFor({state:'hidden'});
  assert.equal(await page.getByRole('dialog').count(),1,'Escape closes dropdown before dialog');
  assert.ok(await dropdown.evaluate(el=>el===document.activeElement));
  await dropdown.click();
  await page.keyboard.press('ArrowDown');
  assert.ok(await page.getByRole('option',{name:'alice',exact:true}).evaluate(el=>el===document.activeElement));
  await page.keyboard.press('Tab');
  await page.getByRole('listbox').waitFor({state:'hidden'});
  assert.ok(await page.evaluate(()=>document.activeElement?.closest('[role="dialog"]')));
  await page.keyboard.press('Escape');
  await page.getByRole('dialog').waitFor({state:'hidden'});
  await page.evaluate(()=>{
   localStorage.setItem('honcho-dashboard:writeActions','false');
   window.dispatchEvent(new Event('honcho-dashboard:writeActions-change'));
  });
  await page.goto(`${base}/#/fleet`);
  await page.getByText('2m 5s',{exact:true}).waitFor();
  assert.equal(await page.getByRole('button',{name:'REFRESH',exact:true}).count(),1);
  const beforeFleetRefresh=calls.length;
  await Promise.all([
   page.waitForResponse(r=>new URL(r.url()).pathname.endsWith('/deriver/metrics')),
   page.getByRole('button',{name:'REFRESH',exact:true}).click(),
  ]);
  assert.ok(calls.slice(beforeFleetRefresh).some(c=>c.path==='/v3/workspaces/list'));
  await shot(page,`${label}-backlog`);
  await page.goto(`${base}/#/reasoning`);
  await page.getByText('2m 5s',{exact:true}).waitFor();
  assert.equal(await page.getByRole('button',{name:'REFRESH',exact:true}).count(),1);
  const beforeReasoningRefresh=calls.length;
  await Promise.all([
   page.waitForResponse(r=>new URL(r.url()).pathname.endsWith('/deriver/metrics')),
   page.getByRole('button',{name:'REFRESH',exact:true}).click(),
  ]);
  assert.ok(calls.slice(beforeReasoningRefresh).some(c=>c.path.endsWith('/queue/status')));
  assert.ok(calls.slice(beforeReasoningRefresh).filter(c=>c.path==='/api/operator/db').length>=2);
  await page.goto(`${base}/#/diagnostics`);
  await page.getByRole('button',{name:'Inspect trace synthetic-trace'}).waitFor();
  assert.equal(await page.getByRole('button',{name:'REFRESH',exact:true}).count(),0);
  const beforeDiagnosticsRefresh=calls.length;
  await Promise.all([
   page.waitForResponse(r=>new URL(r.url()).pathname==='/api/operator/traces'),
   page.getByRole('button',{name:'RE_RUN',exact:true}).click(),
  ]);
  for(const path of ['/api/operator/diagnostics','/api/operator/config','/api/operator/logs','/api/operator/traces']) {
   assert.ok(calls.slice(beforeDiagnosticsRefresh).some(c=>c.path===path),`${path} refreshed`);
  }
  await shot(page,`${label}-traces`);
  await page.getByRole('button',{name:'Inspect trace synthetic-trace'}).click();
  await page.getByText('sha256:synthetic-prompt',{exact:true}).waitFor();
  await shot(page,`${label}-trace-details`);
  await page.keyboard.press('Escape');
  await context.close();
 }
 {
  const {context,page,state}=await contextFor('3.2.0',{width:1200,height:900});
  state.conclusionStatus=403;
  await page.goto(`${base}/#/conclusions`);
  await page.getByRole('button',{name:'PROVENANCE',exact:true}).first().click();
  await page.getByText('Access denied. Check the key in CONFIG.').waitFor();
  state.conclusionStatus=404;
  await page.getByRole('button',{name:'RETRY',exact:true}).click();
  await page.getByText('This conclusion is unavailable or has been deleted.').waitFor();
  state.conclusionStatus=200;
  await page.getByRole('button',{name:'RETRY',exact:true}).click();
  await page.getByText('deleted-parent · unavailable or deleted').waitFor();
  await page.keyboard.press('Escape');
  state.metricsStatus=503;
  await page.goto(`${base}/#/fleet`);
  await page.getByText('No deriver measurement is available yet.',{exact:false}).waitFor();
  await page.goto(`${base}/#/diagnostics`);
  await page.getByRole('textbox',{name:'Find trace'}).fill('missing-trace');
  await page.getByText('No records match these filters in the loaded window.').waitFor();
  await page.getByRole('button',{name:'CLEAR_FILTERS',exact:true}).click();
  for(const stateName of ['empty','unconfigured','error']) {
   state.traceStatus=stateName;
   await page.getByRole('button',{name:'RE_RUN',exact:true}).click();
   await page.getByText(stateName==='empty'?'No supported call traces in this file window.':stateName==='unconfigured'?'Set HONCHO_TRACE_FILE on the dashboard host.':'Trace request failed.',{exact:false}).waitFor();
  }
  state.evidence=null;
  await page.goto(`${base}/#/chat?peer=alice`);
  await page.getByRole('checkbox',{name:'INCLUDE_EVIDENCE',exact:true}).click();
  await page.locator('input[placeholder="ask alice…"]').fill('What is recorded?');
  await page.getByRole('button',{name:'SEND',exact:true}).click();
  await page.getByRole('button',{name:/SHOW_EVIDENCE/}).click();
  await page.getByText('No evidence was returned by the server for this answer.').waitFor();
  state.evidence={conclusions:null};
  await page.locator('input[placeholder="ask alice…"]').fill('Malformed evidence');
  await page.getByRole('button',{name:'SEND',exact:true}).click();
  await page.getByText('Invalid chat response from Honcho. Please retry.',{exact:false}).waitFor();
  await page.evaluate(()=>{
   const next=[{id:'new-instance',name:'Another instance',baseUrl:'http://other-synthetic.invalid:8000'}];
   localStorage.setItem('honcho-dashboard:instances',JSON.stringify(next));
   localStorage.setItem('honcho-dashboard:activeId','new-instance');
   window.dispatchEvent(new StorageEvent('storage',{key:'honcho-dashboard:activeId'}));
  });
  await page.getByText('No messages yet',{exact:true}).waitFor();
  assert.equal(await page.getByRole('button',{name:/SHOW_EVIDENCE|HIDE_EVIDENCE/}).count(),0);
  await context.close();
 }
 for(const version of ['3.1.0','unknown']) {
  const {context,page,calls}=await contextFor(version,{width:1100,height:800});
  await page.goto(`${base}/#/chat?peer=alice`);
  await page.locator('input[placeholder="ask alice…"]').waitFor();
  assert.ok(await page.getByRole('checkbox').isDisabled());
  await page.locator('input[placeholder="ask alice…"]').fill('Hello');
  await page.getByRole('button',{name:'SEND',exact:true}).click();
  await page.getByText('Plan the morning around focused work.').waitFor();
  assert.equal(calls.some(c=>c.body?.include_evidence),false);
  await page.goto(`${base}/#/conclusions`);
  await page.getByText(root.content,{exact:true}).waitFor();
  assert.equal(await page.getByRole('button',{name:'PROVENANCE',exact:true}).count(),0);
  assert.equal(calls.some(c=>c.path.endsWith('/conclusions/conclusion-derived')),false);
  await page.goto(`${base}/#/fleet`);
  await page.getByText('Backlog metrics',{exact:false}).waitFor();
  await page.getByRole('button',{name:'REFRESH',exact:true}).click();
  assert.equal(calls.some(c=>c.path==='/deriver/metrics'),false);
  await context.close();
 }
 assert.deepEqual(unexpected,[]);assert.deepEqual(errors,[]);assert.deepEqual(overflows,[]);
 console.log(JSON.stringify({passed:true,checks:'desktop/mobile evidence, read-only message retrieval and retry, malformed evidence, dropdown/modal focus, provenance cycles/missing parents, workspace empty evidence, backlog, trace details, 3.1/unknown gating',output}));
} finally {await browser.close();}
