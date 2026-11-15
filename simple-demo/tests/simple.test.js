import assert from 'node:assert/strict';
import { createHmac, randomBytes } from 'node:crypto';
import { spawn } from 'node:child_process';
import { mkdtempSync, rmSync } from 'node:fs';
import { createServer } from 'node:net';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import test from 'node:test';
import { fileURLToPath } from 'node:url';

function availablePort(){return new Promise(resolve=>{const s=createServer();s.listen(0,'127.0.0.1',()=>{const a=s.address();if(typeof a==='object'&&a)s.close(()=>resolve(a.port));});});}
test('simple demo authenticates raw bytes and echoes only the selected safe task fields',async()=>{
 const work=mkdtempSync(join(tmpdir(),'steal-simple-demo-'));const port=await availablePort();const secret=randomBytes(32).toString('hex');
 const server=spawn(process.execPath,['server.js'],{cwd:fileURLToPath(new URL('..',import.meta.url)),env:{PATH:process.env.PATH??'',PORT:String(port),AGENT_GAMES_HMAC_SECRET:secret},stdio:'ignore'});
 const exited=new Promise(resolve=>server.once('exit',(code,signal)=>resolve({code,signal})));
  const url=`http://127.0.0.1:${port}/agent`;
  const sign=(raw)=>createHmac('sha256',secret).update(raw).digest('hex');
  const checkResponse=async(r)=>{const text=await r.text();assert.equal(r.headers.get('x-agent-games-signature'),sign(text));return JSON.parse(text);};
  try{
  let ready=false;for(let i=0;i<40;i++){try{const r=await fetch(`http://127.0.0.1:${port}/healthz`);if(r.status===200){ready=true;break;}}catch{}await new Promise(r=>setTimeout(r,50));}assert.equal(ready,true);
  const raw='{ malformed';const invalid=await fetch(url,{method:'POST',headers:{'content-type':'application/json','x-agent-games-signature':sign('different')},body:raw});
  assert.equal(invalid.status,401);assert.deepEqual(await checkResponse(invalid),{error:'BAD_SIGNATURE'});
  const malformed=await fetch(url,{method:'POST',headers:{'content-type':'application/json','x-agent-games-signature':sign(raw)},body:raw});
  assert.equal(malformed.status,400);assert.deepEqual(await checkResponse(malformed),{error:'INVALID_JSON'});
  const secret='NEVER-ECHO';const body=JSON.stringify({mode:'practice',eventId:'steal-the-vfy',matchId:'local',turn:3,ignored_secret_field:secret});const signature=sign(body);
  const good=await fetch(url,{method:'POST',headers:{'content-type':'application/json','x-agent-games-signature':signature},body});
  assert.equal(good.status,200);assert.deepEqual(await checkResponse(good),{mode:'practice',eventId:'steal-the-vfy',matchId:'local',turn:3,authenticated:true});
  const altered=await fetch(url,{method:'POST',headers:{'content-type':'application/json','x-agent-games-signature':signature},body:body+' '});
  assert.equal(altered.status,401);assert.deepEqual(await checkResponse(altered),{error:'BAD_SIGNATURE'});
  const compressed=await fetch(url,{method:'POST',headers:{'content-type':'application/json','content-encoding':'gzip','x-agent-games-signature':signature},body});
  assert.equal(compressed.status,415);assert.deepEqual(await checkResponse(compressed),{error:'UNSUPPORTED_MEDIA_TYPE'});
  assert.equal(body.includes(secret),true);
 }finally{if(server.exitCode===null)server.kill('SIGTERM');const result=await exited;assert.equal(result.code,0);rmSync(work,{recursive:true,force:true});}
});
