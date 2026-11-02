-- Adds only: a nullable column and two new tables. No existing data changes.
ALTER TABLE "Generation" ADD COLUMN "canvasId" TEXT;

CREATE TABLE "Canvas" (
    "id" TEXT NOT NULL,
    "title" TEXT NOT NULL DEFAULT 'Untitled canvas',
    "board" JSONB NOT NULL,
    "sessionId" TEXT NOT NULL,
    "ip" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "Canvas_pkey" PRIMARY KEY ("id")
);
CREATE INDEX "Canvas_sessionId_updatedAt_idx" ON "Canvas"("sessionId", "updatedAt");

CREATE TABLE "Asset" (
    "id" TEXT NOT NULL,
    "canvasId" TEXT NOT NULL,
    "kind" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "status" TEXT NOT NULL DEFAULT 'queued',
    "paths" JSONB NOT NULL DEFAULT '[]',
    "prompt" TEXT,
    "sources" JSONB NOT NULL DEFAULT '[]',
    "generated" BOOLEAN NOT NULL DEFAULT false,
    "error" TEXT,
    "comfyJobId" TEXT,
    "sessionId" TEXT NOT NULL,
    "ip" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "Asset_pkey" PRIMARY KEY ("id")
);
CREATE INDEX "Asset_canvasId_createdAt_idx" ON "Asset"("canvasId", "createdAt");
CREATE INDEX "Asset_sessionId_createdAt_idx" ON "Asset"("sessionId", "createdAt");
CREATE INDEX "Asset_ip_createdAt_idx" ON "Asset"("ip", "createdAt");
CREATE INDEX "Asset_createdAt_idx" ON "Asset"("createdAt");
