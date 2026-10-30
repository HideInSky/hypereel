# Submission kit

## Demo video script (≤ 2:00)

| Time | Shot | Voiceover / on-screen |
|---|---|---|
| 0:00–0:08 | Hook: phone screen, a photo of a houseplant becomes a Nature Documentary clip **with sound** | "This is my houseplant. hypereel turned it into a nature documentary." |
| 0:08–0:20 | Same photo remixed into Action Trailer and Infomercial, quick cuts | "One photo. Six genres. Narrator, music and sound effects, all in one pass." |
| 0:20–0:45 | Live use on a phone: pick photo of a pet/lunch/mug, pick genre, optionally tell the writer something, tap **Hypereel it**, the progress screen, the result | "Upload anything, pick a genre, an AI writes a joke about your exact photo, and about a minute later you get the clip. Same photo again? A different joke." |
| 0:45–1:00 | Tap Share, paste link in a chat app, the video preview unfurls, friend taps **Make your own** | "Every clip is a share link that plays inline and has a Make-your-own button. That's the viral loop." |
| 1:00–1:30 | Screen: ComfyUI with `workflows/hypereel_h3_i2v_api.json` loaded (LoadImage, Claude script writer, MiniMax H3, SaveVideo), then the backend code that submits it with `@comfyorg/sdk` | "Under the hood it's a ComfyUI workflow on Comfy Cloud. A Claude node looks at the photo and writes the scene. MiniMax H3 Max Turbo is the core model. It generates the video and the audio together, so no separate text-to-speech or music model. The backend sends the workflow with the Comfy TypeScript SDK." |
| 1:30–1:50 | README: architecture diagram, docker compose, CI badge | "Everything's open source under MIT. Fastify, Postgres, React, Docker Compose and GitHub Actions. Swap the workflow in ComfyUI and the app follows." |
| 1:50–2:00 | Outro: grid of clips | "hypereel. Make anything overdramatic. Link below. #OpenSourceHiggsfield" |

**Tools to mention (rule: explain other tools):** ComfyUI + Comfy Cloud, MiniMax H3 Max Turbo (partner node), @comfyorg/sdk, Fastify, Prisma/PostgreSQL, React/Vite, sharp, Docker, GitHub Actions, Railway. No other AI models.

## Social post (X / LinkedIn / Reddit)

> I made my houseplant the star of a nature documentary 🌿🎬
>
> **hypereel**: upload any photo, pick a genre (action trailer, nature doc, infomercial, K-drama, horror, cooking show), and an AI writes a new joke about your photo, then MiniMax H3 renders an 8-second clip with narrator, music and SFX in one pass running as a ComfyUI workflow on Comfy Cloud.
>
> Try it: <APP_URL>
> Code (MIT): https://github.com/HideInSky/hypereel
>
> #OpenSourceHiggsfield @ComfyUI

## Checklist
- [ ] Repo is **public** (Settings → General → Danger zone → Change visibility)
- [ ] Railway deploy live, `PUBLIC_URL` set to the real URL
- [ ] Seed the gallery with 6–10 good clips (your own pet/plant/food photos; no faces of real people, no brands/characters)
- [ ] Record demo (≤2 min), upload, post with #OpenSourceHiggsfield
- [ ] Submit the entry form before **Oct 30, 9:00 PT**: repo URL, video URL, app URL, post URL. Bonus category: **Built with MiniMax H3**
