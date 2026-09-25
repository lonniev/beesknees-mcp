- **The front end is on `@tollbooth-dpyc/web` 1.2.0.** The Ledger's sort
  headers and paging are the package's `SortHeader` / `PageControls` in this
  site's classes (paging now reads First / Prev / Page N of M / Next / Last);
  the Profile top-up runs on `useTopUp`, so an open invoice settles on its own
  without "I've paid"; the operator gate asks `listCanonicalIdentities`; the
  lapsed-session strip's Dismiss clears the notice (`dismissNotice`) instead of
  re-reading the session. The site's colour overrides also cover the package's
  new `:root[data-theme="dark"]` block, so the app stays light.
