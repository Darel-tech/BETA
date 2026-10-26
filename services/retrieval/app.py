
from fastapi import FastAPI
from pydantic import BaseModel, Field

from retrieve import retrieve_knowledge
from correction import correct_answer

app = FastAPI(
    title="BETA Knowledge Store API",
    description="Retrieve knowledge and prepare evidence-based corrections.",
    version="1.0.0",
)


class RetrieveRequest(BaseModel):
    query: str
    entities: list[str] = Field(default_factory=list)
    k: int = Field(default=5, ge=1, le=20)


class CorrectRequest(BaseModel):
    original_question: str
    flagged_answer: str
    facts: list[dict] = Field(default_factory=list)


@app.get("/health")
def health():
    return {
        "status": "healthy",
        "service": "BETA Retrieval API",
    }


@app.post("/retrieve")
def retrieve(request: RetrieveRequest):
    facts = retrieve_knowledge(
        query=request.query,
        k=request.k,
    )

    return {
        "facts": facts,
        "latency_ms": None,
    }


@app.post("/correct")
def correct(request: CorrectRequest):
    result = correct_answer(
        original_question=request.original_question,
        flagged_answer=request.flagged_answer,
        facts=request.facts,
    )

    return result
