import authStyles from "@/components/auth.module.css"
import { scopedClasses } from "@/components/scoped-classes"
export async function AuthMessage({ searchParams }) {
  const params = await searchParams
  const error = params?.error
  const success = params?.success
  if (!error && !success) return null
  return <p className={scopedClasses(authStyles, `auth-message ${error ? 'is-error' : 'is-success'}`)}>{error || success}</p>
}
