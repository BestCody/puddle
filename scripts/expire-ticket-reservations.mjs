import { createClient } from '@supabase/supabase-js'
const url=process.env.NEXT_PUBLIC_SUPABASE_URL,key=process.env.SUPABASE_SECRET_KEY
if(!url||!key)throw new Error('Supabase secret-key credentials are required.')
const admin=createClient(url,key,{auth:{persistSession:false,autoRefreshToken:false}})
const [reservations,transfers]=await Promise.all([admin.rpc('expire_ticket_reservations_v1',{batch_size:1000}),admin.rpc('expire_ticket_transfers_v1',{batch_size:1000})])
if(reservations.error)throw reservations.error;if(transfers.error)throw transfers.error
console.log(JSON.stringify({expiredReservations:reservations.data,expiredTransfers:transfers.data},null,2))
