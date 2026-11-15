import { createHmac, timingSafeEqual } from 'node:crypto';
import { isUtf8 } from 'node:buffer';
import express from 'express';

const secret = process.env.AGENT_GAMES_HMAC_SECRET;
if (typeof secret !== 'string' || Buffer.byteLength(secret) < 32 || Buffer.byteLength(secret) > 1024 || /^(changeme|placeholder|example|test-secret)/i.test(secret)) {
  process.stderr.write('demo_configuration_invalid\n'); process.exit(1);
}
const port = Number(process.env.PORT ?? '3000');
if (!Number.isSafeInteger(port) || port < 1 || port > 65535) { process.stderr.write('demo_configuration_invalid\n'); process.exit(1); }
const app = express(); app.disable('x-powered-by');
function sign(raw) { return createHmac('sha256', secret).update(raw).digest('hex'); }
function sendSigned(res, status, value) {
  const raw = JSON.stringify(value);
  res.status(status).set('content-type','application/json; charset=utf-8').set('x-agent-games-signature',sign(raw)).send(raw);
}
app.get('/healthz', (_req,res) => res.status(200).json({ok:true}));
// Read the encoded body bytes ourselves; body parsers may decompress/normalize
// before HMAC validation. The platform signs the raw body, not parsed JSON.
app.post('/agent', (req,res) => {
  const chunks=[]; let total=0; let tooLarge=false; let finished=false;
  req.on('data',chunk=>{
    total+=chunk.length;
    if(total>8192){tooLarge=true;chunks.length=0;} else if(!tooLarge) chunks.push(chunk);
  });
  req.on('end',()=>{
    if(finished)return; finished=true;
    if(tooLarge)return sendSigned(res,413,{error:'BODY_TOO_LARGE'});
    const raw=Buffer.concat(chunks); const header=req.headers['x-agent-games-signature'];
    if(typeof header!=='string'||!/^[0-9a-fA-F]{64}$/.test(header))return sendSigned(res,401,{error:'BAD_SIGNATURE'});
    if(!timingSafeEqual(Buffer.from(sign(raw),'hex'),Buffer.from(header,'hex')))return sendSigned(res,401,{error:'BAD_SIGNATURE'});
    const type=req.headers['content-type'];
    if(typeof type!=='string'||type.split(';',1)[0].trim().toLowerCase()!=='application/json'||req.headers['content-encoding']!==undefined)return sendSigned(res,415,{error:'UNSUPPORTED_MEDIA_TYPE'});
    if(!isUtf8(raw))return sendSigned(res,400,{error:'INVALID_JSON'});
    let task; try{task=JSON.parse(raw.toString('utf8'));}catch{return sendSigned(res,400,{error:'INVALID_JSON'});}
    if(!task||typeof task!=='object'||Array.isArray(task)||typeof task.mode!=='string'||typeof task.eventId!=='string'||typeof task.matchId!=='string'||!Number.isSafeInteger(task.turn))return sendSigned(res,400,{error:'INVALID_TASK'});
    // Educational echo only: never emits a game action, proof, decision, or secret.
    return sendSigned(res,200,{mode:task.mode,eventId:task.eventId,matchId:task.matchId,turn:task.turn,authenticated:true});
  });
  req.on('aborted',()=>{finished=true;});
});
app.use((_req,res)=>sendSigned(res,404,{error:'NOT_FOUND'}));
const server=app.listen(port,'127.0.0.1');
server.on('error',()=>{process.stderr.write('demo_startup_failed\n');process.exitCode=1;});
function stop(){server.close(()=>process.exit(0));}
process.once('SIGTERM',stop); process.once('SIGINT',stop);
