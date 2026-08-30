-- CreateEnum
CREATE TYPE "PresetTemplateTier" AS ENUM ('FREE', 'PAID');

-- CreateEnum
CREATE TYPE "PresetTemplateStatus" AS ENUM ('AVAILABLE', 'PENDING');

-- CreateTable
CREATE TABLE "preset_template" (
    "id" UUID NOT NULL,
    "name" TEXT NOT NULL,
    "category" TEXT NOT NULL,
    "description" TEXT NOT NULL,
    "tier" "PresetTemplateTier" NOT NULL,
    "status" "PresetTemplateStatus" NOT NULL,
    "pending_reason" TEXT,
    "filters" JSONB NOT NULL,
    "position" INTEGER NOT NULL,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "preset_template_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "preset_template_name_key" ON "preset_template"("name");
