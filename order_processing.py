from word2number import w2n
from num2words import num2words as n2w
import more_itertools as mit
import sys

COINS = {"Bitcoin": "BTC",
         "Ether": "ETH"}

BUY_SELL_WORDS = ["buy", "sell"]

TYPE_WORDS = ["limit", "market"]


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
                print("Unexpected: word 'and' was either the first or the last word in the sequence.")
                return False
            else:
                # If the word "and" is between two numbers, successfully consider it as a number
                if all((represents_float(seq[ix_before]), represents_float(seq[ix_after]))):
                    number_indexes.append(i)
                # Else we have an unexpected case where the word "and" isn't connecting two numbers
                else:
                    print("Unexpected: word 'and' was not found between two numbers.")
                    return False
        else:
            continue

    return number_indexes


def order_sanity_check(words):

    if all(("buy" in words, "sell" in words)):
        print("Both 'buy' and 'sell' words were found in the order. Order is incorrect.".format(len(words)))
        return False
    elif all(("market" in words, "limit" in words)):
        print("Both 'market' and 'limit' words were found in the order. Order is incorrect.".format(len(words)))
        return False
    elif all(("market" not in words, "limit" not in words)):
        print("Order type was not found.")
        return False
    else:
        return True


def bypass_sanitize_numbers(words):
    # Process the cases where we can bypass number sanitation

    # Get all the number words in the sequence.
    # Not considering the words "+", "and", and "million" yet. Those will be addressed further below
    number_word_indexes = number_word_indexes_in_sequence(words, consider_and_word=False)

    # If the order already has the expected structure, we can skip sanitation
    # Case 1 to bypass sanitation:
    # - Word in index 3 is "market"
    # - There are 4 words in total in the sequence
    # - There is exactly 1 'number word',
    # - That 'number word' is in index 1
    if all((words[3] == "market", len(words) == 4, len(number_word_indexes) == 1, number_word_indexes == [1])):
        return True
    # Case 2 to bypass sanitation:
    # - Word in index 3 is "limit"
    # - There are 5 words in the sequence
    # - There are 2 'number words'
    # - Those 2 'number words' are in indexes 1 and 4.
    elif all((words[3] == "limit", len(words) == 5, len(number_word_indexes) == 2, number_word_indexes == [1, 4])):
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
                print("Found non-integer before the word 'million' aborting")
                return False
            else:
                words[index-1] = str(int(words[index-1]) * 10 ** 6)
                # Delete the word 'million' from the list
                del words[index]

    # Replace '+' signs and convert them to 'and'
    words = ["and" if w == "+" else w for w in words]

    # Get the indexes of the number words. The word "and" also counts as a number word.
    number_word_indexes = number_word_indexes_in_sequence(words, consider_and_word=True)

    if not number_word_indexes:
        # Something went wrong processing the "and" word part of the number indexes, check
        # `number_word_indexes_in_sequence` for more details
        return False

    # Group the consecutive number word indexes.
    number_word_indexes = [list(group) for group in mit.consecutive_groups(number_word_indexes)]

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
            print("Found more than 1 group of number words for 'market' order, which means order is wrong. Aborting.")
            return False
    elif order_type == "limit":
        if len(number_word_indexes) != 2:
            print("Didn't find 2 group of number words for 'limit' order, which means order is wrong. Aborting.")
            return False

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
                                print("There was a problem converting numbers to words: {}".format(e))
                                return False
                        # Note that we will do nothing with the word "and". Will just append it as is
                        number_words.append(number_word)

                    # Convert all the number words from the current group into a single number
                    number_words = " ".join(number_words)
                    try:
                        number = str(w2n.word_to_num(number_words))
                    except ValueError as e:
                        print("There was a problem converting words to numbers: {}".format(e))
                        return False

                    # Replace that number in the word sequence
                    words[index_group[0]] = number
                    # Delete the other words in front. Won't delete the first element, cause that's the final
                    # number we've just inserted. Also reversing order in the iteration for the deletion.
                    for i in sorted(index_group[1:], reverse=True):
                        del words[i]

                # All other cases, are unexpected. Don't process order.
                else:
                    print("Unexpected number group structure.")
                    return False

    return words


def parse_order(order):

    words = order.lower().split()

    print("Tokenized words: {}".format(words))

    # First make sure that the order fulfills the basic criteria for being valid
    if not order_sanity_check(words):
        return False

    # If basic criteria test was passed, check if it's necessary to sanitize the numbers in the order:
    bypass_sanitize = bypass_sanitize_numbers(words)
    if not bypass_sanitize:
        words = sanitize_numbers_from_google_speech(words)
        # If something went wrong with the sanitation, don't go further
        if not words:
            return False

    # If after the sanitation the order doesn't have either 4 or 5 words, something went wrong. Don't go further
    if len(words) not in (4, 5):
        print("Order must have either 4 or 5 command words. {} words were received instead.".format(len(words)))
        return False

    # If all the previous succeeded the order is now structured as expected. Let's parse it
    parsed_order = {}

    # -- Parse buy/sell
    if any(words[0] == x for x in BUY_SELL_WORDS):
        parsed_order["order_buy_sell"] = words[0]
    else:
        print("First word was not either buy or sell")
        return False

    # -- Parse size
    try:
        parsed_order["order_size"] = float(words[1])
    except ValueError as e:
        print("Second word was not a number convertible to float (order size)")
        print(e)
        return False

    # -- Parse ticker
    if any(words[2] == x.lower() for x in COINS):
        # Coin names in COINS have first letter as upper-case, to pass as context to
        # Google Speech. So let's change the first letter here to upper case as well
        # to look in the dictionary
        coin_name = words[2].title()
        parsed_order["order_ticker"] = COINS[coin_name]
    else:
        print("Third word was not a valid ticker")
        return False

    # -- Parse type
    if any(words[3] == x for x in TYPE_WORDS):
        parsed_order["order_type"] = words[3]
    else:
        print("Fourth word was not a valid type")
        return False

    # Only check price if type is limit
    if words[3] == "limit":
        # -- Parse price
        try:
            parsed_order["order_price"] = float(words[4])
        except Exception as e:
            print("Fifth word was not a number convertible to float (order price)")
            print(e)
            return False

    # Check that the number of words is correct for the corresponding order type:
    if parsed_order["order_type"] == "limit":
        if len(words) != 5:
            print("Order type 'limit' must have exactly 5 command words. {} words were received instead.".format(len(words)))
            return False
    elif parsed_order["order_type"] == "market":
        if len(words) != 4:
            print("Order type 'market' must have exactly 4 command words. {} words were received instead.".format(len(words)))
            return False

    print("----- Parsed Order -----")
    print(parsed_order)

    return parsed_order


if __name__ == "__main__":
    order_text = sys.argv[1]
    parse_order(order_text)