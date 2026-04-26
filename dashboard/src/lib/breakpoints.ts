/**
 * Activity-page responsive breakpoints (Phase 2.9, #37).
 *
 * Each constant is a pixel ceiling that defines an "at or below" media query.
 * The `(max-width: 1023px)` query matches at widths ≤ 1023, which is exactly
 * the spec's "<1024px" rule (spec §2.9 acceptance #1: ≥1024 = desktop).
 *
 * Centralizing these prevents the magic-number drift that would otherwise
 * sprawl across Activity.tsx, ActivityFeed, FilterRail, and ActivityRow.
 */
export const BREAKPOINT_DRAWER = 1023;
export const BREAKPOINT_COMPACT = 767;
export const BREAKPOINT_NARROW = 639;

export const MEDIA_DRAWER = `(max-width: ${BREAKPOINT_DRAWER}px)`;
export const MEDIA_COMPACT = `(max-width: ${BREAKPOINT_COMPACT}px)`;
export const MEDIA_NARROW = `(max-width: ${BREAKPOINT_NARROW}px)`;
