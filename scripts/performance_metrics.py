import json
import sys
import pandas as pd
import numpy as np

pd.set_option('display.max_columns', None)  # or 1000
pd.set_option('display.max_rows', None)  # or 1000
pd.set_option('display.max_colwidth', None)  # or 199

order_types = ['market', 'limit', 'range']

def calculate_metrics(results):
    results = json.loads(results)

    # Get the field names of all the the parameters that vary
    parameters = {k: [] for k in results[0]['orderFileDetails'] if k != 'orderResult'}
    # Get the values of all the parameters that vary
    for r in results:
        for p in parameters:
            parameter_value = r['orderFileDetails'][p]
            if parameter_value not in parameters[p]:
                parameters[p].append(parameter_value)
                parameters[p].sort()

    # Get the multi-indexes to build the dataframe
    mi = [[], []]
    for k, v in parameters.items():
        mi[0] += [k] * len(v)
        mi[1] += v

    index = pd.MultiIndex.from_arrays(mi, names=('parameter', 'value'))

    correct_counts = pd.DataFrame(np.zeros((len(order_types), len(mi[1])), dtype=int), index=order_types, columns=index)
    total_counts = pd.DataFrame(np.zeros((len(order_types), len(mi[1])), dtype=int), index=order_types, columns=index)
    accuracy = pd.DataFrame(np.zeros((len(order_types), len(mi[1])), dtype=float), index=order_types, columns=index)

    global_correct = 0
    global_total = 0

    # Iterate through the results and get the counts
    # Also save the wrong cases for debugging
    for r in results:
        order_expected = r['orderFileDetails']['orderResult']
        order_obtained = r['orderProcessingResult']
        order_type = order_expected['type']

        if order_expected == order_obtained:
            global_correct += 1
            for p in parameters:
                correct_counts.loc[order_type, (p, r['orderFileDetails'][p])] += 1

        global_total += 1
        for p in parameters:
            total_counts.loc[order_type, (p, r['orderFileDetails'][p])] += 1

    # TODO calculate separate accuracies by dividing matrix correct_counts by total_counts

    # Calculate the final metrics
    global_accuracy = float(global_correct)/global_total

    return True, metrics


if __name__ == "__main__":
    #rslts = sys.argv[1]

    rslts = '[{"orderFileDetails":{"voiceName":"en-US-Wavenet-A","speakingRate":"1.0","pitch":"0.5","orderResult":{"polarity":"sell","size":3.355,"ticker":"BTC","type":"market"}},"orderTranscription":"sell 3.3 5 5 Bitcoin Market","orderProcessingResult":{"type":"market","polarity":"sell","size":3.355,"ticker":"BTC"}},{"orderFileDetails":{"voiceName":"en-US-Wavenet-B","speakingRate":"1.0","pitch":"0.2","orderResult":{"polarity":"buy","size":0.0175,"ticker":"ETH","type":"limit","price":82212.6}},"orderTranscription":"buy 0.0 1 7 5 ether limit 80 2200 12.6","orderProcessingResult":{"type":"limit","polarity":"buy","size":0.0175,"ticker":"ETH","price":82212.6}},{"orderFileDetails":{"voiceName":"en-US-Wavenet-J","speakingRate":"0.7","pitch":"0.2","orderResult":{"polarity":"buy","size":7.52,"ticker":"BTC","type":"range","n_orders":58,"price_low":59985,"price_high":75644.9651}},"orderTranscription":"buy 7.5 2 Bitcoin range 58 low 50 9980 5 high 70 5600 44.9 6 5 1","orderProcessingResult":{"type":"range","polarity":"buy","size":7.52,"ticker":"BTC","n_orders":58,"price_low":59985,"price_high":75644.9651}}]'
    status, output = calculate_metrics(rslts)

    out = json.dumps({"status": status,
                      "output": output})

    print(out)
    sys.stdout.flush()
