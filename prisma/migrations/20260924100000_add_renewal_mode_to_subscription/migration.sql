-- CreateEnum
CREATE TYPE "RenewalMode" AS ENUM ('AUTOMATIC', 'MANUAL');

-- AlterTable
ALTER TABLE "subscription" ADD COLUMN     "renewal_mode" "RenewalMode" NOT NULL DEFAULT 'MANUAL';
