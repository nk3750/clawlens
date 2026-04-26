/**
 * Activity-page responsive breakpoints (Phase 2.9, #37).
 *
 * Each constant is a pixel ceiling that defines an "at or below" media query.
 * Boundaries match the spec acceptance criteria, not the prose's strict-less
 * wording — operators see the page as "at this device, this UX kicks in":
 *
 *   `(max-width: 1024px)` matches at ≤1024 → iPad Pro 12.9" portrait gets
 *   drawer mode (acceptance #2: "1024px → drawer").
 *
 *   `(max-width: 768px)` matches at ≤768 → iPad Mini portrait gets compact
 *   UX with inline tags hidden + LIVE label dropped (acceptance #3: "768px
 *   (iPad portrait) → tags hidden + LIVE label hidden").
 *
 *   `(max-width: 639px)` matches at ≤639 → small phones get the stacked
 *   row layout. No acceptance binds 640 explicitly so the strict-less spec
 *   prose holds here.
 *
 * Centralizing these prevents the magic-number drift that would otherwise
 * sprawl across Activity.tsx, ActivityFeed, FilterRail, and ActivityRow.
 */
export const BREAKPOINT_DRAWER = 1024;
export const BREAKPOINT_COMPACT = 768;
export const BREAKPOINT_NARROW = 639;

export const MEDIA_DRAWER = `(max-width: ${BREAKPOINT_DRAWER}px)`;
export const MEDIA_COMPACT = `(max-width: ${BREAKPOINT_COMPACT}px)`;
export const MEDIA_NARROW = `(max-width: ${BREAKPOINT_NARROW}px)`;
