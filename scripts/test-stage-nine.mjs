import assert from 'node:assert/strict'
import { cspValue } from '../lib/security/headers.js'
import { csrfCookieName, verifyCsrf } from '../lib/security/csrf.js'
import { string, uuid, integer, record } from '../lib/security/schema.js'
import { verifyWorkerBearer } from '../lib/security/worker-auth.js'
import { verifyTurnstile } from '../lib/security/turnstile.js'
const csp=cspValue({nonce:'abc123'});assert.match(csp,/nonce-abc123/);assert.match(csp,/object-src 'none'/);assert.match(csp,/frame-ancestors 'none'/);assert.match(csp,/report-uri \/api\/security\/csp-report/);assert.ok(!csp.includes("default-src *"))
const request={cookies:{get:(name)=>name===csrfCookieName()?{value:'same-token'}:null},headers:{get:(name)=>name==='x-puddle-csrf'?'same-token':null}};assert.equal(verifyCsrf(request),true);request.headers.get=()=> 'different';assert.equal(verifyCsrf(request),false)
assert.equal(string(' ok ',{min:2,max:4}),'ok');assert.equal(uuid('550e8400-e29b-41d4-a716-446655440000'),'550e8400-e29b-41d4-a716-446655440000');assert.equal(integer('5',{min:1,max:10}),5);assert.deepEqual(record({safe:true}),{safe:true});assert.throws(()=>string('',{min:1}));assert.throws(()=>integer(11,{max:10}));
process.env.CRON_SECRET='test-secret';assert.equal(verifyWorkerBearer({headers:{get:()=> 'Bearer test-secret'}}),true);assert.equal(verifyWorkerBearer({headers:{get:()=> 'Bearer wrong'}}),false);
process.env.TURNSTILE_REQUIRED='true';delete process.env.TURNSTILE_SECRET_KEY;assert.equal((await verifyTurnstile({token:'x',action:'test'})).success,false);process.env.TURNSTILE_REQUIRED='false';assert.equal((await verifyTurnstile({token:'',action:'test'})).success,true);
console.log('Puddle Stage 9 security unit tests passed.')
