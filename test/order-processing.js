const storageService = require('../services/storage'),
	  utils = require('../helpers/utils');

function downloadFile(fileKey) {

}

function processFileName(fileName) {
	const x = 0;
}

async function processFile() {
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
	    const s3List = await storageService.s3ListAll('vorder-data', 'test/voice-orders/');

	    const filesInfo = s3List.output.Contents;
	    // Remove first element, because it's just info about the parent folder
	    filesInfo.shift()

	    for (const f of filesInfo)
	    	const fileKey = f.Key;
	    	console.log(fileKey);

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