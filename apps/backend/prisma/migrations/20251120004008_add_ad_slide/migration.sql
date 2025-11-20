-- CreateEnum
CREATE TYPE "AdTransitionType" AS ENUM ('FADE', 'SLIDE', 'ZOOM', 'NONE');

-- CreateTable
CREATE TABLE "AdSlide" (
    "id" TEXT NOT NULL,
    "imageUrl" TEXT NOT NULL,
    "duration" INTEGER NOT NULL DEFAULT 10,
    "transition" "AdTransitionType" NOT NULL DEFAULT 'FADE',
    "order" INTEGER NOT NULL DEFAULT 0,
    "active" BOOLEAN NOT NULL DEFAULT true,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "AdSlide_pkey" PRIMARY KEY ("id")
);
