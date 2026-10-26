-- AlterTable
ALTER TABLE "PurchaseDocument" ADD COLUMN     "enteredBy" TEXT;

-- Bestehende Belege: Name des Benutzerkontos, mit dem sie angelegt wurden
UPDATE "PurchaseDocument" p SET "enteredBy" = u."name" FROM "User" u WHERE p."userId" = u."id";
