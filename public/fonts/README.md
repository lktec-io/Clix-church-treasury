# CircularTtf

This product's design system specifies **Circular** (Lineto) as its primary
typeface, referenced in `src/index.css` as:

```css
@font-face {
  font-family: 'CircularTtf';
  src: local('Circular'), url('/fonts/circular-std-font.ttf') format('truetype');
}
```

Circular is a **paid, licensed commercial font** — its binary is intentionally
not committed to this repository. To activate it:

1. Obtain a valid license/file for Circular (or your organization's chosen
   weight/format) from Lineto or an authorized reseller.
2. Place the file at `public/fonts/circular-std-font.ttf` (this exact path).
3. Rebuild (`npm run build`) / restart the dev server.

Until that file is present, the app falls back to the system sans-serif
stack defined in `src/index.css`'s `--font-primary`, which is a deliberate,
premium-looking fallback — not a broken state.
