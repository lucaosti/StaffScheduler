# Store listing draft

Draft copy and a sourcing checklist for the App Store / Play Store listings. This is
documentation, not a submission artifact — nothing here has been uploaded anywhere. Paste
the relevant fields into App Store Connect / Play Console when an actual submission is
prepared, and replace the placeholders first.

## App identity

- **App name**: Staff Scheduler
- **Bundle / package ID**: `com.staffscheduler.app` (set in `mobile/capacitor.config.ts`,
  synced into both native projects by `cap sync`)
- **Category**:
  - App Store: Business (secondary: Productivity)
  - Play Store: Business

## Short description

(App Store "Promotional Text" / Play Store "Short description", ~80 characters)

> Workforce scheduling, shift assignments, and approvals — for managers and staff.

## Full description (draft)

> Staff Scheduler brings the full workforce-management workflow to your phone: view your
> upcoming shifts, request time off, and swap shifts with teammates from anywhere.
>
> For managers: build and publish schedules, review and approve time-off and shift-swap
> requests, and keep visibility into team coverage without being at a desk.
>
> Staff Scheduler is built for organizations that already run their scheduling through the
> Staff Scheduler platform — this app is a companion client, not a standalone service.

This full description is intentionally generic until real screenshots and a settled
feature set (auth flow, calendar views, and push notifications are not implemented yet —
see `DOCUMENTATION.md`'s mobile section) are available to describe accurately. Do not
submit copy describing features the shipped build doesn't have.

## Privacy policy URL

`REPLACE_WITH_REAL_PRIVACY_POLICY_URL` — both stores require a live, reachable privacy
policy URL before a listing can be submitted. This needs to exist on the organization's
own domain before submission; it is not something this repository can host or fabricate.

## Support URL / contact

`REPLACE_WITH_REAL_SUPPORT_URL_OR_EMAIL`

## Screenshot sourcing plan

No screenshots exist yet — this is a checklist of what to capture and at which device
size classes, once the app has a stable, representative set of screens to show.

**Screens to capture** (once implemented / available in a build worth screenshotting):

- [ ] Login screen
- [ ] Upcoming shifts / personal schedule view
- [ ] Shift detail view
- [ ] Time-off request form
- [ ] Shift-swap request flow
- [ ] Manager: schedule calendar / Gantt view
- [ ] Manager: pending-approvals list

**Required device size classes**:

- App Store (iOS):
  - [ ] iPhone 6.7" display (e.g. iPhone 15 Pro Max class) — required
  - [ ] iPhone 6.5" display (e.g. iPhone 11 Pro Max class) — required
  - [ ] iPad Pro 12.9" (3rd gen or later) — only if the listing supports iPad; the
        current build's `UISupportedInterfaceOrientations~ipad` entry in `Info.plist`
        means it does, so this size class is required, not optional
- Play Store (Android):
  - [ ] Phone — required (minimum 2 screenshots, 16:9 or 9:16)
  - [ ] 7" tablet — required if the listing targets tablets
  - [ ] 10" tablet — required if the listing targets tablets

Screenshots should be captured from a real build running against representative demo data
(`npm run db:seed:demo` in `backend/`), never from a design mockup — both stores reject
listings whose screenshots don't match the shipped app.

## What's explicitly not done here

- No app icon or splash screen beyond the Capacitor template defaults has been designed —
  see `DOCUMENTATION.md`'s mobile section.
- No screenshots have been captured.
- No developer account, signing certificate, or provisioning profile has been created.
- Nothing in this directory has been uploaded to either store.
