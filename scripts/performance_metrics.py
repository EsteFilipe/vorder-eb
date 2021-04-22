import json
import sys
import pandas as pd
import numpy as np
import datetime
import os
import pprint

pd.set_option('display.max_columns', None)  # or 1000
pd.set_option('display.max_rows', None)  # or 1000
pd.set_option('display.max_colwidth', None)  # or 199

order_types = ['market', 'limit', 'range']
index_names = order_types + ['overall']


def calculate_accuracy(results):
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

    mi[0] += ['overall']
    mi[1] += ['overall']

    index = pd.MultiIndex.from_arrays(mi, names=('parameter', 'value'))

    correct_counts = pd.DataFrame(np.zeros((len(index_names), len(mi[1])), dtype=int), index=index_names, columns=index)
    total_counts = pd.DataFrame(np.zeros((len(index_names), len(mi[1])), dtype=int), index=index_names, columns=index)

    wrong_cases = []
    # Iterate through the results and get the counts
    # Also save the wrong cases for debugging
    for r in results:
        order_expected = r['orderFileDetails']['orderResult']
        order_transcription = r['orderTranscription']
        order_processing_result = r['orderProcessingResult']
        order_obtained = r['orderProcessingResult']
        order_type = order_expected['type']

        # Count total
        for p in parameters:
            total_counts.loc[order_type, (p, r['orderFileDetails'][p])] += 1
            total_counts.loc['overall', (p, r['orderFileDetails'][p])] += 1

        total_counts.loc[order_type, ('overall', 'overall')] += 1
        total_counts.loc['overall', ('overall', 'overall')] += 1

        # Count correct
        if order_expected == order_obtained:
            for p in parameters:
                correct_counts.loc[order_type, (p, r['orderFileDetails'][p])] += 1
                correct_counts.loc['overall', (p, r['orderFileDetails'][p])] += 1

            correct_counts.loc[order_type, ('overall', 'overall')] += 1
            correct_counts.loc['overall', ('overall', 'overall')] += 1
        else:
            wrong_case = {'order_expected': order_expected,
                          'order_transcription': order_transcription}
            wrong_cases.append(wrong_case)

    accuracy = correct_counts.div(total_counts)

    return accuracy, wrong_cases


def write_log(config, accuracy, wrong_cases):
    logs_path = os.path.dirname(os.path.abspath(__file__)) + '/../logs/'
    file_name = "accuracy_{}.txt".format(datetime.datetime.now(datetime.timezone.utc).strftime("%Y-%m-%dT%H:%M:%S"))
    file_path = logs_path + file_name

    output_config = pprint.pformat(config)
    output_accuracy = accuracy.to_csv()
    output_wrong_cases = pprint.pformat(wrong_cases)

    with open(file_path, 'w+') as file:
        file.write("----> CONFIG")
        file.write(output_config)
        file.write("\n---------------------------------------")
        file.write("\n----> ACCURACY")
        file.write(output_accuracy)
        file.write("\n---------------------------------------")
        file.write("\n----> WRONG CASES")
        file.write(output_wrong_cases)

if __name__ == "__main__":

    # data = '[{"orderFileDetails":{"voiceName":"en-US-Wavenet-A","speakingRate":"1.0","pitch":"0.5","orderResult":{"polarity":"sell","size":3.355,"ticker":"BTC","type":"market"}},"orderTranscription":"sell 3.3 5 5 Bitcoin Market","orderProcessingResult":{"type":"market","polarity":"sell","size":3.355,"ticker":"BTC"}},{"orderFileDetails":{"voiceName":"en-US-Wavenet-B","speakingRate":"1.0","pitch":"0.2","orderResult":{"polarity":"buy","size":0.0175,"ticker":"ETH","type":"limit","price":82212.6}},"orderTranscription":"buy 0.0 1 7 5 ether limit 80 2200 12.6","orderProcessingResult":{"type":"limit","polarity":"buy","size":0.0175,"ticker":"ETH","price":82212.6}},{"orderFileDetails":{"voiceName":"en-US-Wavenet-J","speakingRate":"0.7","pitch":"0.2","orderResult":{"polarity":"buy","size":7.52,"ticker":"BTC","type":"range","n_orders":58,"price_low":59985,"price_high":75644.9651}},"orderTranscription":"buy 7.5 2 Bitcoin range 58 low 50 9980 5 high 70 5600 44.9 6 5 1","orderProcessingResult":{"type":"range","polarity":"buy","size":7.52,"ticker":"BTC","n_orders":58,"price_low":59985,"price_high":75644.9651}}]'

    data = json.loads(sys.argv[1])

    rslts = data['results']
    conf = data['config']

    acc, wc = calculate_accuracy(rslts)

    # Write log to logs/
    write_log(conf, acc, wc)

    # Output only the overall accuracy metrics
    output = {'{}_accuracy'.format(k): acc.loc[k, ('overall', 'overall')] for k in index_names}
    out = json.dumps(output)

    print(out)
    sys.stdout.flush()
