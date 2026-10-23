
import json
import urllib.request
import urllib.error
from pathlib import Path

DATASET_PATH = Path(__file__).parent / "datasets" / "test_questions.json"
API_URL = "http://localhost:3000/api/check"

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

    print(f"Loaded {len(questions)} test questions.\n")

    for item in questions:
        payload = {
            "text": item["answer"],
            "source": item["source"],
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
    "correct": predicted == expected
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
            print(f'Question {item["id"]}: ERROR - {error}\n')

    if evaluated == 0:
        print("No questions were evaluated successfully.")
        print("Check that the API is running and the dataset is valid.")
        return

    # Calculate metrics safely.
    accuracy = correct / evaluated

    precision_denominator = true_positive + false_positive
    recall_denominator = true_positive + false_negative

    precision = (
        true_positive / precision_denominator
        if precision_denominator else 0.0
    )

    recall = (
        true_positive / recall_denominator
        if recall_denominator else 0.0
    )

    f1_denominator = precision + recall
    f1 = (
        2 * precision * recall / f1_denominator
        if f1_denominator else 0.0
    )

    print("=" * 45)
    print(f"Questions evaluated: {evaluated}/{len(questions)}")
    print(f"Correct matches:     {correct}/{evaluated}")
    print(f"Accuracy:            {accuracy:.1%}")
    print()
    print(f"True positives:      {true_positive}")
    print(f"False positives:     {false_positive}")
    print(f"False negatives:     {false_negative}")
    print()
    print(f"Precision:           {precision:.1%}")
    print(f"Recall:              {recall:.1%}")
    print(f"F1 score:            {f1:.1%}")
    print("=" * 45)
    print("Reminder: the API currently returns mock results.")
    print("These metrics do not measure real AI detection performance.")

    RESULTS_DIR.mkdir(parents=True, exist_ok=True)

    benchmark = {
        "questions_evaluated": evaluated,
        "correct_matches": correct,
        "accuracy": accuracy,
        "true_positives": true_positive,
        "false_positives": false_positive,
        "false_negatives": false_negative,
        "precision": precision,
        "recall": recall,
        "f1_score": f1,
        "results": run_results,
        "note": "Mock API results; not real AI detection performance."
    }

    with open(RESULTS_PATH, "w", encoding="utf-8") as file:
        json.dump(benchmark, file, indent=2)

    print(f"\nBenchmark results saved to: {RESULTS_PATH}")

if __name__ == "__main__":
    main()