-- Adds only: a nullable column. No existing data changes.
ALTER TABLE "AudioClip" ADD COLUMN "shotId" TEXT;
