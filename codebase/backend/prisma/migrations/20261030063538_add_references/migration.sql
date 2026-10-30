-- AlterTable
ALTER TABLE "Generation" ADD COLUMN     "aspectRatio" TEXT,
ADD COLUMN     "references" JSONB,
ADD COLUMN     "resolution" TEXT;
