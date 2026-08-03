import { createClient } from '@supabase/supabase-js'

const url = process.env.NEXT_PUBLIC_SUPABASE_URL || process.env.SUPABASE_URL
const serviceRoleKey = process.env.SUPABASE_SECRET_KEY || process.env.SUPABASE_SERVICE_ROLE_KEY
if (!url || !serviceRoleKey) throw new Error('Supabase URL and service-role key are required.')

const days = Math.max(1, Math.min(90, Math.trunc(Number(process.argv.find((value) => value.startsWith('--days='))?.split('=')[1]) || 7)))
const admin = createClient(url, serviceRoleKey, { auth: { persistSession: false, autoRefreshToken: false } })
const { data, error } = await admin.rpc('discovery_spatial_profile_v1', { sample_window: `${days} days` })
if (error) throw error
console.log(JSON.stringify(data, null, 2))
if (data?.recommendPostgis) console.log('Profiling thresholds are met. Plan a separate PostGIS geography/GiST migration and validate it with EXPLAIN (ANALYZE, BUFFERS).')
else console.log('PostGIS is not yet justified by the configured sample, latency, and catalogue-size thresholds.')
