"use client"

import { useEffect, useState } from 'react'
import { createClient } from '@/lib/supabase/client'

export function MfaEnrollment() {
  const [factor, setFactor] = useState(null)
  const [existing, setExisting] = useState(null)
  const [code, setCode] = useState('')
  const [message, setMessage] = useState('Checking authenticator status…')
  const supabase = createClient()
  useEffect(()=>{supabase.auth.mfa.listFactors().then(({data,error})=>{if(error)return setMessage(error.message);const current=data?.totp?.find((item)=>item.status==='verified')||null;setExisting(current);setMessage(current?'Enter a code from your authenticator app.':'Set up an authenticator app to continue.')})},[])
  async function enroll() {
    if(existing)return setMessage('Use the authenticator already connected to this account.')
    setMessage('Creating authenticator setup…')
    const { data, error } = await supabase.auth.mfa.enroll({ factorType: 'totp', friendlyName: 'Puddle privileged access' })
    if (error) return setMessage(error.message)
    setFactor(data)
    setMessage('Scan the QR code, then enter the six-digit code.')
  }
  async function verify() {
    const factorId=existing?.id||factor?.id
    if (!factorId || !/^\d{6}$/.test(code)) return setMessage('Enter the six-digit authenticator code.')
    const challenge = await supabase.auth.mfa.challenge({ factorId })
    if (challenge.error) return setMessage(challenge.error.message)
    const verified = await supabase.auth.mfa.verify({ factorId, challengeId: challenge.data.id, code })
    if (verified.error) return setMessage(verified.error.message)
    window.location.href = '/admin'
  }
  return <section className="admin-card"><h2>Authenticator app</h2>{factor?.totp?.qr_code ? <img className="mfa-qr" src={factor.totp.qr_code} alt="Authenticator enrollment QR code"/> : null}{factor?.totp?.secret ? <details><summary>Manual setup key</summary><code>{factor.totp.secret}</code></details> : null}{existing||factor ? <div className="admin-inline"><input inputMode="numeric" autoComplete="one-time-code" maxLength={6} value={code} onChange={(event)=>setCode(event.target.value.replace(/\D/g,''))} placeholder="123456"/><button onClick={verify} type="button">Verify MFA</button></div> : <button onClick={enroll} type="button">Set up MFA</button>}<p>{message}</p></section>
}
