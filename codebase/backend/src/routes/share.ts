import type { FastifyInstance } from "fastify";
import type { AppContext } from "../app.js";
import { renderSharePage } from "../share.js";

export async function shareRoutes(app: FastifyInstance, ctx: AppContext) {
  app.get<{ Params: { id: string } }>("/v/:id", async (req, reply) => {
    const g = await ctx.db.generation.findUnique({ where: { id: req.params.id } });
    if (!g) return reply.code(404).type("text/html").send("<h1>Not found</h1>");
    const html = renderSharePage(g, ctx.cfg.PUBLIC_URL, {
      video: g.videoPath ? ctx.storage.publicPath(g.videoPath) : undefined,
      poster: g.posterPath ? ctx.storage.publicPath(g.posterPath) : undefined,
    });
    return reply.type("text/html").send(html);
  });
}
