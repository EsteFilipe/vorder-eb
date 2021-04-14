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

        console.log('\nCreating Custom Classes and Phrase sets from adaptation config...')
        await this.createCustomClassesFromArray(config.stt.adaptations.configuration.customClasses);
        await this.createPhraseSetsFromArray(config.stt.adaptations.configuration.phraseSets);

        console.log('Finished creating Custom Classes and Phrase Sets.')
        const customClasses = await this.listCustomClasses();
        const phraseSets = await this.listPhraseSet();

        const output = prettifyListAdaptations(customClasses, phraseSets);

        await this.adaptationClient.close();

        return output

    }

    function prettifyListAdaptations(customClasses, phraseSets) {

            var output = '\n---> List of all Custom Classes and Phrase Sets:\n';

            output += '\n\n--> CUSTOM CLASSES\n\n\n';

            customClasses.forEach( (customClass) => {
                output += `- '${customClass.customClassId}'; `
                output += 'Items: ' + JSON.stringify(customClass.items) + '\n';
            });

            output += '\n\n--> PHRASE SETS\n\n\n';

            phraseSets.forEach( (phraseSet) => {
                output += `- '${phraseSet.phraseSetId}'; `;
                output += 'Phrases: ' + JSON.stringify(phraseSet.phrases) + '\n';
            });

            output += '\n---> End of list.\n';

            return output
        }

    SpeechService.prototype.createCustomClassesFromArray = async function (customClasses) {
        const override = config.stt.adaptations.override;

        for (customClass of customClasses) {
            // Check if class exists
            const customClassId = customClass.customClassId;
            const items = customClass.items;
            const customClassExists = await this.getCustomClass(customClassId);
            // If it doesn't exist, create it
            if (!customClassExists) {
                await this.createCustomClass(customClassId, items);
                console.log(`Created Custom Class '${customClassId}'`)
            }
            else {
                // If it exists and `override` is set to true, delete it and create
                // it with the new items.
                // Note: this could be done with the update method, but I didn't manage
                // to figure out what should be in `updateMask`
                if (override) {
                    await this.deleteCustomClass(customClassId);
                    await this.createCustomClass(customClassId, items);
                    console.log(`Overrode Custom Class '${customClassId}'`)
                }
                // Else, do nothing
                else {
                    console.log(`Custom Class '${customClassId}' already exists, doing nothing because 'override' is false.`)
                }
            }
        }
    }

    SpeechService.prototype.createPhraseSetsFromArray = async function (phraseSets) {
  
        for (phraseSet of phraseSets) {
            // Check if class exists
            const phraseSetId = phraseSet.phraseSetId;
            const phrases = phraseSet.phrases;
            const phraseSetExists = await this.getCustomClass(phraseSetId);

            const phrasesProcessed = this.parsePhrases(phrases);

            // If it doesn't exist, create it
            if (!phraseSetExists) {
                await this.createPhraseSet(phraseSetId, phrasesProcessed);
                console.log(`Created Phrase Set '${phraseSetId}'`)
            }
            else {
                // If it exists and `override` is set to true, delete it and create
                // it with the new items.
                // Note: this could be done with the update method, but I didn't manage
                // to figure out what should be in `updateMask`
                if (override) {
                    await this.deletePhraseSet(phraseSetId);
                    await this.createPhraseSet(phraseSetId, phrasesProcessed);
                    console.log(`Overrode Phrase Set '${phraseSetId}'`)
                }
                // Else, do nothing
                else {
                    console.log(`Phrase Set '${phraseSetId}' already exists, doing nothing because 'override' is false.`)
                }
            }
        }
    }

    SpeechService.prototype.parsePhrases = function (phrases) {

        const replaceCustomClassTokenInPhrase = (p) => p.replace(/\${(.*?)}/g,
          (match, offset) => '${' + `${this.parent}/customClasses/${offset}` + '}');

        var phrasesProcessed = []; 
        phrases.forEach( (phrase) => {
            phraseValue = replaceCustomClassTokenInPhrase(phrase.value);
            phrasesProcessed.push({value: phraseValue, boost: phrase.boost})
        });

        return phrasesProcessed

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
        try {
            const customClass = await this.adaptationClient.getCustomClass(
                {name: `${this.parent}/customClasses/${customClassId}`});
            return customClass
        }
        catch(err) {
            // Custom Class not found
            if (err.code === 5) {
                return false
            }
            // Don't keep going in any other case
            else {
                throw new Error(`Unexpected error code from gRPC: ERROR ${err.code}`);
            }
        }
    }

    SpeechService.prototype.getPhraseSet = async function (phraseSetId) {
        try {
            const phraseSet = await this.adaptationClient.getPhraseSet(
                {name: `${this.parent}/phraseSets/${phraseSetId}`});
            return phraseSet
        }
        catch(err) {
            // Phrase not found
            if (err.code === 5) {
                return false
            }
            // Don't keep going in any other case
            else {
                throw new Error(`Unexpected error code from gRPC: ERROR ${err.code}`);
            }
        }
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