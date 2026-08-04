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
      summary="This policy explains how Puddle handles personal information when you discover and plan places, use memberships or opt-in global connections, contribute information, or otherwise use the Service."
      updated="August 3, 2026"
      companionHref="/terms"
      companionLabel="Read the Terms of Service"
    >
      <LegalSection id="scope" title="1. Scope and accountability">
        <p>This Privacy Policy applies to Puddle websites, applications, location-discovery tools, DateMatch rooms, memberships, global connection and messaging features, saved and planned locations, contribution and moderation tools, and related services (collectively, the “Service”). It does not describe the independent practices of a venue, payment provider, map provider, authentication provider, or other third party operating under its own policy.</p>
        <p>Puddle is responsible for personal information under its control and designates a Privacy Officer to oversee its privacy practices. Where consent is required, Puddle seeks consent in a form appropriate to the sensitivity of the information and the purpose for which it will be used.</p>
      </LegalSection>

      <LegalSection id="collection" title="2. Information we collect">
        <h3>Account and profile information</h3>
        <ul>
          <li>Email address, authentication-provider identifiers, account status, and information needed to sign you in, secure the account, or recover access.</li>
          <li>Display name, username, birth date, biography, profile visibility, preferred location, search radius, and categories of places you select.</li>
          <li>Profile photos or other media you choose to upload.</li>
        </ul>

        <h3>Discovery, planning, and DateMatch activity</h3>
        <ul>
          <li>Location cards shown to you and actions such as Pass, Save, Perfect Pick, undo, notes, sharing, and opening place details.</li>
          <li>Saved, planned, and past places, selected dates or times, shortlist activity, and post-visit feedback.</li>
          <li>DateMatch invitations, room membership, availability, private selections, mutual matches, planning decisions, notes, and post-visit feedback submitted through the room.</li>
          <li>Recommendation settings and signals used to improve future decks, such as preferred categories, distance, prior actions, and feedback.</li>
        </ul>

        <h3>Membership and billing information</h3>
        <ul>
          <li>Your tier, subscription status, renewal or cancellation state, current paid period, payment-provider customer and subscription identifiers, and the price identifier used for your plan.</li>
          <li>Checkout, billing-portal, webhook, payment-success, failure, refund, dispute, and fraud-prevention records received from the payment provider.</li>
        </ul>
        <p className="legal-note">Puddle uses a payment provider such as Stripe for card processing. Puddle does not need to receive or store your complete payment-card number.</p>

        <h3>Global connection and messaging activity</h3>
        <ul>
          <li>Whether you opt into global visibility and whether your stated intent is a date, hangout, or either.</li>
          <li>Same-place results generated when eligible users independently make a positive selection for the same location.</li>
          <li>Message requests, accept or decline decisions, conversations, blocks, reports, and related place and account identifiers.</li>
          <li>Safety and moderation records associated with a request, conversation, report, or enforcement action.</li>
        </ul>

        <h3>Contributions, claims, and support information</h3>
        <ul>
          <li>Place submissions, edits, photos, source information, attribution, ownership or management claims, and supporting materials.</li>
          <li>Reports, appeals, moderation decisions, fraud signals, and communications relating to safety, integrity, or policy enforcement.</li>
          <li>Support requests, survey responses, feedback, and other information you choose to send to Puddle.</li>
        </ul>

        <h3>Location information</h3>
        <ul>
          <li>A city, address, map point, or coordinates you enter or select for discovery and account preferences.</li>
          <li>Device location when you deliberately grant browser or device permission to use it for nearby discovery.</li>
          <li>Approximate location inferred from an IP address for security, localization, and service operation.</li>
        </ul>
        <p className="legal-note">Puddle does not currently provide continuous or live friend-location sharing. Global connection results are based on a shared place selection, not your current or precise live location.</p>

        <h3>Technical and security information</h3>
        <ul>
          <li>IP address, browser and device type, operating system, language, referring page, timestamps, request identifiers, and diagnostic or error information.</li>
          <li>Session cookies, security events, rate-limit information, bot-detection results, webhook identifiers, and records used to prevent abuse or unauthorized access.</li>
          <li>Usage and performance measurements, including sampled discovery actions and aggregated product statistics.</li>
        </ul>
      </LegalSection>

      <LegalSection id="sources" title="3. Where information comes from">
        <p>Puddle receives information directly from you, automatically from your browser or device, from another person who invites or messages you or reports content, and from service providers supporting authentication, payments, hosting, maps, geocoding, security, communications, or monitoring.</p>
        <p>Place listings, geographic information, and photos may also come from public or licensed datasets and media sources. Those records can include place names, addresses, coordinates, categories, hours, amenities, website links, photos, creator names, source links, and licence or attribution information.</p>
      </LegalSection>

      <LegalSection id="use" title="4. How we use information">
        <p>Puddle uses personal information to:</p>
        <ul>
          <li>Create, authenticate, maintain, recover, and secure accounts.</li>
          <li>Build nearby location decks and personalize ranking based on location settings, interests, saves, passes, picks, plans, and feedback.</li>
          <li>Provide saved, planned, past, shortlist, sharing, note, and DateMatch features.</li>
          <li>Create and administer Free and paid membership entitlements, checkout, renewals, cancellations, billing support, fraud checks, and financial records.</li>
          <li>Provide opt-in same-place results, message requests, accepted conversations, blocks, reports, and global connection controls.</li>
          <li>Display profile or contribution information according to the visibility and sharing choices available for the relevant feature.</li>
          <li>Review place contributions, ownership claims, reports, appeals, uploaded media, and relevant message context.</li>
          <li>Detect fraud, harassment, spam, automated misuse, security incidents, and violations of the Terms.</li>
          <li>Respond to support, privacy, billing, account, and legal requests.</li>
          <li>Send essential account, payment, security, and service communications and, with any consent required by law, optional product updates.</li>
          <li>Measure and improve relevance, accessibility, reliability, safety, security, and product design.</li>
          <li>Comply with legal obligations and protect the rights, safety, and integrity of users, Puddle, and others.</li>
        </ul>
      </LegalSection>

      <LegalSection id="location" title="5. Location and recommendation controls">
        <p>You can choose a city or map location manually, change your preferred location and search radius, or grant device-location permission for nearby discovery. Device location is not required to create an account or purchase a membership.</p>
        <p>Recommendations are generated using place quality, distance, catalogue confidence, your selected categories, and your activity. They are intended to help you explore options, not to make decisions that have legal or similarly significant effects.</p>
        <p>You can change preference information, clear or revise saved and planned items where controls are available, and withdraw browser or device location permission through your settings. Some nearby or personalized features may be less useful after those choices.</p>
      </LegalSection>

      <LegalSection id="global-privacy" title="6. Global connection privacy">
        <p>Global visibility is off by default and is limited to eligible paid users who are at least 18. When you turn it on, Puddle may show your display name, username, profile photo, biography, general profile city or country, stated intent, and a place that both you and another eligible user positively selected.</p>
        <p>Puddle does not show the other person whether your positive action was Save or Perfect Pick, your passes, your private recommendation history, your exact home address, or your current device location through this feature.</p>
        <p>Only the recipient of a message request receives its opening message. Additional messages are enabled after acceptance. You can turn visibility off, decline a request, block an account, or report a concern. Turning visibility off stops new discovery but does not automatically erase messages or safety records already shared or created.</p>
      </LegalSection>

      <LegalSection id="sharing" title="7. When information is shared">
        <p>Puddle may disclose personal information in the following circumstances:</p>
        <ul>
          <li><strong>At your direction.</strong> With a DateMatch participant, a person receiving a shared place or plan, an eligible same-place user after you opt into global visibility, a message recipient, or the public when you choose a public profile or contribution.</li>
          <li><strong>Service providers.</strong> With providers supplying hosting, databases, authentication, payments, private object storage, maps, place details, geocoding, email delivery, bot prevention, media processing, monitoring, and security. Current infrastructure may include Vercel, Supabase, Backblaze, Stripe, Google Maps or Places, Geoapify, and Cloudflare Turnstile.</li>
          <li><strong>Place, map, payment, and media requests.</strong> A provider may receive technical and transaction information needed to complete the request under its own terms and privacy policy.</li>
          <li><strong>Moderation and claims.</strong> With a contributor, claimant, rights holder, venue representative, affected person, moderator, or service provider when reasonably necessary to review an edit, claim, report, payment dispute, infringement notice, or safety issue.</li>
          <li><strong>Legal and safety reasons.</strong> When reasonably necessary to comply with law or valid legal process, investigate abuse, preserve evidence, protect rights or safety, or enforce agreements.</li>
          <li><strong>Business changes.</strong> In connection with a proposed or completed financing, merger, acquisition, reorganization, or transfer of the Service, subject to appropriate confidentiality and legal safeguards.</li>
        </ul>
        <p>Puddle does not sell personal information for money and does not use personal information for cross-context behavioural advertising.</p>
      </LegalSection>

      <LegalSection id="public-data" title="8. Public place information and contributed content">
        <p>Place information displayed by Puddle may originate from sources such as FSQ OS, Overture Maps, Wikimedia Commons, Mapillary, KartaView, Google Places, and user contributions. Puddle may store stable place identifiers, factual place data, source links, licence information, and attribution needed to operate the catalogue and comply with source terms.</p>
        <p>Public contributions may remain associated with your display name, username, source attribution, or account identifier as reasonably necessary to show provenance, investigate misuse, resolve disputes, or maintain an accurate change history. Do not submit personal information about another person unless you are authorized to do so.</p>
      </LegalSection>

      <LegalSection id="retention" title="9. Retention and deletion">
        <p>Puddle keeps personal information only as long as reasonably necessary for the purposes described in this policy. Factors include whether your account or subscription is active, whether information is needed to provide a feature, the sensitivity of the information, safety and fraud risks, chargeback and tax requirements, dispute and appeal periods, backup cycles, and legal obligations.</p>
        <p>Account deletion removes or de-identifies information from active systems except where retention is reasonably necessary for payment and tax records, security, fraud prevention, legal compliance, dispute resolution, public-source attribution, moderation evidence, or shared records that cannot be removed without affecting another person’s legitimate use.</p>
        <p>Messages may remain available to the other participant and may be retained when associated with a block, report, investigation, or legal obligation. Residual copies may remain temporarily in protected backups or logs until overwritten or expired.</p>
      </LegalSection>

      <LegalSection id="security" title="10. Security">
        <p>Puddle uses safeguards designed for the sensitivity of the information, including encrypted connections, access controls, restricted server credentials, private object storage, short-lived access tokens, signed payment webhooks, request validation, rate limits, logging, and review of uploaded or reported content.</p>
        <p>No online service can guarantee absolute security. Use a unique password, protect access to your email and payment accounts, sign out of shared devices, and promptly report suspected account misuse.</p>
      </LegalSection>

      <LegalSection id="transfers" title="11. International processing">
        <p>Puddle and its service providers may process information in Canada, the United States, or other countries. Information processed outside your province or country may be subject to the laws and lawful-access rules of that jurisdiction. Puddle uses contractual, organizational, and technical measures intended to protect information under its control wherever it is processed.</p>
      </LegalSection>

      <LegalSection id="choices" title="12. Your choices and privacy rights">
        <p>Depending on applicable law, you may ask to access personal information Puddle holds about you, correct inaccurate information, delete information, withdraw consent, object to certain processing, obtain information about disclosures, or challenge Puddle’s privacy practices.</p>
        <ul>
          <li>Update profile, location, radius, interests, visibility, and recommendation settings in the Service where available.</li>
          <li>Turn global visibility on or off, change your stated intent, decline message requests, and block or report accounts.</li>
          <li>Manage or cancel a paid subscription through the available billing controls.</li>
          <li>Change browser or device permissions used by Puddle, including location permission.</li>
          <li>Leave a DateMatch room or stop sharing a place or plan using the available controls.</li>
          <li>Unsubscribe from optional promotional email. Essential account, billing, security, and service messages may still be sent.</li>
          <li>Request account deletion or other privacy assistance through account controls or by contacting the Privacy Officer.</li>
        </ul>
        <p>Puddle may need to verify your identity before completing a request. Legal exceptions may apply, and withdrawing consent may prevent Puddle from providing a feature that depends on the information.</p>
      </LegalSection>

      <LegalSection id="children" title="13. Children and younger users">
        <p>Puddle accounts require users to be at least 13. The Service is not directed to children under 13, and Puddle does not knowingly create accounts for them. Where local law requires a higher minimum age or permission from a parent or guardian, that requirement applies.</p>
        <p>Tinder tier global discovery and messaging require users to be at least 18. Birth date is used to apply age requirements and may also be used for safety, eligibility, and age-appropriate controls. Users must provide an accurate birth date and must not help another person bypass age restrictions.</p>
      </LegalSection>

      <LegalSection id="cookies" title="14. Cookies and similar technologies">
        <p>Puddle uses cookies, local storage, and similar technologies to maintain sessions, preserve preferences, protect forms, prevent abuse, remember consent choices, and understand service performance. Blocking or deleting essential storage may sign you out or prevent parts of the Service from working.</p>
        <p>Third-party components such as authentication, checkout, billing, maps, place details, or bot prevention may set or read their own cookies or similar identifiers under their policies.</p>
      </LegalSection>

      <LegalSection id="changes" title="15. Changes to this policy">
        <p>Puddle may update this policy as the Service, memberships, vendors, laws, or privacy practices change. Material changes will be brought to your attention through the Service, email, or another appropriate method, and additional consent will be requested when required.</p>
      </LegalSection>

      <LegalSection id="contact" title="16. Contact the Privacy Officer">
        <p>Questions, access or deletion requests, and privacy complaints can be sent to <a href="mailto:privacy@puddle.you">privacy@puddle.you</a>. Include enough detail for Puddle to understand and respond to the request, but do not email passwords, authentication codes, complete payment-card details, or unnecessary sensitive information.</p>
      </LegalSection>
    </LegalPage>
  )
}
