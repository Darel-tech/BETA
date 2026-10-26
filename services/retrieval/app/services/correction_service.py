import logging
import re
from typing import Any

from app.adapters.llm_client import LLMClient
from app.schemas import CorrectResponse
from app.services.constants import CORRECTION_SYSTEM_PROMPT, CORRECTION_USER_PROMPT_TEMPLATE
from app.services.retrieval_service import RetrievalService

logger = logging.getLogger(__name__)


class CorrectionService:
    """
    Business logic for hallucination correction grounded strictly on retrieved facts.
    """

    def __init__(
        self,
        llm_client: LLMClient,
        retrieval_service: RetrievalService,
    ) -> None:
        self.llm_client = llm_client
        self.retrieval_service = retrieval_service

    def _extract_used_facts(self, completion: str, available_facts: list[str]) -> list[str]:
        """
        Parse fact citations such as [Fact 1] or [Fact 2] from the LLM output,
        validate indices against available facts, and return the unique cited facts.
        """
        cited_indices = set()
        matches = re.findall(r"\[(?:Fact\s*)?(\d+)\]", completion, re.IGNORECASE)
        for m in matches:
            idx = int(m) - 1  # 1-indexed to 0-indexed
            if 0 <= idx < len(available_facts):
                cited_indices.add(idx)

        # Return facts in order of original index
        return [available_facts[i] for i in sorted(cited_indices)]

    async def correct(
        self,
        original_question: str,
        flagged_answer: str,
        facts: list[str] | None = None,
    ) -> CorrectResponse:
        # If facts are omitted, automatically retrieve them via retrieval service
        if facts is None:
            retrieval_resp = await self.retrieval_service.retrieve(
                query=original_question,
                k=5,
            )
            facts = retrieval_resp.facts

        # Filter out empty or whitespace-only facts
        valid_facts = [f.strip() for f in facts if f and f.strip()]

        if not valid_facts:
            return CorrectResponse(
                corrected_answer="Unable to correct reliably: verified facts are insufficient to ground an answer.",
                used_facts=[],
            )

        # Build numbered fact block
        facts_block = "\n".join(f"[Fact {i+1}]: {fact}" for i, fact in enumerate(valid_facts))

        user_prompt = CORRECTION_USER_PROMPT_TEMPLATE.format(
            original_question=original_question.strip(),
            flagged_answer=flagged_answer.strip(),
            facts_block=facts_block,
        )

        try:
            raw_completion = await self.llm_client.complete(
                prompt=user_prompt,
                system_prompt=CORRECTION_SYSTEM_PROMPT,
            )
        except Exception as e:
            logger.error(f"LLM correction invocation failed: {e}")
            return CorrectResponse(
                corrected_answer="Error occurred during answer correction; unable to reach language model.",
                used_facts=[],
            )

        used_facts = self._extract_used_facts(raw_completion, valid_facts)

        # If model didn't explicitly cite using bracket indices but produced a grounded response,
        # detect if any fact substring is present or assign the primary relevant fact.
        if not used_facts and len(valid_facts) == 1:
            if "insufficient" not in raw_completion.lower():
                used_facts = [valid_facts[0]]

        return CorrectResponse(
            corrected_answer=raw_completion,
            used_facts=used_facts,
        )
