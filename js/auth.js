function authChoice(mode) {
  const isSignIn = mode === 'signin'
  return `<div class="auth-page"><div class="auth-page__top">${logo(true)}<a href="/">Home</a></div><main class="auth-choice"><p class="eyebrow">Welcome to Valantir</p><h1>${isSignIn ? 'Sign in' : 'Sign up'}</h1><p>${isSignIn ? 'Select your account type' : 'Choose your account type to get started'}</p><div class="role-grid">
    <a class="role-card role-card--student" href="/${mode}/student"><span class="role-card__icon" aria-hidden="true">✦</span><div><span class="role-card__label">For students</span><h2>Student</h2><p>${isSignIn ? 'Access your volunteer dashboard' : 'Find volunteer opportunities and build your experience'}</p></div><span class="role-card__arrow">${arrow}</span></a>
    <a class="role-card role-card--business" href="/${mode}/business"><span class="role-card__icon" aria-hidden="true">⌂</span><div><span class="role-card__label">For organizations</span><h2>Organization</h2><p>${isSignIn ? 'Manage your volunteer opportunities' : 'Post opportunities and connect with student volunteers'}</p></div><span class="role-card__arrow">${arrow}</span></a>
  </div><p class="auth-switch">${isSignIn ? "Don't have an account?" : 'Already have an account?'} <a href="/${isSignIn ? 'signup' : 'signin'}">${isSignIn ? 'Sign up' : 'Sign in'}</a></p></main></div>`
}

function field(label, name, placeholder, type = 'text') {
  return `<label class="field"><span>${label}</span><input name="${name}" type="${type}" placeholder="${placeholder}" required></label>`
}

function authForm(mode, role) {
  const isSignIn = mode === 'signin'
  const isBusiness = role === 'business'
  return `<div class="auth-page auth-page--form"><div class="auth-page__top">${logo(true)}<a href="/${mode}">← Change account type</a></div><main class="form-shell"><div class="form-shell__intro"><p class="eyebrow">${isBusiness ? 'Organization account' : 'Student account'}</p><h1>${isSignIn ? 'Welcome back.' : isBusiness ? 'Start finding volunteers.' : 'Start making your hours count.'}</h1><p>${isSignIn ? 'Enter your details to continue to Valantir.' : isBusiness ? 'Tell us a little about your organization. Every organization is reviewed before it can post.' : 'Create your profile and start exploring opportunities near you.'}</p><a class="text-button" href="/${mode}">Use a different account type</a></div><form class="account-form">
    ${!isSignIn && isBusiness ? field('Organization name', 'organization', 'Oakville Community Centre') : ''}
    ${!isSignIn && !isBusiness ? field('Full name', 'name', 'Alex Morgan') : ''}
    ${field('Email', 'email', 'you@example.com', 'email')}
    ${!isSignIn && isBusiness ? field('Phone number', 'phone', '(905) 555-0123', 'tel') : ''}
    ${field('Password', 'password', 'At least 8 characters', 'password')}
    ${!isSignIn ? `<label class="checkbox"><input type="checkbox" required><span>I agree to Valantir's <a href="/terms">terms</a> and <a href="/privacy">privacy policy</a>.</span></label>` : ''}
    <button class="button button--dark button--wide" type="submit">${isSignIn ? 'Sign in' : 'Create account'} ${arrow}</button><button class="google-button" type="button"><span>G</span> Continue with Google</button><p class="demo-message" hidden role="status">This recreation includes the complete public interface. Connect your authentication backend here to enable live accounts.</p><p class="auth-switch">${isSignIn ? "Don't have an account?" : 'Already have an account?'} <a href="/${isSignIn ? 'signup' : 'signin'}">${isSignIn ? 'Sign up' : 'Sign in'}</a></p>
  </form></main></div>`
}

