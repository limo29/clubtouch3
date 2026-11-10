-- AlterTable
ALTER TABLE "CashCount" ADD COLUMN     "isOpening" BOOLEAN NOT NULL DEFAULT false;

-- CreateTable
CREATE TABLE "BankBalance" (
    "id" TEXT NOT NULL,
    "date" TIMESTAMP(3) NOT NULL,
    "isOpening" BOOLEAN NOT NULL DEFAULT false,
    "accountsJson" JSONB NOT NULL DEFAULT '[]',
    "total" DECIMAL(10,2) NOT NULL,
    "note" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "userId" TEXT NOT NULL,

    CONSTRAINT "BankBalance_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "BankBalance_date_idx" ON "BankBalance"("date");

-- AddForeignKey
ALTER TABLE "BankBalance" ADD CONSTRAINT "BankBalance_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

