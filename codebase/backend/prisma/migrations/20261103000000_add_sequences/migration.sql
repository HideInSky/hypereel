-- Adds only: two nullable columns and two new tables. No existing data changes.
ALTER TABLE "Generation" ADD COLUMN "shotMode" TEXT;
ALTER TABLE "Generation" ADD COLUMN "sequenceId" TEXT;

CREATE TABLE "Sequence" (
    "id" TEXT NOT NULL,
    "title" TEXT NOT NULL DEFAULT 'Untitled story',
    "sourceId" TEXT NOT NULL,
    "shots" JSONB NOT NULL,
    "audio" JSONB NOT NULL DEFAULT '[]',
    "sessionId" TEXT NOT NULL,
    "ip" TEXT NOT NULL,
    "editedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "exportStatus" TEXT,
    "exportPath" TEXT,
    "exportError" TEXT,
    "exportedAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "Sequence_pkey" PRIMARY KEY ("id")
);
CREATE INDEX "Sequence_sessionId_createdAt_idx" ON "Sequence"("sessionId", "createdAt");

CREATE TABLE "AudioClip" (
    "id" TEXT NOT NULL,
    "kind" TEXT NOT NULL,
    "prompt" TEXT,
    "label" TEXT NOT NULL,
    "seconds" DOUBLE PRECISION NOT NULL,
    "status" TEXT NOT NULL DEFAULT 'queued',
    "path" TEXT,
    "error" TEXT,
    "comfyJobId" TEXT,
    "sessionId" TEXT NOT NULL,
    "ip" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "AudioClip_pkey" PRIMARY KEY ("id")
);
CREATE INDEX "AudioClip_sessionId_createdAt_idx" ON "AudioClip"("sessionId", "createdAt");
CREATE INDEX "AudioClip_ip_createdAt_idx" ON "AudioClip"("ip", "createdAt");
CREATE INDEX "AudioClip_createdAt_idx" ON "AudioClip"("createdAt");
