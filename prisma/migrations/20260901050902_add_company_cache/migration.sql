-- CreateTable
CREATE TABLE "company" (
    "company_id" TEXT NOT NULL,
    "company_name" TEXT,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "company_pkey" PRIMARY KEY ("company_id")
);

-- CreateTable
CREATE TABLE "company_sync_state" (
    "id" INTEGER NOT NULL DEFAULT 1,
    "synced_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "company_sync_state_pkey" PRIMARY KEY ("id")
);
