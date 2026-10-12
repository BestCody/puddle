// Exercise the real signup action's error return without creating an account.
export async function registerAccount() {
  return { error: 'We could not create your account. Please try again.' }
}
