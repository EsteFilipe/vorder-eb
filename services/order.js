const storageService = require('./storage'),
	  exchangeService = require('./exchange');


module.exports = function (dependencies) {

	var OrderService = function() {
		this.client = dependencies.client;
		this.serverCredentials = dependencies.serverCredentials;
	}

	OrderService.prototype.startMonitoring = async function(data) {
		const sub = this.client.request.session.cognitoData.idToken.payload.sub;
	    var status;
	    // Only allow if user has valid API key stored
	    const keys = await storageService.getAPIKeys(sub, 'binance');

	    if (keys.status == "API_KEY_DEFINED") {
            const hasValidAPIKeys = await exchangeService.validateAPIKeys({
            	apiKey: keys.output.api_key,
            	apiSecret: keys.output.api_secret
            }, 'binance');
	        if (hasValidAPIKeys) {
	            status = "SUCCESS";
	            this.client.emit('start-monitoring', {status: true, output: ""});
	        }
	        else {
	            status = "API_KEY_INVALID";
	            this.client.emit('start-monitoring', {status: false, output: "Invalid API key"});
	        }
	    }
	    else {
	        status = "API_KEY_UNDEFINED";
	        this.client.emit('start-monitoring', {status: false, output: "Undefined API key."});
	    }

	    // TODO register errors
	    storageService.ddbPut({sub: {S: this.client.request.session.cognitoData.idToken.payload.sub},
	            server_timestamp: {S: Date.now().toString()},
	            status: {S: status},
	            event_type: {S: 'START_MONITORING'},
	            client_timestamp: {S: data.timestamp.toString()}},
	            process.env.EVENTS_TABLE);

	    // Putting this in almost every call to avoid the case where a stale
	    // order stays in memory and then is executed by accident 
	    this.client.request.session.order = -1;
	}

	return new OrderService();

}