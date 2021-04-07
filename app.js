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

    var AWS = require('aws-sdk'),
        express = require('express'),
        session = require('express-session'),
        dbStore = require('connect-dynamodb')({session: session}),
        attr = require('dynamodb-data-types').AttributeValue,
        bodyParser = require('body-parser'),
        cors = require('cors'),
        socketIo = require('socket.io'),
        ss = require('socket.io-stream'),
        path = require('path'),
        fs = require('fs'),
        http = require('http'),
        util = require('util'),
        hash = require('object-hash'),
        spawn = require('await-spawn'),
        binanceAPI = require('node-binance-api'),
        speech = require('@google-cloud/speech').v1p1beta1,
        textToSpeech = require('@google-cloud/text-to-speech'),
        request = require('request'),
        jwkToPem = require('jwk-to-pem'),
        jwt = require('jsonwebtoken');

    global.fetch = require('node-fetch');

    // TODO not sure this is needed, since we're serving wasm from nginx, not nodejs. Try commenting out
    express.static.mime.define({'application/wasm': ['wasm']});

    AWS.config.region = process.env.REGION;

    var ddb = new AWS.DynamoDB();
    var S3 = new AWS.S3();

    // Server variables
    var serverCredentials = {};
    var speechClient, requestSTT, ttsClient, requestTTS;
    var orderSpeechContexts, confirmationSpeechContexts;

    const port = process.env.PORT || 3000;
    const cookieMaxAge = 86400000;

    // Speech configuration
    const languageCode = 'en-US';
    const ttsVoiceName = 'en-US-Wavenet-G';
    const ttsPitch = 3.2;
    const ttsSpeakingRate = 1;
    const ttsEncoding = 'MP3';
    const sttEncoding = 'LINEAR16';
    const sttSampleRate = 16000;

    // Currencies
    const coins = {BTC: "Bitcoin", ETH: "Ether"};
    const fiatSymbol = "USDT";

    async function initVariables() {

        // Initialize Google Speech-to-Text API variables
        fs.readFile(process.env.EXPECTED_SENTENCES_FILE_PATH, (err, data) => {
            if (err) throw err;
                let phrases = JSON.parse(data);
                orderSpeechContexts = [{
                        phrases: phrases,
                        boost: 20.0
                }];
        });

        confirmationSpeechContexts = [{
                                       phrases: ['yes','no'],
                                       boost: 20.0
                                      }];

        // Initialize credentials
        await getServerCredentials();

        return true;
    }

    //  TODO do encryption in transit using https://github.com/aws/aws-dynamodb-encryption-python/tree/master/examples/src
    // As it is, it only has encryption in rest, which is default in DynamoDB.
    function getServerCredentials() {
        // Only resolved when all the data has been fetched
        return Promise.all([
            new Promise((resolve, reject) => {
                ddb.getItem({
                    'TableName': process.env.CREDENTIALS_TABLE,
                    'Key': {partition: {S: 'server'},
                            id: {S: 'google-service-account-key-1'}},
                }, function(err, data) {
                    if (err) {
                        reject('DB_ERROR: getBinanceAPIKey() [google-service-account-key-1] - ' + err);
                    } else {
                        serverCredentials['google-service-account-key-1'] = attr.unwrap(data.Item).json;
                        resolve();
                    }
                });
            }),
            new Promise((resolve, reject) => {
                ddb.getItem({
                    'TableName': process.env.CREDENTIALS_TABLE,
                    'Key': {partition: {S: 'server'},
                            id: {S: 'google-service-account-key-2'}},
                }, function(err, data) {
                    if (err) {
                        reject('DB_ERROR: getBinanceAPIKey() [google-service-account-key-2] - ' + err);
                    } else {
                        serverCredentials['google-service-account-key-2'] = attr.unwrap(data.Item).json;
                        resolve();
                    }
                });
            }),
            new Promise((resolve, reject) => {
                ddb.getItem({
                    'TableName': process.env.CREDENTIALS_TABLE,
                    'Key': {partition: {S: 'server'},
                            id: {S: 'cognito-user-pool'}},
                }, function(err, data) {
                    if (err) {
                        reject('DB_ERROR: getBinanceAPIKey() [cognito-user-pool] - ' + err);
                    } else {
                        serverCredentials['cognito-user-pool'] = attr.unwrap(data.Item).json;
                        resolve();
                    }
                });
            }),
            new Promise((resolve, reject) => {
                ddb.getItem({
                    'TableName': process.env.CREDENTIALS_TABLE,
                    'Key': {partition: {S: 'server'},
                            id: {S: 'cookie-session-secret'}},
                }, function(err, data) {
                    if (err) {
                        reject('DB_ERROR: getBinanceAPIKey() [cognito-user-pool] - ' + err);
                    } else {
                        serverCredentials['cookie-session-secret'] = attr.unwrap(data.Item).json.value;
                        resolve();
                    }
                });
            })
        ]);
    }

    function setupServer() {

        var app = express();

        app.use(cors());
        app.set('view engine', 'ejs');
        app.set('views', __dirname + '/views');

        app.use(bodyParser.urlencoded({extended : true}));
        app.use(bodyParser.json());

        // Necessary for session.cookie.secure == true, as per
        //https://www.npmjs.com/package/express-session
        app.set('trust proxy', 1); 

        var sess = session({
            store: new dbStore ({
                table: process.env.SESSIONS_TABLE,
                prefix: '',
                hashKey: 'id',
                client: ddb
            }),
            secret: serverCredentials['cookie-session-secret'],
            resave: false,
            saveUninitialized: false,
            cookie: {
                maxAge: cookieMaxAge,
                secure: true
            }
        });

        app.use(sess);


        app.use('/', require('./routes/routes'))
        app.use('/', require('./routes/account')(serverCredentials))

        // ROUTES GO HERE

        var server = http.createServer(app);

        server.listen(port, () => {
            console.log('Running server on port %s', port);
        });

        // TODO Move all this stuff into a separate file to hold just the routes, as in
        // https://www.youtube.com/watch?v=hbaebQFzT9M&list=PLaxxQQak6D_d5lL4zJ2D1fFK_U_24KY6E&index=9&ab_channel=WornOffKeys
        /*

        app.post('/auth', function(req, res) {
            var email = req.body.email;
            var password = req.body.password;

            if (email && password) {
                userLogin(email, password).then(function(result) {
                    req.session.order = -1;
                    req.session.cognitoData = result;
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
            // TODO CHECK FOR JWT TOKEN VALIDITY
            if (!req.session.cognitoData) {
                res.sendFile(path.join(__dirname + '/views/login.html'));
            } else {
                res.render('index', {
                    static_path: 'static',
                });
            }
        });

        app.get('/options', async function(req, res) {
            // TODO CHECK FOR JWT TOKEN VALIDITY?
            if (!req.session.cognitoData) {
                res.sendFile(path.join(__dirname + '/views/login.html'));
            } else {
                const sub = req.session.cognitoData.idToken.payload.sub;

                binanceAPIKey = await getBinanceAPIKey(sub);
                //console.log("--------> binanceAPIKey");
                //console.log(binanceAPIKey);

                if (binanceAPIKey.status == "API_KEY_DEFINED") {
                    const key = binanceAPIKey.output;
                    const hasValidAPIKey = await validateBinanceAPIKey(key.api_key, key.api_secret);

                    if (hasValidAPIKey) {
                        res.render('options', {
                            verified: true,
                        });
                    }
                    else {
                        res.render('options', {
                            verified: false,
                        });
                    }
                }
                else {
                     res.render('options', {
                        verified: false,
                    });   
                }
            }
        });

        app.post('/set-api-key', async function(req, res) {
            var apiKey = req.body.apiKey;
            var apiSecret = req.body.apiSecret;

            if (!req.session.cognitoData) {
                return;
            }
            else {
                const hasValidAPIKey = await validateBinanceAPIKey(apiKey, apiSecret);

                if (hasValidAPIKey) {
                    const sub = req.session.cognitoData.idToken.payload.sub;

                    ddbPut({
                        partition: {S: 'users'},
                        id: {S: sub},
                        binance_api_key:
                            {M: {
                                api_key: {S: apiKey},
                                api_secret: {S: apiSecret}
                            }
                        }
                    }, process.env.CREDENTIALS_TABLE).then(function(data){
                        res.send('API Key updated.');
                    }, function(err) {
                        res.send("There's been an error updating the API Key");
                    })
                }
                else {
                    res.send("Invalid API key.");
                }
            }
        });

        app.get('/signup', function(req, res) {
            res.sendFile(path.join(__dirname + '/views/signup.html'));
        });

        app.post('/signup', function(req, res) {
            var email = req.body.email;
            var password = req.body.password;
            var repeatPassword = req.body.repeatPassword;

            if (email && password && repeatPassword) {
                if (password == repeatPassword) {
                registerUser(email, password).then(function(result) {
                    res.send('Success. Check your e-mail and click the confirmation link.');
                }, function(err) {
                    res.send('Invalid data.');
                    //console.log('Invalid Sign-up:')
                    //console.log(err);
                })
                }
                else {
                    res.send("Passwords don't match.");
                }
            } else {
                res.send('Please fill-in all fields.');
            }
        });

        io = socketIo(server);

        // Share session variables with socket.io
        io.use(function(socket, next) {
            sess(socket.request, socket.request.res || {}, next);
        });

        // Listener, once the client connect to the server socket
        io.on('connect', (client) => {
            console.log(`[socket.io] Client connected [id=${client.id}]`);
            client.emit('server_setup', `[socket.io] Server connected [id=${client.id}]`);

            // When the user clicks "Start"
            client.on('start-monitoring', async function(data) {

                const sub = client.request.session.cognitoData.idToken.payload.sub;
                var status;
                // Only allow if user has valid API key stored
                const binanceAPIKey = await getBinanceAPIKey(sub);

                if (binanceAPIKey.status == "API_KEY_DEFINED") {
                    const key = binanceAPIKey.output;
                    const hasValidAPIKey = await validateBinanceAPIKey(key.api_key, key.api_secret);
                    if (hasValidAPIKey) {
                        status = "SUCCESS";
                        client.emit('start-monitoring', {status: true, output: ""});
                    }
                    else {
                        status = "API_KEY_INVALID";
                        client.emit('start-monitoring', {status: false, output: "Invalid API key"});
                    }
                }
                else {
                    status = "API_KEY_UNDEFINED";
                    client.emit('start-monitoring', {status: false, output: "Undefined API key."});
                }

                // TODO register errors
                ddbPut({sub: {S: client.request.session.cognitoData.idToken.payload.sub},
                        server_timestamp: {S: Date.now().toString()},
                        status: {S: status},
                        event_type: {S: 'START_MONITORING'},
                        client_timestamp: {S: data.timestamp.toString()}},
                        process.env.EVENTS_TABLE);

                // Putting this in almost every call to avoid the case where a stale
                // order stays in memory and then is executed by accident 
                client.request.session.order = -1;
            });

            // When the user clicks "Stop"
            client.on('stop-monitoring', function(data) {

                ddbPut({sub: {S: client.request.session.cognitoData.idToken.payload.sub},
                        server_timestamp: {S: Date.now().toString()},
                        event_type: {S: 'STOP_MONITORING'},
                        client_timestamp: {S: data.timestamp.toString()}},
                        process.env.EVENTS_TABLE);

                client.request.session.order = -1;
            });

            client.on('wake-word-detected', function(data) {

                ddbPut({sub: {S: client.request.session.cognitoData.idToken.payload.sub},
                        server_timestamp: {S: Date.now().toString()},
                        event_type: {S: 'WAKE_WORD_DETECTED'},
                        client_timestamp: {S: data.timestamp.toString()}},
                        process.env.EVENTS_TABLE);

                client.request.session.order = -1;
            });

            client.on('microphone-error', function(data) {

                ddbPut({sub: {S: client.request.session.cognitoData.idToken.payload.sub},
                        server_timestamp: {S: Date.now().toString()},
                        event_type: {S: 'MICROPHONE_ERROR_' + data.stage.toUpperCase()},
                        client_timestamp: {S: data.timestamp.toString()}},
                        process.env.EVENTS_TABLE);

                client.request.session.order = -1;
            });

            // Transcribe, process and validate order
            client.on('process-order', async function(data) {
                const eventType = 'PROCESS_ORDER';
                const clientTimestamp = data.timestamp.toString();
                const fileName = client.request.session.cognitoData.idToken.payload.sub + "-" + clientTimestamp + ".wav";
                // Get the dataURL which was sent from the client
                const dataURL = data.audio.dataURL.split(',').pop();
                // Convert it to a Buffer
                let fileBuffer = Buffer.from(dataURL, 'base64');

                // Send audio to transcribe and wait for the response
                const orderTranscription = await speechTranscription(fileBuffer, "PROCESS");

                //console.log(orderTranscription);

                var status, output;

                client.request.session.order = -1;

                if (orderTranscription != "TRANSCRIPTION_ERROR") {

                    // Process the order using python script
                    const orderProcessingResult = await runPython38Script(process.env.ORDER_PROCESSING_SCRIPT_PATH, orderTranscription);
                    const orderInfo = JSON.parse(orderProcessingResult);

                    status = orderInfo.status ? "VALID" : "PROCESSING_ERROR";
                    output = JSON.stringify({
                                transcription: orderTranscription,
                                processing: orderInfo.output});

                    // Send text result of order processing to client
                    client.emit('order-processing', JSON.stringify({status: status, output: orderInfo.output}));

                    // Get the order description audio data
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

                        try {
                            const audioArrayBuffer = await textToAudioBuffer(orderText);
                            client.emit('stream-audio-confirm-order', audioArrayBuffer);
                        }
                        catch (err){
                            console.log(err);
                        }
                    }
                }

                else {
                    status = "TRANSCRIPTION_ERROR";
                    output = "There has been a problem transcribing the audio.";

                    client.emit('order-processing', JSON.stringify({status: status, output: output}));
                }

                storeProcessingData({
                        sub: client.request.session.cognitoData.idToken.payload.sub,
                        eventType: eventType,
                        status: status,
                        output: output});

                storeAudioData({
                    sub: client.request.session.cognitoData.idToken.payload.sub,
                    eventType: eventType,
                    fileName: fileName,
                    fileBuffer: fileBuffer,
                    clientTimestamp: clientTimestamp});

            });

            // Transcribe, process and validate order confirmation
            client.on('confirm-order', async function(data) {
                const orderDetails = client.request.session.order
                const sub = client.request.session.cognitoData.idToken.payload.sub;
                const eventType = 'CONFIRM_ORDER';
                const clientTimestamp = data.timestamp.toString();
                const fileName = client.request.session.cognitoData.idToken.payload.sub + "-" + clientTimestamp + ".wav";
                // Get the dataURL which was sent from the client
                const dataURL = data.audio.dataURL.split(',').pop();
                // Convert it to a Buffer
                let fileBuffer = Buffer.from(dataURL, 'base64');
                // Send audio to transcribe and wait for the response
                const confirmationTranscription = await speechTranscription(fileBuffer, "CONFIRMATION");

                var status, output;

                if (confirmationTranscription != "TRANSCRIPTION_ERROR") {

                    const confirmationProcessing = processOrderConfirmation(confirmationTranscription);

                    if (confirmationProcessing != "PROCESSING_ERROR") {
                        if (confirmationProcessing == "YES") {
                            const binanceAPIKey = await getBinanceAPIKey(sub);

                            if (binanceAPIKey.status == "API_KEY_DEFINED") {
                                const key = binanceAPIKey.output;
                               // Pass order to the Binance API.
                                const exchangeResponse = await placeOrder("binance", orderDetails, true, key.api_key, key.api_secret);
                                if (exchangeResponse.status) {
                                     status = "ORDER_PLACED";
                                     output = "-";
                                }
                                else {
                                     status = "ORDER_REJECTED";
                                     output = exchangeResponse.output;
                                }
                            }
                            else {
                                status = "UNEXPECTED_ERROR";
                                output = "-";
                            }
                        }
                        else if (confirmationProcessing == "NO") {
                            status = "ORDER_CANCEL";
                            output = "-";
                        }
                        // Order resolved. Clean it up
                        client.request.session.order = -1;
                    }
                    else {
                        status = "PROCESSING_ERROR";
                        output = "There has been a problem processing the confirmation. One of the two happened:" +
                         "1) Both words 'yes' and 'no' were found;" +
                         "2) None of the words 'yes' or 'no' were found.";
                    }
                }

                else {
                    status = "TRANSCRIPTION_ERROR";
                    output = "There has been a problem transcribing the audio.";
                }

                client.emit('order-confirmation', JSON.stringify({status: status, output: output}));

                storeProcessingData({
                    sub: client.request.session.cognitoData.idToken.payload.sub,
                    eventType: eventType,
                    status: status,
                    output: output});

                storeAudioData({
                    sub: client.request.session.cognitoData.idToken.payload.sub,
                    eventType: eventType,
                    fileName: fileName,
                    fileBuffer: fileBuffer,
                    clientTimestamp: clientTimestamp});

            });
        });
        */
    }

    // For several Cognito examples, check:
    //https://medium.com/@prasadjay/amazon-cognito-user-pools-in-nodejs-as-fast-as-possible-22d586c5c8ec
    function registerUser(email, password){
        var attributeList = [];
        attributeList.push(new amazonCognitoIdentity.CognitoUserAttribute({Name:"email",Value:email}));

        return new Promise((resolve, reject) => {
            userPool.signUp(email, password, attributeList, null, (err, result) => {
                if (err) {
                    //console.log(err.message);
                    reject(err);
                    return;
                }
                cognitoUser = result.user;
                resolve(cognitoUser)
            });
        });
    }

    // TODO INTEGRATE (THIS IS FROM https://www.npmjs.com/package/amazon-cognito-identity-js - USE CASE 11)
    function changeUserPassword (email, oldPassword, newPassword) {
        // TODO TURN INTO PROMISE
        var userData = {
            Username : email,
            Pool : userPool
        };

        var cognitoUser = new amazonCognitoIdentity.CognitoUser(userData);

        cognitoUser.changePassword(oldPassword, newPassword, function(err, result) {
            if (err) {
                alert(err.message || JSON.stringify(err));
                return;
            }
            //console.log('call result: ' + result);
        });
    }

    /*
    // TODO perhaps in the future I'll have to use the token received from cognito for something
    // Check https://www.npmjs.com/package/amazon-cognito-identity-js
    // Use case 4. Authenticating a user and establishing a user session with the Amazon Cognito Identity service.
    function userLogin(email, password) {

        var authenticationDetails = new amazonCognitoIdentity.AuthenticationDetails({
            Username : email,
            Password : password,
        });

        var userData = {
            Username : email,
            Pool : userPool
        };

        var cognitoUser = new amazonCognitoIdentity.CognitoUser(userData);

        return new Promise((resolve, reject) => {
            cognitoUser.authenticateUser(authenticationDetails, {
                onSuccess: (result) => {
                    //console.log('successfully authenticated', result);
                    resolve(result);
                },
                onFailure: (err) => {
                    //console.log('error authenticating', err);
                    reject(err);
                }
            });
        });

    }
    */

    async function userLogout (email) {

        var userData = {
            Username : email,
            Pool : userPool
        };

        var cognitoUser = new amazonCognitoIdentity.CognitoUser(userData);

        await cognitoUser.signOut();

        req.session.order = -1;
        req.session.cognitoData = null;

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
	        else if (t.includes("no")){
	        	return "NO";
	        }
	        // If nothing from "yes", "no", or "cancel" was said, ask again.
	    	else {
	        	return "PROCESSING_ERROR";
	    	}
	    }
    }

    async function runPython38Script (scriptPath, arg) {
    	const pythonProcess = await spawn('python3.8',[scriptPath, arg]);
        return pythonProcess.toString();
    }

    /**
     * Setup Cloud STT Integration
     */
    function setupSTT(){

        const creds = serverCredentials['google-service-account-key-1'];
       //https://github.com/googleapis/gax-nodejs/blob/master/client-libraries.md#creating-the-client-instance
       // Creates a client
       speechClient = new speech.SpeechClient({
            credentials: {client_email: creds.client_email,
                          private_key: creds.private_key},
            projectId: creds.project_id
        });

        // Create the initial request object
	    // When streaming, this is the first call you will
	    // make, a request without the audio stream
	    // which prepares Dialogflow in receiving audio
	    // with a certain sampleRateHerz, encoding and languageCode
	    // this needs to be in line with the audio settings
	    // that are set in the client
        requestSTT = {
            config: {
                sampleRateHertz: sttSampleRate,
                encoding: sttEncoding,
                languageCode: languageCode
            }
        };
    }

    /**
     * Setup Cloud STT Integration
     */
    function setupTTS(){

        const creds = serverCredentials['google-service-account-key-2'];

        // Creates a client
        ttsClient = new textToSpeech.TextToSpeechClient({
            credentials: {client_email: creds.client_email,
                          private_key: creds.private_key},
            projectId: creds.project_id
        });

      // Construct the request
        requestTTS = {
            voice: {
                languageCode: languageCode,
                name: ttsVoiceName,
            },
        // TODO It's possible to decrease the sampling rate to make the audio file as small as possible
        // Also possible to increase the speakingRate
            audioConfig: {
                audioEncoding: ttsEncoding, //'LINEAR16|MP3|AUDIO_ENCODING_UNSPECIFIED/OGG_OPUS'
                pitch: ttsPitch,
                speakingRate: ttsSpeakingRate
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

    async function storeAudioData(data){

        var fileName;
        s3PutResult = await s3Put(data.fileName, data.fileBuffer);

        //console.log('------> storeAudioData')
        //console.log(s3PutResult);
        //console.log(data);

        if (s3PutResult.status) {
            fileName = data.fileName;
        }
        else {
            fileName = "UPLOAD_ERROR";
        }

        ddbPut({sub: {S: data.sub},
                server_timestamp: {S: Date.now().toString()},
                event_type: {S: data.eventType + '-SAVE_AUDIO'},
                file_name: {S: fileName},
                client_timestamp: {S: data.clientTimestamp}},
               process.env.EVENTS_TABLE)
    }

    function storeProcessingData(data) {
        // Put processing result into database
        ddbPut({sub: {S: data.sub},
                server_timestamp: {S: Date.now().toString()},
                event_type: {S: data.eventType + '-PROCESS'},
                status: {S: data.status},
                output: {S: data.output}},
                process.env.EVENTS_TABLE);
    }

    function ddbPut(item, tableName) {

        return new Promise(function(resolve, reject) {
            ddb.putItem({
                'TableName': tableName,
                'Item': item,
            }, function(err, data) {
                if (err) {
                    reject(err);
                } else {
                    resolve(data);
                }
            });
        });

    }

    function s3Put(fileName, fileContent) {

        // Setting up S3 upload parameters
        const params = {
            Bucket: process.env.EVENTS_BUCKET,
            Key: fileName, // File name you want to save as in S3
            Body: fileContent
        };

        // Uploading files to the bucket
        return new Promise(function(resolve, reject) {
            S3.upload(params, function(err, data) {
                if (err) {
                    resolve({status: false, output: err});
                } else {
                    resolve({status: true, output: data});
                }
            });
        });

    }

    async function validateBinanceAPIKey(apiKey, apiSecret) {
        const binanceValidate = new binanceAPI().options({
            APIKEY: apiKey,
            APISECRET: apiSecret,
            test: true
        });
        // Make an API call just to check if the credentials are valid
        var exchangeResponse = await binanceValidate.futuresOpenOrders();

        //console.log(exchangeResponse);

        if ("code" in exchangeResponse) {
            // Invalid API key
            return false;
        }
        else {
            return true;
        }
    }

    function getBinanceAPIKey(sub) {

        return new Promise((resolve, reject) => {
            ddb.getItem({
                'TableName': process.env.CREDENTIALS_TABLE,
                'Key': {partition: {S: 'users'}, id: {S: sub}},
            }, function(err, data) {
                if (err) {
                    resolve({status:"DB_ERROR", output: err});
                } else {
                    if(typeof data.Item !== 'undefined') {
                        resolve({status:'API_KEY_DEFINED', output: attr.unwrap(data.Item).binance_api_key});
                    }
                    // If the user doesn't yet have an API key defined, reject
                    else {
                        resolve({status:"API_KEY_UNDEFINED", output: "-"});
                    }
                }
            });
        });
    }

    async function placeOrder(exchange, orderDetails, testMode, apiKey, apiSecret) {

        const orderSymbol = orderDetails.ticker + fiatSymbol;
        // Actual response from the exchange API
        var exchangeResponse;
        // Processed response to pass to the user
        var eResponse = {status: true, output: ''};

        //console.log(orderDetails);

        if (exchange == 'binance') {
            var binance = new binanceAPI().options({
                APIKEY: apiKey,
                APISECRET: apiSecret,
                test: testMode
            });
            // Set leverage value
            // TODO this doesn't affect the leverage with which the order
            // is placed. Although, when I do refresh on the page, the set leverage
            // on binance updates.
            //await binance.futuresLeverage( 'BTCUSDT', 2 );
            if (testMode) {
                if (orderDetails.polarity == 'buy') {
                    if (orderDetails.type == 'market') {
                        exchangeResponse = await binance.futuresMarketBuy(orderSymbol, orderDetails.size);
                    }
                    else if (orderDetails.type == 'limit') {
                        exchangeResponse = await binance.futuresBuy(orderSymbol, orderDetails.size, orderDetails.price);
                    }
                    else if (orderDetails.type == 'range') {
                        const x = 0;
                    }
                }
                else if (orderDetails.polarity == 'sell') {
                    if (orderDetails.type == 'market') {
                        exchangeResponse = await binance.futuresMarketSell(orderSymbol, orderDetails.size);
                    }
                    else if (orderDetails.type == 'limit') {
                        exchangeResponse = await binance.futuresSell(orderSymbol, orderDetails.size, orderDetails.price);
                    }
                    else if (orderDetails.type == 'range') {
                        const x = 0;
                    }
                }
            }

            //console.log(exchangeResponse);

            // Error response objects are of the form {code:<CODE>, msg:<MSG>}
            // Only in the case of error does the response have the fields `code` and `msg`
            if ("code" in exchangeResponse) {
                eResponse = {status: false, output: exchangeResponse.msg}
            }

        }

        return eResponse

    }

    initVariables().then(
        (result) => {
            setupSTT();
            setupTTS();
            setupServer();
        }
    );

}