"use client"

import { useFormStatus } from 'react-dom'

export function SubmitButton({ children, pendingText = 'Making a splash…', className = 'primary-button' }) {
  const { pending } = useFormStatus()
  return <button className={className} type="submit" disabled={pending}>{pending ? pendingText : children}</button>
}
