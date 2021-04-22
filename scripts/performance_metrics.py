import json
import sys
import pandas as pd
import numpy as np
import datetime
import os
import pprint
import errno
from tabulate import tabulate

pd.set_option('display.max_columns', None)  # or 1000
pd.set_option('display.max_rows', None)  # or 1000
pd.set_option('display.max_colwidth', None)  # or 199

order_types = ['market', 'limit', 'range']
index_names = order_types + ['overall']


def calculate_accuracy(results):

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
                          'order_processing_result': order_processing_result,
                          'order_transcription': order_transcription}
            wrong_cases.append(wrong_case)

    accuracy = correct_counts.div(total_counts)

    return accuracy, wrong_cases


def write_log(config, results, accuracy, wrong_cases):
    logs_path = os.path.abspath(os.path.dirname(os.path.abspath(__file__)) + '/../logs')
    file_name = "accuracy_{}.txt".format(datetime.datetime.now(datetime.timezone.utc).strftime("%Y-%m-%dT%H:%M:%S"))
    file_path = logs_path + '/' + file_name

    # Create log folder if it doesn't already exist
    if not os.path.exists(logs_path):
        try:
            os.makedirs(logs_path)
        except OSError as exc: # Guard against race condition
            if exc.errno != errno.EEXIST:
                raise

    output_config = pprint.pformat(config)
    output_wrong_cases = pprint.pformat(wrong_cases)
    output_results = pprint.pformat(results)

    h = list(map('\n'.join, accuracy.columns.tolist()))
    output_accuracy = tabulate(accuracy, headers=h, tablefmt='grid', floatfmt=".2f")

    with open(file_path, 'w+') as file:
        file.write("----> CONFIG\n\n")
        file.write(output_config)
        file.write("\n\n----> ACCURACY\n\n")
        file.write(output_accuracy)
        file.write("\n\n----> WRONG CASES\n\n")
        file.write(output_wrong_cases)
        file.write("\n\n----> RESULTS\n\n")
        file.write(output_results)


if __name__ == "__main__":

    data =  '{"config":{"encoding":"LINEAR16","sampleRate":16000,"contextsConf":null,"adaptations":{"create":true,"override":true,"configuration":{"customClasses":[{"customClassId":"order-polarity","items":[{"value":"buy"},{"value":"sell"}]},{"customClassId":"coins","items":[{"value":"bitcoin"},{"value":"ether"}]},{"customClassId":"order-type","items":[{"value":"market"},{"value":"limit"},{"value":"range"}]},{"customClassId":"range-bounds-words","items":[{"value":"low"},{"value":"high"}]},{"customClassId":"confirmation","items":[{"value":"yes"},{"value":"no"}]}],"phraseSets":[{"phraseSetId":"process","phrases":[{"value":"${order-polarity}","boost":20},{"value":"${coins}","boost":20},{"value":"${order-type}","boost":20},{"value":"${range-bounds-words}","boost":20},{"value":"$OOV_CLASS_DIGIT_SEQUENCE","boost":20},{"value":"$OPERAND","boost":20}]},{"phraseSetId":"confirmation","phrases":[{"value":"${confirmation}","boost":20}],"boost":20}]}}},"results":[{"orderFileDetails":{"voiceName":"en-US-Wavenet-A","speakingRate":"1.0","pitch":"0.5","orderResult":{"polarity":"sell","size":3.355,"ticker":"BTC","type":"market"}},"orderTranscription":"sell 3.3 5 5 Bitcoin Market","orderProcessingResult":{"type":"market","polarity":"sell","size":3.355,"ticker":"BTC"}},{"orderFileDetails":{"voiceName":"en-US-Wavenet-B","speakingRate":"1.0","pitch":"0.2","orderResult":{"polarity":"buy","size":0.0175,"ticker":"ETH","type":"limit","price":82212.6}},"orderTranscription":"buy 0.0 1 7 5 ether limit 80 2200 12.6","orderProcessingResult":{"type":"limit","polarity":"buy","size":0.0175,"ticker":"ETH","price":82212.6}},{"orderFileDetails":{"voiceName":"en-US-Wavenet-J","speakingRate":"0.7","pitch":"0.2","orderResult":{"polarity":"buy","size":7.52,"ticker":"BTC","type":"range","n_orders":58,"price_low":59985,"price_high":75644.9651}},"orderTranscription":"buy 7.5 2 Bitcoin range 58 low 50 9980 5 high 70 5600 44.9 6 5 1","orderProcessingResult":{"type":"range","polarity":"buy","size":7.52,"ticker":"BTC","n_orders":58,"price_low":59985,"price_high":75644.9651}}]}'
    data = json.loads(data)

    #data = json.loads(sys.argv[1])

    conf = data['config']
    rslts = data['results']

    acc, wc = calculate_accuracy(rslts)
    # Write log to logs/
    write_log(conf, rslts, acc, wc)

    # Output only the overall accuracy metrics
    output = {'{}_accuracy'.format(k): acc.loc[k, ('overall', 'overall')] for k in index_names}
    out = json.dumps(output)

    print(out)
    sys.stdout.flush()
