# Fonts

The product typeface is **Cipher**. Its `@font-face` rules live in
`src/styles/typography.css` and the stack is the single token
`--font-primary` in `src/styles/variables.css`.

Each weight first tries a locally installed Cipher, then loads the
self-hosted file from `public/fonts/cipher/`:

| Weight | File                                   |
| ------ | -------------------------------------- |
| 400    | `public/fonts/cipher/Cipher-Regular.woff2`   |
| 500    | `public/fonts/cipher/Cipher-Medium.woff2`    |
| 600    | `public/fonts/cipher/Cipher-SemiBold.woff2`  |
| 700    | `public/fonts/cipher/Cipher-Bold.woff2`      |
| 800    | `public/fonts/cipher/Cipher-ExtraBold.woff2` |

Drop the licensed `.woff2` files in with exactly those names; no code change
is needed. Until a weight's file is present, that weight renders in
**Nunito** (bundled via `@fontsource/nunito`, imported in `src/main.jsx`),
which is the declared fallback in `--font-primary`.

The images in this folder (`loginpage.jpg`, `slide2-4.jpg`) are the login
slideshow, referenced from `src/pages/LoginPage.jsx`.
