'use server'

// Test-only actions: exercise form recovery without any account or data writes.
export async function createPuddlePost() { return { error: 'We could not publish that puddle. Please try again.' } }
export async function submitContentReport() { return { error: 'We could not submit this report. Please try again.' } }
