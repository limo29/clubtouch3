-- CreateTable
CREATE TABLE "CashCount" (
    "id" TEXT NOT NULL,
    "countedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "denominations" JSONB NOT NULL,
    "countedTotal" DECIMAL(10,2) NOT NULL,
    "expectedTotal" DECIMAL(10,2) NOT NULL,
    "difference" DECIMAL(10,2) NOT NULL,
    "note" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "userId" TEXT NOT NULL,
    "previousCountId" TEXT,

    CONSTRAINT "CashCount_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "CashCount_countedAt_idx" ON "CashCount"("countedAt");

-- AddForeignKey
ALTER TABLE "CashCount" ADD CONSTRAINT "CashCount_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "CashCount" ADD CONSTRAINT "CashCount_previousCountId_fkey" FOREIGN KEY ("previousCountId") REFERENCES "CashCount"("id") ON DELETE SET NULL ON UPDATE CASCADE;
