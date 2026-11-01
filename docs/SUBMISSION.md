# Submission kit

## Demo video script (about 90 seconds)

Most Innovative requires the demo to explain why the entry is innovative, so say it out loud.

| Time | Shot | Voiceover |
|---|---|---|
| 0:00-0:10 | Gallery playing, scroll slowly | "Viral video effects are all closed. You get the ones the app ships. hypereel makes an effect something you can write, remix and share." |
| 0:10-0:30 | Pick an effect, press Remix. Studio opens with its timed beats and the live prompt | "Any effect opens as an editable recipe: camera, timed beats and sound. On the right is the exact prompt MiniMax H3 will read." |
| 0:30-0:45 | Change a beat, press Save, press Copy link | "Change a beat, save it, and it has its own link. Anyone who opens it can run it or remix it again." |
| 0:45-1:00 | Add a photo, Generate, cut to the finished clip with sound | "One photo, and H3 renders picture and sound together." |
| 1:00-1:20 | Press ComfyUI, drop the file into ComfyUI. Then show the hypereel Effect node's dropdown | "Every effect exports as a normal ComfyUI workflow. There's also a custom node that lists every recipe. An effect is just a JSON file, so adding one is a pull request, no code." |
| 1:20-1:30 | README and community folder | "Open format, open source, MIT licensed. #OpenSourceHiggsfield" |

### Why this is innovative (for the form)
> Most effect apps treat an effect as a closed preset. hypereel defines an open format, hypereel-effect/1: an effect is a JSON file with camera, timed beats, sound and product rules. The same file runs in the web app, shares by link, remixes, exports as a ComfyUI workflow, and appears in a custom node's dropdown. Anyone can add an effect with a pull request and no code. A parity test keeps the app and the node producing identical MiniMax H3 prompts.

**Tools to mention:** ComfyUI + Comfy Cloud, MiniMax H3 Max (partner node), Nano Banana 2 (example references only), @comfyorg/sdk, Fastify, Prisma/PostgreSQL, React/Vite, sharp, Docker, GitHub Actions, Railway.

## Social post (X / LinkedIn / Reddit)

> One photo. The body vanishes. The clothes hit the floor.
>
> **hypereel** is an open-source take on viral video effects: Floating Fall, Vanish and Eyes In, plus a Studio to write and remix your own. Add a character, plus a location and products if you like, and MiniMax H3 renders the clip with sound, running as a ComfyUI workflow on Comfy Cloud.
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
- [ ] Submit the entry form before **Nov 3, 9:00 PT**: repo URL, video URL, app URL, post URL. Main category: **Most Innovative**. Bonus category: **Built with MiniMax H3**
