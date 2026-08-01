"use client"

import { useRouter } from 'next/navigation'
import { useState } from 'react'

const moods = [
  { label: 'Coffee', icon: '☕', query: 'coffee', category: 'cafe' },
  { label: 'Dinner', icon: '◇', query: 'dinner', category: 'restaurant' },
  { label: 'Drinks', icon: '◒', query: 'cocktails', category: 'bar' },
  { label: 'Something active', icon: '↗', query: 'activity', category: 'activity_venue' },
  { label: 'Outdoors', icon: '✿', query: 'outdoors', category: 'park' },
  { label: 'Free or cheap', icon: '$', query: 'free cheap', price: '1' },
  { label: 'Surprise me', icon: '✦', query: 'surprise me' }
]

export function HomeMoodShortcuts() {
  const router = useRouter()
  const [selected, setSelected] = useState(null)

  function openMood(mood) {
    setSelected(mood.label)
    const params = new URLSearchParams()
    if (mood.query) params.set('q', mood.query)
    if (mood.category) params.set('category', mood.category)
    if (mood.price) params.set('price', mood.price)
    window.setTimeout(() => router.push(`/discover?${params.toString()}`), 140)
  }

  return (
    <div className="home-mood-grid" aria-label="Start a deck by mood">
      {moods.map((mood) => (
        <button className={selected === mood.label ? 'is-selected' : ''} type="button" onClick={() => openMood(mood)} key={mood.label}>
          <span aria-hidden="true">{mood.icon}</span>
          <strong>{mood.label}</strong>
          <small>Build a deck</small>
        </button>
      ))}
    </div>
  )
}
