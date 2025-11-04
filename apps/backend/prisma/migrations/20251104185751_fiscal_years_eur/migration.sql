-- AlterTable
ALTER TABLE "Article" ALTER COLUMN "unitsPerPurchase" SET DEFAULT 20;

-- CreateTable
CREATE TABLE "FiscalYear" (
    "id" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "startDate" TIMESTAMP(3) NOT NULL,
    "endDate" TIMESTAMP(3) NOT NULL,
    "closed" BOOLEAN NOT NULL DEFAULT false,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "FiscalYear_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "YearEndReport" (
    "id" TEXT NOT NULL,
    "fiscalYearId" TEXT NOT NULL,
    "incomeTotal" DECIMAL(65,30) NOT NULL DEFAULT 0,
    "expensesTotal" DECIMAL(65,30) NOT NULL DEFAULT 0,
    "profit" DECIMAL(65,30) NOT NULL DEFAULT 0,
    "cashOnHand" DECIMAL(65,30) NOT NULL DEFAULT 0,
    "bankAccountsJson" JSONB NOT NULL DEFAULT '[]',
    "guestBalance" DECIMAL(65,30) NOT NULL DEFAULT 0,
    "inventorySystem" JSONB NOT NULL DEFAULT '[]',
    "inventoryPhysical" JSONB NOT NULL DEFAULT '[]',
    "inventoryDiff" JSONB NOT NULL DEFAULT '[]',
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "YearEndReport_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "YearEndReport_fiscalYearId_key" ON "YearEndReport"("fiscalYearId");

-- AddForeignKey
ALTER TABLE "YearEndReport" ADD CONSTRAINT "YearEndReport_fiscalYearId_fkey" FOREIGN KEY ("fiscalYearId") REFERENCES "FiscalYear"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
