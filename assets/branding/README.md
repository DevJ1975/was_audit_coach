# Branding assets

## WLS logo (header)

Drop the real **Workplace Learning System** mark here as:

```
assets/branding/wls-logo.png
```

Then set `USE_RASTER_LOGO = true` in [`src/components/branding.tsx`](../../src/components/branding.tsx).
Until then, the header renders a wordmark fallback (red "Workplace" / grey
"Learning System") in the logo palette.

Prefer a transparent-background PNG (or `@2x`/`@3x` variants) ~ 400×180.

If it's easier, upload it to the public Supabase bucket (as the workbook was) and
share the URL — it can be fetched into this folder.

## Notes

- WLS branding is a **white-label theme** of Soteria Audit (plan Part 5). At
  Phase 4 login, `orgs.theme` can override brand tokens + supply a logo URL per
  tenant; this bundled asset is the WLS default.
- The footer attribution "Powered by Trainovate Technologies LLC" lives in
  `AppFooter` ([`src/components/branding.tsx`](../../src/components/branding.tsx)).
