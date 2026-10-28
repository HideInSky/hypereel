-- CreateEnum
CREATE TYPE "GenerationStatus" AS ENUM ('queued', 'running', 'succeeded', 'failed');

-- CreateTable
CREATE TABLE "Generation" (
    "id" TEXT NOT NULL,
    "status" "GenerationStatus" NOT NULL DEFAULT 'queued',
    "genre" TEXT NOT NULL,
    "caption" TEXT,
    "prompt" TEXT NOT NULL,
    "model" TEXT NOT NULL,
    "comfyJobId" TEXT,
    "progress" INTEGER NOT NULL DEFAULT 0,
    "inputPath" TEXT NOT NULL,
    "videoPath" TEXT,
    "posterPath" TEXT,
    "error" TEXT,
    "sessionId" TEXT NOT NULL,
    "ip" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "Generation_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "Generation_sessionId_createdAt_idx" ON "Generation"("sessionId", "createdAt");

-- CreateIndex
CREATE INDEX "Generation_ip_createdAt_idx" ON "Generation"("ip", "createdAt");

-- CreateIndex
CREATE INDEX "Generation_status_createdAt_idx" ON "Generation"("status", "createdAt");
