
def correct_answer(
    original_question: str,
    flagged_answer: str,
    facts: list[dict]
) -> dict:
    """
    Prepare an answer using retrieved evidence.
    Do not invent facts that are not supported by the evidence.
    """

    valid_facts = [
        fact for fact in facts
        if isinstance(fact, dict)
        and isinstance(fact.get("text"), str)
        and fact["text"].strip()
    ]

    if not valid_facts:
        return {
            "corrected_answer": (
                "Unable to correct the answer reliably "
                "because no supporting facts were found."
            ),
            "used_facts": []
        }

    evidence = " ".join(
        fact["text"].strip()
        for fact in valid_facts
    )

    used_facts = [
        {
            "text": fact["text"].strip(),
            "source": fact.get("source", "unknown")
        }
        for fact in valid_facts
    ]

    corrected_answer = (
        "Answer based on retrieved evidence: " + evidence
    )

    return {
        "corrected_answer": corrected_answer,
        "used_facts": used_facts
    }


if __name__ == "__main__":
    question = "What is Neon?"
    flagged_answer = "Neon is a NoSQL database."

    facts = [
        {
            "text": (
                "Neon is a cloud-hosted PostgreSQL database service."
            ),
            "source": "beta_sample"
        }
    ]

    result = correct_answer(
        original_question=question,
        flagged_answer=flagged_answer,
        facts=facts
    )

    print("Original question:", question)
    print("Flagged answer:", flagged_answer)
    print("Correction result:", result["corrected_answer"])
    print("Facts used:", result["used_facts"])
