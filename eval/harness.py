
import json
import os
import urllib.request
import urllib.error
from pathlib import Path
from datetime import datetime, timezone

DATASET_PATH = Path(__file__).parent / "datasets" / "test_questions.json"
API_URL = os.environ.get("BETA_CHECK_API_URL", "http://localhost:3000/api/check")

RESULTS_DIR = Path(__file__).parent / "results"
RESULTS_PATH = RESULTS_DIR / "benchmark_results.json"

# We treat needs_correction as the positive class.
POSITIVE_LABEL = "needs_correction"


def main():
    with open(DATASET_PATH, "r", encoding="utf-8") as file:
        questions = json.load(file)

    correct = 0
    evaluated = 0

    run_results = []

    true_positive = 0
    false_positive = 0
    false_negative = 0
    true_negative = 0
    errors = 0

    print(f"Loaded {len(questions)} test questions.\n")

    for item in questions:
        payload = {
            "text": item["answer"],
            "source": item["source"],
            "question": item["question"],
        }

        request = urllib.request.Request(
            API_URL,
            data=json.dumps(payload).encode("utf-8"),
            headers={"Content-Type": "application/json"},
            method="POST",
        )

        try:
            with urllib.request.urlopen(request, timeout=15) as response:
                result = json.loads(response.read().decode("utf-8"))

            predicted = result["verdict"]
            expected = item["expected"]
            run_results.append({
                "id": item["id"],
                "question": item["question"],
                "source": item["source"],
                "expected": expected,
                "predicted": predicted,
                "confidence": result.get("confidence"),
                "latency_ms": result.get("latency_ms"),
                "signals": result.get("signals", {}),
                "evidence": result.get("evidence", []),
                "correct": predicted == expected,
            })

            # Count exact verdict matches.
            is_correct = predicted == expected
            evaluated += 1

            if is_correct:
                correct += 1

            # Calculate counts for the positive class.
            predicted_positive = predicted == POSITIVE_LABEL
            expected_positive = expected == POSITIVE_LABEL

            if predicted_positive and expected_positive:
                true_positive += 1
            elif predicted_positive and not expected_positive:
                false_positive += 1
            elif not predicted_positive and expected_positive:
                false_negative += 1
            elif not predicted_positive and not expected_positive:
                true_negative += 1

            print(f'Question {item["id"]}: {item["question"]}')
            print(f"  Expected:  {expected}")
            print(f"  Predicted: {predicted}")
            print(f"  Match:     {'YES' if is_correct else 'NO'}")
            print()

        except (
            urllib.error.URLError,
            KeyError,
            json.JSONDecodeError,
            TimeoutError,
        ) as error:
            errors += 1
            run_results.append({
                "id": item["id"],
                "question": item["question"],
                "source": item["source"],
                "expected": item["expected"],
                "predicted": None,
                "confidence": None,
                "latency_ms": None,
                "signals": {},
                "evidence": [],
                "correct": False,
                "error": str(error),
            })
            print(f'Question {item["id"]}: ERROR - {error}\n')

    if evaluated == 0:
        print("No questions were evaluated successfully.")
        print("Saving this failed run so the dashboard cannot keep showing an older snapshot.")

    # Calculate metrics safely.
    accuracy = correct / evaluated if evaluated else None

    precision_denominator = true_positive + false_positive
    recall_denominator = true_positive + false_negative

    precision = (
        true_positive / precision_denominator
        if evaluated and precision_denominator else None
    )

    recall = (
        true_positive / recall_denominator
        if evaluated and recall_denominator else None
    )

    f1_denominator = precision + recall if precision is not None and recall is not None else 0.0
    f1 = (
        2 * precision * recall / f1_denominator
        if precision is not None and recall is not None and f1_denominator else None
    )

    print("=" * 45)
    print(f"Questions evaluated: {evaluated}/{len(questions)} ({errors} errors)")
    print(f"Correct matches:     {correct}/{evaluated}")
    print(f"Accuracy:            {accuracy:.1%}" if accuracy is not None else "Accuracy:            unavailable")
    print()
    print(f"True positives:      {true_positive}")
    print(f"False positives:     {false_positive}")
    print(f"False negatives:     {false_negative}")
    print(f"True negatives:      {true_negative}")
    print()
    print(f"Precision:           {precision:.1%}" if precision is not None else "Precision:           unavailable")
    print(f"Recall:              {recall:.1%}" if recall is not None else "Recall:              unavailable")
    print(f"F1 score:            {f1:.1%}" if f1 is not None else "F1 score:            unavailable")
    print("=" * 45)
    print("Metrics summarize this labeled dataset and this run; they are not calibrated probabilities.")

    RESULTS_DIR.mkdir(parents=True, exist_ok=True)

    benchmark = {
        "schema_version": 2,
        "run_at": datetime.now(timezone.utc).isoformat(),
        "attempted": len(questions),
        "errors": errors,
        "questions_evaluated": evaluated,
        "correct_matches": correct,
        "accuracy": accuracy,
        "true_positives": true_positive,
        "false_positives": false_positive,
        "false_negatives": false_negative,
        "true_negatives": true_negative,
        "precision": precision,
        "recall": recall,
        "f1_score": f1,
        "results": run_results,
        "note": "Live API observations over the repository test dataset. Metrics describe this dataset and run; they are not calibrated probabilities or a production accuracy guarantee.",
    }

    with open(RESULTS_PATH, "w", encoding="utf-8") as file:
        json.dump(benchmark, file, indent=2)

    print(f"\nBenchmark results saved to: {RESULTS_PATH}")
    if evaluated == 0:
        raise SystemExit(1)

if __name__ == "__main__":
    main()
