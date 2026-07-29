import { createClient } from '@supabase/supabase-js'

const url=process.env.NEXT_PUBLIC_SUPABASE_URL
const key=process.env.SUPABASE_SERVICE_ROLE_KEY
if(!url||!key) throw new Error('Supabase service credentials are required')
const supabase=createClient(url,key,{auth:{persistSession:false,autoRefreshToken:false}})
const since=new Date(Date.now()-24*60*60*1000).toISOString()
const date=new Date().toISOString().slice(0,10)
const [{data:requests,error:requestError},{data:candidates,error:candidateError},{data:outcomes,error:outcomeError},{count:queued,error:queueError}]=await Promise.all([
  supabase.from('recommendation_requests').select('ranking_version,experiment_variant,fallback_reason,vector_enabled').gte('created_at',since),
  supabase.from('recommendation_candidates').select('request_id,vector_similarity,content_kind,final_score,distance_m,category').gte('created_at',since),
  supabase.from('recommendation_outcomes').select('outcome').gte('created_at',since),
  supabase.from('embedding_jobs').select('*',{count:'exact',head:true}).in('status',['queued','failed'])
])
if(requestError||candidateError||outcomeError||queueError) throw requestError||candidateError||outcomeError||queueError
const total=requests.length||0
const fallback=requests.filter((item)=>item.fallback_reason).length
const vectorCandidates=candidates.filter((item)=>Number.isFinite(Number(item.vector_similarity))).length
const scores=candidates.map((item)=>Number(item.final_score)).filter(Number.isFinite)
const distances=candidates.map((item)=>Number(item.distance_m)).filter(Number.isFinite)
const categoryCounts=candidates.reduce((map,item)=>{const key=item.category||'unknown';map[key]=(map[key]||0)+1;return map},{})
const metrics=[
  ['requests',total,total],
  ['fallback_rate',total?fallback/total:0,total],
  ['vector_candidate_coverage',candidates.length?vectorCandidates/candidates.length:0,candidates.length],
  ['average_candidates_per_request',total?candidates.length/total:0,total],
  ['average_final_score',scores.length?scores.reduce((a,b)=>a+b,0)/scores.length:0,scores.length],
  ['average_distance_m',distances.length?distances.reduce((a,b)=>a+b,0)/distances.length:0,distances.length],
  ['event_share',candidates.length?candidates.filter((item)=>item.content_kind==='event').length/candidates.length:0,candidates.length],
  ['category_coverage',Object.keys(categoryCounts).length,candidates.length],
  ['save_outcomes',outcomes.filter((item)=>item.outcome==='saved').length,outcomes.length],
  ['dismissal_outcomes',outcomes.filter((item)=>item.outcome==='dismissed').length,outcomes.length],
  ['embedding_backlog',queued||0,queued||0]
]
for(const [name,value,sample] of metrics){
  const result=await supabase.from('recommendation_metrics').upsert({metric_date:date,ranking_version:'hybrid-v1',experiment_variant:'all',metric_name:name,metric_value:Number(value),sample_size:Number(sample),details:{window_hours:24,...(name==='category_coverage'?{category_counts:categoryCounts}:{})}},{onConflict:'metric_date,ranking_version,experiment_variant,metric_name'})
  if(result.error) throw result.error
}
console.log(JSON.stringify({date,metrics:Object.fromEntries(metrics.map(([name,value])=>[name,value]))}))
