const storageService = require('../services/storage'),
	  utils = require('../helpers/utils');


function processFileName(fileName) {
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
	    	const expectedOrderResult = processFileName(fileName);
	    	console.log(fileName);

	    	// Download audio file
	    	const fileData = await storageService.s3Get('vorder-data', fileKey);
	    	// Transcribe and process transcription
			const orderTranscription = await speechService.speechToText(fileData.output.Body, "PROCESS");
	    	const orderProcessingResult = await utils.runPython38Script('order_processing.py', orderTranscription);
            const orderInfo = JSON.parse(orderProcessingResult);
            const orderResult = orderInfo.output;
            console.log(orderResult);
            // Compare obtained to expected
	    }

	}

    return new OrderProcessingTest();

}