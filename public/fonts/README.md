# Fonts

This directory is no longer used. The design system originally specified
**Circular** (a paid, licensed Lineto font this project could never legally
bundle) and referenced `public/fonts/circular-std-font.ttf`, which never
actually existed here.

That requirement was superseded: the application now uses **Poppins**
(SIL Open Font License, freely bundleable), self-hosted via the
`@fontsource/poppins` npm package and imported directly in `src/main.jsx`
— no files needed in this directory, no `@font-face` declaration in CSS,
no external font CDN.
