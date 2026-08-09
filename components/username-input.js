"use client"

import { useEffect, useState } from 'react'
import { sanitizeUsername } from '@/lib/app/input-validation'

export function UsernameInput({ defaultValue = '', error = '', id = 'username' }) {
  const [value, setValue] = useState(() => sanitizeUsername(defaultValue))
  const [editedAfterError, setEditedAfterError] = useState(false)
  const visibleError = editedAfterError ? '' : error

  useEffect(() => {
    setEditedAfterError(false)
  }, [error])

  return <>
    <input
      id={id}
      name="username"
      value={value}
      onChange={(event) => {
        setValue(sanitizeUsername(event.target.value))
        setEditedAfterError(true)
      }}
      required
      minLength={3}
      maxLength={24}
      pattern="[a-z0-9_]{3,24}"
      autoComplete="username"
      aria-invalid={Boolean(visibleError)}
      aria-describedby={`${id}-hint ${id}-error`}
      placeholder="your_username"
    />
    <small className="field-hint" id={`${id}-hint`}>3–24 lowercase letters, numbers, or underscores. Capitals are converted automatically.</small>
    <small className="field-error" id={`${id}-error`} aria-live="polite">{visibleError}</small>
  </>
}
