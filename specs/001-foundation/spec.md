# Feature Specification: Phase 1 — Foundation

**Feature Branch**: `001-foundation`
**Created**: 2026-09-18
**Status**: Draft
**Input**: User description: "Phase 1 Foundation: multi-tenant SaaS base with single-account registration (user + organization + default workspace), organization and workspace setup, secure JWT access/refresh cookie authentication, subscription-ready entitlements, audit logging, Express REST API skeleton, Next.js app shell with login/register/onboarding, and automated tests in every phase."

## User Scenarios & Testing *(mandatory)*

### User Story 1 - Create an Organization Account (Priority: P1)

A new business owner opens GrowMetrics, fills in a short registration form (name, email, password, and organization name), and immediately gets their own organization with a default workspace. They are signed in and taken to an onboarding page that invites them to connect their business data.

**Why this priority**: Nothing else in the product can exist without an account, an organization, and a workspace to hold data. This is the entry point of the whole product and the foundation every later phase builds on.

**Independent Test**: Register with a new email and organization name; confirm the account is created, the user is signed in, an organization and one default workspace exist, and the user lands on the onboarding page. No other feature is required for this to deliver value.

**Acceptance Scenarios**:

1. **Given** an unauthenticated visitor, **When** they submit a valid name, unique email, valid password, and organization name, **Then** an account is created with exactly one organization and one default workspace, and a session is established.
2. **Given** an account is created, **When** registration completes, **Then** the user is taken to an onboarding page that shows the "Let's connect your business data" empty state.
3. **Given** an email address that already belongs to an account, **When** the visitor tries to register with it, **Then** registration is rejected with a clear, non-revealing message and no account is created.
4. **Given** registration input that is missing or invalid, **When** the visitor submits it, **Then** the request is rejected with field-level guidance and nothing is persisted.

---

### User Story 2 - Sign In, Stay Signed In, and Sign Out (Priority: P1)

A registered user signs in with their email and password, uses the product, stays signed in across page reloads and normal navigation, and can sign out. Credentials are verified against stored account details at sign-in.

**Why this priority**: Every subsequent feature assumes an authenticated user with a durable, secure session. Without reliable sign-in/session handling, no protected capability can be trusted.

**Independent Test**: Sign in with valid credentials, reload the page, confirm the session persists, then sign out and confirm protected pages are no longer reachable. Works independently of any data feature.

**Acceptance Scenarios**:

1. **Given** a registered user, **When** they submit correct credentials, **Then** they are signed in and their profile is available to the app.
2. **Given** a signed-in user, **When** they reload the page or navigate between sections, **Then** they remain signed in without re-entering credentials.
3. **Given** a signed-in user, **When** they explicitly sign out, **Then** their session is revoked and protected areas become inaccessible.
4. **Given** an incorrect email or password, **When** sign-in is attempted, **Then** it fails with a safe generic error and no session is created.
5. **Given** a session whose short-lived credential has expired, **When** the user continues using the app, **Then** the session is transparently renewed without forcing a fresh sign-in (until the session's overall lifetime ends or it is revoked).
6. **Given** an authentication endpoint, **When** it is called repeatedly in a short window, **Then** abusive request rates are throttled.

---

### User Story 3 - Review and Update Organization & Workspace Details (Priority: P2)

A signed-in user opens settings, sees their organization and workspace details, and can rename them. Changes are saved and reflected throughout the app.

**Why this priority**: Users need to correct or brand their organization/workspace names. It is important but not required for the first usable slice.

**Independent Test**: Sign in, open settings, rename the organization and workspace, save, reload, and confirm the new names persist and display in the app shell.

**Acceptance Scenarios**:

1. **Given** a signed-in user, **When** they open settings, **Then** they see their organization name and their workspace name.
2. **Given** a signed-in user, **When** they rename the organization or workspace and save, **Then** the change persists and is shown across the app.
3. **Given** an invalid name (empty or too long), **When** saving is attempted, **Then** the change is rejected with guidance.

---

### User Story 4 - Navigate the Authenticated Application Shell (Priority: P2)

A signed-in user sees a professional application shell: a sidebar with all planned product areas (overview, dashboard, AI analyst, investigations, simulator, recommendations, reports, alerts, notifications, data hub, audit logs, settings, billing), a top bar, and light/dark mode. Areas not yet built show honest "coming soon" empty states rather than fake data.

**Why this priority**: Establishes the product experience and navigation skeleton that every later phase fills in, and prevents the app from looking like a generic chatbot.

**Independent Test**: Sign in and click through every navigation area; confirm each renders an appropriate empty/coming-soon state, the shell is responsive, and dark/light mode works.

**Acceptance Scenarios**:

1. **Given** a signed-in user, **When** they view the app, **Then** a sidebar lists all planned product areas and the current area is indicated.
2. **Given** an area that is not yet implemented, **When** the user opens it, **Then** it shows an honest empty or "coming soon" state and never fabricated business data.
3. **Given** a signed-in user, **When** they toggle the color theme, **Then** the change applies immediately and persists on reload.
4. **Given** an unauthenticated visitor, **When** they request any authenticated area directly, **Then** they are redirected to sign-in.

---

### User Story 5 - Subscription-Ready Access Control (Priority: P3)

The account is provisioned on a default free plan. The system can report what the account is entitled to and how much it has used, so later phases can gate premium features (AI investigations, simulations, anomaly detection, reports, alerts) without reworking access control.

**Why this priority**: It is foundational plumbing that later phases depend on, but no user-visible premium feature exists yet, so it can follow the core auth and shell work.

**Independent Test**: For a new account, confirm a default plan/subscription exists, entitlements can be read for the current user, and a usage counter can be recorded and fetched.

**Acceptance Scenarios**:

1. **Given** a newly registered account, **When** its subscription is inspected, **Then** it is on the default plan with a defined set of entitlements.
2. **Given** an authenticated user, **When** the app requests their entitlements, **Then** a well-defined set of feature limits is returned.
3. **Given** an allowed usage event, **When** usage is recorded for the current billing period, **Then** the recorded amount is reflected when usage is fetched.
4. **Given** a feature that the plan does not include, **When** it is requested through the backend, **Then** access is denied server-side (not only hidden in the UI).

---

### User Story 6 - Audit Important Account Actions (Priority: P3)

Important account and security actions are recorded in an audit trail the organization can review, without ever storing credentials or secrets.

**Why this priority**: Auditability is a constitutional requirement and supports security reviews, but it is not required for the first usable slice.

**Independent Test**: Perform registration, sign-in, sign-out, and a settings update; confirm each appears as a timestamped audit entry for the organization with actor, action, and resource, and that no password or token is present.

**Acceptance Scenarios**:

1. **Given** a signed-in user, **When** they perform a recorded action (registration, sign-in, sign-out, organization/workspace update), **Then** an audit entry is written with the actor, action, resource, and timestamp.
2. **Given** an audit entry, **When** it is inspected, **Then** it contains no passwords, tokens, or other secrets.
3. **Given** a signed-in user, **When** they open the audit log area, **Then** they see their organization's recent entries in reverse-chronological order.

---

### Edge Cases

- **Duplicate email at registration**: rejected without revealing whether an account exists beyond what is necessary; no partial organization/workspace records are created.
- **Concurrent duplicate registration**: two simultaneous registrations for the same email result in exactly one account; the other is rejected cleanly.
- **Weak or missing password**: registration fails with guidance before any account is created.
- **Expired or revoked session credential**: protected requests are rejected and the client is routed to sign-in rather than showing a broken state.
- **Tampered or invalid session credential**: rejected; no user is authenticated from a forged credential.
- **Cross-account access attempt**: a signed-in user requesting another organization's/workspace's resource by changing an identifier is denied, and the event is recorded.
- **Trailing/leading whitespace or different casing in email**: normalized so the same person cannot create two accounts that differ only by case.
- **Settings change with only whitespace**: treated as invalid.
- **Service unavailable / downstream failure**: the user sees a safe, generic error; technical details are logged server-side and never exposed.
- **Direct URL access while signed out**: redirected to sign-in; after signing in the user reaches the originally requested area where feasible.

## Requirements *(mandatory)*

### Functional Requirements

- **FR-001**: System MUST allow a visitor to register an account using name, email, password, and organization name.
- **FR-002**: Registration MUST create exactly one user, one organization, and one default workspace as a single atomic operation (all succeed or none are created).
- **FR-003**: System MUST normalize email addresses and enforce uniqueness so that one email belongs to at most one account.
- **FR-004**: System MUST store passwords only in a strong, one-way hashed form; plaintext passwords MUST never be stored or logged.
- **FR-005**: System MUST establish an authenticated session on successful registration and on successful sign-in.
- **FR-006**: System MUST allow a registered user to sign in with email and password, validating against stored account details.
- **FR-007**: System MUST keep sessions alive across page reloads and normal navigation via a short-lived credential plus a longer-lived, revocable session credential.
- **FR-008**: System MUST transparently renew the short-lived credential as long as the overall session is valid, and MUST deny renewal for expired, revoked, or unrecognized sessions.
- **FR-009**: System MUST allow a user to sign out, which revokes the session credential so it cannot be reused.
- **FR-010**: System MUST deliver session credentials only through secure, HTTP-only cookies that are not readable by client scripts.
- **FR-011**: System MUST protect all authenticated routes and APIs, rejecting requests without a valid session.
- **FR-012**: System MUST derive the user's organization and workspace from the authenticated user's own record and MUST NOT trust organization, workspace, or role identifiers supplied by the client.
- **FR-013**: System MUST deny access to another organization's or workspace's resources even when a valid identifier is supplied by an attacker.
- **FR-014**: System MUST rate-limit authentication-sensitive operations to mitigate abuse.
- **FR-015**: System MUST implement a single-account-per-organization model where the registering user is the implicit owner; memberships, invitations, and role-based permissions are explicitly out of scope for this phase.
- **FR-016**: System MUST provide the authenticated user's profile and current organization/workspace context to the application.
- **FR-017**: System MUST let a signed-in user view and update the organization name and workspace name.
- **FR-018**: System MUST provision a default subscription plan for every new organization and expose the organization's entitlements to authenticated requests.
- **FR-019**: System MUST record usage against a named metric for the current period and return recorded usage on request.
- **FR-020**: System MUST enforce entitlement limits in the backend whenever a gated capability is requested, not only in the interface.
- **FR-021**: System MUST write an audit entry for important account and security actions (at minimum: registration, sign-in, sign-out, organization update, workspace update).
- **FR-022**: Audit entries MUST include actor, organization context, action, resource reference, and timestamp, and MUST NOT contain passwords, tokens, or other secrets.
- **FR-023**: System MUST provide the authenticated application shell with navigation to all planned product areas (overview, dashboard, AI analyst, investigations, simulator, recommendations, reports, alerts, notifications, data hub: datasets/data sources/data quality/import history, audit logs, settings, billing).
- **FR-024**: Areas not yet implemented MUST present an honest empty or "coming soon" state and MUST NOT display fabricated business data.
- **FR-025**: System MUST support light and dark color themes that persist across sessions.
- **FR-026**: System MUST return consistent, safe error responses with a machine-readable code and a human-readable message, and MUST NOT expose stack traces, secrets, or internal details to clients.
- **FR-027**: System MUST validate all external input (request bodies, query parameters, and path parameters) and reject invalid input with field-level feedback.
- **FR-028**: System MUST emit structured server-side logs with a request identifier and MUST redact secrets.
- **FR-029**: System MUST expose a health endpoint reporting service availability and version.
- **FR-030**: System MUST include automated tests for each phase: unit tests for core logic, integration tests for authentication and tenant isolation, and a documented phase gate (type-check, lint, tests, and database migration validity) that must pass before the next phase begins.
- **FR-031**: System MUST allow the authenticated user to reach the onboarding page after registration, and returning users to reach the overview without being forced through onboarding.

### Key Entities *(include if data is involved)*

- **User**: A person who signs in. Holds name, normalized unique email, hashed password, a reserved role value (default owner, unused for permissions in this phase), last sign-in time, and a reference to their organization.
- **Organization**: A business account. Holds name, a unique slug, and timestamps. Owns workspaces and all business data.
- **Workspace**: A container for a business's data and analysis, belonging to one organization. Every new organization gets one default workspace.
- **Session**: A revocable record of a signed-in session, storing a hashed session credential, device/network context, expiry, and revocation time.
- **Plan**: A subscription tier definition with a key, display name, and a set of feature limits.
- **Subscription**: Links an organization to a plan with a status and validity window; provisioned to the default plan at registration.
- **Usage Record**: A per-metric, per-period counter for an organization used for entitlement/limit checks.
- **Audit Entry**: An immutable record of an important action with actor, organization/workspace context, action, resource, metadata, and timestamp.
- **Background Job**: A record of deferred work with type, status, attempt count, scheduling, and error information. In this phase it is the foundation for later async processing.
- **Notification**: A per-user message record used by later phases for alerts and report notices.

## Success Criteria *(mandatory)*

### Measurable Outcomes

- **SC-001**: A new user can complete registration (account, organization, and default workspace) and reach onboarding in under 2 minutes.
- **SC-002**: 100% of protected areas and APIs reject requests made without a valid session.
- **SC-003**: A signed-in user remains signed in across page reloads and navigation for the full session lifetime without re-entering credentials.
- **SC-004**: 100% of simulated cross-account access attempts are denied and recorded.
- **SC-005**: A duplicate email registration is rejected in 100% of cases, with no duplicate organization or workspace created.
- **SC-006**: Every one of the planned product areas is reachable from the app shell and displays a non-fabricated empty/coming-soon state.
- **SC-007**: A new account can report its entitlements and accumulate usage for the current period; a request for a non-entitled capability is denied server-side.
- **SC-008**: Every important account action sampled in review produces exactly one audit entry with no secret values.
- **SC-009**: The phase gate passes end to end: automated tests, type-check, lint, and database migration validity all succeed before Phase 2 begins.
- **SC-010**: A signed-in user can update organization and workspace names and see the change reflected after reload.

## Assumptions

- Single-account model per organization for this phase: one user owns one organization and one default workspace. Memberships, invitations, and role-based permissions are intentionally deferred (to be modeled later without a redesign; a reserved role field exists for that).
- Email verification is not performed in this phase; sign-in validates stored credentials as described. Verification and password reset are deferred.
- Email sending is not required in this phase. When later phases need it, a reusable, provider-agnostic email service with a development log sink will be used.
- The organization name given at registration also seeds the default workspace name, which the user may rename later.
- Storage, authentication cryptography, queueing, and interfaces follow the project's ratified architecture and constitution; this specification intentionally avoids prescribing implementation technologies.
- A default free plan is available to provision every new organization.
- Test coverage in this phase focuses on authentication, authorization/tenant isolation, entitlements, and the account lifecycle, with the amount of coverage growing in later phases.
