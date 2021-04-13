const speechToText = require('@google-cloud/speech').v1p1beta1,
      textToSpeech = require('@google-cloud/text-to-speech');


module.exports = function (credentials, config) {

    // TODO THIS IS JUST ASYNC FOR TESTING. PUT IT BACK TO SYNC
	var SpeechService = function() {

        // Note: these clients don't start initialized. The first method
        // to be called with them, initializes them. Also possible to use
        // initialize() on them beforehand. Also note that, from my experiments
        // once a client has been initialized with a certain service account,
        // another client can't use that same 
        this.adaptationClient = new speechToText.AdaptationClient({
            credentials: {client_email: credentials[1].client_email,
                          private_key: credentials[1].private_key},
            projectId: credentials[1].project_id
        });

		this.sttClient = new speechToText.SpeechClient({
            credentials: {client_email: credentials[0].client_email,
                          private_key: credentials[0].private_key},
            projectId: credentials[0].project_id
        });

        this.ttsClient = new textToSpeech.TextToSpeechClient({
            credentials: {client_email: credentials[1].client_email,
                          private_key: credentials[1].private_key},
            projectId: credentials[1].project_id
        });

        // TODO DEBUG REMOVE

        this.adaptationClient.initialize()
        console.log('initialized 1')
        this.ttsClient.initialize()
        console.log('initialized 2')
        // TODO REMOVE

		this.sttRequest = {
            config: {
                languageCode: config.languageCode,
                encoding: config.stt.encoding,
                sampleRateHertz: config.stt.sampleRate
            }
        };

        this.ttsRequest = {
            // TODO It's possible to decrease the sampling rate to make the audio file as small as possible
            // Also possible to increase the speakingRate
            audioConfig: {
                audioEncoding: config.tts.encoding, //'LINEAR16|MP3|AUDIO_ENCODING_UNSPECIFIED/OGG_OPUS'
                pitch: config.tts.pitch,
                speakingRate: config.tts.speakingRate
            },
            voice: {
                languageCode: config.languageCode,
                name: config.tts.voiceName,
            },

        };

        this.orderSpeechContexts = config.stt.contexts.order;
        this.confirmationSpeechContexts = config.stt.contexts.confirmation;

	}


    SpeechService.prototype.createCustomClass = async function () {

        const request = {
            parent: 'projects/vorder/locations/global',
            customClassId: 'order-polarity-2',
            customClass: {
                items: [{value: "buy"}, {value: "sell"}]
            }
        }

        const [res] = await this.adaptationClient.createCustomClass(request)

        // Cloning object
        const request = Object.assign({}, this.ttsRequest)
        request.input = { text: 'yeah' }; // text or SSML
        // Performs the Text-to-Speech request
        const response = await this.ttsClient.synthesizeSpeech(request);

        /*
        const request = {
            parent: 'projects/vorder/locations/global/phraseSets',
            phraseSetId: 'test-phrase-set-2',
            phraseSet: {"phrases": [{"value": "ionity", "boost": 10}, {"value": "fionity", "boost": 10}]}
        }

        const [response] = await adaptationClient.createPhraseSet(request)
        */

        //console.log(response)

        //Works, but gives `Error: 5 NOT_FOUND: Resource projects/1030681041480/locations/global/customClasses/order-polarity not found` 
        /*
        const phraseSet = await adaptationClient.getPhraseSet(
            {name: 'projects/vorder/locations/global/phraseSets/test-phrase-set-1'});

        console.log(phraseSet)
        */

        //console.log(customClass)

        //response = await adaptationClient.getProjectId();
        //console.log(response)
    }


    SpeechService.prototype.textToSpeech = async function (text) {
    	// Cloning object
    	const request = Object.assign({}, this.ttsRequest)
        request.input = { text: text }; // text or SSML
        // Performs the Text-to-Speech request
        const response = await this.ttsClient.synthesizeSpeech(request);
        return response[0].audioContent;
    }

    SpeechService.prototype.speechToText = async function (audio, orderStage) {
    	   // Cloning object
    	const request = Object.assign({}, this.sttRequest)
        if (orderStage === "PROCESS") {
        	request.config.speechContexts = this.orderSpeechContexts;

        }
        else if (orderStage === "CONFIRMATION") {
        	request.config.speechContexts = this.confirmationSpeechContexts;
        }

        request.audio = {
            content: audio
        };

        const responses = await this.sttClient.recognize(request);

        var transcription = "TRANSCRIPTION_ERROR";

       	// TODO when `confidence` < threshold, also return N/A
        if(responses[0] && responses[0].results[0] && responses[0].results[0].alternatives[0]) {
        	transcription = responses[0].results[0].alternatives[0].transcript;
        }

        return transcription;
    }

    return new SpeechService();

}