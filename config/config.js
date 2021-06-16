var config = {
	server: {
		port: process.env.PORT || 3000,
		cookieMaxAge: 86400000,
		obfuscateJS: {
			production: false,
			development: false
		}
	},
	speech: {
		languageCode: 'en-US',
		stt: {
			testAccuracy: false,
			encoding: 'LINEAR16',
			model: 'default',
			sampleRate: -1, // if -1, the used sampling rate will be the one specified in the audio file
			// Speech context is a no-go for range orders. Maximum number of characters per phrase is 100.
			contextsConf: null,
			//contextsConf: {
			//	useBigrams: 'false'
			//},
			// Adaptations to create and use in the speech recognition model
			// Adaptations are made up of Phrase Sets and Classes. 
			// See https://cloud.google.com/speech-to-text/docs/adaptation-model#improve_transcription_results_using_a_customclass
			// and https://googleapis.dev/nodejs/speech/latest/v1p1beta1.AdaptationClient.html
			//
			// Notes: 
			// -> When both `contextsConf` and `adaptations` are non-null, `adaptations` superseedes according to
			// https://cloud.google.com/speech-to-text/docs/reference/rest/v1p1beta1/RecognitionConfig
			// -> New adaptations are only created from `adaptations.configuration` if `adaptations.create` is set to true. Otherwise
			// nothing is done, and the last set adaptations will be used.
			// -> If `adaptations.override` is true then even if an adaptation with the same name already exists
			// it will be redifined, else only the adaptations whose name doesn't already exist will be defined.
			//adaptations: null,
			adaptations: {
				create: false,
				list: false,
				override: true,
				configuration: {
					customClasses: [
						{
							customClassId: 'order-polarity',
							items: [{value: 'buy'}, {value: 'sell'}]
						},
						{
							customClassId: 'coins',
							items: [{value: 'bitcoin'}, {value: 'ether'}]
						},
						{
							customClassId: 'order-type',
							items: [{value: 'market'}, {value: 'limit'}, {value: 'range'}]
						},
						{
							customClassId: 'range-bounds-words',
							items: [{value: 'low'}, {value: 'high'}, {value: 'lower'}, {value: 'higher'}, {value: 'lowest'}, {value: 'highest'}]
						},
						{
							customClassId: 'confirmation',
							items: [{value: 'yes'}, {value: 'no'}]
						}
					],
					// Notes: 
					// -> Custom classes are refered to as '${my-custom-class}' and then replaced in services/speech.js
					// by their respective url location in the format of 'projects/project_id/locations (...)'
					// -> Tokens in the format '$CLASS' are pre-built classes, native to Google Speech API, and listed here
					// https://cloud.google.com/speech-to-text/docs/class-tokens
					// -> For each phrase in `phrases` you can mix up as you please Custom Classes, pre-defined Classes and arbitrary text
					phraseSets: [
						{
							phraseSetId: 'process',
							phrases: [
								
								// Market order combinations
								//{value: '${order-polarity} $OOV_CLASS_DIGIT_SEQUENCE ${coins} ${order-type}', boost: 20},
								//{value: '${order-polarity} $OPERAND ${coins} ${order-type}', boost: 20},
								// Limit order combinations
								//{value: '${order-polarity} $OOV_CLASS_DIGIT_SEQUENCE ${coins} ${order-type} OOV_CLASS_DIGIT_SEQUENCE', boost: 20},
								//{value: '${order-polarity} $OOV_CLASS_DIGIT_SEQUENCE ${coins} ${order-type} $OPERAND', boost: 20},
								//{value: '${order-polarity} $OPERAND ${coins} ${order-type} $OOV_CLASS_DIGIT_SEQUENCE', boost: 20},
								//{value: '${order-polarity} $OPERAND ${coins} ${order-type} $OPERAND', boost: 20},
								
								// Single word classes
								{value: '${order-polarity}', boost: 20},
								{value: '${coins}', boost: 20},
								{value: '${order-type}', boost: 20},
								{value: '${range-bounds-words}', boost: 20},
								{value: '$OOV_CLASS_DIGIT_SEQUENCE', boost: 20},
								{value: '$OPERAND', boost: 20},
							],
						},
						{
							phraseSetId: 'confirmation',
							phrases: [
								{value: '${confirmation}', boost: 20}
							],
							boost: 20
						}
					]
				}
			}
		},
		tts: {
			encoding: 'MP3',
			voiceName: 'en-US-Wavenet-G',
			pitch: 3.2,
			speakingRate: 1
		}
	}
}

module.exports = config;