import { LegalPage, LegalSection } from '../../components/legal-page'

export const dynamic = 'force-dynamic'
export const metadata = {
  title: 'Privacy Policy',
  description: 'How Puddle collects, uses, shares, and protects personal information.'
}

export default function PrivacyPage() {
  return (
    <LegalPage
      eyebrow="Privacy"
      title="Privacy Policy"
      summary="This policy explains what personal information Puddle handles, why we handle it, when it may be shared, and the choices available to you."
      updated="July 30, 2026"
      companionHref="/terms"
      companionLabel="Read the Terms of Service"
    >
      <LegalSection id="scope" title="1. Scope and accountability">
        <p>This Privacy Policy applies to Puddle websites, applications, event-discovery tools, social features, organizer tools, ticketing features, and related services (collectively, the “Service”). Puddle is responsible for personal information under its control and designates a Privacy Officer to oversee its privacy practices.</p>
        <p>By using the Service, you acknowledge the practices described here. Where consent is required, Puddle will request it in a form appropriate to the sensitivity of the information and the purpose for which it is used.</p>
      </LegalSection>

      <LegalSection id="collection" title="2. Information we collect">
        <h3>Information you provide</h3>
        <ul>
          <li>Account details such as your name, email address, authentication information, age or date-of-birth confirmation, and account preferences.</li>
          <li>Profile information such as a username, photo, biography, interests, accessibility preferences, and visibility settings.</li>
          <li>Event and plan activity, including saves, swipes, RSVPs, attendance status, shared plans, poll responses, check-ins, and ticket information.</li>
          <li>Social content such as messages, event-chat posts, reports, blocks, profile interactions, and content you upload.</li>
          <li>Organizer information such as organization details, event listings, venue information, attendee-management data, payout details, and verification materials.</li>
          <li>Support, feedback, survey, and waitlist information you choose to submit.</li>
        </ul>
        <h3>Information collected through use of the Service</h3>
        <ul>
          <li>Device and log information, including IP address, browser type, operating system, timestamps, referring pages, error logs, and security events.</li>
          <li>Usage information, including pages viewed, features used, search filters, recommendations shown, and actions taken on recommendations.</li>
          <li>Approximate location inferred from an IP address and, only with permission, device location used for nearby discovery.</li>
          <li>Precise live location only when an eligible user deliberately starts a time-limited sharing session.</li>
          <li>Transaction records from payment providers, such as purchase status, amount, currency, ticket identifier, and payment token. Puddle does not need to store complete payment-card numbers.</li>
        </ul>
      </LegalSection>

      <LegalSection id="use" title="3. How we use information">
        <p>Puddle uses personal information to:</p>
        <ul>
          <li>Create, authenticate, secure, and support accounts.</li>
          <li>Provide event discovery, recommendations, maps, plans, RSVPs, tickets, messaging, and organizer services.</li>
          <li>Personalize recommendations based on interests, location settings, saves, skips, and other activity.</li>
          <li>Show attendance, profile, and social information according to the visibility choices you make.</li>
          <li>Process purchases, transfers, refunds, payouts, and fraud checks.</li>
          <li>Respond to support requests and communicate service, safety, account, and transaction information.</li>
          <li>Detect abuse, enforce rules, investigate reports, protect users, and comply with legal obligations.</li>
          <li>Measure and improve performance, accessibility, reliability, and product design.</li>
        </ul>
        <p>Puddle will not use sensitive information for a materially different purpose without obtaining any additional consent required by law.</p>
      </LegalSection>

      <LegalSection id="location" title="4. Location and social privacy">
        <p>Nearby discovery may use approximate or device location when you permit it. You can deny or withdraw device-location permission through your device or browser settings, although location-based features may then be limited.</p>
        <p className="legal-note">Precise live location is opt-in, is shared only with the people you select, displays who can view it, and ends when you stop it or its timer expires. Puddle does not treat live location as an emergency or personal-safety service.</p>
        <p>Attendance and profile visibility are controlled by the settings offered for the relevant feature, such as hidden, friends-only, attendees-only, or public. Adult-oriented matching and live friend-location features are restricted to eligible users who are at least 18.</p>
      </LegalSection>

      <LegalSection id="sharing" title="5. When information is shared">
        <p>Puddle may share personal information in the following circumstances:</p>
        <ul>
          <li><strong>At your direction.</strong> With other users, plan members, attendees, friends, or organizers when you choose to post, join, RSVP, message, share location, or otherwise use a social feature.</li>
          <li><strong>With service providers.</strong> With vendors that provide hosting, databases, authentication, maps, email, analytics, moderation, media processing, customer support, payments, and security. They may use information only to provide contracted services to Puddle.</li>
          <li><strong>With organizers and venues.</strong> Information reasonably required to administer an event, ticket, refund, entry, safety matter, or attendee request.</li>
          <li><strong>For safety and legal reasons.</strong> When reasonably necessary to investigate abuse, protect rights or safety, comply with law or valid legal process, or enforce agreements.</li>
          <li><strong>Business changes.</strong> In connection with a proposed or completed financing, merger, acquisition, reorganization, or sale, subject to appropriate confidentiality and legal safeguards.</li>
        </ul>
        <p>Puddle does not sell personal information for money.</p>
      </LegalSection>

      <LegalSection id="retention" title="6. Retention">
        <p>Puddle retains personal information only as long as reasonably necessary for the purposes described in this policy, including providing the Service, maintaining transaction and safety records, resolving disputes, enforcing agreements, and meeting legal obligations. Retention periods vary by information type and context.</p>
        <p>When information is no longer required, Puddle will delete it, anonymize it, or securely isolate it until deletion is possible. Content shared with others may remain in their accounts or records where deletion would affect their legitimate use, legal rights, or safety records.</p>
      </LegalSection>

      <LegalSection id="security" title="7. Security">
        <p>Puddle uses administrative, technical, and physical safeguards designed for the sensitivity of the information, including access controls, encryption in transit, restricted service credentials, logging, secure media handling, and incident-response procedures. No online service can guarantee absolute security, so you should use a unique password and promptly report suspected account misuse.</p>
      </LegalSection>

      <LegalSection id="transfers" title="8. Service providers and international processing">
        <p>Puddle and its service providers may process information in Canada, the United States, or other countries. Information processed outside your province or country may be subject to the laws and lawful access rules of that jurisdiction. Puddle uses contractual and technical safeguards intended to protect information wherever it is processed.</p>
      </LegalSection>

      <LegalSection id="choices" title="9. Your choices and rights">
        <p>Depending on applicable law, you may request access to personal information Puddle holds about you, ask that inaccurate information be corrected, request deletion, withdraw consent, object to certain processing, or ask questions about Puddle’s practices.</p>
        <ul>
          <li>Update profile and visibility settings in the Service where available.</li>
          <li>Change device permissions for camera, notifications, and location at any time.</li>
          <li>Stop a live-location session immediately from the sharing controls.</li>
          <li>Unsubscribe from promotional email using the link in the message. Essential account, safety, and transaction messages may still be sent.</li>
          <li>Request account or data assistance by contacting the Privacy Officer.</li>
        </ul>
        <p>Puddle may need to verify your identity before completing a request. Legal exceptions may apply, and withdrawing consent may prevent Puddle from providing a feature that requires the information.</p>
      </LegalSection>

      <LegalSection id="children" title="10. Children and age-restricted features">
        <p>The Service is not directed to children under 13, and Puddle does not knowingly create accounts for children under 13. Where local law requires a higher minimum age or parental authorization, that requirement applies.</p>
        <p>Features involving adult-oriented matching or precise live friend location are restricted to users who are at least 18. Puddle may use proportionate age-assurance measures to apply these restrictions and protect younger users.</p>
      </LegalSection>

      <LegalSection id="cookies" title="11. Cookies and similar technology">
        <p>Puddle may use cookies, local storage, and similar technology to keep users signed in, preserve preferences, prevent fraud, understand performance, and remember consent choices. Browser controls can block or delete these technologies, but some Service features may stop working correctly.</p>
      </LegalSection>

      <LegalSection id="changes" title="12. Changes to this policy">
        <p>Puddle may update this policy as the Service, laws, or privacy practices change. Material changes will be brought to your attention through the Service, email, or another appropriate notice, and additional consent will be requested when required.</p>
      </LegalSection>

      <LegalSection id="contact" title="13. Contact the Privacy Officer">
        <p>Questions, privacy requests, or complaints can be sent to <a href="mailto:privacy@puddle.you">privacy@puddle.you</a>. Please include enough detail for Puddle to understand and respond to your request, but do not email passwords, full payment-card details, or unnecessary sensitive information.</p>
      </LegalSection>
    </LegalPage>
  )
}