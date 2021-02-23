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
    var session = require('express-session')
    var bodyParser = require('body-parser');
    var cors = require('cors');
    var socketIo = require('socket.io');
    var path = require('path');
    var fs = require('fs');
    var http = require('http');
    var ss = require('socket.io-stream');
    //var basicAuth = require('express-basic-auth');
    var util = require('util')
    var hash = require('object-hash');

    // Server

    AWS.config.region = process.env.REGION

    //var sns = new AWS.SNS();
    //var snsTopic =  process.env.NEW_SIGNUP_TOPIC;
    var ddb = new AWS.DynamoDB();
    var ddbTable =  process.env.EVENTS_TABLE;
    var S3 = new AWS.S3();

    const S3_bucket = process.env.EVENTS_BUCKET;

    // AWS Cognito
    var AmazonCognitoIdentity = require('amazon-cognito-identity-js');
    var CognitoUserPool = AmazonCognitoIdentity.CognitoUserPool;
    var request = require('request');
    var jwkToPem = require('jwk-to-pem');
    var jwt = require('jsonwebtoken');
    global.fetch = require('node-fetch');
    var poolData = {
    UserPoolId : "us-east-2_XVWGKwmzC",
    ClientId : "4rh5g79v3qme18vk6rutfpsjup" // App Client id
    };
    const pool_region = 'us-east-2';
    const userPool = new AmazonCognitoIdentity.CognitoUserPool(poolData);

    // STT
    var speech = require('@google-cloud/speech').v1p1beta1;

    // TTS
    var textToSpeech = require('@google-cloud/text-to-speech');

    // set some server variables
    var server;
    var sessionId, sessionClient, sessionPath, request;
    var speechClient, requestSTT, ttsClient, requestTTS, mediaTranslationClient, requestMedia;
    const port = process.env.PORT || 3000;

    // Credentials for the Google Service Account
    const googleServiceAccount = {keyFilename: process.env.GOOGLE_SERVICE_ACCOUNT_FILE_PATH};
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

    // For several methods on cognito, check:
    //https://medium.com/@prasadjay/amazon-cognito-user-pools-in-nodejs-as-fast-as-possible-22d586c5c8ec

    function registerUser(email, password){
        var attributeList = [];
        attributeList.push(new AmazonCognitoIdentity.CognitoUserAttribute({Name:"email",Value:email}));

        userPool.signUp(email, password, attributeList, null, function(err, result){
            if (err) {
                console.log("Error creating user.");
                console.log(err);
                return;
            }
            cognitoUser = result.user;
            console.log("Success creating user.");
            console.log('user name is ' + cognitoUser.getUsername());
        });
    }

    // TODO perhaps in the future I'll have to use the token received from cognito for something
    // Check https://www.npmjs.com/package/amazon-cognito-identity-js
    // Use case 4. Authenticating a user and establishing a user session with the Amazon Cognito Identity service.
    function login(email, password) {

        console.log("Trying to log in...")
        console.log("E-mail: ", email)
        console.log("Password: ", password)

        var authenticationDetails = new AmazonCognitoIdentity.AuthenticationDetails({
            Username : email,
            Password : password,
        });

        var userData = {
            Username : email,
            Pool : userPool
        };

        var cognitoUser = new AmazonCognitoIdentity.CognitoUser(userData);

        return new Promise((success, error) => {
            cognitoUser.authenticateUser(authenticationDetails, {
                onSuccess: (result) => {
                    console.log('successfully authenticated', result);
                    success(result);
                },

                onFailure: (err) => {
                    console.log('error authenticating', err);
                    error(err);
                }
            });
        });

    }

    function validateToken(token) {
            request({
                url: `https://cognito-idp.${pool_region}.amazonaws.com/${poolData.UserPoolId}/.well-known/jwks.json`,
                json: true
            }, function (error, response, body) {
                if (!error && response.statusCode === 200) {
                    pems = {};
                    var keys = body['keys'];
                    for(var i = 0; i < keys.length; i++) {
                        //Convert each key to PEM
                        var key_id = keys[i].kid;
                        var modulus = keys[i].n;
                        var exponent = keys[i].e;
                        var key_type = keys[i].kty;
                        var jwk = { kty: key_type, n: modulus, e: exponent};
                        var pem = jwkToPem(jwk);
                        pems[key_id] = pem;
                    }
                    //validate the token
                    var decodedJwt = jwt.decode(token, {complete: true});
                    if (!decodedJwt) {
                        console.log("Not a valid JWT token");
                        return;
                    }

                    var kid = decodedJwt.header.kid;
                    var pem = pems[kid];
                    if (!pem) {
                        console.log('Invalid token');
                        return;
                    }

                    jwt.verify(token, pem, function(err, payload) {
                        if(err) {
                            console.log("Invalid Token.");
                        } else {
                            console.log("Valid Token.");
                            console.log(payload);
                        }
                    });
                } else {
                    console.log("Error! Unable to download JWKs");
                }
            });
    }

    function renewToken() {
        const RefreshToken = new AmazonCognitoIdentity.CognitoRefreshToken({RefreshToken: "your_refresh_token_from_a_previous_login"});

        const userPool = new AmazonCognitoIdentity.CognitoUserPool(poolData);

        const userData = {
            Username: "sample@gmail.com",
            Pool: userPool
        };

        const cognitoUser = new AmazonCognitoIdentity.CognitoUser(userData);

        cognitoUser.refreshSession(RefreshToken, (err, session) => {
            if (err) {
                console.log(err);
            } else {
                let retObj = {
                    "access_token": session.accessToken.jwtToken,
                    "id_token": session.idToken.jwtToken,
                    "refresh_token": session.refreshToken.token,
                }
                console.log(retObj);
            }
        })
    }

    function setupServer() {

        var app = express();

        // Require authentication to access (from https://stackoverflow.com/questions/23616371/basic-http-authentication-with-node-and-express-4)
        //app.use(basicAuth({
        //    users: { dawuon9d39feaAFCEb19bdy332id13: '9f2y4fg274624xn7cn289cADASry9482cvyb' },
        //    challenge: true // <--- needed to actually show the login dialog!
        //}));

        app.use(cors());
        app.set('view engine', 'ejs');
        app.set('views', __dirname + '/views');

        app.use(bodyParser.urlencoded({extended : true}));
        app.use(bodyParser.json());

        var sess = session({secret: 'fiADWXCVejn984w7AWDWADuhftfntwfyb8fcnGRIK7wcwu9chw9IO85151',
                            resave: false,
                            saveUninitialized: false
                            })

        app.use(sess);

        // X-Ray debug logs
        //var AWSXRay = require('aws-xray-sdk');
        //app.use(AWSXRay.express.openSegment('VorderApp'));

        app.get('/', function(req, res) {
            res.sendFile(path.join(__dirname + '/views/login.html'));
        });

        app.post('/auth', function(req, res) {
        	var email = req.body.email;
        	var password = req.body.password;

        	if (email && password) {
                login(email, password).then(function(result) {
                    req.session.loggedin = true;
                    req.session.email = email;
                    res.redirect('/home');
                }, function(err) {
                    res.send('Incorrect e-mail and/or password.');
                    console.log(err);
                })
        	} else {
        		res.send('Please enter e-mail and password.');
        	}
        });

        app.get('/home', function(req, res) {
        	if (req.session.loggedin) {
                res.render('index', {
                    static_path: 'static',
                    theme: 'flatly',
                    flask_debug: process.env.FLASK_DEBUG || 'false'
                });
        	} else {
        		res.sendFile(path.join(__dirname + '/views/login.html'));
        	}
        });


        //var server = app.listen(port, function () {
        //    console.log('Server running at http://127.0.0.1:' + port + '/');
        //});

        // X-Ray debug logs
        //app.use(AWSXRay.express.closeSegment());

        server = http.createServer(app);
        io = socketIo(server);

        // Share session variables with socket.io
        io.use(function(socket, next) {
            sess(socket.request, socket.request.res || {}, next);
        });

        server.listen(port, () => {
            console.log('Running server on port %s', port);
        });

        // Listener, once the client connect to the server socket
        io.on('connect', (client) => {
            console.log(`Client connected [id=${client.id}]`);
            client.emit('server_setup', `Server connected [id=${client.id}]`);

            // when the client sends 'debug' events
            /*
            client.on('debug', async function(message) {
                await test_speechtotext();
                console.log('Debugging');
            });
            */

            // when the client sends 'start-recording' events
            client.on('start-recording', async function(timestamp) {
                // we get the dataURL which was sent from the client
                //console.log(timestamp);
                //console.dir(client.request.session);
                //console.log(client.request.session.email);

                const db_item = {
                    'email': {'S': client.request.session.email},
                    'event_type': {'S': 'start-recording'},
                    'client_timestamp': {'S': timestamp.toString()}
                };

                ddb_put(db_item)
            });

            // when the client sends 'message' events
            // when using simple audio input
            client.on('message-transcribe', async function(data) {
                const server_timestamp = Date.now();
                const client_timestamp = data.timestamp.toString();
                const fname = client.request.session.email + "-" + client_timestamp;
                // we get the dataURL which was sent from the client
                const dataURL = data.audio.dataURL.split(',').pop();
                // we will convert it to a Buffer
                let fileBuffer = Buffer.from(dataURL, 'base64');

                // put record in database and upload audio file to S3 bucket
                s3_put(fname, fileBuffer).then(function(result) {
                    console.log("File " + fname + " uploaded successfully.");

                    const db_item = {
                        'email': {'S': client.request.session.email},
                        'event_type': {'S': 'message-transcribe-receive-audio'},
                        'file_name': {'S': fname},
                        'client_timestamp': {'S': client_timestamp},
                        'server_timestamp': {'S': server_timestamp}
                    };
                    ddb_put(db_item)
                }, function(err) {
                    console.log('Error inserting file ' + fname);
                    console.log(err);
                });

                // run the simple transcribeAudio() function
                // TODO UNCOMMENT
                //const results = await transcribeAudio(fileBuffer);
                //client.emit('results', results);
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
       //https://github.com/googleapis/gax-nodejs/blob/master/client-libraries.md#creating-the-client-instance
       // Creates a client
       speechClient = new speech.SpeechClient(googleServiceAccount);
    }

    /*
    // DEBUG
    async function test_speechtotext() {
      // The path to the remote LINEAR16 file
      const gcsUri = 'gs://cloud-samples-data/speech/brooklyn_bridge.raw';

      // The audio file's encoding, sample rate in hertz, and BCP-47 language code
      const audio = {
        uri: gcsUri,
      };
      const config = {
        encoding: 'LINEAR16',
        sampleRateHertz: 16000,
        languageCode: 'en-US',
      };
      const request = {
        audio: audio,
        config: config,
      };

      // Detects speech in the audio file
      const [response] = await speechClient.recognize(request);
      const transcription = response.results
        .map(result => result.alternatives[0].transcript)
        .join('\n');
      console.log(`Transcription: ${transcription}`);
    }
    //DEBUG
    */

    /**
     * Setup Cloud STT Integration
     */
    function setupTTS(){
      // Creates a client
      ttsClient = new textToSpeech.TextToSpeechClient(googleServiceAccount);

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

    // Insert new item in DynamoDB table
    function ddb_put(item) {

        // calculate unique hash for the item id (uses SHA1)
        item.id = {'S': hash(item)};

        console.log("Inserting item into DB")
        console.dir(item)

        ddb.putItem({
            'TableName': ddbTable,
            'Item': item,
            'Expected': { id: { Exists: false } }
        }, function(err, data) {
            if (err) {
                console.log('DDB Error: ' + err);
            } else {
                console.log('DDB Success!');
            }
        });

    }

    function s3_put(file_name, file_content) {

        // Setting up S3 upload parameters
        const params = {
            Bucket: S3_bucket,
            Key: file_name, // File name you want to save as in S3
            Body: file_content
        };

        // Uploading files to the bucket
        return new Promise(function(resolve, reject) {
            S3.upload(params, function(err, data) {
                if (err) {
                    reject(err);
                } else {
                    resolve(data);
                }
            });
        });

    }

    setupSTT();
    setupTTS();
    setupServer();
    //registerUser("rodrigues.gon@gmail.com", "Famalicao6!")
    //registerUser("filipe.b.aleixo@gmail.com", "Famalicao10!")
    //login()

    console.log("Finished running.")
}