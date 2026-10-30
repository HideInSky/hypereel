// Server-rendered share page. Social crawlers (iMessage, X, Discord, Slack)
// don't run JS, so OG tags must be in the raw HTML. Humans get redirected
// into the SPA, which plays the clip and offers "make your own".
import type { Generation } from "@prisma/client";
import { getEffect } from "./effects.js";

const esc = (s: string) => s.replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[c]!);

export function renderSharePage(g: Generation, publicUrl: string, paths: { video?: string }): string {
  const effect = getEffect(g.genre);
  const title = `${esc(effect?.label ?? "hypereel")}, made with hypereel`;
  const desc = "Upload a photo, pick an effect, and get a viral clip with sound. Rendered by MiniMax H3 on ComfyUI. Make your own!";
  const pageUrl = `${publicUrl}/v/${g.id}`;
  const video = paths.video ? `${publicUrl}${paths.video}` : "";
  // A generic image: the character photo is the uploader's, and isn't what they chose to share.
  const poster = `${publicUrl}/og.png`;
  return `<!doctype html>
<html lang="en"><head><meta charset="utf-8"/>
<meta name="viewport" content="width=device-width,initial-scale=1"/>
<title>${title}</title>
<meta name="description" content="${esc(desc)}"/>
<meta property="og:type" content="video.other"/>
<meta property="og:title" content="${title}"/>
<meta property="og:description" content="${esc(desc)}"/>
<meta property="og:url" content="${pageUrl}"/>
${poster ? `<meta property="og:image" content="${poster}"/>` : ""}
${video ? `<meta property="og:video" content="${video}"/>
<meta property="og:video:secure_url" content="${video}"/>
<meta property="og:video:type" content="video/mp4"/>
<meta property="og:video:width" content="480"/>
<meta property="og:video:height" content="854"/>
<meta name="twitter:card" content="player"/>
<meta name="twitter:player" content="${pageUrl}?embed=1"/>
<meta name="twitter:player:width" content="480"/>
<meta name="twitter:player:height" content="854"/>` : `<meta name="twitter:card" content="summary_large_image"/>`}
${poster ? `<meta name="twitter:image" content="${poster}"/>` : ""}
<style>html,body{margin:0;background:#0b0b10;color:#fff;font-family:system-ui,sans-serif}main{max-width:720px;margin:0 auto;padding:16px}video{width:100%;border-radius:12px;background:#000}a.btn{display:inline-block;margin-top:16px;padding:12px 20px;border-radius:999px;background:#8fd3f4;color:#10131a;text-decoration:none;font-weight:700}</style>
</head><body><main>
<h1>${title}</h1>
${video ? `<video src="${video}" controls autoplay playsinline loop></video>` : `<p>This clip is still rendering. Refresh in a moment.</p>`}
<a class="btn" href="${publicUrl}/">Make your own</a>
<script>if(!location.search.includes("embed")&&!/bot|crawl|facebook|twitter|slack|discord|whatsapp|telegram|preview/i.test(navigator.userAgent)){location.replace("${publicUrl}/?v=${g.id}")}</script>
</main></body></html>`;
}
