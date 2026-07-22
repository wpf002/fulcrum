-- CreateEnum
CREATE TYPE "OwnerType" AS ENUM ('OWNER_OCCUPIED', 'ABSENTEE', 'ENTITY');

-- CreateEnum
CREATE TYPE "PropertyEventType" AS ENUM ('SALE', 'REFINANCE', 'LIEN', 'NOD_PREFORECLOSURE', 'PROBATE', 'DIVORCE_FILING', 'PERMIT', 'CODE_VIOLATION', 'TAX_DELINQUENT', 'LISTING');

-- CreateEnum
CREATE TYPE "MatchStatus" AS ENUM ('SURFACED', 'CONTACTED', 'DISMISSED', 'CONVERTED');

-- CreateEnum
CREATE TYPE "ResolutionStatus" AS ENUM ('RESOLVED', 'QUARANTINED');

-- CreateTable
CREATE TABLE "Property" (
    "id" TEXT NOT NULL,
    "apn" TEXT NOT NULL,
    "fips" TEXT NOT NULL,
    "addressLine1" TEXT NOT NULL,
    "addressLine2" TEXT,
    "city" TEXT NOT NULL,
    "state" TEXT NOT NULL,
    "zip" TEXT NOT NULL,
    "lat" DOUBLE PRECISION,
    "lng" DOUBLE PRECISION,
    "geohash" TEXT,
    "beds" INTEGER,
    "baths" DOUBLE PRECISION,
    "sqftLiving" INTEGER,
    "sqftLot" INTEGER,
    "yearBuilt" INTEGER,
    "propertyType" TEXT,
    "ownerName" TEXT,
    "ownerType" "OwnerType",
    "lastSaleDate" TIMESTAMP(3),
    "lastSalePriceCents" BIGINT,
    "ownershipTenureMonths" INTEGER,
    "assessedValueCents" BIGINT,
    "avmEstimateCents" BIGINT,
    "mortgageOriginationDate" TIMESTAMP(3),
    "mortgageAmountCents" BIGINT,
    "mortgageLender" TEXT,
    "resolutionStatus" "ResolutionStatus" NOT NULL DEFAULT 'RESOLVED',
    "resolutionConfidence" DOUBLE PRECISION,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "Property_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "PropertyEvent" (
    "id" TEXT NOT NULL,
    "propertyId" TEXT NOT NULL,
    "type" "PropertyEventType" NOT NULL,
    "occurredAt" TIMESTAMP(3) NOT NULL,
    "source" TEXT NOT NULL,
    "sourceRef" TEXT,
    "payload" JSONB,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "PropertyEvent_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "SellerScore" (
    "id" TEXT NOT NULL,
    "propertyId" TEXT NOT NULL,
    "probabilityListMonths" DOUBLE PRECISION NOT NULL,
    "score" INTEGER NOT NULL,
    "velocity" DOUBLE PRECISION NOT NULL DEFAULT 0,
    "factors" JSONB NOT NULL,
    "modelVersion" TEXT NOT NULL,
    "computedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "SellerScore_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Agent" (
    "id" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "email" TEXT NOT NULL,
    "brandConfig" JSONB,
    "subscriptionTier" TEXT NOT NULL DEFAULT 'trial',
    "territories" JSONB NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "Agent_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Consent" (
    "id" TEXT NOT NULL,
    "termsVersion" TEXT NOT NULL,
    "capturedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "ip" TEXT NOT NULL,
    "toolSource" TEXT NOT NULL,
    "channelOptIns" JSONB NOT NULL,

    CONSTRAINT "Consent_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "BuyerLead" (
    "id" TEXT NOT NULL,
    "agentId" TEXT NOT NULL,
    "consentId" TEXT NOT NULL,
    "firstName" TEXT,
    "lastName" TEXT,
    "email" TEXT,
    "phone" TEXT,
    "priceBandMinCents" BIGINT,
    "priceBandMaxCents" BIGINT,
    "targetGeographies" TEXT[],
    "minBeds" INTEGER,
    "minBaths" DOUBLE PRECISION,
    "propertyType" TEXT,
    "mustHaves" JSONB,
    "affordabilityResultCents" BIGINT,
    "mortgageReadinessAnswers" JSONB,
    "timelineMonths" INTEGER,
    "readinessScore" INTEGER NOT NULL DEFAULT 0,
    "readinessVelocity" DOUBLE PRECISION NOT NULL DEFAULT 0,
    "source" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "BuyerLead_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Match" (
    "id" TEXT NOT NULL,
    "agentId" TEXT NOT NULL,
    "buyerLeadId" TEXT NOT NULL,
    "propertyId" TEXT NOT NULL,
    "matchScore" DOUBLE PRECISION NOT NULL,
    "factors" JSONB NOT NULL,
    "status" "MatchStatus" NOT NULL DEFAULT 'SURFACED',
    "surfacedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "Match_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Outcome" (
    "id" TEXT NOT NULL,
    "propertyId" TEXT NOT NULL,
    "soldAt" TIMESTAMP(3) NOT NULL,
    "salePriceCents" BIGINT NOT NULL,
    "source" TEXT NOT NULL,
    "viaTrackedBuyer" BOOLEAN NOT NULL DEFAULT false,
    "trackedBuyerLeadId" TEXT,
    "predictedSellerScoreId" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "Outcome_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "Property_zip_idx" ON "Property"("zip");

-- CreateIndex
CREATE INDEX "Property_geohash_idx" ON "Property"("geohash");

-- CreateIndex
CREATE INDEX "Property_state_city_idx" ON "Property"("state", "city");

-- CreateIndex
CREATE UNIQUE INDEX "Property_fips_apn_key" ON "Property"("fips", "apn");

-- CreateIndex
CREATE INDEX "PropertyEvent_propertyId_occurredAt_idx" ON "PropertyEvent"("propertyId", "occurredAt");

-- CreateIndex
CREATE INDEX "PropertyEvent_type_occurredAt_idx" ON "PropertyEvent"("type", "occurredAt");

-- CreateIndex
CREATE INDEX "SellerScore_propertyId_computedAt_idx" ON "SellerScore"("propertyId", "computedAt");

-- CreateIndex
CREATE INDEX "SellerScore_score_idx" ON "SellerScore"("score");

-- CreateIndex
CREATE UNIQUE INDEX "Agent_email_key" ON "Agent"("email");

-- CreateIndex
CREATE UNIQUE INDEX "BuyerLead_consentId_key" ON "BuyerLead"("consentId");

-- CreateIndex
CREATE INDEX "BuyerLead_agentId_createdAt_idx" ON "BuyerLead"("agentId", "createdAt");

-- CreateIndex
CREATE INDEX "BuyerLead_readinessScore_idx" ON "BuyerLead"("readinessScore");

-- CreateIndex
CREATE INDEX "Match_agentId_status_matchScore_idx" ON "Match"("agentId", "status", "matchScore");

-- CreateIndex
CREATE UNIQUE INDEX "Match_buyerLeadId_propertyId_key" ON "Match"("buyerLeadId", "propertyId");

-- CreateIndex
CREATE INDEX "Outcome_propertyId_soldAt_idx" ON "Outcome"("propertyId", "soldAt");

-- AddForeignKey
ALTER TABLE "PropertyEvent" ADD CONSTRAINT "PropertyEvent_propertyId_fkey" FOREIGN KEY ("propertyId") REFERENCES "Property"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "SellerScore" ADD CONSTRAINT "SellerScore_propertyId_fkey" FOREIGN KEY ("propertyId") REFERENCES "Property"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "BuyerLead" ADD CONSTRAINT "BuyerLead_agentId_fkey" FOREIGN KEY ("agentId") REFERENCES "Agent"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "BuyerLead" ADD CONSTRAINT "BuyerLead_consentId_fkey" FOREIGN KEY ("consentId") REFERENCES "Consent"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Match" ADD CONSTRAINT "Match_agentId_fkey" FOREIGN KEY ("agentId") REFERENCES "Agent"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Match" ADD CONSTRAINT "Match_buyerLeadId_fkey" FOREIGN KEY ("buyerLeadId") REFERENCES "BuyerLead"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Match" ADD CONSTRAINT "Match_propertyId_fkey" FOREIGN KEY ("propertyId") REFERENCES "Property"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Outcome" ADD CONSTRAINT "Outcome_propertyId_fkey" FOREIGN KEY ("propertyId") REFERENCES "Property"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Outcome" ADD CONSTRAINT "Outcome_trackedBuyerLeadId_fkey" FOREIGN KEY ("trackedBuyerLeadId") REFERENCES "BuyerLead"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Outcome" ADD CONSTRAINT "Outcome_predictedSellerScoreId_fkey" FOREIGN KEY ("predictedSellerScoreId") REFERENCES "SellerScore"("id") ON DELETE SET NULL ON UPDATE CASCADE;
