// PUT HERE ALL THE METHODS TO INTERACT WITH THE EXCHANGES

const binanceAPI = require('node-binance-api');

var ExchangeService = function () {
    this.fiatSymbol = 'USDT';
}

ExchangeService.prototype.validateAPIKeys = async function(keys, exchange) {

    if (exchange == 'binance') {

        binance = getExchangeInstance(keys, 'binance', true)
        // Make an API call just to check if the credentials are valid
        const exchangeResponse = await binance.futuresOpenOrders();

        if ("code" in exchangeResponse) {
            // Invalid API key
            return false;
        }
        else {
            return true;
        }

    }
}

ExchangeService.prototype.placeOrder = async function(keys, exchange, test, orderDetails) {

    const orderSymbol = orderDetails.ticker + this.fiatSymbol;
    // Actual response from the exchange API
    var exchangeResponse;
    // Processed response to pass to the user
    var eResponse = {status: true, output: ''};

    //console.log(orderDetails);

    if (exchange == 'binance') {
        binance = getExchangeInstance(keys, 'binance', test)
        // Set leverage value
        // TODO this doesn't affect the leverage with which the order
        // is placed. Although, when I do refresh on the page, the set leverage
        // on binance updates.
        //await binance.futuresLeverage( 'BTCUSDT', 2 );
        try {
            if (test) {
                if (orderDetails.polarity == 'buy') {
                    if (orderDetails.type == 'market') {
                        exchangeResponse = await binance.futuresMarketBuy(orderSymbol, orderDetails.size);
                    }
                    else if (orderDetails.type == 'limit') {
                        exchangeResponse = await binance.futuresBuy(orderSymbol, orderDetails.size, orderDetails.price);
                    }
                    else if (orderDetails.type == 'range') {
                        // TODO
                        exchangeResponse = 0;
                    }
                }
                else if (orderDetails.polarity == 'sell') {
                    if (orderDetails.type == 'market') {
                        exchangeResponse = await binance.futuresMarketSell(orderSymbol, orderDetails.size);
                    }
                    else if (orderDetails.type == 'limit') {
                        exchangeResponse = await binance.futuresSell(orderSymbol, orderDetails.size, orderDetails.price);
                    }
                    else if (orderDetails.type == 'range') {
                        // TODO
                        exchangeResponse = 0;
                    }
                }
            }
            // Error response objects are of the form {code:<CODE>, msg:<MSG>}
            // Only in the case of error does the response have the fields `code` and `msg`
            if ("code" in exchangeResponse) {
                eResponse = {status: false, output: exchangeResponse.msg}
            }
        }
        catch (err) {
            eResponse = {status: false, output: err}
        }

    }

    return eResponse

}

function getExchangeInstance(keys, exchange, test) {
    var exchangeInstance;
    if (exchange == 'binance') {
        exchangeInstance = new binanceAPI().options({
            APIKEY: keys.apiKey,
            APISECRET: keys.apiSecret,
            test: test
        });
    }
    return exchangeInstance;
}


module.exports = new ExchangeService();

