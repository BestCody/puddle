import { LegalPage, LegalSection } from '../../components/legal-page'

export const dynamic = 'force-dynamic'
export const metadata = {
  title: 'Terms of Service',
  description: 'The terms that govern access to and use of Puddle.'
}

export default function TermsPage() {
  return (
    <LegalPage
      eyebrow="Legal"
      title="Terms of Service"
      summary="These Terms govern your access to and use of Puddle’s event-discovery, social, organizer, planning, and ticketing services."
      updated="July 30, 2026"
      companionHref="/privacy"
      companionLabel="Read the Privacy Policy"
    >
      <LegalSection id="agreement" title="1. Agreement to these Terms">
        <p>These Terms of Service (“Terms”) are a binding agreement between you and Puddle (“Puddle,” “we,” “us,” or “our”) governing your use of Puddle websites, applications, event-discovery tools, social features, organizer tools, ticketing features, and related services (collectively, the “Service”).</p>
        <p>By creating an account, clicking to accept these Terms, purchasing a ticket, publishing content, or otherwise using the Service, you agree to these Terms and the Privacy Policy. If you do not agree, do not use the Service.</p>
      </LegalSection>

      <LegalSection id="eligibility" title="2. Eligibility and age restrictions">
        <p>You must be legally capable of entering into this agreement and meet the minimum age required where you live. The Service is not intended for children under 13. A parent or legal guardian must authorize use where local law requires it.</p>
        <p>Adult-oriented matching and precise live friend-location features are available only to users who are at least 18. You may not misrepresent your age or help another person bypass age restrictions.</p>
      </LegalSection>

      <LegalSection id="accounts" title="3. Accounts and account security">
        <p>You must provide accurate information, keep it reasonably current, protect your login credentials, and promptly notify Puddle of suspected unauthorized access. You are responsible for activity through your account unless caused by Puddle’s failure to use reasonable security safeguards.</p>
        <p>You may not sell, transfer, rent, or share an account in a way that defeats identity, age, safety, payment, or organizer-verification controls.</p>
      </LegalSection>

      <LegalSection id="service" title="4. The Service and recommendations">
        <p>Puddle helps users discover events and places, save and share plans, communicate with other users, manage attendance, and access organizer and ticketing tools. Recommendations, rankings, distance estimates, availability, schedules, prices, and attendance information may change and are not guarantees.</p>
        <p>Puddle may add, remove, test, suspend, or modify features. We will provide notice when a change materially affects an ongoing paid service where required by law.</p>
      </LegalSection>

      <LegalSection id="conduct" title="5. Acceptable use">
        <p>You agree not to:</p>
        <ul>
          <li>Harass, threaten, exploit, stalk, impersonate, discriminate against, or endanger another person.</li>
          <li>Share another person’s private information or precise location without authorization.</li>
          <li>Use the Service for sexual exploitation, trafficking, illegal sales, violence, fraud, or other unlawful conduct.</li>
          <li>Evade blocks, reports, age gates, account restrictions, ticket controls, or moderation actions.</li>
          <li>Upload malware, scrape the Service without permission, overload systems, reverse engineer protected portions of the Service, or interfere with security controls.</li>
          <li>Publish false, misleading, infringing, deceptive, or unsafe event, venue, ticket, identity, or organizer information.</li>
          <li>Use automated means to create accounts, manipulate recommendations, reserve inventory unfairly, send spam, or purchase tickets contrary to posted limits.</li>
        </ul>
      </LegalSection>

      <LegalSection id="content" title="6. Your content">
        <p>You retain ownership of content you submit, including profile information, event listings, photos, messages, reviews, and other materials (“User Content”). You grant Puddle a worldwide, non-exclusive, royalty-free licence to host, store, reproduce, adapt, display, distribute, and otherwise use User Content only as reasonably necessary to operate, secure, promote, and improve the Service and to make the content available according to your settings and actions.</p>
        <p>You represent that you have the rights needed to submit User Content and that it does not violate law or another person’s rights. You may delete content where the Service provides controls, subject to legal, safety, backup, transaction, and shared-record retention requirements described in the Privacy Policy.</p>
      </LegalSection>

      <LegalSection id="organizers" title="7. Organizer responsibilities">
        <p>If you create or manage an event, place, or organizer profile, you are responsible for the accuracy, legality, accessibility, safety, capacity, licensing, pricing, refund terms, taxes, and delivery of what you publish or sell. You must honour valid tickets and consumer rights, communicate material changes promptly, and maintain any permits, insurance, permissions, and approvals required for the activity.</p>
        <p>Puddle may request identity, business, venue, banking, or event verification and may delay publication or payouts while reviewing safety, fraud, chargeback, or legal concerns.</p>
      </LegalSection>

      <LegalSection id="tickets" title="8. Tickets, payments, refunds, and payouts">
        <p>Event-specific price, fees, currency, refund rules, transfer rules, restrictions, and organizer identity should be displayed before purchase. You must review and expressly accept the transaction details before completing an order.</p>
        <p>Payment services may be provided by third-party processors. Puddle may act as a marketplace or limited payment agent for an organizer, but the organizer remains responsible for producing and operating the event unless the checkout page expressly states otherwise.</p>
        <p>Refunds, credits, event changes, and cancellations are governed by the terms shown at checkout, mandatory consumer-protection law, and any applicable organizer policy. Puddle may reverse transactions, withhold payouts, or cancel tickets reasonably believed to involve fraud, duplication, chargebacks, prohibited resale, or a material violation of these Terms.</p>
      </LegalSection>

      <LegalSection id="social-safety" title="9. Social features, meetups, and location sharing">
        <p>Interactions arranged through Puddle involve independent users and organizers. Use reasonable judgment, meet in appropriate places, tell someone you trust about your plans, and use block and report tools when needed.</p>
        <p className="legal-note">Puddle is not an emergency, transportation, medical, security, or personal-safety service. Location, attendance, identity, verification, and compatibility indicators can be delayed, inaccurate, incomplete, or changed by users.</p>
        <p>Precise live location must be deliberately enabled, is limited to eligible adult users, and should be shared only with trusted recipients. You must not record, redistribute, or use another person’s location outside the purpose for which they shared it.</p>
      </LegalSection>

      <LegalSection id="moderation" title="10. Moderation and enforcement">
        <p>Puddle may investigate reports and use automated and human review to detect fraud, abuse, unsafe content, or violations. We may remove content, limit visibility, cancel listings or tickets, restrict features, suspend accounts, preserve relevant records, or refer matters to appropriate authorities when reasonably necessary.</p>
        <p>Moderation decisions involve judgment and do not create a duty to monitor every user, event, message, or interaction. Where appropriate, Puddle may provide notice or an appeal path, subject to safety, legal, and investigative limits.</p>
      </LegalSection>

      <LegalSection id="ip" title="11. Puddle intellectual property">
        <p>The Service, excluding User Content, is owned by Puddle or its licensors and is protected by intellectual-property laws. These Terms give you a limited, personal, revocable, non-exclusive, non-transferable licence to use the Service as intended. No rights are granted to Puddle names, logos, designs, software, datasets, or other protected materials except as expressly stated.</p>
      </LegalSection>

      <LegalSection id="third-party" title="12. Third-party services and links">
        <p>The Service may rely on or link to maps, payments, authentication, hosting, communications, venues, organizers, and other third-party services. Their terms and privacy practices may apply separately. Puddle is not responsible for third-party products or conduct that it does not control, subject to rights that cannot legally be excluded.</p>
      </LegalSection>

      <LegalSection id="termination" title="13. Suspension, termination, and account closure">
        <p>You may stop using the Service and request account closure at any time. Puddle may suspend or terminate access for a material or repeated violation, fraud, safety risk, legal requirement, prolonged inactivity, or discontinuation of the Service.</p>
        <p>Provisions that by their nature should survive termination will survive, including ownership, payment obligations, transaction records, disclaimers, liability limits, dispute provisions, and licences needed to maintain lawful shared or safety records.</p>
      </LegalSection>

      <LegalSection id="disclaimers" title="14. Disclaimers">
        <p>To the maximum extent permitted by law, the Service is provided “as is” and “as available.” Puddle does not guarantee that every event, organizer, user, venue, listing, recommendation, ticket, message, map result, or social interaction will be accurate, safe, lawful, available, suitable, or uninterrupted.</p>
        <p>Nothing in these Terms excludes warranties, remedies, or consumer rights that cannot be waived under applicable law.</p>
      </LegalSection>

      <LegalSection id="liability" title="15. Limitation of liability">
        <p>To the maximum extent permitted by law, Puddle and its directors, officers, employees, contractors, and affiliates will not be liable for indirect, incidental, special, consequential, exemplary, or punitive damages, or for lost profits, data, goodwill, opportunities, or business interruption arising from the Service.</p>
        <p>To the maximum extent permitted by law, Puddle’s aggregate liability arising from the Service will not exceed the greater of the amount you paid to Puddle during the 12 months before the event giving rise to the claim or CAD $100. This limitation does not apply where prohibited by law, including liability that cannot be limited for fraud, wilful misconduct, gross negligence, personal injury, or mandatory consumer rights.</p>
      </LegalSection>

      <LegalSection id="indemnity" title="16. Indemnity">
        <p>To the extent permitted by law, you will indemnify Puddle from third-party claims, losses, and reasonable costs arising from your User Content, your event or organizer activity, your violation of these Terms, or your infringement of another person’s rights. This obligation does not apply to the extent a claim results from Puddle’s own unlawful conduct.</p>
      </LegalSection>

      <LegalSection id="law" title="17. Governing law and disputes">
        <p>These Terms are governed by the laws of Ontario and the federal laws of Canada applicable there, without regard to conflict-of-law rules. Courts located in Toronto, Ontario will have jurisdiction, unless applicable consumer law gives you the right to bring a claim elsewhere.</p>
        <p>Before filing a formal claim, you and Puddle agree to try in good faith to resolve the issue by written notice, unless urgent relief or a limitation period makes that impractical.</p>
      </LegalSection>

      <LegalSection id="changes" title="18. Changes to these Terms">
        <p>Puddle may update these Terms to reflect changes to the Service, law, safety practices, or business operations. Material changes will be communicated through the Service, email, or another reasonable method. If a change requires your consent, Puddle will request it before the change applies to you.</p>
      </LegalSection>

      <LegalSection id="general" title="19. General terms">
        <p>If a provision is unenforceable, it will be limited or removed only to the minimum extent necessary, and the remaining provisions will continue. Puddle’s failure to enforce a provision is not a waiver. You may not assign these Terms without Puddle’s consent; Puddle may assign them as part of a reorganization, financing, merger, acquisition, or transfer of the Service.</p>
        <p>These Terms, the Privacy Policy, and transaction- or feature-specific terms presented to you form the entire agreement concerning the Service and replace prior discussions about the same subject.</p>
      </LegalSection>

      <LegalSection id="contact" title="20. Contact">
        <p>Questions about these Terms can be sent to <a href="mailto:legal@puddle.you">legal@puddle.you</a>. Support and account questions may also be submitted through the support tools available in the Service.</p>
      </LegalSection>
    </LegalPage>
  )
}