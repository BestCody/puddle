"use client"

import { useEffect, useRef, useState } from 'react'
import { birthDateError, formatBirthDateDigits } from '@/lib/app/input-validation'

export function BirthDateInput({ defaultValue = '', serverError = '' }) {
  const [value, setValue] = useState(formatBirthDateDigits(defaultValue))
  const [touched, setTouched] = useState(false)
  const [editedAfterServerError, setEditedAfterServerError] = useState(false)
  const inputRef = useRef(null)
  const localError = value.length === 10 ? birthDateError(value) : touched && value ? 'Enter all 8 birth-date numbers in YYYY-MM-DD format.' : ''
  const error = localError || (editedAfterServerError ? '' : serverError)

  useEffect(() => {
    setEditedAfterServerError(false)
  }, [serverError])

  useEffect(() => {
    inputRef.current?.setCustomValidity(error || '')
  }, [error])

  return (
    <>
      <input
        ref={inputRef}
        name="birth_date"
        type="text"
        inputMode="numeric"
        autoComplete="bday"
        placeholder="YYYY-MM-DD"
        pattern="[0-9]{4}-[0-9]{2}-[0-9]{2}"
        maxLength={10}
        value={value}
        onChange={(event) => {
          setValue(formatBirthDateDigits(event.target.value))
          setEditedAfterServerError(true)
        }}
        onBlur={() => setTouched(true)}
        aria-describedby="birth-date-hint birth-date-error"
        aria-invalid={Boolean(error)}
        required
      />
      <small className="field-hint" id="birth-date-hint">8 numbers only. Puddle accounts require users to be 13 or older.</small>
      <small className="field-error" id="birth-date-error" aria-live="polite">{error}</small>
    </>
  )
}
