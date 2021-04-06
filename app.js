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
        spawn = require("child_process").spawn,
        binanceAPI = require('node-binance-api'),
        speech = require('@google-cloud/speech').v1p1beta1,
        textToSpeech = require('@google-cloud/text-to-speech'),
        amazonCognitoIdentity = require('amazon-cognito-identity-js'),
        request = require('request'),
        jwkToPem = require('jwk-to-pem'),
        jwt = require('jsonwebtoken');

    global.fetch = require('node-fetch');

    // TODO not sure this is needed, since we're serving wasm from nginx, not nodejs. Try commenting out
    express.static.mime.define({'application/wasm': ['wasm']});

    AWS.config.region = process.env.REGION;

    var ddb = new AWS.DynamoDB();
    var S3 = new AWS.S3();

    // Server credentials
    // Using two service accounts for Google because if I only used one, I get an error. Apparently two
    // services can't access the same service account in simultaneous.
    var serverCredentials = {};

    // TODO Put this in options.config
    var cognitoPoolData = {
        UserPoolId : "us-east-2_XVWGKwmzC",
        ClientId : "4rh5g79v3qme18vk6rutfpsjup" // App Client id
    };
    //const pool_region = 'us-east-2';
    const userPool = new amazonCognitoIdentity.CognitoUserPool(cognitoPoolData);
    const cookieMaxAge = 86400000;

    var server;
    var sessionId, sessionClient, sessionPath, request;
    var speechClient, requestSTT, ttsClient, requestTTS, mediaTranslationClient, requestMedia;
    const port = process.env.PORT || 3000;

    // Credentials for the Google Service Account

    //const googleServiceAccount = {keyFilename: process.env.GOOGLE_SERVICE_ACCOUNT_FILE_PATH};
    //const googleServiceAccount2 = {keyFilename: process.env.GOOGLE_SERVICE_ACCOUNT2_FILE_PATH};
    // STT configuration
    const languageCode = 'en-US';
    const encoding = 'LINEAR16';
    const sampleRateHertz = 16000;

    // Currencies
    const coins = {BTC: "Bitcoin", ETH: "Ether"};
    const fiatSymbol = "USDT";

    // Speech Contexts for Google Speech API
    var orderSpeechContexts, confirmationSpeechContexts;

    fs.readFile('speech_order_expected_sentences.json', (err, data) => {
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


    async function initVariables() {
        // Initialize all the necessary variables for the server to run
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
                        reject('DB_ERROR: getBinanceAPIKey() [google-service-account-key-1]');
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
                        reject('DB_ERROR: getBinanceAPIKey() [google-service-account-key-2]');
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
                        reject('DB_ERROR: getBinanceAPIKey() [cognito-user-pool]');
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
                        reject('DB_ERROR: getBinanceAPIKey() [cognito-user-pool]');
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

        // X-Ray debug logs
        //var AWSXRay = require('aws-xray-sdk');
        //app.use(AWSXRay.express.openSegment('VorderApp'));

        // Move all this stuff into a separate file to hold just the routes, as in
        // https://www.youtube.com/watch?v=hbaebQFzT9M&list=PLaxxQQak6D_d5lL4zJ2D1fFK_U_24KY6E&index=9&ab_channel=WornOffKeys

        app.get('/', function(req, res) {
            if (!req.session.cognitoData) {
                res.sendFile(path.join(__dirname + '/views/login.html'));
            } else {
                res.render('index', {
                    static_path: 'static',
                });
            }
        });

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
            // TODO CHECK FOR JWT TOKEN VALIDITY?
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

                    ddbPutOrUpdateCredentials({
                        partition: {S: 'users'},
                        id: {S: sub},
                        binance_api_key:
                            {M: {
                                api_key: {S: apiKey},
                                api_secret: {S: apiSecret}
                            }
                        }
                    }).then(function(data){
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
                ddbPutEvent({email: {S: client.request.session.cognitoData.idToken.payload.email},
                             status: {S: status},
                             event_type: {S: 'START_MONITORING'},
                             client_timestamp: {S: data.timestamp.toString()},
                             server_timestamp: {S: Date.now().toString()}});

                // Putting this in almost every call to avoid the case where a stale
                // order stays in memory and then is executed by accident 
                client.request.session.order = -1;
            });

            // When the user clicks "Stop"
            client.on('stop-monitoring', function(data) {

                ddbPutEvent({email: {S: client.request.session.cognitoData.idToken.payload.email},
                             event_type: {S: 'STOP_MONITORING'},
                             client_timestamp: {S: data.timestamp.toString()},
                             server_timestamp: {S: Date.now().toString()}});

                client.request.session.order = -1;
            });

            client.on('wake-word-detected', function(data) {

                ddbPutEvent({email: {S: client.request.session.cognitoData.idToken.payload.email},
                             event_type: {S: 'WAKE_WORD_DETECTED'},
                             client_timestamp: {S: data.timestamp.toString()},
                             server_timestamp: {S: Date.now().toString()}});

                client.request.session.order = -1;
            });

            client.on('microphone-error', function(data) {

                ddbPutEvent({email: {S: client.request.session.cognitoData.idToken.payload.email},
                             event_type: {S: 'MICROPHONE_ERROR_' + data.stage.toUpperCase()},
                             client_timestamp: {S: data.timestamp.toString()},
                             server_timestamp: {S: Date.now().toString()}});

                client.request.session.order = -1;
            });

            // Transcribe, process and validate order
            client.on('process-order', async function(data) {
                const eventType = 'PROCESS_ORDER';
                const clientTimestamp = data.timestamp.toString();
                const fileName = client.request.session.cognitoData.idToken.payload.email + "-" + clientTimestamp + ".wav";
                // Get the dataURL which was sent from the client
                const dataURL = data.audio.dataURL.split(',').pop();
                // Convert it to a Buffer
                let fileBuffer = Buffer.from(dataURL, 'base64');

                // Send audio to transcribe and wait for the response
                const orderTranscription = await speechTranscription(fileBuffer, "PROCESS");

                console.log(orderTranscription);

                var status, output;

                client.request.session.order = -1;

                if (orderTranscription != "TRANSCRIPTION_ERROR") {

                    // Process the order using python script
                    runPython38Script ("order_processing.py", orderTranscription, (output) => {

                        const orderInfo = JSON.parse(output);

                        status = orderInfo.status ? "VALID" : "PROCESSING_ERROR";
                        output = orderInfo.output;

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

                            textToAudioBuffer(orderText).then(function(arrayBuffer){
                                client.emit('stream-audio-confirm-order', arrayBuffer);
                            }).catch(function(e){
                                console.log(e);
                            });
                        }

                        storeProcessingData({
                            email: client.request.session.cognitoData.idToken.payload.email,
                            eventType: eventType,
                            status: status,
                            output: JSON.stringify({
                                transcription: orderTranscription,
                                processing: orderInfo.output})});
                    });
                }

                else {
                    status = "TRANSCRIPTION_ERROR";
                    output = "There has been a problem transcribing the audio.";

                    client.emit('order-processing', JSON.stringify({status: status, output: output}));

                    storeProcessingData({
                        email: client.request.session.cognitoData.idToken.payload.email,
                        eventType: eventType,
                        status: status,
                        output: output});
                }

                storeAudioData({
                    email: client.request.session.cognitoData.idToken.payload.email,
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
                const fileName = client.request.session.cognitoData.idToken.payload.email + "-" + clientTimestamp + ".wav";
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
                    email: client.request.session.cognitoData.idToken.payload.email,
                    eventType: eventType,
                    status: status,
                    output: output});

                storeAudioData({
                    email: client.request.session.cognitoData.idToken.payload.email,
                    eventType: eventType,
                    fileName: fileName,
                    fileBuffer: fileBuffer,
                    clientTimestamp: clientTimestamp});

            });
        });
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
        const RefreshToken = new amazonCognitoIdentity.CognitoRefreshToken({RefreshToken: "your_refresh_token_from_a_previous_login"});

        const userPool = new amazonCognitoIdentity.CognitoUserPool(poolData);

        const userData = {
            Username: "sample@gmail.com",
            Pool: userPool
        };

        const cognitoUser = new amazonCognitoIdentity.CognitoUser(userData);

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

    function storeAudioData(data){
        console.log("-----> storeAudioData");
        console.log(data);
	    // Put audio file record into database and upload audio file to S3 bucket
	    // (Just putting this in the end to return the response ASAP to the client)
	    s3Put(data.fileName, data.fileBuffer).then(function(data) {
	        ddbPutEvent({email: {S: data.email},
	                    event_type: {S: data.eventType + '-SAVE_AUDIO'},
	                    file_name: {S: data.fileName},
	                    client_timestamp: {S: data.clientTimestamp},
	                    server_timestamp: {S: Date.now().toString()}});

	    }, function(err) {
	        ddbPutEvent({email: {S: data.email},
	                     event_type: {S: data.eventType + '-SAVE_AUDIO'},
	                     file_name: {S: "UPLOAD_ERROR"},
	                     client_timestamp: {S: data.clientTimestamp},
	                     server_timestamp: {S: Date.now().toString()}});
	    });

    }

    function storeProcessingData(data) {
        console.log("-----> storeProcessingData");
        console.log(data);
    	// Put processing result into database
	    ddbPutEvent({email: {S: data.email},
	                 event_type: {S: data.eventType + '-PROCESS'},
	                 status: {S: data.status},
	                 output: {S: data.output},
	                 server_timestamp: {S: Date.now().toString()}});
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
	        sampleRateHertz: sampleRateHertz,
	        encoding: encoding,
	        languageCode: languageCode
	      }
	    }
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

    function ddbPutEvent(item) {

        //console.log(item);

        // calculate unique hash for the item id (uses SHA1)
        item.id = {'S': hash(item)};

        ddb.putItem({
            'TableName': process.env.EVENTS_TABLE,
            'Item': item,
            'Expected': { id: { Exists: false } }
        }, function(err, data) {
            if (err) {
                console.log('DDB Error: ' + err);
            } else {
                //console.log('DDB Success!');
            }
        });

    }

    function ddbPutOrUpdateCredentials(item) {

        ddb.putItem({
            'TableName': process.env.CREDENTIALS_TABLE,
            'Item': item,
        }, function(err, data) {
            if (err) {
                console.log('DDB Error: ' + err);
            } else {
                //console.log('DDB Success!');
            }
        });

        return new Promise(function(resolve, reject) {
            ddb.putItem({
                'TableName': process.env.CREDENTIALS_TABLE,
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
                    reject(err);
                } else {
                    resolve(data);
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

        console.log(orderDetails);

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

            console.log(exchangeResponse);

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