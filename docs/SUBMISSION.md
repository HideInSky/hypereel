# Submission kit

## Demo video script (about 110 seconds)

Most Innovative requires the demo to explain why the entry is innovative, so say it out loud.

| Time | Shot | Voiceover |
|---|---|---|
| 0:00-0:08 | The finished story playing: home, then stage, then a rainy street | "This started as one five-second clip." |
| 0:08-0:25 | Canvas: upload a character, press "Character sheet", add a stage image | "Every AI clip starts from assets. On the canvas you make them: characters, character sheets, places. The sheet keeps the face and outfit the same in every shot." |
| 0:25-0:40 | Select the cards, "Make a video", the clip appears linked to them | "Pick the cards, and MiniMax H3 renders the clip with sound. The lines show what each clip was made from." |
| 0:40-1:00 | "+ After" (Continue), then show the clip's last frame next to the new shot's first frame | "Most AI clips are dead ends: the next generation is a different person in a different world. Continue starts on this clip's exact last frame, so the join is invisible. Before works too: we draw an opening frame, and H3 animates into the clip." |
| 1:00-1:20 | "+ Before" (Restage): same moves, rainy New York. Play the two side by side | "Restage copies the moves into a new world. The clip goes into H3 as Video 1, so the dance stays the same, beat for beat." |
| 1:20-1:40 | The story strip: original sound, rain from the library, AI music, drag their start times, Export | "One soundtrack across every cut: the original sound, music and sound effects as layers. Export is free." |
| 1:40-1:50 | The workflows folder in ComfyUI | "Every step is a ComfyUI workflow in the repo. Open source, MIT licensed. #OpenSourceHiggsfield" |

### Why this is innovative (for the form)
> Effect apps make isolated five-second clips, and the next generation never matches. hypereel's Canvas treats a clip as the middle of a story. You build assets on a board (characters, open-template character sheets, places), make a clip from them with MiniMax H3, then extend it backwards or forwards. Continue joins through a shared frame, so cuts are invisible: the shot after starts on the clip's last frame, and for the shot before, Nano Banana draws an opening frame that H3 animates into the clip's first frame. Restage feeds the clip to H3 as a reference video to replay the same moves in a new place, style or light. A layered soundtrack (original audio, AI music, AI sound effects, library sounds) runs across every cut. Every step is a ComfyUI workflow included in the repo.

**Tools to mention:** ComfyUI + Comfy Cloud, MiniMax H3 Max (partner node), Nano Banana 2 (example references only), @comfyorg/sdk, Fastify, Prisma/PostgreSQL, React/Vite, sharp, Docker, GitHub Actions, Railway.

## Social post (X / LinkedIn / Reddit)

> AI video apps make 5-second dead ends. The next clip is a different person in a different world.
>
> **hypereel** treats a clip as the middle of a story. Build characters, character sheets and places on a canvas, make a clip with MiniMax H3, then grow it: + After starts on the clip's exact last frame, + Before animates into its first, and Restage replays the same moves somewhere new. One soundtrack runs across every cut, and every step is a ComfyUI workflow on Comfy Cloud.
>
> Try it: https://hypereel-production.up.railway.app
> Code (MIT): https://github.com/HideInSky/hypereel
>
> #OpenSourceHiggsfield @ComfyUI

**Short version for X** (fits 280 characters; attach the video):

> AI video apps make 5-second dead ends. hypereel turns a clip into a story: build characters on a canvas, make a clip with MiniMax H3, then extend it before and after with seamless cuts. Open source, built on ComfyUI.
> https://hypereel-production.up.railway.app
> #OpenSourceHiggsfield @ComfyUI

## Checklist
- [ ] Repo is **public** (Settings → General → Danger zone → Change visibility)
- [ ] Railway deploy live, `PUBLIC_URL` set to the real URL
- [ ] Use only your own face with consent, or fictional people, in the demo. No brands or characters.
- [ ] Check credits: each clip costs about 75 to 195. Set `LIMIT_GLOBAL_PER_DAY` to fit your balance.
- [ ] Record demo (≤2 min), upload, post with #OpenSourceHiggsfield
- [ ] Submit the entry form before **Nov 3, 9:00 PT**: repo URL, video URL, app URL, post URL. Main category: **Most Innovative**. Bonus category: **Built with MiniMax H3**
