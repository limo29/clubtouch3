-- AlterEnum
-- Startguthaben aus der Übernahme von Clubtouch 2.0: kein Geldeingang, nicht in Kasse, Bank, EÜR oder Tagesabschluss
ALTER TYPE "TopUpMethod" ADD VALUE 'MIGRATION';
