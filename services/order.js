const storageService = require('./storage'),
	  exchangeService = require('./exchange'),
      utils = require('../helpers/utils');


module.exports = function (client, speechCredentials, speechOptions) {

	var speechService = require('./speech')(speechCredentials, speechOptions);

	var OrderService = function() {
		this.client = client;
		this.coins = {BTC: "Bitcoin", ETH: "Ether"};
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

	OrderService.prototype.stopMonitoring = function(data) {
	    storageService.ddbPut({sub: {S: this.client.request.session.cognitoData.idToken.payload.sub},
	            server_timestamp: {S: Date.now().toString()},
	            event_type: {S: 'STOP_MONITORING'},
	            client_timestamp: {S: data.timestamp.toString()}},
	            process.env.EVENTS_TABLE);

	    this.client.request.session.order = -1;
	}

	OrderService.prototype.wakeWordDetected = function(data) {
	    storageService.ddbPut({sub: {S: this.client.request.session.cognitoData.idToken.payload.sub},
	            server_timestamp: {S: Date.now().toString()},
	            event_type: {S: 'WAKE_WORD_DETECTED'},
	            client_timestamp: {S: data.timestamp.toString()}},
	            process.env.EVENTS_TABLE);

	    this.client.request.session.order = -1;
	}

	OrderService.prototype.microphoneError = function(data) {
        storageService.ddbPut({sub: {S: this.client.request.session.cognitoData.idToken.payload.sub},
                server_timestamp: {S: Date.now().toString()},
                event_type: {S: 'MICROPHONE_ERROR_' + data.stage.toUpperCase()},
                client_timestamp: {S: data.timestamp.toString()}},
                process.env.EVENTS_TABLE);

        this.client.request.session.order = -1;
	}

	OrderService.prototype.processOrder = async function(data) {
		const eventType = 'PROCESS_ORDER';
        const clientTimestamp = data.timestamp.toString();
        const fileName = this.client.request.session.cognitoData.idToken.payload.sub + "-" + clientTimestamp + ".wav";
        // Get the dataURL which was sent from the client
        const dataURL = data.audio.dataURL.split(',').pop();
        console.log('-----> DEBUG');
        console.log(dataURL);
        // Convert it to a Buffer
        let fileBuffer = Buffer.from(dataURL, 'base64');

        // Send audio to transcribe and wait for the response
        const orderTranscription = await speechService.speechToText(fileBuffer, "PROCESS");

        //console.log(orderTranscription);

        var status, output;

        this.client.request.session.order = -1;

        if (orderTranscription != "TRANSCRIPTION_ERROR") {

            // Process the order using python script
            const orderProcessingResult = await utils.runPython38Script('order_processing.py', orderTranscription);
            const orderInfo = JSON.parse(orderProcessingResult);

            status = orderInfo.status ? "VALID" : "PROCESSING_ERROR";
            output = JSON.stringify({
                        transcription: orderTranscription,
                        processing: orderInfo.output});

            // Send text result of order processing to client
            this.client.emit('order-processing', JSON.stringify({status: status, output: orderInfo.output}));

            // Get the order description audio data
            if (status == "VALID") {

                // Save order in session variable
                this.client.request.session.order = orderInfo.output;
                
                const order = orderInfo.output;
                const coinName = this.coins[order.ticker];
                
                if (order.type == "market") {
                    orderText = `${order.polarity} ${order.size} ${coinName} at market price.`;
                }                
                else if (order.type == "limit") {
                    orderText = `${order.polarity} ${order.size} ${coinName} at ${order.price} US Dollars.`;
                }
                else if (order.type == "range") {
                    orderText = `${order.polarity} total of ${order.size} ${coinName}, ${order.n_orders} orders equally 
                        distributed between ${order.price_low} and ${order.price_high} US Dollars.`;
                }

                try {
                    const audioArrayBuffer = await speechService.textToSpeech(orderText);
                    this.client.emit('stream-audio-confirm-order', audioArrayBuffer);
                }
                catch (err){
                    console.log(err);
                }
            }
        }

        else {
            status = "TRANSCRIPTION_ERROR";
            output = "There has been a problem transcribing the audio.";

            this.client.emit('order-processing', JSON.stringify({status: status, output: output}));
        }

        storageService.storeProcessingData({
                sub: this.client.request.session.cognitoData.idToken.payload.sub,
                eventType: eventType,
                status: status,
                output: output});

        storageService.storeAudioData({
            sub: this.client.request.session.cognitoData.idToken.payload.sub,
            eventType: eventType,
            fileName: fileName,
            fileBuffer: fileBuffer,
            clientTimestamp: clientTimestamp});
	}

	OrderService.prototype.confirmOrder = async function(data) {
        const orderDetails = this.client.request.session.order;
        const sub = this.client.request.session.cognitoData.idToken.payload.sub;
        const eventType = 'CONFIRM_ORDER';
        const clientTimestamp = data.timestamp.toString();
        const fileName = this.client.request.session.cognitoData.idToken.payload.sub + "-" + clientTimestamp + ".wav";
        // Get the dataURL which was sent from the client
        const dataURL = data.audio.dataURL.split(',').pop();
        // Convert it to a Buffer
        let fileBuffer = Buffer.from(dataURL, 'base64');
        // Send audio to transcribe and wait for the response
        const confirmationTranscription = await speechService.speechToText(fileBuffer, "CONFIRMATION");

        var status, output;

        if (confirmationTranscription != "TRANSCRIPTION_ERROR") {

            const confirmationProcessing = processOrderConfirmation(confirmationTranscription);

            if (confirmationProcessing != "PROCESSING_ERROR") {
                if (confirmationProcessing == "YES") {
                	const keys = await storageService.getAPIKeys(sub, 'binance');

                    if (keys.status == "API_KEY_DEFINED") {
                       // Pass order to the Binance API.
                        const exchangeResponse = await exchangeService.placeOrder({
	            			apiKey: keys.output.api_key,
	            			apiSecret: keys.output.api_secret
	            		}, "binance", true, orderDetails);
                        if (exchangeResponse.status) {
                             status = "ORDER_PLACED";
                             output = "-";
                        }
                        else {
                             status = "ORDER_REJECTED";
                             output = exchangeResponse.output;
                        }
                    }
                    else {
                        status = "UNEXPECTED_ERROR";
                        output = "-";
                    }
                }
                else if (confirmationProcessing == "NO") {
                    status = "ORDER_CANCEL";
                    output = "-";
                }
                // Order resolved. Clean it up
                this.client.request.session.order = -1;
            }
            else {
                status = "PROCESSING_ERROR";
                output = "There has been a problem processing the confirmation. One of the two happened:" +
                 "1) Both words 'yes' and 'no' were found;" +
                 "2) None of the words 'yes' or 'no' were found.";
            }
        }

        else {
            status = "TRANSCRIPTION_ERROR";
            output = "There has been a problem transcribing the audio.";
        }

        this.client.emit('order-confirmation', JSON.stringify({status: status, output: output}));

        storageService.storeProcessingData({
            sub: this.client.request.session.cognitoData.idToken.payload.sub,
            eventType: eventType,
            status: status,
            output: output});

        storageService.storeAudioData({
            sub: this.client.request.session.cognitoData.idToken.payload.sub,
            eventType: eventType,
            fileName: fileName,
            fileBuffer: fileBuffer,
            clientTimestamp: clientTimestamp});

	}

    function processOrderConfirmation(transcription) {
    	const t = transcription.toLowerCase();
		// If both "yes" and "no" were said
	    if (t.includes("yes") && t.includes("no")) {
	    	return "PROCESSING_ERROR";
	    }
	    else {
	    	// If only one of "yes" and "no" was said, check which one.
	        if (t.includes("yes")){
	        	return "YES";
	        }
	        else if (t.includes("no")){
	        	return "NO";
	        }
	        // If nothing from "yes", "no", or "cancel" was said, ask again.
	    	else {
	        	return "PROCESSING_ERROR";
	    	}
	    }
    }



	return new OrderService();

}