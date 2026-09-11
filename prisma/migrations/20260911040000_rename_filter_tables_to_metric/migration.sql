-- Hand-written (NOT prisma-generated): `prisma migrate dev` computes Filter*->Metric* model renames as
-- DROP+CREATE by default, which would destroy filter_metric_field's 144 live rows and cascade-delete every
-- user's saved ScreenerPresetFilter rows pointing at them (onDelete: Cascade). This migration is pure
-- ALTER TABLE/CONSTRAINT RENAME, so no data moves and no FK/cascade fires.

-- Tables
ALTER TABLE "filter_category" RENAME TO "metric_category";
ALTER TABLE "filter_metric" RENAME TO "metric_definition";
ALTER TABLE "filter_metric_field" RENAME TO "metric_definition_field";

-- metric_category constraints (renaming a PK constraint also renames its backing index in Postgres)
ALTER TABLE "metric_category" RENAME CONSTRAINT "filter_category_pkey" TO "metric_category_pkey";
ALTER TABLE "metric_category" RENAME CONSTRAINT "filter_category_key_not_null" TO "metric_category_key_not_null";
ALTER TABLE "metric_category" RENAME CONSTRAINT "filter_category_name_not_null" TO "metric_category_name_not_null";
ALTER TABLE "metric_category" RENAME CONSTRAINT "filter_category_position_not_null" TO "metric_category_position_not_null";

-- metric_definition constraints
ALTER TABLE "metric_definition" RENAME CONSTRAINT "filter_metric_pkey" TO "metric_definition_pkey";
ALTER TABLE "metric_definition" RENAME CONSTRAINT "filter_metric_category_key_fkey" TO "metric_definition_category_key_fkey";
ALTER TABLE "metric_definition" RENAME CONSTRAINT "filter_metric_key_not_null" TO "metric_definition_key_not_null";
ALTER TABLE "metric_definition" RENAME CONSTRAINT "filter_metric_category_key_not_null" TO "metric_definition_category_key_not_null";
ALTER TABLE "metric_definition" RENAME CONSTRAINT "filter_metric_name_not_null" TO "metric_definition_name_not_null";
ALTER TABLE "metric_definition" RENAME CONSTRAINT "filter_metric_path_not_null" TO "metric_definition_path_not_null";
ALTER TABLE "metric_definition" RENAME CONSTRAINT "filter_metric_position_not_null" TO "metric_definition_position_not_null";

-- metric_definition_field constraints
ALTER TABLE "metric_definition_field" RENAME CONSTRAINT "filter_metric_field_pkey" TO "metric_definition_field_pkey";
ALTER TABLE "metric_definition_field" RENAME CONSTRAINT "filter_metric_field_metric_key_fkey" TO "metric_definition_field_metric_key_fkey";
ALTER TABLE "metric_definition_field" RENAME CONSTRAINT "filter_metric_field_key_not_null" TO "metric_definition_field_key_not_null";
ALTER TABLE "metric_definition_field" RENAME CONSTRAINT "filter_metric_field_metric_key_not_null" TO "metric_definition_field_metric_key_not_null";
ALTER TABLE "metric_definition_field" RENAME CONSTRAINT "filter_metric_field_name_not_null" TO "metric_definition_field_name_not_null";
ALTER TABLE "metric_definition_field" RENAME CONSTRAINT "filter_metric_field_period_not_null" TO "metric_definition_field_period_not_null";
ALTER TABLE "metric_definition_field" RENAME CONSTRAINT "filter_metric_field_position_not_null" TO "metric_definition_field_position_not_null";
