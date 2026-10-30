// Server-rendered share page. Social crawlers (iMessage, X, Discord, Slack)
// don't run JS, so OG tags must be in the raw HTML. Humans get redirected
// into the SPA, which plays the clip and offers "make your own".
import type { Generation } from "@prisma/client";
import { getGenre } from "./prompts.js";

const esc = (s: string) => s.replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[c]!);

export function renderSharePage(g: Generation, publicUrl: string, paths: { video?: string; poster?: string }): string {
  const genre = getGenre(g.genre);
  const title = `${genre?.emoji ?? "🎬"} ${genre?.label ?? "Hypereel"}: ${g.caption ? esc(g.caption) : "a very dramatic clip"}`;
  const desc = "Made with Hypereel — turn any photo into an overdramatic 8-second clip with narrator, music and SFX (MiniMax H3 via ComfyUI). Make your own!";
  const pageUrl = `${publicUrl}/v/${g.id}`;
  const video = paths.video ? `${publicUrl}${paths.video}` : "";
  const poster = paths.poster ? `${publicUrl}${paths.poster}` : "";
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
<meta property="og:video:width" content="854"/>
<meta property="og:video:height" content="480"/>
<meta name="twitter:card" content="player"/>
<meta name="twitter:player" content="${pageUrl}?embed=1"/>
<meta name="twitter:player:width" content="854"/>
<meta name="twitter:player:height" content="480"/>` : `<meta name="twitter:card" content="summary_large_image"/>`}
${poster ? `<meta name="twitter:image" content="${poster}"/>` : ""}
<style>html,body{margin:0;background:#0b0b10;color:#fff;font-family:system-ui,sans-serif}main{max-width:720px;margin:0 auto;padding:16px}video{width:100%;border-radius:12px;background:#000}a.btn{display:inline-block;margin-top:16px;padding:12px 20px;border-radius:999px;background:#ff3d71;color:#fff;text-decoration:none;font-weight:700}</style>
</head><body><main>
<h1>${title}</h1>
${video ? `<video src="${video}" poster="${poster}" controls autoplay playsinline loop></video>` : `<p>This clip is still rendering. Refresh in a moment.</p>`}
<a class="btn" href="${publicUrl}/?remix=${g.id}">🎬 Make your own</a>
<script>if(!location.search.includes("embed")&&!/bot|crawl|facebook|twitter|slack|discord|whatsapp|telegram|preview/i.test(navigator.userAgent)){location.replace("${publicUrl}/?v=${g.id}")}</script>
</main></body></html>`;
}
