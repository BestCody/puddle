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
      summary="These Terms govern your use of Puddle’s location discovery, planning, memberships, opt-in global connections, contribution, and related services."
      updated="August 3, 2026"
      companionHref="/privacy"
      companionLabel="Read the Privacy Policy"
    >
      <LegalSection id="agreement" title="1. Agreement to these Terms">
        <p>These Terms of Service (“Terms”) are a binding agreement between you and Puddle (“Puddle,” “we,” “us,” or “our”) governing your access to and use of Puddle websites, applications, location-discovery tools, DateMatch rooms, paid memberships, global connection and messaging features, contribution and moderation tools, and related services (collectively, the “Service”).</p>
        <p>By creating an account, accepting these Terms, starting a paid subscription, submitting content, messaging another user, or otherwise using the Service, you agree to these Terms and the Privacy Policy. If you do not agree, do not use the Service.</p>
      </LegalSection>

      <LegalSection id="service" title="2. What Puddle provides">
        <p>Puddle helps users discover places for dates and hangouts, review location cards, Pass, Save, or mark a Perfect Pick, create shortlists, keep saved and planned places, coordinate a place and time in a private DateMatch room, and provide feedback that may improve later recommendations.</p>
        <p>The Service may also let eligible users contribute or correct place information, upload place media, submit ownership or management claims, report problems, use recommendation controls, purchase a Puddle membership, and use opt-in same-place connection features.</p>
        <p>Puddle is a discovery, planning, and communication service. Unless a feature expressly states otherwise under separate transaction terms, Puddle does not sell venue tickets, make venue reservations, take payment for a venue, operate listed places, provide transportation, or guarantee that a venue will admit or serve you.</p>
      </LegalSection>

      <LegalSection id="eligibility" title="3. Eligibility and age requirements">
        <p>You must be at least 13 to create a Puddle account. You must also be legally capable of agreeing to these Terms, and a parent or legal guardian must authorize your use where local law requires it. A higher minimum age applies where required by the law where you live.</p>
        <p>Tinder tier global discovery, message requests, and conversations are available only to users who are at least 18. You must provide an accurate birth date and may not misrepresent your age or help another person bypass an age or safety restriction. Puddle may limit features or request proportionate age or identity information when reasonably necessary for safety, legal compliance, payment integrity, or account security.</p>
      </LegalSection>

      <LegalSection id="accounts" title="4. Accounts and account security">
        <p>You must provide accurate account and profile information, keep it reasonably current, protect your login credentials and email account, and promptly notify Puddle of suspected unauthorized access. You are responsible for activity through your account unless it results from Puddle’s failure to use reasonable safeguards.</p>
        <p>You may not sell, rent, transfer, or share an account in a way that defeats identity, age, billing, security, moderation, or contribution controls. Usernames may be reclaimed or changed when reasonably necessary to address impersonation, infringement, inactivity, or abuse.</p>
      </LegalSection>

      <LegalSection id="recommendations" title="5. Recommendations and place information">
        <p>Puddle recommendations may consider catalogue quality, distance, place confidence, your selected interests, prior actions, plans, and feedback. A recommendation or ranking is an estimate intended to help you explore options; it is not an endorsement, professional assessment, or guarantee that a place is suitable for you.</p>
        <p>Place names, categories, addresses, coordinates, travel distances, hours, prices, ratings, accessibility details, amenities, photos, availability, and other facts may come from public datasets, licensed providers, venue representatives, or users. This information can be incomplete, delayed, inaccurate, or changed without notice. Confirm important details directly with the venue before relying on them.</p>
        <p>You are responsible for considering your own budget, dietary needs, accessibility needs, transportation, local conditions, legal requirements, and personal safety when choosing or visiting a place.</p>
      </LegalSection>

      <LegalSection id="datematch" title="6. DateMatch and shared planning">
        <p>DateMatch lets invited participants compare place selections and coordinate a place and time. Information you submit in a room, including availability, mutual picks, planning choices, and feedback, may be visible to the other participant as indicated by the feature.</p>
        <p>Invite only people you intend to plan with. Do not add, impersonate, pressure, harass, or expose another person, and do not share private room information outside the purpose for which it was provided.</p>
      </LegalSection>

      <LegalSection id="global-connections" title="7. Tinder tier and global connections">
        <p>Tinder tier may let eligible paid users discover other opt-in paid adults who independently selected the same place. Global visibility is off by default. You must deliberately enable it before you can appear in or view same-place results.</p>
        <p>A shared place selection does not mean that another person likes you, knows you, is nearby, is currently available, or has agreed to meet. You may send one message request for a shared person-and-place combination. Ordinary conversation begins only after the recipient accepts the request.</p>
        <p>You must respect another person’s stated intent, boundaries, decline, block, and decision not to respond. Do not use the feature for unsolicited sexual content, repeated contact, harassment, stalking, coercion, fraud, commercial solicitation, or attempts to move a person into an unsafe interaction.</p>
        <p className="legal-note">Puddle does not choose, screen, verify, supervise, or guarantee another user or any in-person interaction. Puddle is not an emergency, transportation, medical, security, background-check, identity-verification, or personal-safety service.</p>
      </LegalSection>

      <LegalSection id="subscriptions" title="8. Paid subscriptions and billing">
        <p>Puddle currently offers a Free tier and a paid Tinder tier. The price, currency, billing interval, taxes, renewal terms, and included features shown at checkout form part of your purchase. Do not subscribe unless you have reviewed and accepted those terms.</p>
        <p>Paid subscriptions renew automatically until canceled. You can manage or cancel through the billing controls made available by Puddle. Unless checkout states otherwise or applicable law requires a different result, cancellation takes effect at the end of the current paid period and does not create a partial-period refund.</p>
        <p>Payments and billing-account tools may be provided by Stripe or another disclosed payment provider. Puddle does not need to receive or store your complete payment-card number. The payment provider’s terms and privacy practices apply separately.</p>
        <p>Puddle may change prices or paid features prospectively. We will provide notice and obtain consent where required before a material change applies to a renewal. If a paid feature becomes unavailable for a material period, remedies are limited to those stated at purchase and rights that cannot be excluded by law.</p>
      </LegalSection>

      <LegalSection id="conduct" title="9. Acceptable use">
        <p>You agree not to:</p>
        <ul>
          <li>Harass, threaten, exploit, stalk, impersonate, discriminate against, deceive, pressure, or endanger another person.</li>
          <li>Share another person’s personal information, private plans, messages, account data, or location without authorization.</li>
          <li>Evade a block, decline, message-request limit, age gate, subscription entitlement, account restriction, or moderation action.</li>
          <li>Use the Service for sexual exploitation, trafficking, fraud, illegal sales, violence, or other unlawful conduct.</li>
          <li>Create false venue records, ownership claims, reviews, reports, source attributions, photos, identities, subscriptions, or recommendation activity.</li>
          <li>Upload malware or unlawful content, scrape the Service without permission, reverse engineer protected portions, or interfere with systems or other users.</li>
          <li>Use bots or automated means to create accounts, manipulate rankings, generate artificial engagement, send bulk messages, or overload the Service without written permission.</li>
          <li>Infringe intellectual-property, privacy, publicity, contractual, database, or other rights.</li>
        </ul>
      </LegalSection>

      <LegalSection id="content" title="10. Your content and communications">
        <p>You retain ownership of content you submit, such as profile information, place edits, photos, notes, feedback, message requests, conversations, reports, and supporting materials (“User Content”). You grant Puddle a worldwide, non-exclusive, royalty-free, sublicensable licence to host, store, reproduce, adapt, format, display, distribute, moderate, and otherwise use User Content as reasonably necessary to operate, secure, improve, and promote the Service and to make the content available according to your settings and actions.</p>
        <p>For factual place contributions intended for the shared catalogue, the licence includes the right to combine, normalize, verify, correct, and redistribute those facts with source and attribution information. This licence continues for public catalogue facts, moderation records, and shared records where removal would impair provenance, safety, legal rights, or another person’s legitimate use.</p>
        <p>You represent that you have the rights and permissions needed to submit User Content, that required attribution is accurate, and that the content does not violate law, source terms, or another person’s rights. Do not upload a photo merely because it appears elsewhere online.</p>
      </LegalSection>

      <LegalSection id="claims" title="11. Claims, reports, and moderation">
        <p>A claim to own, manage, or represent a place must be truthful and supported when Puddle requests verification. A verified claim does not transfer ownership of third-party data or guarantee exclusive control over a listing.</p>
        <p>Puddle may review, reject, edit, merge, attribute, limit, or remove contributions, photos, claims, profiles, message requests, conversations, or other content when reasonably necessary for accuracy, safety, source compliance, legal obligations, or enforcement of these Terms.</p>
        <p>Puddle may investigate reports using automated tools and human review, including relevant conversation context. We may preserve evidence, restrict messaging, block access, suspend accounts, or refer matters to appropriate parties or authorities. Moderation involves judgment and does not create a duty to monitor every place, contribution, account, message, or interaction.</p>
      </LegalSection>

      <LegalSection id="third-party" title="12. Venues, data sources, and third-party services">
        <p>Places displayed by Puddle are generally owned and operated by independent third parties. Your visit, purchase, reservation, or other interaction with a venue is between you and that venue or its provider. Their rules, prices, cancellation terms, accessibility, safety practices, and privacy policies may apply separately.</p>
        <p>The Service may rely on or link to authentication, hosting, payments, maps, geocoding, place details, open-data catalogues, photos, email, security, and other third-party services. Their licences, terms, and privacy practices may apply. Puddle is not responsible for third-party products, content, availability, or conduct that it does not control, subject to rights that cannot legally be excluded.</p>
      </LegalSection>

      <LegalSection id="ip" title="13. Puddle and licensed intellectual property">
        <p>The Service, excluding User Content and third-party materials, is owned by Puddle or its licensors and is protected by intellectual-property laws. These Terms give you a limited, personal, revocable, non-exclusive, non-transferable licence to use the Service as intended.</p>
        <p>Place data, photos, maps, and attribution may be provided under separate open or commercial licences. You must preserve attribution and licence notices presented by the Service and may not extract or reuse protected datasets, images, branding, or software except as permitted by the applicable licence or by law.</p>
      </LegalSection>

      <LegalSection id="privacy" title="14. Privacy">
        <p>The Privacy Policy explains how Puddle collects, uses, shares, and protects personal information, including billing records, global visibility, same-place results, messages, blocks, and reports. Feature-specific notices may provide additional information at the point of collection or sharing.</p>
      </LegalSection>

      <LegalSection id="changes-service" title="15. Service availability and changes">
        <p>Puddle may add, remove, test, suspend, or modify features, data sources, coverage areas, ranking methods, limits, and interfaces. Location coverage and media availability vary by region and depend partly on third-party data and operational imports.</p>
        <p>We do not guarantee that the Service, a particular place, a catalogue release, a paid feature, or any communication will always be available, error-free, current, delivered, or supported on every device. Puddle may perform maintenance or restrict access to protect users, systems, data sources, or legal rights.</p>
      </LegalSection>

      <LegalSection id="termination" title="16. Suspension, termination, and account closure">
        <p>You may stop using the Service, cancel a subscription, and request account deletion. Deleting an account does not automatically reverse completed charges, and you remain responsible for amounts properly incurred before cancellation or deletion.</p>
        <p>Puddle may suspend or terminate access for a material or repeated violation, fraud, chargeback abuse, security or safety risk, legal requirement, prolonged inactivity, misuse of third-party data, or discontinuation of the Service.</p>
        <p>Where appropriate, Puddle may provide notice or an appeal path, subject to safety, legal, source-licence, and investigative limits. Provisions that by their nature should survive termination will survive, including ownership, payment obligations, licences needed for lawful shared or public records, disclaimers, liability limits, dispute terms, and enforcement rights.</p>
      </LegalSection>

      <LegalSection id="disclaimers" title="17. Disclaimers">
        <p>To the maximum extent permitted by law, the Service is provided “as is” and “as available.” Puddle does not guarantee that any place, venue, listing, photo, rating, recommendation, route, hour, price, amenity, accessibility statement, plan, user, message, connection, payment service, or third-party service will be accurate, safe, lawful, available, suitable, delivered, or uninterrupted.</p>
        <p>Nothing in these Terms excludes warranties, remedies, or consumer rights that cannot be waived under applicable law.</p>
      </LegalSection>

      <LegalSection id="liability" title="18. Limitation of liability">
        <p>To the maximum extent permitted by law, Puddle and its directors, officers, employees, contractors, and affiliates will not be liable for indirect, incidental, special, consequential, exemplary, or punitive damages, or for lost profits, data, goodwill, opportunities, or business interruption arising from the Service.</p>
        <p>To the maximum extent permitted by law, Puddle’s aggregate liability arising from the Service will not exceed the greater of the amount you paid directly to Puddle during the 12 months before the event giving rise to the claim or CAD $100. This limitation does not apply where prohibited by law, including liability that cannot be limited for fraud, wilful misconduct, gross negligence, personal injury, or mandatory consumer rights.</p>
      </LegalSection>

      <LegalSection id="indemnity" title="19. Indemnity">
        <p>To the extent permitted by law, you will indemnify Puddle from third-party claims, losses, liabilities, and reasonable costs arising from your User Content, messages, contributions, place claims, misuse of the Service, violation of these Terms, or infringement of another person’s rights. This obligation does not apply to the extent a claim results from Puddle’s own unlawful conduct.</p>
      </LegalSection>

      <LegalSection id="law" title="20. Governing law and disputes">
        <p>These Terms are governed by the laws of Ontario and the federal laws of Canada applicable there, without regard to conflict-of-law rules. Courts located in Toronto, Ontario will have jurisdiction, unless applicable consumer law gives you the right to bring a claim elsewhere.</p>
        <p>Before filing a formal claim, you and Puddle agree to try in good faith to resolve the issue by written notice, unless urgent relief or a limitation period makes that impractical.</p>
      </LegalSection>

      <LegalSection id="changes" title="21. Changes to these Terms">
        <p>Puddle may update these Terms to reflect changes to the Service, memberships, data sources, law, safety practices, or business operations. Material changes will be communicated through the Service, email, or another reasonable method. If a change requires your consent, Puddle will request it before the change applies to you.</p>
      </LegalSection>

      <LegalSection id="general" title="22. General terms">
        <p>If a provision is unenforceable, it will be limited or removed only to the minimum extent necessary, and the remaining provisions will continue. Puddle’s failure to enforce a provision is not a waiver. You may not assign these Terms without Puddle’s consent; Puddle may assign them as part of a reorganization, financing, merger, acquisition, or transfer of the Service.</p>
        <p>These Terms, the Privacy Policy, checkout terms, and any feature-specific terms presented to you form the entire agreement concerning the Service and replace prior discussions about the same subject.</p>
      </LegalSection>

      <LegalSection id="contact" title="23. Contact">
        <p>Questions about these Terms or billing can be sent to <a href="mailto:legal@puddle.you">legal@puddle.you</a>. Privacy requests can be sent to <a href="mailto:privacy@puddle.you">privacy@puddle.you</a>.</p>
      </LegalSection>
    </LegalPage>
  )
}
