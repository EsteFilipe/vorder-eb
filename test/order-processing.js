/*

This test case will download all the audio files from the target S3 bucket,
transcribe everything, process the file names to infer what the expected order details are, and then
compare the obtained order processing with the expected order processing.

In the end, it will compute the accuracy metrics of the system and output them to a log file in logs/

*/

const _ = require('lodash'),
	  storageService = require('../services/storage'),
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

		console.log('Calculating order speech processing performance metrics...')
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

	    	// Download audio file
	    	const fileData = await storageService.s3Get('vorder-data', fileKey);
	 		// Get expected order result from the file name
	    	const orderFileDetails = processFileName(fileName);
	    	// Transcribe and process transcription
			const orderTranscription = await speechService.speechToText(fileData.output.Body, "PROCESS");
	    	var orderProcessingResult = await utils.runPython38Script('order_processing.py', orderTranscription);
            orderProcessingResult = JSON.parse(orderProcessingResult).output;

            // TODO DEBUG
            console.log('--> FILE DETAILS: ' + JSON.stringify(orderFileDetails))
            console.log('--> TRANSCRIPTION: ' + orderTranscription)
            console.log('--> PROCESSING RESULT: ' + JSON.stringify(orderProcessingResult))
            // TODO DEBUG


            // If order is 'range', remove the `range_values` field, because we don't need it for the comparison
            if (orderProcessingResult.type == 'range') {
            	delete orderProcessingResult.range_values;
            }

            results.push({
            	orderFileDetails: orderFileDetails,
            	orderTranscription: orderTranscription,
            	orderProcessingResult: orderProcessingResult
            });

	    }

    	// This script prints a log file to logs/ with configuration and full metrics
		const accuracy = await utils.runPython38Script(
		'performance_metrics.py', JSON.stringify({config: config.speech.stt, results: results}));
		
    	console.log('Detailed accuracy metrics printed to `logs/` folder')
    	console.log()
    	console.log('---> Global Accuracy results:')
    	console.log(accuracy)

	    return 0;

	}

    return new OrderProcessingTest();

}