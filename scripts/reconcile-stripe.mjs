import { createClient } from '@supabase/supabase-js'
const url=process.env.NEXT_PUBLIC_SUPABASE_URL,key=process.env.SUPABASE_SERVICE_ROLE_KEY
if(!url||!key)throw new Error('Supabase service-role credentials are required.')
const admin=createClient(url,key,{auth:{persistSession:false,autoRefreshToken:false}})
const{data,error}=await admin.rpc('run_stage5_reconciliation_v1',{run_mode:'automated'})
if(error)throw error
const{data:run,error:readError}=await admin.from('reconciliation_runs').select('id,status,summary,started_at,completed_at').eq('id',data).single()
if(readError)throw readError
console.log(JSON.stringify(run,null,2));if(run.status==='differences')process.exitCode=1
