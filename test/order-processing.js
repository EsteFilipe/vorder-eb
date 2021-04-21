const storageService = require('../services/storage'),
	  utils = require('../helpers/utils');


function processFileName(fileName) {
	const components = fileName.split('_');

	// Process metadata
	const voiceName = fileName[0];
	var speakingRate = fileName[1];
	speakingRate = speakingRate.split('-')
	speakingRate = speakingRate[speakingRate.length - 1];
	var pitch = fileName[2];
	pitch = pitch.split('-')
	pitch = pitch[pitch.length - 1];
	// Process order details
	var order = fileName[0].substr(0, fileName[0].lastIndexOf('.'));
	order = order.split('-')

	var ticker;
	if (order[2] == 'bitcoin') {
		ticker = 'BTC';
	}
	else if (order[2] == 'ether') {
		ticker = 'ETH';
	}

	orderResult = {
		polarity: order[0],
		size: order[1],
		ticker: ticker,
		type: order[3]
	}

	else if (orderResult.type == 'limit') {
		orderResult.price = order[4];
	}
	else if (orderResult.type == 'range') {
		orderResult.n_orders = order[4];
		orderResult.price_low = order[6];
		orderResult.price_high = order[8];
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
            // Compare obtained to expected
	    }

	    // TODO CALCULATE ACCURACY AND TEST WITH DIFFERENT SETTINGS

	}

    return new OrderProcessingTest();

}