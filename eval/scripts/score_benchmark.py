
import json
from pathlib import Path


def main():
    project_root = Path(__file__).resolve().parents[2]
    results_file = (
        project_root / "eval" / "results" / "benchmark_results.json"
    )

    if not results_file.exists():
        print("Results file not found. Run eval/harness.py first.")
        return

    with results_file.open("r", encoding="utf-8") as file:
        data = json.load(file)

    if (
        data.get("schema_version") != 2
        or not data.get("run_at")
        or "mock" in str(data.get("note", "")).lower()
    ):
        print("Benchmark snapshot is stale, incomplete, or not from a live API run.")
        print("Run eval/harness.py against the live API before scoring results.")
        return

    rows = data.get("results", [])

    if not isinstance(rows, list) or not rows:
        print("No individual predictions found in the results file.")
        return

    positive = "needs_correction"

    total = 0
    correct = 0
    tp = 0
    fp = 0
    fn = 0
    tn = 0

    for row in rows:
        if not isinstance(row, dict):
            continue

        expected = row.get("expected")
        predicted = row.get("predicted")

        if expected not in (
            "trustworthy", "uncertain", "needs_correction"
        ):
            continue

        if predicted not in (
            "trustworthy", "uncertain", "needs_correction"
        ):
            continue

        total += 1

        if expected == predicted:
            correct += 1

        if expected == positive and predicted == positive:
            tp += 1
        elif expected != positive and predicted == positive:
            fp += 1
        elif expected == positive and predicted != positive:
            fn += 1
        elif expected != positive and predicted != positive:
            tn += 1

    if total == 0:
        print("No valid prediction rows found.")
        return

    accuracy = correct / total
    precision = tp / (tp + fp) if tp + fp else 0.0
    recall = tp / (tp + fn) if tp + fn else 0.0
    f1 = (
        2 * precision * recall / (precision + recall)
        if precision + recall else 0.0
    )

    print("\nBETA BENCHMARK SUMMARY")
    print("=" * 35)
    print(f"Questions evaluated: {total}")
    print(f"Correct matches: {correct}")
    print(f"Accuracy: {accuracy:.1%}")
    print(f"True positives: {tp}")
    print(f"False positives: {fp}")
    print(f"False negatives: {fn}")
    print(f"True negatives: {tn}")
    print(f"Precision: {precision:.1%}")
    print(f"Recall: {recall:.1%}")
    print(f"F1 score: {f1:.1%}")
    print("\nMetrics describe the labeled dataset and run; they are not calibrated probabilities.")


if __name__ == "__main__":
    main()
