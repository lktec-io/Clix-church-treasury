# Fonts

No font files live in this folder. Both typefaces are self-hosted from npm
packages and bundled into the build, so there is no runtime dependency on a
font CDN:

| Role | Family | Package | Loaded in |
| ---- | ------ | ------- | --------- |
| UI text (`--font-primary`) | Nunito | `@fontsource/nunito` | `src/main.jsx` |
| Financial data (`--font-mono`) | JetBrains Mono | `@fontsource/jetbrains-mono` | `src/index.css` |

Both stacks are defined in `src/styles/variables.css` and applied only in
`src/styles/typography.css` — that file's FINANCIAL DATA section lists every
element that uses the monospaced face with tabular figures.

The images in this folder (`loginpage.jpg`, `slide2-4.jpg`) are the login
slideshow, referenced from `src/pages/LoginPage.jsx`.
