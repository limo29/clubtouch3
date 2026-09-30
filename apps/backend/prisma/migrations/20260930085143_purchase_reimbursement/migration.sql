-- AlterEnum
ALTER TYPE "TopUpMethod" ADD VALUE 'REIMBURSEMENT';

-- AlterTable
ALTER TABLE "AccountTopUp" ADD COLUMN     "purchaseDocumentId" TEXT;

-- AlterTable
ALTER TABLE "PurchaseDocument" ADD COLUMN     "reimbursedCustomerId" TEXT;

-- CreateIndex
CREATE INDEX "AccountTopUp_purchaseDocumentId_idx" ON "AccountTopUp"("purchaseDocumentId");

-- AddForeignKey
ALTER TABLE "AccountTopUp" ADD CONSTRAINT "AccountTopUp_purchaseDocumentId_fkey" FOREIGN KEY ("purchaseDocumentId") REFERENCES "PurchaseDocument"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "PurchaseDocument" ADD CONSTRAINT "PurchaseDocument_reimbursedCustomerId_fkey" FOREIGN KEY ("reimbursedCustomerId") REFERENCES "Customer"("id") ON DELETE SET NULL ON UPDATE CASCADE;
