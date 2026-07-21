# 👕 AI Stylist

A mobile-first web app that turns photos of your own clothes into outfit
suggestions. Snap a picture of a garment, an AI vision model tags it
automatically, and the app builds complete outfits from your wardrobe for any
occasion.

**Live demo:** _(added after GitHub Pages is enabled — see below)_

![screens](docs/preview.png)

---

## Why I built this

Existing "AI stylist" apps charge around **$20/month** because they pay a large
AI provider on every request. I wanted to prove the same experience can be
**free for the user**: the app is a static site (no server to pay for) and each
person uses their **own free Google Gemini API key**, entered once and stored
only in their browser. Nothing is billed to me, and no key is ever hard-coded
into the source.

This is a personal / university project focused on three things: a clean
mobile UI, calling a multimodal LLM correctly from the browser, and doing it
without exposing any secret.

## How it works

```
 Phone camera ──▶ resize on <canvas> ──▶ Gemini Vision ──▶ tags (JSON)
                                                              │
                          browser localStorage  ◀────────────┘
                                   │
 "Style me" ──▶ wardrobe as text ──▶ Gemini ──▶ outfit suggestions (JSON)
```

- **Add item** — takes a photo, shrinks it to 512px on a `<canvas>` (so it fits
  in `localStorage`), and asks Gemini to return structured JSON describing the
  garment (name, category, colour, style, season).
- **Style me** — sends the wardrobe as a compact text list (cheaper and more
  reliable than re-sending every image) and asks Gemini for up to three
  matching outfits with a one-line reason for each.
- **Storage** — the wardrobe and the API key live entirely in the browser via
  `localStorage`. Clearing the browser data resets the app.

## Tech

- Plain **HTML + CSS + vanilla JavaScript** — no framework, no build step.
- **Google Gemini API** (`generateContent`) called directly from the browser
  with the user's key.
- Deployable as a **static site** on GitHub Pages.

Keeping it framework-free is deliberate: the whole thing is three readable
files, which makes it easy to understand and to document.

## Run it locally

Any static file server works. For example, with Python:

```bash
python -m http.server 5178
# then open http://localhost:5178
```

Then go to **Settings**, paste a free Gemini API key
(<https://aistudio.google.com/apikey>), and Save.

## Deploy (GitHub Pages)

1. Push this repo to GitHub.
2. Repo **Settings → Pages → Source: `main` branch, `/root`**.
3. Wait ~1 minute; your app is live at
   `https://<username>.github.io/ai-stylist/`.

Because it's HTTPS, the phone camera and `localStorage` both work.

## Project structure

| File | Purpose |
|------|---------|
| `index.html` | Markup and the three tabs (Closet / Style me / Settings) |
| `styles.css` | Mobile-first dark theme |
| `app.js` | All logic: camera, image resize, Gemini calls, rendering |

## Privacy

The API key and all photos stay on the user's device. The only network calls
are made directly from the browser to Google's Gemini endpoint, using the
user's own key. This project has no backend and collects no data.

## License

MIT — see [LICENSE](LICENSE).
