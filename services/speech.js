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
                sampleRateHertz: options.stt.sampleRate,
                encoding: options.stt.encoding,
                languageCode: options.stt.languageCode
            }
        };

        this.ttsClient = new textToSpeech.TextToSpeechClient({
            credentials: {client_email: credentials[1].client_email,
                          private_key: credentials[1].private_key},
            projectId: credentials[1].project_id
        });

        this.ttsRequest = {
            voice: {
                languageCode: options.tts.languageCode,
                name: options.tts.voiceName,
            },
        // TODO It's possible to decrease the sampling rate to make the audio file as small as possible
        // Also possible to increase the speakingRate
            audioConfig: {
                audioEncoding: options.tts.encoding, //'LINEAR16|MP3|AUDIO_ENCODING_UNSPECIFIED/OGG_OPUS'
                pitch: options.tts.pitch,
                speakingRate: options.tts.speakingRate
            }
        };

        this.orderSpeechContexts = options.stt.speechContexts.order;
        this.confirmationSpeechContexts = options.stt.speechContexts.confirmation;
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

		//console.log(JSON.stringify(requestSTT, null, 4));

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