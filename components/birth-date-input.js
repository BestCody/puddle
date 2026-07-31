"use client"

import { useState } from 'react'

function formatBirthDate(value) {
  const digits = String(value || '').replace(/\D/g, '').slice(0, 8)
  if (digits.length <= 4) return digits
  if (digits.length <= 6) return `${digits.slice(0, 4)}-${digits.slice(4)}`
  return `${digits.slice(0, 4)}-${digits.slice(4, 6)}-${digits.slice(6)}`
}

export function BirthDateInput({ defaultValue = '' }) {
  const [value, setValue] = useState(formatBirthDate(defaultValue))

  return (
    <>
      <input
        name="birth_date"
        type="text"
        inputMode="numeric"
        autoComplete="bday"
        placeholder="YYYY-MM-DD"
        pattern="[0-9]{4}-[0-9]{2}-[0-9]{2}"
        maxLength={10}
        value={value}
        onChange={(event) => setValue(formatBirthDate(event.target.value))}
        aria-describedby="birth-date-hint"
        required
      />
      <small className="field-hint" id="birth-date-hint">Use a four-digit year, then month and day.</small>
    </>
  )
}
