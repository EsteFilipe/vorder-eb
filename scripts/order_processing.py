from word2number import w2n
from num2words import num2words as n2w
import more_itertools as mit
import sys
import json
import re

COINS = {"Bitcoin": "BTC",
         "Ether": "ETH"}

BUY_SELL_WORDS = ["buy", "sell"]

TYPE_WORDS = ["limit", "market"]

WORDS_REPLACE = {"buy": ["by"]}


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


def number_word_indexes_in_sequence(seq, consider_and_word):
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

    return True, number_indexes


def order_basic_criteria_check(words):

    if all(("buy" in words, "sell" in words)):
        return False, "Both 'buy' and 'sell' words were found in the order. Order is incorrect.".format(len(words))
    elif all(("market" in words, "limit" in words)):
        return False, "Both 'market' and 'limit' words were found in the order. Order is incorrect.".format(len(words))
    elif all(("market" not in words, "limit" not in words)):
        return False, "Order type ('market' or 'limit') not found."
    else:
        return True, ""


def bypass_sanitize_numbers(words):
    # Process the cases where we can bypass number sanitation

    # Get all the number words in the sequence.
    # Not considering the words "+", "and", and "million" yet. Those will be addressed further below
    nw_indexes_status, nw_indexes_output = number_word_indexes_in_sequence(words, consider_and_word=False)

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
        else:
            # ---- For all other cases, sanitize, because there's something wrong atypical with the numbers ----
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

    Examples (first number said out loud, second result returned by the speech API):
    31,301 -> '30', '1301' (case 1)
    31,361 -> '30', '1361' (case 1)
    31,364 -> '30', '1364' (case 1)
    31,360 -> '30', '1360' (case 1)
    41,523 -> '40', '1523' : (case 1)
    31,010 -> '31000', '+', '10' (case 2)
    32,010 -> '32000', '+', '10' (case 2)
    32,012 -> '32000', '+', '12' (case 2)
    41,010 -> '41000', '+', '10' (case 2)
    41,023 -> '41000', '+', '23' (case 2)
    30,012 -> '30000', '+', '12' (case 2)
    60,010 -> '60000', '+', '10' (case 2)
    11,241 -> '11241' (correct) -> my guess is that from 10,000 to 19,999 it will always work except for cases like case 2.
    11,041 ->  '11000', '+', '41' (case 2)
    15,041 -> '15000', '+', '41' (case 2)
    112,051 -> '112000', '+', '51' (case 2)
    21,051 -> '20', '1051' (case 1)
    101,051 -> '100', '+', '1051' (case 3)
    103,081 -> '100', '+', '3081' (case 3)
    102,071 -> '100', 'and', '2071' (case 3 with 'and' instead of '+')
    102,081 -> '100', 'and', '2081' (case 3 with 'and' instead of '+')
    112,000 -> '112000' (correct)
    112,651 -> '112651' (correct)
    1,001,341 -> '1', 'million', '1341' (case 5)
    1,031,341 -> '1031341' (correct)
    1,931,341 -> '1931341' (correct)
    1,112,051 -> '1112000', '+', '51' (case 2)

    # Conclusions:
    # 1. Every time there is either '+' or 'and' it means that she said 'and'
    # 2. If we read the results out loud that are given by the speech api they always make sense
    # so the most elegant solution is to convert the numbers into words, and then convert all the words
    # that are numbers into digits.
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

    # Replace '+' signs and convert them to 'and'
    words = ["and" if w == "+" else w for w in words]

    # TODO the call to `number_word_indexes_in_sequence` is unnecessarily repeated. It's both here and in
    #   bypass_sanitize_numbers
    # Get the indexes of the number words. The word "and" also counts as a number word.
    nw_indexes_status, nw_indexes_output = number_word_indexes_in_sequence(words, consider_and_word=True)

    if not nw_indexes_status:
        return False, "Something went wrong processing the the number indexes: {}".format(nw_indexes_output)

    # Group the consecutive number word indexes.
    number_word_indexes = [list(group) for group in mit.consecutive_groups(nw_indexes_output)]

    # Check whether we have a 'market' or 'limit' order
    # Already made sure in `order_sanity_check` that one, and only one, of those types is present in the order.
    order_type = ""
    if "market" in words:
        order_type = "market"
    elif "limit" in words:
        order_type = "limit"

    # Check if the number of groups in `number_word_indexes` makes sense according to the order type
    if order_type == "market":
        if len(number_word_indexes) != 1:
            return False, "Found more than 1 group of number words for 'market' order, which means order is wrong. Aborting."
    elif order_type == "limit":
        if len(number_word_indexes) != 2:
            return False, "Didn't find 2 group of number words for 'limit' order, which means order is wrong. Aborting."

    # If all the tests above passed, let's proceed to sanitize the numbers
    # Again reverse the order of the indexes, because we'll have to delete elements in the original list
    for index_group in sorted(number_word_indexes, reverse=True):
        # Sanitation is only needed if there's more than one number word in the group
        if len(index_group) > 1:

            # For number groups we have the following possible cases

            # 1. First number is a decimal (string is something point something), and the following numbers are all ints
            # (I haven't seen any case where there was more than an int after the decimal, but just to be safe)
            if all(["." in words[index_group[0]]] + [represents_int(words[n]) for n in index_group[1:]]):
                number_words = "".join([words[i] for i in index_group])
                # Replace
                words[index_group[0]] = number_words
                # Delete the rest of the number words from the group
                for i in sorted(index_group[1:], reverse=True):
                    del words[i]

            # 2.1
            # - Exactly 2 word numbers in the group
            # - First number is int
            # - Second number is either int or decimal
            #
            # 2.2.
            # - More than 2 word numbers in the group
            # - First number is an int
            # - Last number is an int or a decimal
            # - All the numbers in between are either ints or the word "and".
            else:
                # Check if we have a valid example:
                valid = False

                # Case 2.1
                # Note: if we get something strange like "3 5" from Google Speech it will pass through
                # For the specific example with "3 5", it will give 8. I won't go through those cases for now.
                if all([len(index_group) == 2,
                        represents_int(words[index_group[0]]),
                        represents_float(words[index_group[1]])]):  # represents_float returns True for int and float
                    valid = True

                # Case 2.2
                elif all([len(index_group) > 2,
                          represents_int(words[index_group[0]]),
                          represents_float(words[index_group[-1]]),  # RepresentsFloat returns True both for int and float
                          all([represents_int(n) or n == "and" for n in index_group[1:-1]])]):
                    valid = True

                # Only proceed if valid
                if valid:
                    number_words = []
                    for i in index_group:
                        number_word = words[i]
                        # If the number word is not an "and", convert it to words
                        if number_word != "and":
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

                # All other cases, are unexpected. Don't process order.
                else:
                    return False, "Unexpected number group structure."

    # If all succeeded, return the sanitized order
    return True, words


def remove_unwanted_chars(text):

    # Remove everything except alphanumeric chars, spaces, '+', and '.'
    txt = re.sub(r'[^A-Za-z0-9+. ]+', '', text)

    # Remove any potential multiple consecutive spaces generated by the previous replacement
    txt = re.sub(' +', ' ', txt)

    # Remove any leading / trailing spaces
    txt = txt.strip()

    return txt

def word_replacement(words)
    # TODO
    pass

def parse_order(order):

    order = remove_unwanted_chars(order)

    words = order.lower().split()

    words = word_replacement(words)

    #print("Tokenized words: {}".format(words))

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

    # If after the order doesn't have either 4 or 5 words, something went wrong. Don't go further
    if len(words) not in (4, 5):
        return False, "Order must have either 4 or 5 command words. {} words were received instead.".format(len(words))

    # If all the previous succeeded the order is now structured as expected. Let's parse it
    parsed_order = {}

    # -- Parse buy/sell
    if any(words[0] == x for x in BUY_SELL_WORDS):
        parsed_order["polarity"] = words[0]
    else:
        return False, "First word was not either buy or sell"

    # -- Parse size
    try:
        parsed_order["size"] = float(words[1])
    except ValueError as e:
        return False, "Second word was not a number convertible to float (order size). Error message: {}".format(e)

    # -- Parse ticker
    if any(words[2] == x.lower() for x in COINS):
        # Coin names in COINS have first letter as upper-case, to pass as context to
        # Google Speech. So let's change the first letter here to upper case as well
        # to look in the dictionary
        coin_name = words[2].title()
        parsed_order["ticker"] = COINS[coin_name]
    else:
        return False, "Third word was not a valid ticker"

    # -- Parse type
    if any(words[3] == x for x in TYPE_WORDS):
        parsed_order["type"] = words[3]
    else:
        return False, "Fourth word was not a valid type"

    # Only check price if type is limit
    if words[3] == "limit":
        # -- Parse price
        try:
            parsed_order["price"] = float(words[4])
        except Exception as e:
            return False, "Fifth word was not a number convertible to float (order price). Error message: {}".format(e)

    # Check that the number of words is correct for the corresponding order type:
    if parsed_order["type"] == "limit":
        if len(words) != 5:
            return False, "Order type 'limit' must have exactly 5 command words. {} words were received instead.".format(len(words))
    elif parsed_order["type"] == "market":
        if len(words) != 4:
            return False, "Order type 'market' must have exactly 4 command words. {} words were received instead.".format(len(words))

    return True, parsed_order


def test_sanitize_numbers_from_google_speech():
    orders = [{"in": "buy 1.1 bitcoin limit 30 1301", "out_expected": "buy 1.1 bitcoin limit 31301"},
              {"in": "buy 1.1 bitcoin limit 40 1523", "out_expected": "buy 1.1 bitcoin limit 41523"},
              {"in": "buy 1.1 bitcoin limit 11241", "out_expected": "buy 1.1 bitcoin limit 11241"},
              {"in": "buy 1.1 bitcoin limit 20 1051", "out_expected": "buy 1.1 bitcoin limit 21051"},
              {"in": "buy 1.1 bitcoin limit 100 + 1051", "out_expected": "buy 1.1 bitcoin limit 101051"},
              {"in": "buy 1.1 bitcoin limit 112000", "out_expected": "buy 1.1 bitcoin limit 112000"},
              {"in": "buy 1.1 bitcoin limit 1 million 1341", "out_expected": "buy 1.1 bitcoin limit 1001341"},
              {"in": "buy 1.1 bitcoin limit 1031341", "out_expected": "buy 1.1 bitcoin limit 1031341"},
              {"in": "buy 1.1 bitcoin limit 1112000 + 51", "out_expected": "buy 1.1 bitcoin limit 1112051"},
              {"in": "buy 3 million 415 bitcoin limit 2 million 1341", "out_expected": "buy 3000415 bitcoin limit 2001341"},
              {"in": "buy 0.23 314 bitcoin limit 1", "out_expected": "buy 0.23314 bitcoin limit 1"},
              {"in": "buy 0.23 314 bitcoin limit 30 1301", "out_expected": "buy 0.23314 bitcoin limit 31301"},
              {"in": "buy 0.23 314 bitcoin limit 30 million 1301", "out_expected": "buy 0.23314 bitcoin limit 30001301"},
              {"in": "buy 0.23 314 987 bitcoin limit 30 1301", "out_expected": "buy 0.23314987 bitcoin limit 31301"},
              {"in": "buy 0.23 314 987 bitcoin limit 100 + 1301", "out_expected": "buy 0.23314987 bitcoin limit 101301"},
              {"in": "sell 0.21 654 bitcoin market", "out_expected": "sell 0.21654 bitcoin market"},
              {"in": "buy 0.1 ether limit 1000", "out_expected": "buy 0.1 ether limit 1000"},
              {"in": "buy 7 ether limit 1500", "out_expected": "buy 7 ether limit 1500"},
              {"in": "sell 3 ether limit 1904", "out_expected": "sell 3 ether limit 1904"},
              {"in": "sell 3 ether limit 1000 41.4", "out_expected": "sell 3 ether limit 1041.4"},
              # unexpected cases
              {"in": "sell 3.0 31.1 ether limit 1904", "out_expected": ""},
              # TODO these two will pass through. didn't remove examples like these. will do so when I have a clearer
              #  idea of all the possible cases returned by Google Speech
              {"in": "sell 3 31.1 ether limit 1904", "out_expected": ""},
              {"in": "sell 3 5 ether limit 1904", "out_expected": ""}]

    for o in orders:
        print("Testing: {}".format(o))
        status_, output_ = sanitize_numbers_from_google_speech(o['in'].split(" "))

        if status_:
            expected_words = o["out_expected"].split(" ")

            if output_ == expected_words:
                print("Passed")
            else:
                print("Failed. Obtained words: {}".format(output_))
        else:
            print("Obtained False. Error: {}".format(output_))


if __name__ == "__main__":
    # Note: sanitize_numbers_from_google_speech doesn't use the removal of unwanted characters
    # which is dealth with by remove_unwanted_chars(), so to test the real output, we will need
    # to make test cases for the output from parse_order() instead.
    #test_sanitize_numbers_from_google_speech()
    #print(parse_order("buy 0.23 314 bitcoin limit 30 1301"))

    order_text = sys.argv[1]
    status, output = parse_order(order_text)

    out = json.dumps({"status": status,
                      "output": output})

    print(out)
    sys.stdout.flush()
