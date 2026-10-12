'use client'

import { useEffect, useState } from 'react'
import { localDateTimeValue, localDateTimeToISO } from '@/lib/app/visit-time'

export function VisitDateTime({ initialValue = '', name = 'planned_for', ...props }) {
  const [value, setValue] = useState('')
  useEffect(() => { setValue(localDateTimeValue(initialValue)) }, [initialValue])
  return <><input {...props} type="datetime-local" value={value} onChange={event => setValue(event.target.value)} /><input type="hidden" name={name} value={localDateTimeToISO(value)} /></>
}

export function VisitTimeLabel({ value, ...props }) {
  const [label, setLabel] = useState('')
  useEffect(() => { setLabel(new Date(value).toLocaleString(undefined, { month: 'short', day: 'numeric', hour: 'numeric', minute: '2-digit' })) }, [value])
  return <time {...props} dateTime={value}>{label}</time>
}
