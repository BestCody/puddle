import { createHmac } from 'node:crypto'
import { retrieveAccount, stripeMode, stripeRequest, verifyStripeWebhook } from '../lib/stripe/client.js'
if(stripeMode()!=='test')throw new Error('STRIPE_SECRET_KEY must be an sk_test_ key for this integration test.')
const balance=await stripeRequest('GET','/balance')
if(!Array.isArray(balance.available)||!Array.isArray(balance.pending))throw new Error('Stripe test balance response is invalid.')
let connected=null
if(process.env.STRIPE_TEST_CONNECTED_ACCOUNT_ID)connected=await retrieveAccount(process.env.STRIPE_TEST_CONNECTED_ACCOUNT_ID)
if(process.env.STRIPE_WEBHOOK_SECRET){const body=JSON.stringify({id:'evt_stage5_fixture',type:'checkout.session.completed',livemode:false,data:{object:{id:'cs_test_fixture'}}}),timestamp=Math.floor(Date.now()/1000),signature=createHmac('sha256',process.env.STRIPE_WEBHOOK_SECRET).update(`${timestamp}.${body}`).digest('hex');verifyStripeWebhook(body,`t=${timestamp},v1=${signature}`)}
console.log(JSON.stringify({mode:'test',balanceCurrencies:[...new Set([...balance.available,...balance.pending].map(item=>item.currency))],connectedAccount:connected?{id:connected.id,charges_enabled:connected.charges_enabled,payouts_enabled:connected.payouts_enabled}:null},null,2))
