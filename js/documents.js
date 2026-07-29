function documentLayout(title, intro, body, updated = '') {
  return `<div class="document-page"><header class="document-header"><a href="/">← Back to home</a>${logo(true)}</header><main class="document-shell"><div class="document-hero"><p class="eyebrow">Valantir resources</p><h1>${title}</h1><p>${intro}</p>${updated ? `<span class="updated">Last updated: ${updated}</span>` : ''}</div><article class="document-content">${body}</article></main>${footer()}</div>`
}

function docSection(title, content) { return `<section><h2>${title}</h2>${content}</section>` }

function helpPage() {
  return documentLayout('Help & Guide', 'A quick walkthrough of how Valantir works. It really is pretty straightforward.', [
    docSection('Getting started', `<ol><li>Sign up from the homepage. Pick <strong>Student</strong> if you're looking for volunteer hours, or <strong>Organization</strong> if you're posting opportunities.</li><li><strong>Verify your email:</strong> enter the six-digit code sent to your inbox.</li><li><strong>Finish onboarding:</strong> add your name, postal code, interests, and—for students—your availability.</li></ol>`),
    docSection('For students', `<ul><li><strong>Browse</strong> opportunities near you, sorted by distance and matched against your interests.</li><li><strong>Map</strong> shows the same opportunities geographically.</li><li><strong>Apply</strong> from any opportunity page and answer any extra questions.</li><li><strong>Messages</strong> supports text, images, PDFs, files, and voice notes.</li><li><strong>Hours</strong> is where you submit time for the organization to confirm.</li></ul>`),
    docSection('For organizations', `<ul><li>New organization accounts go through a quick manual review before activation.</li><li><strong>Post Opportunity</strong> includes title, description, category, address, availability, images, and optional application questions.</li><li><strong>Applications</strong> lets you accept or reject students.</li><li><strong>Hours</strong> lets you verify submitted volunteer time.</li><li><strong>Messages</strong> is your shared inbox for student conversations.</li></ul>`),
    docSection('Settings & account', `<p>Update your profile, postal code, interests, or availability from Settings. You can also reset your password or delete your account there.</p>`),
    docSection('Still stuck?', `<p>Email <a href="mailto:${supportEmail}">${supportEmail}</a> and we'll help you out.</p>`),
  ].join(''))
}

function termsPage() {
  return documentLayout('Terms & Privacy', 'An interim, plain-language agreement for using Valantir.', [
    docSection('A note up front', `<p>Valantir is a small project run by volunteers working toward registration as a Canadian nonprofit. We are not yet incorporated. These terms are an interim agreement between you and the people currently operating the platform. Once we incorporate, we will reissue updated terms and notify users by email.</p><p>This document is not legal advice. Questions can be sent to <a href="mailto:${supportEmail}">${supportEmail}</a>. These terms are governed by the laws of Ontario and the federal laws of Canada that apply there.</p>`),
    docSection('1. What Valantir is', `<p>Valantir is an introduction and matching service that helps high-school students find volunteer opportunities posted by community organizations and businesses. Students can apply, message, and log hours; organizations can post opportunities, review applicants, and sign off on hours.</p><p>Valantir is not a party to any volunteer arrangement and does not guarantee placements, hours, or recognition.</p>`),
    docSection('2. Eligibility', `<ul><li>Students should be of high-school age or have parent or guardian permission.</li><li>Organization account holders must have authority to represent that organization.</li><li>All users must provide accurate contact information.</li></ul>`),
    docSection("3. If you're a student", `<ul><li>Keep your profile accurate.</li><li>Show up to commitments or communicate when you cannot.</li><li>Only log hours you actually worked.</li><li>Treat other users with respect.</li></ul>`),
    docSection("4. If you're an organization", `<ul><li>Every organization is reviewed before it becomes active.</li><li>Post accurate descriptions and lawful, age-appropriate volunteer work.</li><li>Sign off on hours honestly.</li><li>Meet your own legal and safety obligations for volunteers.</li></ul>`),
    docSection('5. Hours sign-off', `<p>Hours are self-reported by students and confirmed by the posting organization. A confirmed status means only that the organization approved the entry. Schools and external programs decide independently whether to accept Valantir records.</p>`),
    docSection('6. Acceptable use', `<p>Do not harass users, post illegal or inappropriate content, attempt to break or overwhelm the platform, or use it to recruit for paid work or multi-level marketing. Accounts that violate these rules may be suspended or removed.</p>`),
    docSection('7. No warranty / limitation of liability', `<p>Valantir is provided as is. To the extent permitted by law, the operators are not liable for user conduct, listing accuracy, hour verification, lost data, or indirect damages arising from use of the platform.</p>`),
    docSection('8. Changes', `<p>These terms may change as Valantir evolves. Material changes will be communicated by email or in-app notice.</p>`),
    docSection('Privacy summary', `<p>Valantir collects account details, profile information, approximate location, content you create, and basic technical data to operate the service. Data is never sold and is not used for third-party ad tracking.</p>`),
    docSection('Contact', `<p>Questions, concerns, or takedown requests: <a href="mailto:${supportEmail}">${supportEmail}</a>.</p>`),
  ].join(''), 'July 18, 2026')
}

function privacyPage() {
  return documentLayout('Privacy Policy', 'What Valantir holds, why it is needed, and the choices available to you.', [
    docSection('The short version', `<p>Valantir helps high-school students find volunteering with local organizations. We collect only what is needed to make that work, do not sell personal information, and do not run ad tracking.</p>`),
    docSection('Who we are', `<p>Valantir is a small volunteer-run project working toward registration as a Canadian nonprofit. The people currently operating the platform are responsible for the data described here.</p>`),
    docSection('What we collect', `<ul><li>Account details, including name, email, password hash, or Google account identifier.</li><li>Student profile details such as age, grade, postal code, interests, and availability.</li><li>Organization profile details such as name, postal code, and contact phone number.</li><li>Approximate location derived from postal code and precise location only when explicitly shared.</li><li>Listings, applications, messages, hour logs, profile images, opportunity images, and message attachments.</li><li>Basic technical and security information such as IP address and sign-in times.</li></ul>`),
    docSection('How we use your information', `<ul><li>Match students with opportunities and support communication.</li><li>Secure accounts through sign-in, verification, and password resets.</li><li>Operate, debug, and improve the service.</li><li>Contact you about approvals and important account notices.</li></ul><p>Valantir does not use personal information for targeted advertising or behavioural profiling.</p>`),
    docSection('Organizations are reviewed before joining', `<p>Every organization account is checked and approved before activation. An unapproved account cannot post opportunities, message students, or access student information.</p>`),
    docSection('Who can see your information', `<p>Organizations see a student's details when that student applies. Conversation participants see messages and attachments shared with them. Service providers process limited data only to operate Valantir. Information may also be disclosed when legally required or necessary for safety.</p>`),
    docSection('Students and parental consent', `<p>Valantir is built mainly for high-school students. Users below the age of majority should have a parent or guardian's permission. Parents and guardians can request deletion of a child's account.</p>`),
    docSection('Retention and backups', `<p>Information is kept while an account is active. Deleting an account removes personal data, although anonymized totals, messages already delivered, and limited safety or legal records may remain. Encrypted backups rotate out after a limited retention period.</p>`),
    docSection('Security', `<p>Valantir uses encryption in transit, hashed passwords, one-time codes, and rate limiting. No online service can promise perfect security, so users should choose a strong, unique password.</p>`),
    docSection('Cookies and local storage', `<p>Only first-party cookies needed for sign-in, short-lived security checks, internal administration, and private previews are used. Local storage may remember display and map preferences. There are no advertising or cross-site tracking cookies.</p>`),
    docSection('Your choices', `<p>You can edit your profile, delete your account, or ask for a copy of your personal information. Contact <a href="mailto:${supportEmail}">${supportEmail}</a> for access requests or questions.</p>`),
  ].join(''), 'July 18, 2026')
}

function notFoundPage() {
  return `<div class="not-found">${logo()}<p class="eyebrow">404</p><h1>That page wandered off.</h1><a class="button button--dark" href="/">Back to Valantir ${arrow}</a></div>`
}

