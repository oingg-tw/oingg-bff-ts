-- CreateTable
CREATE TABLE "filter_category" (
    "key" TEXT NOT NULL,
    "name" TEXT NOT NULL,

    CONSTRAINT "filter_category_pkey" PRIMARY KEY ("key")
);

-- CreateTable
CREATE TABLE "filter_metric" (
    "key" TEXT NOT NULL,
    "category_key" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "path" TEXT NOT NULL,

    CONSTRAINT "filter_metric_pkey" PRIMARY KEY ("key")
);

-- CreateTable
CREATE TABLE "filter_metric_field" (
    "metric_key" TEXT NOT NULL,
    "key" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "period" TEXT NOT NULL,

    CONSTRAINT "filter_metric_field_pkey" PRIMARY KEY ("metric_key","key")
);

-- CreateTable
CREATE TABLE "watchlist_item" (
    "id" SERIAL NOT NULL,
    "firebase_uid" TEXT NOT NULL,
    "symbol" TEXT NOT NULL,
    "note" TEXT,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "watchlist_item_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "watchlist_item_firebase_uid_idx" ON "watchlist_item"("firebase_uid");

-- CreateIndex
CREATE UNIQUE INDEX "watchlist_item_firebase_uid_symbol_key" ON "watchlist_item"("firebase_uid", "symbol");

-- AddForeignKey
ALTER TABLE "filter_metric" ADD CONSTRAINT "filter_metric_category_key_fkey" FOREIGN KEY ("category_key") REFERENCES "filter_category"("key") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "filter_metric_field" ADD CONSTRAINT "filter_metric_field_metric_key_fkey" FOREIGN KEY ("metric_key") REFERENCES "filter_metric"("key") ON DELETE CASCADE ON UPDATE CASCADE;
