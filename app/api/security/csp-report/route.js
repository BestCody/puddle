import { NextResponse } from 'next/server'
import { enforceRateLimit } from '@/lib/security/rate-limit'
import { recordSecurityEvent } from '@/lib/security/audit'

export const runtime='nodejs';export const dynamic='force-dynamic'
export async function POST(request){const limited=await enforceRateLimit({headers:request.headers,action:'csp_report'});if(!limited.allowed)return new NextResponse(null,{status:204});const raw=await request.text().catch(()=>'');if(Buffer.byteLength(raw)>32_000)return new NextResponse(null,{status:204});let report={};try{report=JSON.parse(raw||'{}')}catch{}const value=report['csp-report']||report.body||report;await recordSecurityEvent({headers:request.headers,eventType:'csp_violation',severity:'warning',targetType:'csp',targetId:String(value?.['violated-directive']||value?.effectiveDirective||'unknown').slice(0,160),metadata:{blocked:String(value?.['blocked-uri']||value?.blockedURL||'').slice(0,500),document:String(value?.['document-uri']||value?.documentURL||'').slice(0,500),disposition:value?.disposition||null}});return new NextResponse(null,{status:204})}
