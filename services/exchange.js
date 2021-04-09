// PUT HERE ALL THE METHODS TO INTERACT WITH THE EXCHANGES

const binanceAPI = require('node-binance-api');

module.exports = function () {

	var ExchangeService = function () {

	}


	UserService.prototype.validateAPIKey = async function(apiKey, exchange) {

        if (exchange == 'binance') {

            binance = getExchangeInstance(apiKey, 'binance')
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

    function getExchangeInstance(apiKey, exchange, test) {
        var exchangeInstance;
        if (exchange == 'binance') {
            exchangeInstance = new binanceAPI().options({
                APIKEY: apiKey.apiKey,
                APISECRET: apiKey.apiSecret,
                test: test
            });
        }
        return exchangeInstance;
    }


	return new ExchangeService();

}