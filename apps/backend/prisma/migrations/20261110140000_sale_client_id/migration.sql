-- AlterTable
ALTER TABLE "AccountTopUp" ADD COLUMN     "clientId" TEXT;

-- AlterTable
ALTER TABLE "Transaction" ADD COLUMN     "clientId" TEXT;

-- CreateIndex
CREATE UNIQUE INDEX "AccountTopUp_clientId_key" ON "AccountTopUp"("clientId");

-- CreateIndex
CREATE UNIQUE INDEX "Transaction_clientId_key" ON "Transaction"("clientId");

