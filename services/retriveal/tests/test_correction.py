from correction import correct_answer


def test_correct_answer_uses_nonblank_supporting_facts():
    result = correct_answer(
        original_question="What is Neon?",
        flagged_answer="Neon is a NoSQL database.",
        facts=[
            {"text": "Neon is a PostgreSQL service.", "source": "docs"},
            {"text": "  "},
            "not a fact",
        ],
    )

    assert result == {
        "corrected_answer": (
            "Answer based on retrieved evidence: Neon is a PostgreSQL service."
        ),
        "used_facts": [
            {"text": "Neon is a PostgreSQL service.", "source": "docs"}
        ],
    }


def test_correct_answer_without_valid_facts_returns_safe_message():
    result = correct_answer(
        original_question="What is Neon?",
        flagged_answer="Unknown",
        facts=[{"text": "  "}, None],
    )

    assert result == {
        "corrected_answer": (
            "Unable to correct the answer reliably "
            "because no supporting facts were found."
        ),
        "used_facts": [],
    }


def test_correct_answer_defaults_missing_source():
    result = correct_answer(
        original_question="What is Neon?",
        flagged_answer="Unknown",
        facts=[{"text": "Neon is a PostgreSQL service."}],
    )

    assert result["used_facts"] == [
        {"text": "Neon is a PostgreSQL service.", "source": "unknown"}
    ]
