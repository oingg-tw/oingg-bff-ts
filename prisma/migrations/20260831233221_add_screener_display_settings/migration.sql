-- CreateTable
CREATE TABLE "screener_display_settings" (
    "firebase_uid" TEXT NOT NULL,
    "show_as_of_date" BOOLEAN,
    "updated_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "screener_display_settings_pkey" PRIMARY KEY ("firebase_uid")
);
