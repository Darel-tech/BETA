from unittest.mock import Mock, patch

from retrieve import retrieve_knowledge


def test_retrieve_returns_mapped_facts_and_passes_limit():
    expected_row = (
        6,
        "An API allows software applications to communicate.",
        "beta_sample",
        "api",
        0.768,
    )

    embedding = Mock()
    embedding.tolist.return_value = [0.1, 0.2]
    with patch("retrieve.model.encode", return_value=embedding):
        with patch("retrieve.psycopg.connect") as mock_connect:
            connection = mock_connect.return_value.__enter__.return_value
            cursor = connection.cursor.return_value.__enter__.return_value
            cursor.fetchall.return_value = [expected_row]

            results = retrieve_knowledge("What is an API?", k=5)

    assert results == [
        {
            "id": 6,
            "text": "An API allows software applications to communicate.",
            "source": "beta_sample",
            "entity_tag": "api",
            "similarity": 0.768,
        }
    ]
    assert cursor.execute.call_args.args[1][2] == 5


def test_retrieve_returns_empty_list_when_no_facts_match():
    embedding = Mock()
    embedding.tolist.return_value = [0.1, 0.2]
    with patch("retrieve.model.encode", return_value=embedding):
        with patch("retrieve.psycopg.connect") as mock_connect:
            connection = mock_connect.return_value.__enter__.return_value
            cursor = connection.cursor.return_value.__enter__.return_value
            cursor.fetchall.return_value = []

            results = retrieve_knowledge("Unknown question", k=5)

    assert results == []