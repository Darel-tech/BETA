from fastapi import APIRouter, Depends

from app.api.deps import check_rate_limit, get_retrieval_service, verify_internal_api_key
from app.schemas import RetrieveRequest, RetrieveResponse
from app.services.retrieval_service import RetrievalService

router = APIRouter(tags=["Retrieval"])


@router.post(
    "/retrieve",
    response_model=RetrieveResponse,
    dependencies=[Depends(verify_internal_api_key), Depends(check_rate_limit)],
    summary="Retrieve reference facts matching query via cosine similarity",
)
async def retrieve_facts(
    body: RetrieveRequest,
    service: RetrievalService = Depends(get_retrieval_service),
) -> RetrieveResponse:
    return await service.retrieve(
        query=body.query,
        entities=body.entities,
        k=body.k,
    )
