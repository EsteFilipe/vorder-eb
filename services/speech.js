const speechToText = require('@google-cloud/speech').v1p1beta1,
      textToSpeech = require('@google-cloud/text-to-speech');


module.exports = function (credentials, options) {

	var SpeechService = function() {
		this.sttClient = new speechToText.SpeechClient({
            credentials: {client_email: credentials[0].client_email,
                          private_key: credentials[0].private_key},
            projectId: credentials[0].project_id
        });
		this.sttRequest = {
            config: {
                sampleRateHertz: options.sttSampleRate,
                encoding: options.sttEncoding,
                languageCode: options.languageCode
            }
        };

        this.ttsClient = new textToSpeech.TextToSpeechClient({
            credentials: {client_email: credentials[1].client_email,
                          private_key: credentials[1].private_key},
            projectId: credentials[1].project_id
        });

        this.sttRequest = {
            voice: {
                languageCode: options.languageCode,
                name: options.ttsVoiceName,
            },
        // TODO It's possible to decrease the sampling rate to make the audio file as small as possible
        // Also possible to increase the speakingRate
            audioConfig: {
                audioEncoding: options.ttsEncoding, //'LINEAR16|MP3|AUDIO_ENCODING_UNSPECIFIED/OGG_OPUS'
                pitch: options.ttsPitch,
                speakingRate: options.ttsSpeakingRate
            }
        };

        this.orderSpeechContexts = options.orderSpeechContexts;
        this.confirmationSpeechContexts = options.confirmationSpeechContexts;
	}


    SpeechService.prototype.textToSpeech = async function (text) {
    	// Cloning object
    	const request = Object.assign({}, this.requestTTS)
        request.input = { text: text }; // text or SSML
        // Performs the Text-to-Speech request
        const response = await this.ttsClient.synthesizeSpeech(request);
        return response[0].audioContent;
    }

    SpeechService.prototype.speechToText = async function (audio, orderStage) {
    	   // Cloning object
    	const request = Object.assign({}, this.requestSTT)
        if (orderStage === "PROCESS") {
        	request.config.speechContexts = this.orderSpeechContexts;

        }
        else if (orderStage === "CONFIRMATION") {
        	request.config.speechContexts = this.confirmationSpeechContexts;
        }

		//console.log(JSON.stringify(requestSTT, null, 4));

        request.audio = {
            content: audio
        };

        const responses = await this.speechClient.recognize(request);

        var transcription = "TRANSCRIPTION_ERROR";

       	// TODO when `confidence` < threshold, also return N/A
        if(responses[0] && responses[0].results[0] && responses[0].results[0].alternatives[0]) {
        	transcription = responses[0].results[0].alternatives[0].transcript;
        }

        return transcription;
    }

}