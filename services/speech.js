const speechToText = require('@google-cloud/speech').v1p1beta1,
      textToSpeech = require('@google-cloud/text-to-speech');


module.exports = function (credentials, config) {

    // TODO THIS IS JUST ASYNC FOR TESTING. PUT IT BACK TO SYNC
	var SpeechService = function() {

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

        if(config.stt.contextFilePaths) {
            this.orderSpeechContexts = config.stt.contexts.order;
            this.confirmationSpeechContexts = config.stt.contexts.confirmation;
        }

        // Used for Adaptation
        this.parent = `projects/${credentials[1].project_id}/locations/global`

	}

    SpeechService.prototype.createAdaptationsFromConfig = async function () {

        await this.createCustomClassesFromArray(config.stt.adaptations.configuration.customClasses)
        await this.createPhraseSetsFromArray(config.stt.adaptations.configuration.phraseSets)

        [response] = await this.adaptationClient.close()

        return response
    }

    function parsePhrase() {
        const x = 0
    }

    SpeechService.prototype.createCustomClassesFromArray = async function (customClasses) {
        customClasses.forEach(function(customClass){
            console.log(customClass);
        });
    }

    SpeechService.prototype.createPhraseSetsFromArray = async function (phraseSets) {
        phraseSets.forEach(function(phraseSet){
            console.log(phraseSet);
        });
    }

    SpeechService.prototype.closeAdaptationClient = async function () {
        [response] = await this.adaptationClient.close()

        return response
    }

    SpeechService.prototype.listCustomClasses = async function () {
        [response] = await this.adaptationClient.listCustomClasses(
            {parent:this.parent})

        return response
    }

    SpeechService.prototype.listPhraseSet = async function () {
        [response] = await this.adaptationClient.listPhraseSet(
            {parent:this.parent})

        return response
    }

    SpeechService.prototype.getCustomClass = async function (customClassId) {
        const customClass = await this.adaptationClient.getCustomClass(
            {name: `${this.parent}/customClasses/${customClassId}`});

        return customClass
    }

    SpeechService.prototype.getPhraseSet = async function (phraseSetId) {
        const phraseSet = await this.adaptationClient.getPhraseSet(
            {name: `${this.parent}/phraseSets/${phraseSetId}`});

        return phraseSet
    }

    SpeechService.prototype.deleteCustomClass = async function (customClassId) {
        const [response] = await this.adaptationClient.deleteCustomClass(
            {name: `${this.parent}/customClasses/${customClassId}`});

        return response
    }

    SpeechService.prototype.deletePhraseSet = async function (phraseSetId) {
        const [response] = await this.adaptationClient.deletePhraseSet(
            {name: `${this.parent}/phraseSets/${phraseSetId}`});

        return response
    }

    SpeechService.prototype.createCustomClass = async function (customClassId, items) {
        /*
            `items` format:
            [{value: "foo"}, {value: "bar"}]
        */

        const request = {
            parent: this.parent,
            customClassId: customClassId,
            customClass: {
                items: items
            }
        }

        const [response] = await this.adaptationClient.createCustomClass(request)

        return response
    }

    SpeechService.prototype.createPhraseSet = async function (phraseSetId, phrases) {
        /*
            `phrases` format:
            {"phrases": [{"value": "foo", "boost": 10}, {"value": "bar", "boost": 10}]}
        */
        const request = {
            parent: this.parent,
            phraseSetId: phraseSetId,
            phraseSet: phrases
        }

        const [response] = await this.adaptationClient.createPhraseSet(request)

        return response
    }

    SpeechService.prototype.updateCustomClass = async function (customClassId, items) {
        /*
            The documentation for this is confusing (didn't understand what to put in `updateMask`,
            so haven't implemented it yet). If necessary, just delete class and recreate it
        */

        /*
        const request = {
            customClass: customClassId,
            updateMask: {items: items}
        }

        const [response] = await this.adaptationClient.updateCustomClass(request)

        return response
        */
    }

    SpeechService.prototype.updatePhraseSet = async function (phraseSetId, phrases) {
        /*
            The documentation for this is confusing (didn't understand what to put in `updateMask`,
            so haven't implemented it yet). If necessary, just delete phrase set and recreate it
        */

        /*
        const request = {
            phraseSet: phraseSetId,
            updateMask: {phrases: phrases}
        }

        const [response] = await this.adaptationClient.updatePhraseSet(request)

        return response
        */
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
        // Only use the speechContexts if the files have been defined in the config
        // Else use the Phrase Sets with Custom Classes
        if(config.stt.contextFilePaths) {
            if (orderStage === "PROCESS") {
            	request.config.speechContexts = this.orderSpeechContexts;

            }
            else if (orderStage === "CONFIRMATION") {
            	request.config.speechContexts = this.confirmationSpeechContexts;
            }
        }
        else {
            // Use phrase sets
            const x = 0
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