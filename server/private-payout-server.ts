import { createServer, type IncomingMessage } from 'node:http';
import { randomBytes, timingSafeEqual } from 'node:crypto';
import { readFile } from 'node:fs/promises';
import type { PrivatePayoutService } from './private-payout-service.ts';

const secret=()=>randomBytes(32).toString('hex');
function equal(a:unknown,b:string):boolean {return typeof a==='string'&&Buffer.byteLength(a)===Buffer.byteLength(b)&&timingSafeEqual(Buffer.from(a),Buffer.from(b));}
async function body(request:IncomingMessage):Promise<Record<string,unknown>> {
  if(request.headers['content-type']!=='application/json')throw new Error('JSON required');
  let value='';for await(const chunk of request){value+=chunk.toString();if(Buffer.byteLength(value)>24_000)throw new Error('Request too large');}
  const parsed:unknown=JSON.parse(value);if(!parsed||typeof parsed!=='object'||Array.isArray(parsed))throw new Error('Object required');return parsed as Record<string,unknown>;
}
function text(value:unknown):string {if(typeof value!=='string'||!value.trim())throw new Error('Required text is missing');return value;}
export function createPrivatePayoutServer(input:{service:Pick<PrivatePayoutService,'preview'|'rehearse'|'begin'|'capture'|'recover'|'outcome'|'finish'|'reconcile'>;loginToken:string;port:number}) {
  if(!/^[0-9a-f]{64}$/.test(input.loginToken))throw new Error('A private 256-bit login token is required');
  const host=`127.0.0.1:${input.port}`,origin=`http://${host}`;
  const sessions=new Map<string,{csrf:string;expires:number;nonces:Set<string>}>();
  return createServer(async(request,response)=>{
    response.setHeader('Cache-Control','no-store');response.setHeader('X-Content-Type-Options','nosniff');response.setHeader('Referrer-Policy','no-referrer');
    response.setHeader('Content-Security-Policy',"default-src 'none'; script-src 'self'; style-src 'self'; connect-src 'self'; frame-ancestors 'none'; base-uri 'none'; form-action 'self'");
    const send=(status:number,value:unknown)=>{response.statusCode=status;response.setHeader('Content-Type','application/json');response.end(JSON.stringify(value));};
    try {
      if(request.socket.remoteAddress!=='127.0.0.1'||request.headers.host!==host||request.headers['x-forwarded-host']||request.headers['x-forwarded-for'])return send(403,{error:'Loopback Host required'});
      if(request.headers.origin&&request.headers.origin!==origin)return send(403,{error:'Origin refused'});
      if(request.headers['sec-fetch-site']&& !['same-origin','none'].includes(String(request.headers['sec-fetch-site'])))return send(403,{error:'Cross-site request refused'});
      const url=new URL(request.url??'/',origin);
      if(request.method==='GET'&&['/','/client.mjs','/style.css'].includes(url.pathname)) {
        const asset=url.pathname==='/'?'index.html':url.pathname.slice(1);
        response.setHeader('Content-Type',asset.endsWith('html')?'text/html; charset=utf-8':asset.endsWith('mjs')?'text/javascript':'text/css');
        response.end(await readFile(new URL(`../operator-ui/${asset}`,import.meta.url)));return;
      }
      if(request.method==='POST'&&request.headers.origin!==origin)return send(403,{error:'Exact Origin required'});
      if(request.method==='POST'&&url.pathname==='/api/login') {
        const data=await body(request);if(!equal(data.token,input.loginToken))return send(401,{error:'Operator authentication required'});
        for(const [key,value] of sessions)if(value.expires<=Date.now())sessions.delete(key);
        if(sessions.size>=8)return send(429,{error:'Too many operator sessions'});
        const session=secret(),csrf=secret();sessions.set(session,{csrf,expires:Date.now()+30*60_000,nonces:new Set()});
        response.setHeader('Set-Cookie',`zecori_operator=${session}; HttpOnly; SameSite=Strict; Path=/; Max-Age=1800`);return send(200,{csrf});
      }
      const cookie=request.headers.cookie?.split(';').map(x=>x.trim()).find(x=>x.startsWith('zecori_operator='))?.slice('zecori_operator='.length);
      const session=cookie?sessions.get(cookie):undefined;
      if(!session||session.expires<=Date.now())return send(401,{error:'Operator authentication required'});
      if(request.method==='GET'&&url.pathname==='/api/challenge') {
        if(session.nonces.size>=16)session.nonces.clear();const nonce=secret();session.nonces.add(nonce);return send(200,{nonce});
      }
      if(request.method==='GET'&&url.pathname==='/api/preview')return send(200,await input.service.preview(text(url.searchParams.get('packet'))));
      if(request.method!=='POST')return send(404,{error:'Not found'});
      if(!equal(request.headers['x-csrf-token'],session.csrf))return send(403,{error:'CSRF refused'});
      const nonce=request.headers['x-operator-nonce'];if(typeof nonce!=='string'||!session.nonces.delete(nonce))return send(409,{error:'Request replay refused'});
      const data=await body(request),packetId=text(data.packetId);
      if(!/^[0-9a-f-]{36}$/i.test(packetId))throw new Error('Packet ID is invalid');
      switch(url.pathname) {
        case '/api/rehearse':case '/api/begin': {
          if(!data.observations||typeof data.observations!=='object'||Array.isArray(data.observations))throw new Error('Wallet observations are required');
          const observations=data.observations as Record<string,unknown>;
          return send(200,url.pathname==='/api/begin'?await input.service.begin(packetId,observations,text(data.confirmation)):await input.service.rehearse(packetId,observations));
        }
        case '/api/hash':return send(200,await input.service.capture(packetId,text(data.hash) as `0x${string}`));
        case '/api/recover':return send(200,await input.service.recover(packetId,text(data.hash) as `0x${string}`,text(data.confirmation)));
        case '/api/outcome':return send(200,await input.service.outcome(packetId,data.code));
        case '/api/finish':return send(200,await input.service.finish(packetId));
        case '/api/reconcile':return send(200,await input.service.reconcile(packetId));
        default:return send(404,{error:'Not found'});
      }
    }catch(error){send(409,{error:error instanceof Error?error.message:'Operator action refused'});}
  });
}
