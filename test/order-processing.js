const storageService = require('../services/storage'),
	  utils = require('../helpers/utils');

function processFileName(fileName) {
	const x = 0;
}

async function processFiles() {
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

	    // Download all files
	    const files = await storageService.s3GetAll('vorder-data', 'test/voice-orders/');

	    console.log(JSON.stringify(files));

	    /*
	    // Process files
	    const pFiles = await processFiles(files)

	    for (f of pFiles) {
		    // Iterate through each file. Obtain result and compare against expected

		    // Send audio to transcribe and wait for the response
			const orderTranscription = await speechService.speechToText(fileBuffer, "PROCESS");

		    // Process the order using python script
		    const orderProcessingResult = await utils.runPython38Script('order_processing.py', orderTranscription);


		    // TODO compare against expected
		    status = orderInfo.status ? "VALID" : "PROCESSING_ERROR";
		    output = JSON.stringify({
		        transcription: orderTranscription,
		        processing: orderInfo.output});
		}
		*/

	}

    return new OrderProcessingTest();

}