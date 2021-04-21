const storageService = require('../services/storage'),
	  utils = require('../helpers/utils');


function processFileName(fileName) {
	const components = fileName.split('_');

	// Process metadata
	const voiceName = components[0];
	var speakingRate = components[1];
	speakingRate = speakingRate.split('-')
	speakingRate = speakingRate[speakingRate.length - 1];
	var pitch = components[2];
	pitch = pitch.split('-')
	pitch = pitch[pitch.length - 1];
	// Process order details
	var order = components[components.length - 1]
	order = order.substr(0, order.lastIndexOf('.'));
	order = order.split('-')

	var ticker;
	if (order[2] == 'bitcoin') {
		ticker = 'BTC';
	}
	else if (order[2] == 'ether') {
		ticker = 'ETH';
	}

	var orderResult = {
		polarity: order[0],
		size: Number(order[1]),
		ticker: ticker,
		type: order[3]
	}

	if (orderResult.type == 'limit') {
		orderResult.price = Number(order[4]);
	}
	else if (orderResult.type == 'range') {
		orderResult.n_orders = Number(order[4]);
		orderResult.price_low = Number(order[6]);
		orderResult.price_high = Number(order[8]);
	}

	return {
		voiceName: voiceName,
		speakingRate: speakingRate,
		pitch: pitch,
		orderResult: orderResult
	}
}

function calculatePerformanceMetrics(data) {
	const x = 0;
}

module.exports = function(config) {

    const speechService = require('../services/speech')([
        config.server.credentials['google-service-account-key-1'],
        config.server.credentials['google-service-account-key-2']],
        config.speech
    )

	var OrderProcessingTest = function() {
		this.name = ''
	}

	OrderProcessingTest.prototype.test = async function () {

	    // List all files in bucket folder
	    const s3List = await storageService.s3ListAll('vorder-data', 'test/voice-orders/');
	    const filesInfo = s3List.output.Contents;
	    // Remove first element, because it's just info about the parent folder
	    filesInfo.shift()

	    var results = [];

	    // Iterate through each file
	    for (const f of filesInfo) {
	    	const fileKey = f.Key;
	    	var fileName = fileKey.split("/"); 
	    	fileName = fileName[fileName.length - 1];

	 		// Get expected order result from the file name
	    	const orderFileDetails = processFileName(fileName);

	    	console.log('---> orderFileDetails')
	    	console.log(orderFileDetails);

	    	// Download audio file
	    	const fileData = await storageService.s3Get('vorder-data', fileKey);
	    	// Transcribe and process transcription
			const orderTranscription = await speechService.speechToText(fileData.output.Body, "PROCESS");
	    	const orderProcessingResult = await utils.runPython38Script('order_processing.py', orderTranscription);
            const orderInfo = JSON.parse(orderProcessingResult);
            var orderResult = orderInfo.output;

            // If order is 'range', remove the `range_values` field, because we don't need it for the comparison
            if (orderResult.type == 'range') {
            	delete orderResult.range_values;
            }

            console.log('---> orderResult')
            console.log(orderResult);
            if (orderFileDetails.orderResult === orderResult) {
            	console.log('TRUE')
            }
            else {
            	console.log('FALSE')
            }
            // Compare obtained to expecte
	    }

	    // TODO CALCULATE ACCURACY AND TEST WITH DIFFERENT SETTINGS

	}

    return new OrderProcessingTest();

}