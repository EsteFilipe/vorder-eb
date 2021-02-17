// Include the cluster module
var cluster = require('cluster');

// Code to run if we're in the master process
if (cluster.isMaster) {

    // Count the machine's CPUs
    var cpuCount = require('os').cpus().length;

    // Create a worker for each CPU
    for (var i = 0; i < cpuCount; i += 1) {
        cluster.fork();
    }

    // Listen for terminating workers
    cluster.on('exit', function (worker) {

        // Replace the terminated workers
        console.log('Worker ' + worker.id + ' died :(');
        cluster.fork();

    });

// Code to run if we're in a worker process
} else {

    var AWS = require('aws-sdk');
    var express = require('express');
    var bodyParser = require('body-parser');
    var cors = require('cors');
    var socketIo = require('socket.io');
    var path = require('path');
    var fs = require('fs');
    var http = require('http');
    var ss = require('socket.io-stream');
    var basicAuth = require('express-basic-auth');

    // STT
    var speech = require('@google-cloud/speech');

    // TTS
    var textToSpeech = require('@google-cloud/text-to-speech');

    // set some server variables
    var server;
    var sessionId, sessionClient, sessionPath, request;
    var speechClient, requestSTT, ttsClient, requestTTS, mediaTranslationClient, requestMedia;
    const port = process.env.PORT || 3000;

    // STT configuration
    const languageCode = 'en-US';
    const encoding = 'linear16';
    const sampleRateHertz = 16000;
    // TODO obtain this from the python script (dump from there into a file and load here)
    // TODO this context will depend on whether we're listening to order or yes/no.
    const speechContexts = [
      {
        phrases: [
          'mail',
          'email'
        ],
        boost: 20.0
      }
    ]

    function setupServer() {

        AWS.config.region = process.env.REGION

        var sns = new AWS.SNS();
        // TODO persistent DynamoDB
        var ddb = new AWS.DynamoDB();

        var ddbTable =  process.env.STARTUP_SIGNUP_TABLE;
        var snsTopic =  process.env.NEW_SIGNUP_TOPIC;
        var app = express();

        // Require authentication to access (from https://stackoverflow.com/questions/23616371/basic-http-authentication-with-node-and-express-4)
        app.use(basicAuth({
            users: { dawuon9d39feaAFCEb19bdy332id13: '9f2y4fg274624xn7cn289cADASry9482cvyb' },
            challenge: true // <--- needed to actually show the login dialog!
        }));

        app.use(cors());
        app.set('view engine', 'ejs');
        app.set('views', __dirname + '/views');
        app.use(bodyParser.urlencoded({extended:false}));

        // X-Ray debug logs
        //var AWSXRay = require('aws-xray-sdk');
        //app.use(AWSXRay.express.openSegment('VorderApp'));

        app.get('/', function(req, res) {
            res.render('index', {
                static_path: 'static',
                theme: process.env.THEME || 'flatly',
                flask_debug: process.env.FLASK_DEBUG || 'false'
            });
        });

        app.post('/signup', function(req, res) {
            var item = {
                'email': {'S': req.body.email},
                'name': {'S': req.body.name},
                'preview': {'S': req.body.previewAccess},
                'theme': {'S': req.body.theme}
            };

            ddb.putItem({
                'TableName': ddbTable,
                'Item': item,
                'Expected': { email: { Exists: false } }
            }, function(err, data) {
                if (err) {
                    var returnStatus = 500;

                    if (err.code === 'ConditionalCheckFailedException') {
                        returnStatus = 409;
                    }

                    res.status(returnStatus).end();
                    console.log('DDB Error: ' + err);
                } else {
                    sns.publish({
                        'Message': 'Name: ' + req.body.name + "\r\nEmail: " + req.body.email
                                            + "\r\nPreviewAccess: " + req.body.previewAccess
                                            + "\r\nTheme: " + req.body.theme,
                        'Subject': 'New user sign up!!!',
                        'TopicArn': snsTopic
                    }, function(err, data) {
                        if (err) {
                            res.status(500).end();
                            console.log('SNS Error: ' + err);
                        } else {
                            res.status(201).end();
                        }
                    });
                }
            });
        });

        //var server = app.listen(port, function () {
        //    console.log('Server running at http://127.0.0.1:' + port + '/');
        //});

        // X-Ray debug logs
        //app.use(AWSXRay.express.closeSegment());

        server = http.createServer(app);
        io = socketIo(server);
        server.listen(port, () => {
            console.log('Running server on port %s', port);
        });

        // Listener, once the client connect to the server socket
            io.on('connect', (client) => {
                console.log(`Client connected [id=${client.id}]`);
                client.emit('server_setup', `Server connected [id=${client.id}]`);

                // when the client sends 'message' events
                // when using simple audio input
                client.on('message', async function(data) {
                    // we get the dataURL which was sent from the client
                    const dataURL = data.audio.dataURL.split(',').pop();
                    // we will convert it to a Buffer
                    let fileBuffer = Buffer.from(dataURL, 'base64');
                    // run the simple detectIntent() function
                    const results = await detectIntent(fileBuffer);
                    client.emit('results', results);
                });

                // when the client sends 'message' events
                // when using simple audio input
                // TODO this is the one I'll use first
                  client.on('message-transcribe', async function(data) {
                    // we get the dataURL which was sent from the client
                    const dataURL = data.audio.dataURL.split(',').pop();
                    // we will convert it to a Buffer
                    let fileBuffer = Buffer.from(dataURL, 'base64');
                    // run the simple transcribeAudio() function
                    const results = await transcribeAudio(fileBuffer);
                    client.emit('results', results);
                });

                // when the client sends 'stream' events
                // when using audio streaming
                ss(client).on('stream', function(stream, data) {
                  // get the name of the stream
                  const filename = path.basename(data.name);
                  // pipe the filename to the stream
                  stream.pipe(fs.createWriteStream(filename));
                  // make a detectIntStream call
                  detectIntentStream(stream, function(results){
                      console.log(results);
                      client.emit('results', results);
                  });
                });

                // when the client sends 'stream-transcribe' events
                // when using audio streaming
                ss(client).on('stream-transcribe', function(stream, data) {
                    // get the name of the stream
                    const filename = path.basename(data.name);
                    // pipe the filename to the stream
                    stream.pipe(fs.createWriteStream(filename));
                    // make a detectIntStream call
                    transcribeAudioStream(stream, function(results){
                        console.log(results);
                        client.emit('results', results);
                    });
                });

                // when the client sends 'tts' events
                ss(client).on('tts', function(text) {
                  textToAudioBuffer(text).then(function(results){
                    console.log(results);
                    client.emit('results', results);
                  }).catch(function(e){
                    console.log(e);
                  });
                });

                // when the client sends 'stream-media' events
                // when using audio streaming
                ss(client).on('stream-media', function(stream, data) {
                  // get the name of the stream
                  const filename = path.basename(data.name);
                  // pipe the filename to the stream
                  stream.pipe(fs.createWriteStream(filename));
                  // make a detectIntStream call
                  transcribeAudioMediaStream(stream, function(results){
                      console.log(results);
                      client.emit('results', results);
                  });
                });
            });

    }

    /**
     * Setup Cloud STT Integration
     */
    function setupSTT(){
       // Creates a client
       speechClient = new speech.SpeechClient();

        // Create the initial request object
        // When streaming, this is the first call you will
        // make, a request without the audio stream
        // which prepares Dialogflow in receiving audio
        // with a certain sampleRateHerz, encoding and languageCode
        // this needs to be in line with the audio settings
        // that are set in the client
        requestSTT = {
          config: {
            sampleRateHertz: sampleRateHertz,
            encoding: encoding,
            languageCode: languageCode
          },
          //interimResults: interimResults,
          //enableSpeakerDiarization: true,
          //diarizationSpeakerCount: 2,
          //model: `phone_call`
        }

    }

    /**
     * Setup Cloud STT Integration
     */
    function setupTTS(){
      // Creates a client
      ttsClient = new textToSpeech.TextToSpeechClient();

      // Construct the request
      requestTTS = {
        // Select the language and SSML Voice Gender (optional)
        voice: {
          languageCode: 'en-US', //https://www.rfc-editor.org/rfc/bcp/bcp47.txt
          ssmlGender: 'NEUTRAL'  //  'MALE|FEMALE|NEUTRAL'
        },
        // Select the type of audio encoding
        audioConfig: {
          audioEncoding: encoding, //'LINEAR16|MP3|AUDIO_ENCODING_UNSPECIFIED/OGG_OPUS'
        }
      };
    }

     /*
      * STT - Transcribe Speech
      * @param audio file buffer
      */
     async function transcribeAudio(audio){
      requestSTT.audio = {
        content: audio
      };
      console.log(requestSTT);
      const responses = await speechClient.recognize(requestSTT);
      return responses;
    }

     /*
      * STT - Transcribe Speech on Audio Stream
      * @param audio stream
      * @param cb Callback function to execute with results
      */
     async function transcribeAudioStream(audio, cb) {
      const recognizeStream = speechClient.streamingRecognize(requestSTT)
      .on('data', function(data){
        console.log(data);
        cb(data);
      })
      .on('error', (e) => {
        console.log(e);
      })
      .on('end', () => {
        console.log('on end');
      });

      audio.pipe(recognizeStream);
      audio.on('end', function() {
          //fileWriter.end();
      });
    };

     /*
      * TTS text to an audio buffer
      * @param text - string written text
      */
    async function textToAudioBuffer(text) {
      console.log(text);
      requestTTS.input = { text: text }; // text or SSML
      // Performs the Text-to-Speech request
      const response = await ttsClient.synthesizeSpeech(requestTTS);
      return response[0].audioContent;
    }

    setupSTT();
    setupTTS();
    setupServer();
}