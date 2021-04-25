from word2numberi18n import w2n  # Using this fork because of this bug https://github.com/akshaynagpal/w2n/issues/54
from num2words import num2words as n2w
import more_itertools as mit
import numpy as np
import sys
import json
import re
import os

os.environ['w2n.lang'] = 'en'

COINS = {"bitcoin": "BTC",
         "ether": "ETH"}

POLARITY_WORDS = ["buy", "sell"]

TYPE_WORDS = ["limit", "market", "range"]

# Matches any number with more than one decimal place - real floats, integers are not matched
float_re = re.compile(r'^[0-9]*(\.[0-9]+)$')


def represents_int(s):
    try:
        int(s)
        return True
    except ValueError:
        return False


def represents_float(s):
    try:
        float(s)
        return True
    except ValueError:
        return False


# Split every single number after `x.x` pattern has been found, where x is a single digit
# Doing this to avoid any confusion in the decimal part of the number when converting to words
def split_all_numbers_after_first_decimal(number_words):

    # We're doing changes in place and want to do a comparison afterwards with the original, so let's copy
    number_words = number_words.copy()

    split_idx = -1
    for i, nw in enumerate(number_words):
        if float_re.match(nw):
            split_idx = i
            break

    # If decimal was found
    if split_idx != -1:
        # Note -> "x"  can represent any number of digits

        # Index in the word where the point is located
        point_idx = number_words[split_idx].find('.')
        # Number of decimal places (in the number word that contains the point)
        number_decimal_places = len(number_words[split_idx][point_idx + 1:])

        # First number word is ".x"
        if split_idx == 0:
            if point_idx == 0:
                # -> Add 0 at the beginning
                number_words[split_idx] = '0' + number_words[split_idx]
                # Move floating point one place to the right
                point_idx += 1

        # If more than one decimal place, split and join the rest of the numbers the following word number
        if number_decimal_places > 1:
            # If the decimal number is the last number in the sequence, append another
            # number word to put the rest of the decimal places
            if split_idx == len(number_words) - 1:
                number_words.append('')
            # Add the remaining numbers of the decimal number to the beginning of the following number word
            number_words[split_idx + 1] = number_words[split_idx][point_idx + 2:] + number_words[split_idx + 1]
            # Truncate the decimal number to only one decimal place
            number_words[split_idx] = number_words[split_idx][:point_idx + 2]

        # If decimal number is in the form ".d" where d is a single digit (and in this case will have
        # to be either in the middle or end of the sequence), join it to the previous number word
        if point_idx == 0:
            assert split_idx != 0
            number_words[split_idx - 1] = number_words[split_idx - 1] + number_words[split_idx]
            # Delete point something and move split index 1 element to the left
            del number_words[split_idx]
            split_idx -= 1

        # After these transformations we wont have anymore:
        # 1. Decimals in the form ".x"
        # 2. Decimals with more than one decimal place

        # Merge all the number words at the right of first decimal, then split them all
        right_of_first_decimal = [x for x in ''.join(number_words[split_idx + 1:])]
        del number_words[split_idx+1:]
        number_words += right_of_first_decimal

    return number_words


def number_word_indexes_in_sequence(seq, group, consider_and_word):
    number_indexes = []
    for i, s in enumerate(seq):

        if represents_float(s):
            # If word is convertible to float, append index to list
            number_indexes.append(i)
        # If the word is "and", and is between two numbers, we also consider it as a number word
        elif consider_and_word and s == "and":

            ix_before = i - 1
            ix_after = i + 1

            if any((ix_before < 0, ix_after > len(seq)-1)):
                return False, "Unexpected: word 'and' was either the first or the last word in the sequence."
            else:
                # If the word "and" is between two numbers, successfully consider it as a number
                if all((represents_float(seq[ix_before]), represents_float(seq[ix_after]))):
                    number_indexes.append(i)
                # Else we have an unexpected case where the word "and" isn't connecting two numbers
                else:
                    return False, "Unexpected: word 'and' was not found between two numbers."
        else:
            continue

    if group:
        number_indexes = [list(g) for g in mit.consecutive_groups(number_indexes)]

    return True, number_indexes


def order_basic_criteria_check(words):

    if all([w in words for w in POLARITY_WORDS]):
        return False, "Both 'buy' and 'sell' words were found in the order. Order is incorrect."
    elif sum([w in words for w in TYPE_WORDS]) > 1:
        return False, "Only one order type ('market', 'limit', or 'range') per order is allowed. Order is incorrect."
    elif sum([w in words for w in TYPE_WORDS]) == 0:
        return False, "Order type ('market', 'limit', or 'range') not found."
    else:
        return True, ""


def bypass_sanitize_numbers(words):
    # Process the cases where we can bypass number sanitation

    # Get all the number words in the sequence.
    # Not considering the words "+", "and", and "million" yet. Those will be addressed further below
    nw_indexes_status, nw_indexes_output = number_word_indexes_in_sequence(words, group=False, consider_and_word=False)

    # If there was an error getting the number word indexes, the order will fail down the line. But pass it
    # to the sanitation function anyways
    if not nw_indexes_status:
        return False
    # Else, check if we can bypass sanitation or not
    else:
        # If the order already has the expected structure, we can skip sanitation
        # Case 1 to bypass sanitation:
        # - There are 4 words in total in the sequence (first check to avoid index out of range)
        # - Word in index 3 is "market"
        # - There is exactly 1 'number word',
        # - That 'number word' is in index 1
        if len(words) == 4:
            if all((words[3] == "market", len(nw_indexes_output) == 1, nw_indexes_output == [1])):
                return True
        # Case 2 to bypass sanitation:
        # - There are 5 words in the sequence (first check to avoid index out of range)
        # - Word in index 3 is "limit"
        # - There are 2 'number words'
        # - Those 2 'number words' are in indexes 1 and 4.
        elif len(words) == 5:
            if all((words[3] == "limit", len(nw_indexes_output) == 2, nw_indexes_output == [1, 4])):
                return True
        # Case 3 to bypass sanitation:
        # - There are 9 words in the sequence (first check to avoid index out of range)
        # - Word in index 3 is "range", word in index 6 is "low", and word in index 8 is "high"
        # - There are 4 'number words'
        # - Those 4 'number words' are in indexes 1, 4, 6, and 8
        elif len(words) == 9:
            if all((words[3] == "range", words[5] == "low", words[7] == "high",
                    len(nw_indexes_output) == 4, nw_indexes_output == [1, 4, 6, 8])):
                return True
        else:
            # ---- For all other cases, sanitize, because there's something atypical with the numbers ----
            return False


def sanitize_numbers_from_google_speech(words):
    """
    Google Speech fragments long numbers. For example
    "sell 0.21654 bitcoin market"
    is interpreted as ['sell', '0.21', '654', 'bitcoin', 'market']
    and
    "buy 1.1 bitcoin limit 31301"
    is interpreted as ['buy', '1.1', 'bitcoin', 'limit', '30', '1301']

    I didn't find any way to force google speech to always return single numbers without splitting them,
    so this method is to fix that flaw.

    # Conclusion: If we read the results out loud that are given by the speech api they always make sense
    # so the most elegant solution is to convert the numbers into words, and then convert all those 'number words'
    # back into digits.
    """

    # First, address the exception for the word "million".
    # For example 1,001,341 is interpreted as  ['1', 'million', '1341']
    # Get indexes of the word "million"
    million_word_indexes = [i for i in range(len(words)) if words[i] == "million"]
    if million_word_indexes:
        # Make sure that before the word million there's an int
        # We are going in reverse order cause we'll have to delete indexes. To avoid throwing off the subsequent indexes
        # case there's more than one 'million' word. Note that I haven't seen all cases, and it's possible that this
        # screws up somewhere.
        for index in sorted(million_word_indexes, reverse=True):
            if not represents_int(words[index-1]):
                return False, "Found non-integer before the word 'million' aborting"
            else:
                words[index-1] = str(int(words[index-1]) * 10 ** 6)
                # Delete the word 'million' from the list
                del words[index]

    # If the word "and" appears, remove it. It makes no difference for the numbers
    for index in sorted(range(len(words)), reverse=True):
        if words[index] == 'and':
            del words[index]

    # Get the indexes of the number words (already chunked together in groups).
    # The word "and" also used to count as a number word, but now I'm removing it beforehand, so no need to consider it
    nw_indexes_status, number_word_indexes = number_word_indexes_in_sequence(words, group=True, consider_and_word=False)
    if not nw_indexes_status:
        return False, "Something went wrong processing the the number indexes (1): {}".format(number_word_indexes)

    # Reformat the number words in a way that the method num2words -> word2number will always work
    for index_group in sorted(number_word_indexes, reverse=True):
        number_words = [words[i] for i in index_group]
        split_number_words = split_all_numbers_after_first_decimal(number_words)

        if split_number_words != number_words:
            idx_first_number_word = index_group[0]
            idx_last_number_word = index_group[-1]
            # Words at the left of the number group in the original sequence
            left_words = words[:idx_first_number_word]
            # Words at the right of the number group in the original sequence
            right_words = words[idx_last_number_word+1:]
            # Replace the new number words
            words = left_words + split_number_words + right_words

    # Get the new number word indexes
    nw_indexes_status, number_word_indexes = number_word_indexes_in_sequence(words, group=True, consider_and_word=False)
    if not nw_indexes_status:
        return False, "Something went wrong processing the the number indexes (2): {}".format(number_word_indexes)

    # Check whether we have a 'market', 'limit', or 'range' order
    # Already made sure in `order_sanity_check` that one, and only one, of those types is present in the order.
    order_type = ""
    if "market" in words:
        order_type = "market"
    elif "limit" in words:
        order_type = "limit"
    elif "range" in words:
        order_type = "range"
    # It really shouldn't get into the `else` because previous sanity check was already done for this.
    # If it does, there's something very wrong
    else:
        return False, "Unexpected: Order type ('market', 'limit', or 'range') not found."

    # Check if the number of groups in `number_word_indexes` makes sense according to the order type
    if order_type == "market":
        if len(number_word_indexes) != 1:
            return False, "Found more than 1 group of number words for 'market' order, which means order is wrong. Aborting."
    elif order_type == "limit":
        if len(number_word_indexes) != 2:
            return False, "Didn't find 2 groups of number words for 'limit' order, which means order is wrong. Aborting."
    elif order_type == "range":
        if len(number_word_indexes) != 4:
            return False, "Didn't find 4 groups of number words for 'range' order, which means order is wrong. Aborting."

    # If all the tests above passed, let's proceed to sanitize the numbers
    # Again reverse the order of the indexes, because we'll have to delete elements in the original list
    for index_group in sorted(number_word_indexes, reverse=True):
        # Sanitation is only needed if there's more than one number word in the group
        if len(index_group) > 1:
            number_words = []
            for i in index_group:
                number_word = words[i]
                # Convert the number to words and remove the comma that sometimes n2w inserts
                try:
                    number_word = n2w(number_word).replace(",", "")
                except Exception as e:
                    return False, "There was a problem converting numbers to words: {}".format(e)
                # Note that we will do nothing with the word "and". Will just append it as is
                number_words.append(number_word)

            # Convert all the number words from the current group into a single number
            number_words = " ".join(number_words)
            try:
                number = str(w2n.word_to_num(number_words))
            except ValueError as e:
                return False, "There was a problem converting words to numbers: {}".format(e)

            # Replace that number in the word sequence
            words[index_group[0]] = number
            # Delete the other words in front. Won't delete the first element, cause that's the final
            # number we've just inserted. Also reversing order in the iteration for the deletion.
            for i in sorted(index_group[1:], reverse=True):
                del words[i]

    # If all succeeded, return the sanitized order
    return True, words


def remove_unwanted_chars(text):

    # Remove everything except alphanumeric chars, spaces, and '.'
    txt = re.sub(r'[^A-Za-z0-9. ]+', ' ', text)

    # Remove any potential multiple consecutive spaces generated by the previous replacement
    txt = re.sub(' +', ' ', txt)

    # Remove any leading / trailing spaces
    txt = txt.strip()

    return txt


def parse_order(order):

    order = remove_unwanted_chars(order)

    words = order.lower().split()

    basic_criteria_status, basic_criteria_output = order_basic_criteria_check(words)

    # First make sure that the order fulfills the basic criteria for being valid
    if not basic_criteria_status:
        return basic_criteria_status, basic_criteria_output

    # If basic criteria test was passed, check if it's necessary to sanitize the numbers in the order:
    bypass_sanitize = bypass_sanitize_numbers(words)
    if not bypass_sanitize:
        sanitation_status, sanitation_output = sanitize_numbers_from_google_speech(words)
        # If something went wrong with the sanitation, don't go further
        if not sanitation_status:
            return sanitation_status, sanitation_output
        # Else, the order words to process come from the output of the sanitation method
        else:
            words = sanitation_output

    # If after the order doesn't have either 4, 5 or 9 words, something went wrong. Don't go further
    if len(words) not in (4, 5, 9):
        return False, "Order must have either 4, 5 or 9 command words. {} words were received instead.".format(len(words))

    # If all the previous succeeded the order is now structured as expected. Let's parse it
    parsed_order = {}

    # -- Parse type
    if any(words[3] == x for x in TYPE_WORDS):
        parsed_order["type"] = words[3]
    else:
        return False, "Fourth word was not a valid type (market, limit or range)"

    # Check some specifities for each order type to post-sanity-check the processing
    if parsed_order["type"] == "market":
        if len(words) != 4:
            return False, "Order type 'market' must have exactly 4 command words. {} words were received instead.".format(len(words))
    elif parsed_order["type"] == "limit":
        if len(words) != 5:
            return False, "Order type 'limit' must have exactly 5 command words. {} words were received instead.".format(len(words))
    elif parsed_order["type"] == "range":
        if len(words) != 9:
            return False, "Order type 'range' must have exactly 9 command words. {} words were received instead.".format(len(words))
        if words[5] != 'low':
            return False, "Range order: word is index 6 was not 'low'."
        if words[7] != 'high':
            return False, "Range order: word is index 8 was not 'high'."

    # -- Parse buy/sell
    if any(words[0] == x for x in POLARITY_WORDS):
        parsed_order["polarity"] = words[0]
    else:
        return False, "First word was not either buy or sell"

    # -- Parse size
    try:
        parsed_order["size"] = float(words[1])
    except ValueError as e:
        return False, "Second word was not a number convertible to float (order size). Error message: {}".format(e)

    # -- Parse ticker
    if any(words[2] == x for x in COINS):
        #coin_name = words[2].title()
        parsed_order["ticker"] = COINS[words[2]]
    else:
        return False, "Third word was not a valid coin (bitcoin or ether)"

    # Only check prices if type is limit or range
    if parsed_order["type"] == "limit":
        # -- Parse price
        try:
            parsed_order["price"] = float(words[4])
        except Exception as e:
            return False, "Limit order, fifth word was not a number convertible to float (order price). Error message: {}".format(e)

    if parsed_order["type"] == "range":
        # -- Parse number of orders and range prices
        try:
            parsed_order["n_orders"] = int(words[4])
            parsed_order["price_low"] = float(words[6])
            parsed_order["price_high"] = float(words[8])
            if parsed_order["price_low"] >= parsed_order["price_high"]:
                return False, "Range order, high bound must be higher than low bound."
        except Exception as e:
            return False, "Range order, there was a problem in number type casting. Error message: {}".format(e)
        # Calculate effective order prices and sizes for each of the individual limit orders
        try:
            parsed_order["range_values"] = {}
            # The size of each limit order
            # Note: if the order size is too small, the exchange API will throw an error, but I won't check that here
            # because the number of decimal places is different for each exchange and coin
            parsed_order["range_values"]["size"] = '%.3f' % (parsed_order["size"] / parsed_order["n_orders"])
            # The prices at which each of the orders will be placed at
            price_range_values = np.linspace(
                parsed_order["price_low"], parsed_order["price_high"], parsed_order["n_orders"])
            # Truncate to 2 decimal places
            price_range_values = ['%.2f' % p for p in price_range_values]
            parsed_order["range_values"]["prices"] = price_range_values
        except Exception as e:
            return False, "Range order, there was a problem calculating order prices. Error message: {}".format(e)

    return True, parsed_order


def test_split_all_numbers_after_first_decimal():
    numbers = [{"in": ".7", "out_expected": "0.7"},
               {"in": ".75", "out_expected": "0.7 5"},
               {"in": ".756", "out_expected": "0.7 5 6"},
               {"in": ".756 1", "out_expected": "0.7 5 6 1"},
               {"in": ".756 125", "out_expected": "0.7 5 6 1 2 5"},
               {"in": "0.7", "out_expected": "0.7"},
               {"in": "0.75", "out_expected": "0.7 5"},
               {"in": "0.756", "out_expected": "0.7 5 6"},
               {"in": "0.756 1", "out_expected": "0.7 5 6 1"},
               {"in": "0.756 125", "out_expected": "0.7 5 6 1 2 5"},
               {"in": "1230 .4", "out_expected": "1230.4"},
               {"in": "1235 .4", "out_expected": "1235.4"},
               {"in": "1235 .0", "out_expected": "1235.0"},
               {"in": "1230 .43", "out_expected": "1230.4 3"},
               {"in": "1235 .4467 14 2", "out_expected": "1235.4 4 6 7 1 4 2"},
               {"in": "1230 3.4", "out_expected": "1230 3.4"},
               {"in": "1230 3.46", "out_expected": "1230 3.4 6"},
               {"in": "1230 3.46 32", "out_expected": "1230 3.4 6 3 2"},
               {"in": "1230 32 21 3.46", "out_expected": "1230 32 21 3.4 6"},
               {"in": "1230 32 21 .46", "out_expected": "1230 32 21.4 6"},
               {"in": "1230 32 21 .0", "out_expected": "1230 32 21.0"},
               {"in": "1230 32 21 .0 34 64 134", "out_expected": "1230 32 21.0 3 4 6 4 1 3 4"},
               {"in": "60850 3.0 6 6 6", "out_expected": "60850 3.0 6 6 6"},
               {"in": "80 1600 30 6.7 0", "out_expected": "80 1600 30 6.7 0"},
               {"in": "70 6870 2.0 9", "out_expected": "70 6870 2.0 9"},
               {"in": "70 6870 .36 9", "out_expected": "70 6870.3 6 9"},
               {"in": "70 6870 0.0 9", "out_expected": "70 6870 0.0 9"},
               {"in": "70 6870 0.3 01", "out_expected": "70 6870 0.3 0 1"}]

    for n in numbers:
        print("Testing: {}".format(n))

        numbers_split = split_all_numbers_after_first_decimal(n['in'].split())

        expected_numbers = n["out_expected"].split()

        print('Out: {}'.format(numbers_split))
        print('Expected: {}'.format(expected_numbers))

        if numbers_split == expected_numbers:
            print("Passed")
        else:
            print("Failed. Obtained numbers: {}".format(numbers_split))

        print()


def process(order_text):

    #order_text = "sell 10.79 ether range 35 low 60850 3.05 6 6 6 high 80 1600 30 6.712 0"

    status, output = parse_order(order_text)

    if __name__ == "__main__":
        out = json.dumps({"status": status,
                          "output": output})

        print(out)
        sys.stdout.flush()
    else:
        return status, output


if __name__ == "__main__":

    inpt = sys.argv[1]

    process(inpt)




