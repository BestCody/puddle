import { createClient } from '@supabase/supabase-js'

const DIMENSIONS = 768
const blockedHosts = new Set(['api.openai.com','api.anthropic.com','generativelanguage.googleapis.com','api.cohere.com','api.voyageai.com','ollama.com'])

function hash(value, seed = 2166136261) {
  let result = seed >>> 0
  for (const character of String(value || '')) { result ^= character.charCodeAt(0); result = Math.imul(result, 16777619) }
  return result >>> 0
}
function hashingEmbedding(value) {
  const normalized = String(value || '').toLowerCase().normalize('NFKD').replace(/[^a-z0-9\s_-]/g, ' ').replace(/\s+/g, ' ').trim()
  const words = normalized.split(' ').filter(Boolean).slice(0, 3000)
  const features = [...words]
  for (const word of words) { const padded=`^${word}$`; for(let i=0;i<=padded.length-3;i+=1) features.push(padded.slice(i,i+3)) }
  for(let i=0;i<words.length-1;i+=1) features.push(`${words[i]}_${words[i+1]}`)
  const vector=Array.from({length:DIMENSIONS},()=>0)
  for(const feature of features){const a=hash(feature),b=hash(feature,2246822519),index=a%DIMENSIONS;vector[index]+=((b&1)===0?1:-1)*(1+Math.min(3,feature.length/10))}
  const norm=Math.sqrt(vector.reduce((sum,item)=>sum+item*item,0))||1
  return vector.map((item)=>item/norm)
}
async function ollamaEmbedding(input) {
  const raw=String(process.env.LOCAL_AI_BASE_URL||'').trim()
  if(!raw) throw new Error('LOCAL_AI_BASE_URL is not configured')
  const base=new URL(raw)
  if(!['http:','https:'].includes(base.protocol)||blockedHosts.has(base.hostname.toLowerCase())) throw new Error('Only a self-hosted local model endpoint is allowed')
  const controller=new AbortController(),timer=setTimeout(()=>controller.abort(),120000)
  try {
    const response=await fetch(`${base.toString().replace(/\/$/,'')}/api/embed`,{method:'POST',headers:{'content-type':'application/json'},body:JSON.stringify({model:process.env.LOCAL_AI_EMBEDDING_MODEL||'embeddinggemma',input:[String(input||'').slice(0,12000)],truncate:true,dimensions:DIMENSIONS,keep_alive:'10m'}),signal:controller.signal})
    const data=await response.json().catch(()=>({}))
    if(!response.ok||!Array.isArray(data.embeddings?.[0])||data.embeddings[0].length!==DIMENSIONS) throw new Error(`Local embedding endpoint returned ${response.status}`)
    return {vector:data.embeddings[0].map(Number),model:process.env.LOCAL_AI_EMBEDDING_MODEL||'embeddinggemma',version:process.env.LOCAL_AI_EMBEDDING_MODEL_VERSION||process.env.LOCAL_AI_EMBEDDING_MODEL||'embeddinggemma'}
  } finally { clearTimeout(timer) }
}
async function embed(input) {
  if(String(process.env.LOCAL_AI_EMBEDDING_PROVIDER||'hashing').toLowerCase()==='ollama') return ollamaEmbedding(input)
  return {vector:hashingEmbedding(input),model:'puddle-feature-hashing',version:'puddle-feature-hashing-v1'}
}

const url=process.env.NEXT_PUBLIC_SUPABASE_URL
const key=process.env.SUPABASE_SECRET_KEY
if(!url||!key) throw new Error('Supabase secret-key credentials are required')
const supabase=createClient(url,key,{auth:{persistSession:false,autoRefreshToken:false}})
const maxBatches=Math.max(1,Math.min(100,Number(process.env.EMBEDDING_MAX_BATCHES||10)))
const batchSize=Math.max(1,Math.min(100,Number(process.env.EMBEDDING_BATCH_SIZE||25)))
let completed=0,failed=0
for(let batch=0;batch<maxBatches;batch+=1){
  const claimed=await supabase.rpc('claim_embedding_jobs_v1',{batch_size:batchSize})
  if(claimed.error) throw claimed.error
  if(!claimed.data?.length) break
  for(const job of claimed.data){
    try{
      if(!String(job.source_text||'').trim()) throw new Error('empty_source')
      const result=await embed(job.source_text)
      const stored=await supabase.rpc('store_embedding_job_v1',{target_job:job.job_id,embedding_text:JSON.stringify(result.vector),model_name:result.model,model_revision:result.version,embedding_dimensions:DIMENSIONS})
      if(stored.error) throw stored.error
      completed+=1
    }catch(error){
      failed+=1
      await supabase.rpc('fail_embedding_job_v1',{target_job:job.job_id,failure_category:String(error?.message||'embedding_failed').slice(0,150),retry_after_seconds:300})
    }
  }
}
console.log(JSON.stringify({completed,failed,provider:process.env.LOCAL_AI_EMBEDDING_PROVIDER||'hashing'}))
