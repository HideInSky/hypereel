-- Adds only: a nullable column and a new table. No existing data changes.
ALTER TABLE "Generation" ADD COLUMN "effectName" TEXT;

CREATE TABLE "CustomEffect" (
    "id" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "recipe" JSONB NOT NULL,
    "remixOf" TEXT,
    "sessionId" TEXT NOT NULL,
    "ip" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "CustomEffect_pkey" PRIMARY KEY ("id")
);

CREATE INDEX "CustomEffect_sessionId_createdAt_idx" ON "CustomEffect"("sessionId", "createdAt");
CREATE INDEX "CustomEffect_ip_createdAt_idx" ON "CustomEffect"("ip", "createdAt");
