-- Assets library: an asset with no canvas belongs to its maker's library. Additive only:
-- canvasId becomes optional and new columns have defaults or are nullable.
ALTER TABLE "Asset" ALTER COLUMN "canvasId" DROP NOT NULL;
ALTER TABLE "Asset" ADD COLUMN "category" TEXT;
ALTER TABLE "Asset" ADD COLUMN "favorite" BOOLEAN NOT NULL DEFAULT false;
ALTER TABLE "Asset" ADD COLUMN "position" INTEGER;
ALTER TABLE "Asset" ADD COLUMN "usedAt" TIMESTAMP(3);
ALTER TABLE "Asset" ADD COLUMN "originId" TEXT;
ALTER TABLE "Asset" ADD COLUMN "variant" JSONB;

CREATE INDEX "Asset_sessionId_canvasId_idx" ON "Asset"("sessionId", "canvasId");
CREATE INDEX "Asset_sessionId_originId_idx" ON "Asset"("sessionId", "originId");

CREATE TABLE "AssetCategory" (
    "id" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "sessionId" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "AssetCategory_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "AssetCategory_sessionId_name_key" ON "AssetCategory"("sessionId", "name");
