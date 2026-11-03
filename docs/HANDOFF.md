# Handoff: where hypereel stands

Written 2026-11-03 at about 04:00 PT, when the owner moved to a new laptop. Rules for Claude are in [CLAUDE.md](../CLAUDE.md).

## Deadline
- **Submissions close Tuesday, Nov 3, 2026 at 9:00 PT** (17:00 UTC). The date was extended from Oct 30. When this was written, about 5 hours were left.
- Winners are announced on **Nov 10**. The live site has to keep working until then, because judges may try it.
- After the deadline, avoid risky changes to `main`: every push redeploys the site the judges see.

## The challenge
Page: https://comfy.org/open-source-higgsfield/

**Rules**
- It must be built with ComfyUI. Running it locally, on Comfy Cloud, through the Developer Platform or the Comfy SDK all count.
- The repo needs an open-source license (ours is MIT) and enough setup detail for someone else to run it.
- Every other tool or model used has to be explained in the demo video.
- Everything must be lawful and SFW, with no unlicensed IP or likenesses.
- One submission per person. Comfy and its partners may feature the work.

**A submission includes**
1. A GitHub repo: app code, workflow files, a license, and instructions to run it locally.
2. A demo video, **2 minutes at most**. It should show the app working and explain how it was built. A Most Innovative entry must also **say why it's innovative**.
3. A link to try it (optional, but strongly encouraged).
4. A social post linking the demo on X, Reddit, IG, LinkedIn, YouTube or TikTok, tagged **#OpenSourceHiggsfield**.

**Categories:** an entry gets one main category plus one model bonus. Every entry is also considered for Best Overall ($10k).

| Category | Prize | Requirement |
|---|---|---|
| Most Innovative (**our main category**) | RTX 5090 | An app that's never been done, novel custom node packs, or new uses of ComfyUI |
| Built with MiniMax H3 (**our bonus**) | $1,000 in API credits | MiniMax H3 is the core model in the workflow |
| Most Viral | RTX 5090 | Delightful to use and made to be shared |
| Open Weights Only | RTX 5090 | No partner nodes or closed APIs |
| 10 runner-ups | $250 in Comfy credits | |

The original target was Most Viral. On Nov 2 the owner switched to **Most Innovative**, because other entries already had far more likes on X.

## What hypereel is now
- **Live site:** https://hypereel-production.up.railway.app
- **Repo:** https://github.com/HideInSky/hypereel (public, MIT)
- **Live commit:** `808b7e8` on `main`. Branch `sequence-editor` is at the same commit, and every other branch is merged.

**The pitch for Most Innovative:** effect apps make isolated 5-second clips, and the next generation never matches. hypereel treats a clip as the middle of a story. The full text for the form is in [SUBMISSION.md](SUBMISSION.md).

**Features, newest first**
1. **Assets** (built Nov 3, next to Canvas in the top bar). This is a library shared across canvases:
   - categories (Characters, Places, Props, plus custom ones), favorites, recently used, sorting, and drag to reorder;
   - saving any card or video to it, and placing items back on a canvas through "From Assets";
   - regenerating, and making sheet variants (a new outfit or a new art style).
2. **Character sheet redesign** (Nov 3), following a Higgsfield character-consistency tutorial:
   - one wide image with three panels: the body from the front with the head left out, the back with the head, and a close-up of the face;
   - a flat grey background, rendered at 2K with Nano Banana 2.
3. **Canvas** (Nov 2). This is a board where the user makes image assets, characters and character sheets, then makes an H3 clip from selected cards. Lines show what each clip was made from.
4. **Stories** (Nov 2). Any clip can be extended:
   - **+ Before / + After, Continue:** the joins go through a shared frame. The shot after starts on the clip's last frame; for the shot before, Nano Banana draws an opening frame and H3 animates it into the clip.
   - **Restage:** H3 gets the clip as Video 1 and replays the same moves in a new place or style.
   - **A soundtrack across every cut:** the original audio, AI music, AI sound effects and library sounds, each with its own start, length and volume.
   - **Free export:** ffmpeg joins the shots and mixes the audio.
5. **Effect Studio** (Nov 2):
   - an open effect-recipe format, with remix and share links;
   - export to ComfyUI, plus a custom node pack in `comfyui-hypereel/`.
   - It was built before the owner clarified they wanted Canvas instead. It still works and is on `main`, but the story to tell is Canvas.
6. **Effects** (Oct 30): 45 fixed effects such as Vanish, Floating Fall and Eyes In, with a Higgsfield-like layout in baby blue and pink.

Every model step is a ComfyUI workflow, exported to [workflows/](../workflows). The architecture, costs and limits are in the [README](../README.md).

## Not verified yet
- **Real renders:** no real character sheet or sheet variant has been rendered since the redesign. Only fake mode was checked. One real sheet costs about $0.10–0.15.
- **Untested in the browser:**
  - Assets at phone width (375 px);
  - drag-to-reorder in Assets;
  - "Save to Assets" on the single-clip page;
  - "From Assets" in the Effects upload slots.
- **Docker:** the Docker image was last checked before the OpenSSL fix. Railway builds the same Dockerfile and runs fine.

## Open tasks for Claude
1. **Sound library:** `codebase/frontend/public/sounds/library.json` is still empty.
   - The owner is downloading CC0 sounds from Freesound: rain, thunderstorm, city street, crowd chatter, room tone, wind, campfire, ocean waves, forest birds, night crickets, footsteps, dog bark, scream, café and whoosh.
   - Import them with `npm run import-sounds -w codebase/backend -- <folder> --license CC0`, check the labels, then commit when asked.
2. **Prompt fixes:** if the owner's real test sheet comes out wrong (a head in the left panel, a background that isn't grey), adjust `sheetPrompt` in `codebase/backend/src/services/workflows.ts`, then run `npm run export-workflows`.
3. **Submission text:** update the social post in [SUBMISSION.md](SUBMISSION.md). It still describes the old effects pitch, not Canvas and Stories.
4. **After the deadline:** only small, safe fixes. Ask before every push.

## What only the owner can do
- **New laptop setup:** see the next section.
- **One real test** on the live site: make a character sheet (about $0.10–0.15). This is the only check of the new sheet output.
- **Comfy credits:** check the balance at https://platform.comfy.org. Make sure it covers judges trying the site until Nov 10, or lower `LIMIT_GLOBAL_PER_DAY` in Railway.
- **The demo video** (2 minutes at most), following the script in [SUBMISSION.md](SUBMISSION.md):
  - show Canvas, then a character sheet, then a clip, then + After (Continue), then + Before (Restage), then the soundtrack and Export, then the ComfyUI workflows;
  - say out loud why it's innovative.
  - Use only your own face or made-up characters.
- **The social post** with the video, tagged #OpenSourceHiggsfield and @ComfyUI.
- **The entry form** before 9:00 PT. It takes the repo URL, the video URL, the app URL and the post URL, with Most Innovative as the main category and Built with MiniMax H3 as the bonus.
  - An entry was probably submitted around Oct 30 with an older demo and the Most Viral category. The page doesn't explain how to update an entry, so ask the organizers in the Comfy Discord.
  - If they don't answer in time, resubmit and say it replaces the earlier entry.
- **Freesound:** download the sounds listed above.

## Moving laptops: files git doesn't carry
Clone the repo, then copy these by hand from the old laptop:
- **`.env`** at the repo root, and **`codebase/backend/.env`**. They hold the Comfy API key and local config. Transfer them privately (AirDrop or a USB drive), never through git, chat or email.
- **`launch-video/`** (about 1.2 GB, kept out of git via `.git/info/exclude`). It holds the launch-film sources: a HyperFrames film, a Remotion montage, and a local voice setup in `.venv` that has to be rebuilt on the new machine.
- **The demo recordings** on the Desktop (`hypereel-demo-v1.mp4`, `hypereel-demo-v2.mp4`, `hypereel-launch-video.mp4` and the screen recordings), if you want them.
- **`codebase/backend/test/fixtures/sample.mp4`** (optional): fake mode uses it for effect clips, and makes a test pattern without it.
- **`codebase/backend/data/`** (optional): the local database and test media. Everything in it was made in fake mode, so a fresh start is fine.
- **Accounts:** the new laptop needs Railway, GitHub (with push access) and Comfy platform logins. GitHub CLI isn't set up, so pushes use git over HTTPS.

The old laptop also has leftover Docker items you can delete later: the `hc-db` container, the `hc-net` network and the `hypereel:effect-studio-check` image.
