var config = {
	server: {
		port: process.env.PORT || 3000,
		cookieMaxAge: 86400000
	},
	speech: {
		languageCode: 'en-US',
		stt: {
			encoding: 'LINEAR16',
			sampleRate: 16000,
			contextFilePaths: {
				order: 'config/speech-expected-sentences.json',
				confirmation: ''
			},
			contexts: {}
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