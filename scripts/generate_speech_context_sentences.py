from itertools import chain, product
import sys
import json

POLARITY_WORDS = ["buy", "sell"]

TYPE_WORDS = ["limit", "market"]

NUMBER_CLASSES = ["$OOV_CLASS_DIGIT_SEQUENCE",  # separate numbers, e.g. one three five = 135
                  "$OPERAND"  # numbers spelled properly, e.g. one thousand three hundred fifty one = 1351
                  ]

COINS = {"bitcoin": "BTC",
         "ether": "ETH"}


def pad_sequence(
    sequence,
    n,
    pad_left=False,
    pad_right=False,
    left_pad_symbol=None,
    right_pad_symbol=None,
):
    sequence = iter(sequence)
    if pad_left:
        sequence = chain((left_pad_symbol,) * (n - 1), sequence)
    if pad_right:
        sequence = chain(sequence, (right_pad_symbol,) * (n - 1))
    return sequence


def ngrams(
    sequence,
    n,
    pad_left=False,
    pad_right=False,
    left_pad_symbol=None,
    right_pad_symbol=None):

    sequence = pad_sequence(
        sequence, n, pad_left, pad_right, left_pad_symbol, right_pad_symbol
    )

    history = []
    while n > 1:
        # PEP 479, prevent RuntimeError from being raised when StopIteration bubbles out of generator
        try:
            next_item = next(sequence)
        except StopIteration:
            # no more data, terminate the generator
            return
        history.append(next_item)
        n -= 1
    for item in sequence:
        history.append(item)
        yield tuple(history)
        del history[0]


def get_order_expected_sentences(use_bigrams=False):
    # Get all possible speech context variations
    expected_sentences = []

    # Market:
    for bs in POLARITY_WORDS:
        for c in COINS:
            for nc in NUMBER_CLASSES:
                expected_sentences.append("{} {} {} market".format(bs, nc, c))

    # Limit:

    for bs in POLARITY_WORDS:
        for c in COINS:
            for nc in product(NUMBER_CLASSES, repeat=len(NUMBER_CLASSES)):
                expected_sentences.append("{} {} {} limit {}".format(bs, nc[0], c, nc[1]))

    # TODO ADD RANGE

    # Get all the possible bi-grams to improve accuracy as mentioned in
    # https://cloud.google.com/speech-to-text/docs/speech-adaptation
    if use_bigrams:
        bigrams = []
        for s in expected_sentences:
            n_grams = ngrams(sequence=s.split(), n=2)
            for ng in n_grams:
                bigrams.append(" ".join(ng))

        expected_sentences = expected_sentences + bigrams

    return expected_sentences


if __name__ == "__main__":

    use_bigrams = sys.argv[1]
    sentences = get_order_expected_sentences(use_bigrams.lower() == "true")

    out = json.dumps(sentences)

    print(out)
    sys.stdout.flush()