-- CreateTable
CREATE TABLE "dashboard_card_settings" (
    "firebase_uid" TEXT NOT NULL,
    "visible_card_ids" JSONB NOT NULL,
    "updated_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "dashboard_card_settings_pkey" PRIMARY KEY ("firebase_uid")
);
