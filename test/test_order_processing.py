"""

This test case will test scripts/order_processing.py with a bunch of possible cases, from orders generated at
random and with real transcriptions from the corresponding audio files from google speech.

Here, the transcription from google speech is not tested - that is done end-do-end in test/order-processing.js.

This script simply tests the text processing after the transcription has already been made, and evaluates whether
the obtained processing corresponds to the expected.

"""

from unittest import TestCase
from os import getcwd, path
import sys
import json
from operator import itemgetter

# Add scripts directory to path
cwd = getcwd()
scripts_path = path.abspath(cwd + '/../scripts')
sys.path.append(scripts_path)
from order_processing import process

TESTDATA_FILENAME = './data/test_cases_order_processing_py.json'


class OrderProcessingTest(TestCase):

    def setUp(self):
        with open(TESTDATA_FILENAME, 'r') as f:
            self.testdata = json.load(f)

    def test_order_processing(self):

        for o in self.testdata:
            order_expected = o['orderFileDetails']['orderResult']
            order_result_previous = o['orderProcessingResult']
            order_transcription = o['orderTranscription']

            _, order_result = process(order_transcription)

            if order_result['type'] == 'range':
                del[order_result['range_values']]

            self.assertEqual(order_expected, order_result,
                             msg='-> Expected: {}\n\n'
                                 'Transcription: {}\n'
                                 'Current Result: {}\n'
                                 'Previous Result: {}'.format(order_expected, order_transcription, order_result, order_result_previous))