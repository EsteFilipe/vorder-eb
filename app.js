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
    var ss = require('socket.io-stream');
    var path = require('path');
    var fs = require('fs');
    var http = require('http');
    //var basicAuth = require('express-basic-auth');
    var util = require('util')
    var hash = require('object-hash');
    var spawn = require("child_process").spawn;

    // Server

    express.static.mime.define({'application/wasm': ['wasm']})

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
    // Using two service accounts because if I only used one, I got an error. Apparently two
    // services can't access the same service account in simultaneous.
    const googleServiceAccount = {keyFilename: process.env.GOOGLE_SERVICE_ACCOUNT_FILE_PATH};
    const googleServiceAccount2 = {keyFilename: process.env.GOOGLE_SERVICE_ACCOUNT2_FILE_PATH};
    // STT configuration
    const languageCode = 'en-US';
    const encoding = 'LINEAR16';
    const sampleRateHertz = 16000;

    const coins = {BTC: "Bitcoin", ETH: "Ether"};

    // Speech Contexts for Google Speech API
    var orderSpeechContexts, confirmationSpeechContexts;

    fs.readFile('speech_order_expected_sentences.json', (err, data) => {
	    if (err) throw err;
	    let phrases = JSON.parse(data);
	    orderSpeechContexts = [{
						        phrases: phrases,
						        boost: 20.0
						       }];

		//console.log(orderSpeechContexts);
	});

    confirmationSpeechContexts = [{
							       phrases: ['yes','no'],
							       boost: 20.0
							      }];


    // For several Cognito examples, check:
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
                    req.session.order = -1;
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

            // When the user clicks "Start"
            client.on('start-monitoring', async function(data) {
                const db_item =

                ddb_put({'email': {'S': client.request.session.email},
                         'event_type': {'S': 'START_MONITORING'},
                         'client_timestamp': {'S': data.timestamp.toString()}});
            });

            // When the user clicks "Stop"
            client.on('stop-monitoring', async function(data) {
                const db_item =

                ddb_put({'email': {'S': client.request.session.email},
                         'event_type': {'S': 'STOP_MONITORING'},
                         'client_timestamp': {'S': data.timestamp.toString()}});
            });

            // TODO still not implemented on client side
            client.on('wake-word-detected', async function(data) {

                const db_item =

                ddb_put({'email': {'S': client.request.session.email},
                         'event_type': {'S': 'WAKE_WORD_DETECTED'},
                         'client_timestamp': {'S': data.timestamp.toString()}});
            });

            // Transcribe, process and validate order
            client.on('process-order', async function(data) {
            	const eventType = 'PROCESS_ORDER';
                const client_timestamp = data.timestamp.toString();
                const fname = client.request.session.email + "-" + client_timestamp + ".wav";
                // Get the dataURL which was sent from the client
                const dataURL = data.audio.dataURL.split(',').pop();
                // Convert it to a Buffer
                let fileBuffer = Buffer.from(dataURL, 'base64');

                // put record in database and upload audio file to S3 bucket
                s3_put(fname, fileBuffer).then(function(result) {
                    console.log("File " + fname + " uploaded successfully.");

                    ddb_put({'email': {'S': client.request.session.email},
                             'event_type': {'S': eventType},
                             'stage': {'S': 'SAVE_AUDIO'},
                             'file_name': {'S': fname},
                             'client_timestamp': {'S': client_timestamp},
                             'server_timestamp': {'S': Date.now().toString()}});

                }, function(err) {
                    console.log('Error inserting file ' + fname);
                    console.log(err);
                    ddb_put({'email': {'S': client.request.session.email},
                             'event_type': {'S': eventType},
                             'stage': {'S': 'SAVE_AUDIO'},
                             'file_name': {'S': "UPLOAD_ERROR"},
                             'client_timestamp': {'S': client_timestamp},
                             'server_timestamp': {'S': Date.now().toString()}});
                });

                // Send audio to transcribe and wait for the response
                const orderTranscription = await speechTranscription(fileBuffer, "PROCESS");

                var status = '';
                var output = '';

                if (orderTranscription != "TRANSCRIPTION_ERROR") {

	                // Process the order using python script
	                await runPython38Script ("order_processing.py", orderTranscription, (output) => {
	                	// `output` is a string

	    				const orderInfo = JSON.parse(output);

	    				status = orderInfo.status ? "VALID" : "PROCESSING_ERROR";
	    				output = orderInfo.output;

	    				// Send result of order processing to client
						client.emit('order-processing', JSON.stringify({status: status, output: output}));

				    	if (status == "VALID") {
							// Save order in session variable
							client.request.session.order = orderInfo.output;
							
							const order = orderInfo.output;
							const coinName = coins[order.ticker];
							
							if (order.type == "limit") {
								orderText = `${order.polarity} ${order.size} ${coinName} at ${order.price} US Dollars.`;
							}

							else if (order.type == "market") {
								orderText = `${order.polarity} ${order.size} ${coinName} at market price.`;
							}

			                textToAudioBuffer(orderText).then(function(arrayBuffer){
				                client.emit('stream-audio-confirm-order', arrayBuffer);
				            }).catch(function(e){
				                console.log(e);
				            });


						}
						else {
							// -1 means no order to confirm
							client.request.session.order = -1;
						}

		    			// Store the processed order
		                ddb_put({'email': {'S': client.request.session.email},
					             'event_type': {'S': eventType},
					             'stage': {'S': 'ORDER_PROCESSING'},
					             'status': {'S': status},
					             'output': {'S': JSON.stringify(output)},
					             'server_timestamp': {'S': Date.now().toString()}});
					});
	            }

	            else {
	            	status = "TRANSCRIPTION_ERROR";
	            	output = "There has been a problem transcribing the audio";

	            	client.emit('order-processing', JSON.stringify({status: status, output: output}));

	            	// Store the error
	                ddb_put({'email': {'S': client.request.session.email},
				             'event_type': {'S': eventType},
				             'stage': {'S': 'ORDER_PROCESSING'},
				             'status': {'S': status},
				             'processed': {'S': output},
				             'server_timestamp': {'S': Date.now().toString()}});
	            }

            });

			// Confirm order
			client.on('confirm-order', async function(data) {
				const order = client.request.session.order
				const eventType = 'CONFIRM_ORDER';
                const client_timestamp = data.timestamp.toString();
				const fname = client.request.session.email + "-" + client_timestamp + ".wav";
                // Get the dataURL which was sent from the client
                const dataURL = data.audio.dataURL.split(',').pop();
                // Convert it to a Buffer
                let fileBuffer = Buffer.from(dataURL, 'base64');
				// Send audio to transcribe and wait for the response
                const confirmationTranscription = await transcribeOrder(fileBuffer, "CONFIRMATION");

                var status = '';
                var output = '';

                // TODO
                // - Store audio file
                // - Do the if (confirmationTranscription != "PROCESSING_ERROR") part - connection to binance and error handling


                if (confirmationTranscription != "TRANSCRIPTION_ERROR") {

                	const confirmationProcessing = await processOrderConfirmation(confirmationTranscription);

                	if (confirmationTranscription != "PROCESSING_ERROR") {

                	}

                	else {

                		status = "PROCESSING_ERROR";
	            		output = "There has been a problem processing the confirmation. One of the two happened:" +
	            		 "1) Both words 'yes' and 'no' were found;" +
	            		 "2) None of the words 'yes' or 'no' were found";

                		client.emit('order-confirmation', JSON.stringify({status: status, output: output}));
                		// Store the error
		                ddb_put({'email': {'S': client.request.session.email},
					             'event_type': {'S': eventType},
					             'stage': {'S': 'ORDER_CONFIRMATION'},
					             'status': {'S': status},
					             'processed': {'S': output},
					             'server_timestamp': {'S': Date.now().toString()}});
                	}


                }

                else {
                	status = "TRANSCRIPTION_ERROR";
	            	output = "There has been a problem transcribing the audio";

	            	client.emit('order-confirmation', JSON.stringify({status: status, output: output}));

	            	// Store the error
	                ddb_put({'email': {'S': client.request.session.email},
				             'event_type': {'S': eventType},
				             'stage': {'S': 'ORDER_CONFIRMATION'},
				             'status': {'S': status},
				             'processed': {'S': output},
				             'server_timestamp': {'S': Date.now().toString()}});
                }

				// Clean up the order data afterwards
				//client.request.session.order = -1;
			});

        });

    }

    function processOrderConfirmation(transcription) {
    	const t = transcription.toLowerCase();
		// If both "yes" and "no" were said
	    if (t.includes("yes") && t.includes("no")) {
	    	return "PROCESSING_ERROR";
	    }
	    else {
	    	// If only one of "yes" and "no" was said, check which one.
	        if (t.includes("yes")){
	        	return "YES";
	        }
	        else (t.includes("no")){
	        	return "NO";
	        }
	        // If nothing from "yes", "no", or "cancel" was said, ask again.
	    	else:
	        	return "PROCESSING_ERROR";
	    }
    }

    function runPython38Script (scriptPath, arg, callback) {
    	const pythonProcess = spawn('python3.8',[scriptPath, arg]);
	    var output = '';
	    pythonProcess.stdout.on('data', function(data) {
	         output += data.toString();
	    });
	    pythonProcess.on('close', function(code) {
	        return callback(output);
	    });
    }

    /**
     * Setup Cloud STT Integration
     */
    function setupSTT(){
       //https://github.com/googleapis/gax-nodejs/blob/master/client-libraries.md#creating-the-client-instance
       // Creates a client
       speechClient = new speech.SpeechClient(googleServiceAccount);

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
	      }
	    }
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
      ttsClient = new textToSpeech.TextToSpeechClient(googleServiceAccount2);

      // Construct the request
      requestTTS = {
        voice: {
          languageCode: 'en-US',
          name: 'en-US-Wavenet-G',
        },
        // TODO It's possible to decrease the sampling rate to make the audio file as small as possible
        // Also possible to increase the speakingRate
        audioConfig: {
          audioEncoding: 'MP3', //'LINEAR16|MP3|AUDIO_ENCODING_UNSPECIFIED/OGG_OPUS'
          pitch: 3.2,
          speakingRate: 1
        }
      };
    }

     /*
      * STT - Transcribe Speech
      * @param audio file buffer
      */
    async function speechTranscription(audio, orderStage){

        if (orderStage === "PROCESS") {
        	requestSTT.config.speechContexts = orderSpeechContexts;

        }
        else if (orderStage === "CONFIRMATION") {
        	requestSTT.config.speechContexts = confirmationSpeechContexts;
        }

		//console.log(JSON.stringify(requestSTT, null, 4));

        requestSTT.audio = {
            content: audio
        };

        const responses = await speechClient.recognize(requestSTT);

        var transcription = "TRANSCRIPTION_ERROR";

       	// TODO when `confidence` < threshold, also return N/A
        if(responses[0] && responses[0].results[0] && responses[0].results[0].alternatives[0]) {
        	transcription = responses[0].results[0].alternatives[0].transcript;
        }

        return transcription;
    }

     /*
      * TTS text to an audio buffer
      * @param text - string written text
      */
    async function textToAudioBuffer(text) {
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