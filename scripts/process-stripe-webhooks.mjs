import { createClient } from '@supabase/supabase-js'
import { processPendingStripeWebhooks } from '../lib/stripe/webhooks.js'
const url=process.env.NEXT_PUBLIC_SUPABASE_URL,key=process.env.SUPABASE_SERVICE_ROLE_KEY
if(!url||!key)throw new Error('Supabase service-role credentials are required.')
const admin=createClient(url,key,{auth:{persistSession:false,autoRefreshToken:false}})
const results=await processPendingStripeWebhooks(admin,Number(process.env.STRIPE_WEBHOOK_BATCH_SIZE||50))
console.log(JSON.stringify({processed:results.length,failed:results.filter(item=>!item.ok).length},null,2))
if(results.some(item=>!item.ok))process.exitCode=1
