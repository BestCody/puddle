"use client"

import { useFormStatus } from 'react-dom'

export function SubmitButton({ children, pendingText = 'Making a splash…', className = 'primary-button', disabled = false }) {
  const { pending } = useFormStatus()
  return <button className={className} type="submit" disabled={pending || disabled}>{pending ? pendingText : children}</button>
}
