# Submission kit

## Demo video script (2:00 or less)

| Time | Shot | Voiceover |
|---|---|---|
| 0:00-0:08 | Hook: full-screen Vanish clip, the clothes hit the ground | "That's not a VFX studio. That's one photo." |
| 0:08-0:20 | Quick cuts of Floating Fall and Eyes In | "hypereel is an open-source take on viral video effects. One photo, one click, picture and sound." |
| 0:20-0:50 | Screen: add a character, a location and a product, pick an effect, Generate, the progress screen, the result | "Add a character. Location and products are optional. Pick an effect and about a minute later you have a clip." |
| 0:50-1:05 | Same character, product changed, shows the product floating in Floating Fall | "Your references really drive it. Swap the product and the shot changes." |
| 1:05-1:35 | ComfyUI with `workflows/hypereel_effects_h3_api.json` loaded, then `effects.ts` | "Under the hood it's a ComfyUI workflow on Comfy Cloud. MiniMax H3's reference node takes up to nine images. Each effect is a recipe in plain text, so adding a new one is just a few lines." |
| 1:35-1:50 | README, architecture diagram, CI | "It's MIT licensed, with Fastify, Postgres, React, Docker Compose and GitHub Actions." |
| 1:50-2:00 | Outro: three tiles playing | "hypereel. Link below. #OpenSourceHiggsfield" |

**Tools to mention:** ComfyUI + Comfy Cloud, MiniMax H3 Max (partner node), Nano Banana 2 (example references only), @comfyorg/sdk, Fastify, Prisma/PostgreSQL, React/Vite, sharp, Docker, GitHub Actions, Railway.

## Social post (X / LinkedIn / Reddit)

> One photo. The body vanishes. The clothes hit the floor.
>
> **hypereel** is an open-source take on viral video effects: Floating Fall, Vanish and Eyes In. Add a character, plus a location and products if you like, and MiniMax H3 renders the clip with sound, running as a ComfyUI workflow on Comfy Cloud.
>
> Try it: <APP_URL>
> Code (MIT): https://github.com/HideInSky/hypereel
>
> #OpenSourceHiggsfield @ComfyUI

## Checklist
- [ ] Repo is **public** (Settings → General → Danger zone → Change visibility)
- [ ] Railway deploy live, `PUBLIC_URL` set to the real URL
- [ ] Use only your own face with consent, or fictional people, in the demo. No brands or characters.
- [ ] Check credits: each clip costs about 75 to 195. Set `LIMIT_GLOBAL_PER_DAY` to fit your balance.
- [ ] Record demo (≤2 min), upload, post with #OpenSourceHiggsfield
- [ ] Submit the entry form before **Oct 30, 9:00 PT**: repo URL, video URL, app URL, post URL. Bonus category: **Built with MiniMax H3**
