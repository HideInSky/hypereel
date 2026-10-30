// Credit protection. Each clip costs real Comfy credits, so a public demo
// needs hard caps. Counts come from the DB (not memory) so they survive
// restarts and multiple instances.
import type { PrismaClient } from "@prisma/client";
import type { Config } from "../config.js";

export type LimitResult = { ok: true } | { ok: false; reason: "session" | "ip" | "global"; message: string };

export async function checkLimits(
  db: Pick<PrismaClient, "generation">,
  cfg: Config,
  who: { sessionId: string; ip: string },
  now: Date = new Date(),
): Promise<LimitResult> {
  const hourAgo = new Date(now.getTime() - 60 * 60 * 1000);
  const dayAgo = new Date(now.getTime() - 24 * 60 * 60 * 1000);
  // Failed generations don't count: they didn't cost credits (Comfy refunds failed partner-node runs).
  const notFailed = { status: { not: "failed" as const } };

  const [bySession, byIp, global] = await Promise.all([
    db.generation.count({ where: { sessionId: who.sessionId, createdAt: { gte: hourAgo }, ...notFailed } }),
    db.generation.count({ where: { ip: who.ip, createdAt: { gte: dayAgo }, ...notFailed } }),
    db.generation.count({ where: { createdAt: { gte: dayAgo }, ...notFailed } }),
  ]);

  if (global >= cfg.LIMIT_GLOBAL_PER_DAY) {
    return { ok: false, reason: "global", message: "Today's free clips are all used up. Come back tomorrow!" };
  }
  if (byIp >= cfg.LIMIT_PER_IP_PER_DAY) {
    return { ok: false, reason: "ip", message: "You've hit today's limit from this network. Try again tomorrow." };
  }
  if (bySession >= cfg.LIMIT_PER_SESSION_PER_HOUR) {
    return { ok: false, reason: "session", message: "Easy there, director. You can make a few more in an hour." };
  }
  return { ok: true };
}
