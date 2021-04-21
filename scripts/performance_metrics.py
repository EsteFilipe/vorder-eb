import json
import sys


def process_results(results):
    pass


def calculate_metrics(results):
    #result_processed = process_results(results)
    return True, results


if __name__ == "__main__":
    rslts = sys.argv[1]
    status, output = calculate_metrics(rslts)

    out = json.dumps({"status": status,
                      "output": output})

    print(out)
    sys.stdout.flush()
