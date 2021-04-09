const storageService = require('storage'),
	  exchangeService = require('exchange');


module.exports = function (dependencies) {

	var OrderService = function() {
		this.client = dependencies.client;
		this.serverCredentials = dependencies.serverCredentials;
	}

	OrderService.prototype.startMonitoring = async function(data) {
		const sub = this.client.request.session.cognitoData.idToken.payload.sub;
	    var status;
	    // Only allow if user has valid API key stored
	    const binanceAPIKey = await getBinanceAPIKey(sub);

	    if (binanceAPIKey.status == "API_KEY_DEFINED") {
	        const key = binanceAPIKey.output;
	        const hasValidAPIKey = await validateBinanceAPIKey(key.api_key, key.api_secret);
	        if (hasValidAPIKey) {
	            status = "SUCCESS";
	            client.emit('start-monitoring', {status: true, output: ""});
	        }
	        else {
	            status = "API_KEY_INVALID";
	            client.emit('start-monitoring', {status: false, output: "Invalid API key"});
	        }
	    }
	    else {
	        status = "API_KEY_UNDEFINED";
	        client.emit('start-monitoring', {status: false, output: "Undefined API key."});
	    }

	    // TODO register errors
	    ddbPut({sub: {S: client.request.session.cognitoData.idToken.payload.sub},
	            server_timestamp: {S: Date.now().toString()},
	            status: {S: status},
	            event_type: {S: 'START_MONITORING'},
	            client_timestamp: {S: data.timestamp.toString()}},
	            process.env.EVENTS_TABLE);

	    // Putting this in almost every call to avoid the case where a stale
	    // order stays in memory and then is executed by accident 
	    client.request.session.order = -1;
	}

	return new OrderService();

}