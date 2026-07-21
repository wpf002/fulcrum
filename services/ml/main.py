"""fulcrum-ml: seller model + match scorer.

Contract (see packages/types/src/index.ts):
  POST /score/seller -> P(list within N months) + Factor[] provenance
  POST /score/match  -> criteriaFit x listLikelihood x buyerReadiness
  POST /train/seller -> LightGBM retrain; ships only if precision@top-decile
                        beats the incumbent model on the holdout (kill criteria).
"""

from fastapi import FastAPI
from pydantic import BaseModel

app = FastAPI(title="fulcrum-ml")

MODEL_VERSION = "0.0.0-stub"


class Factor(BaseModel):
    label: str
    weight: float
    direction: str  # "up" | "down"


class SellerScoreRequest(BaseModel):
    propertyId: str


class SellerScoreResponse(BaseModel):
    propertyId: str
    probabilityListMonths: float
    score: int
    velocity: float
    factors: list[Factor]
    modelVersion: str


class MatchScoreRequest(BaseModel):
    buyerLeadId: str
    propertyId: str


class MatchScoreResponse(BaseModel):
    buyerLeadId: str
    propertyId: str
    matchScore: float
    factors: list[Factor]


@app.get("/health")
def health():
    return {"ok": True, "service": "fulcrum-ml", "modelVersion": MODEL_VERSION}


@app.post("/score/seller", response_model=SellerScoreResponse)
def score_seller(req: SellerScoreRequest):
    # Stub until the Phase-0 notebook model is ported here (Phase 3).
    # Real implementation pulls PropertyEvent features from Postgres and
    # runs the versioned LightGBM model.
    return SellerScoreResponse(
        propertyId=req.propertyId,
        probabilityListMonths=0.0,
        score=0,
        velocity=0.0,
        factors=[Factor(label="stub model — no signal", weight=0.0, direction="down")],
        modelVersion=MODEL_VERSION,
    )


@app.post("/score/match", response_model=MatchScoreResponse)
def score_match(req: MatchScoreRequest):
    # matchScore = criteriaFit(geo, price, beds/baths/type)
    #            x listLikelihood x buyerReadiness   (Phase 4)
    return MatchScoreResponse(
        buyerLeadId=req.buyerLeadId,
        propertyId=req.propertyId,
        matchScore=0.0,
        factors=[Factor(label="stub model — no signal", weight=0.0, direction="down")],
    )
