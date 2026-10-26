from fastapi import APIRouter, Depends

from app.api.deps import check_rate_limit, get_correction_service, verify_internal_api_key
from app.schemas import CorrectRequest, CorrectResponse
from app.services.correction_service import CorrectionService

router = APIRouter(tags=["Correction"])


@router.post(
    "/correct",
    response_model=CorrectResponse,
    dependencies=[Depends(verify_internal_api_key), Depends(check_rate_limit)],
    summary="Generate a source-grounded factual correction for a flagged response",
)
async def correct_answer(
    body: CorrectRequest,
    service: CorrectionService = Depends(get_correction_service),
) -> CorrectResponse:
    return await service.correct(
        original_question=body.original_question,
        flagged_answer=body.flagged_answer,
        facts=body.facts,
    )
