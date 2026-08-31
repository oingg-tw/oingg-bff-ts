-- CreateEnum
CREATE TYPE "ThemeMode" AS ENUM ('LIGHT', 'DARK', 'SYSTEM');

-- CreateEnum
CREATE TYPE "ThemeAccentColor" AS ENUM ('BLUE', 'GREEN', 'PURPLE', 'ORANGE', 'RED', 'TEAL');

-- CreateTable
CREATE TABLE "user_theme_preference" (
    "firebase_uid" TEXT NOT NULL,
    "mode" "ThemeMode",
    "accent_color" "ThemeAccentColor",
    "updated_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "user_theme_preference_pkey" PRIMARY KEY ("firebase_uid")
);
