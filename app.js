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
        request = require('request'),
        jwkToPem = require('jwk-to-pem'),
        jwt = require('jsonwebtoken'),
        storageService = require('./services/storage');

    global.fetch = require('node-fetch');

    // TODO not sure this is needed, since we're serving wasm from nginx, not nodejs. Try commenting out
    express.static.mime.define({'application/wasm': ['wasm']});

    AWS.config.region = process.env.REGION;

    var ddb = new AWS.DynamoDB();
    var S3 = new AWS.S3();

    // Server variables
    var serverCredentials;
    var orderSpeechContexts, confirmationSpeechContexts;

    const port = process.env.PORT || 3000;
    const cookieMaxAge = 86400000;

    // TODO PUT THIS INTO CONFIG FILE

    // Speech configuration
    const languageCode = 'en-US';
    const ttsVoiceName = 'en-US-Wavenet-G';
    const ttsPitch = 3.2;
    const ttsSpeakingRate = 1;
    const ttsEncoding = 'MP3';
    const sttEncoding = 'LINEAR16';
    const sttSampleRate = 16000;

    async function init() {

        const {orderSpeechContexts, confirmationSpeechContexts} = await storageService.getSTTContexts();

        console.log(orderSpeechContexts)
        console.log(confirmationSpeechContexts)

        // Initialize credentials
        const serverCredentials = await storageService.getServerCredentials();+

        console.log(serverCredentials)

        // Unpack
        serverCredentials = Object.assign(...serverCredentials);
        console.log(serverCredentials)

        return true;
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
        app.use('/', require('./routes/user')(serverCredentials))

        var server = http.createServer(app);

        server.listen(port, () => {
            console.log('Running server on port %s', port);
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

            var orderService = require('./services/order')(
                client,
                {
                    googleCloudServiceAccountKeys: [serverCredentials['google-service-account-key-1'],
                                                    serverCredentials['google-service-account-key-2']]
                },
                {
                    tts: {
                        languageCode: languageCode,
                        encoding: ttsEncoding,
                        voiceName: ttsVoiceName,
                        pitch: ttsPitch,
                        speakingRate: ttsSpeakingRate
                    },
                    stt: {
                        languageCode: languageCode,
                        encoding: sttEncoding,
                        sampleRate: sttSampleRate,
                        speechContexts: {
                            order: orderSpeechContexts,
                            confirmation: confirmationSpeechContexts
                        }
                    }
                }
            );

            // When the user clicks "Start"
            client.on('start-monitoring', data => orderService.startMonitoring(data));

            // When the user clicks "Stop"
            client.on('stop-monitoring', data => orderService.stopMonitoring(data));

            // When porcupine detects a wake-word
            client.on('wake-word-detected', data => orderService.wakeWordDetected(data));

            // When the microhpone fails
            client.on('microphone-error', data => orderService.microphoneError(data));

            // Transcribe, process and validate order
            client.on('process-order', data => orderService.processOrder(data));

            // Transcribe, process and validate order confirmation
            client.on('confirm-order', data => orderService.confirmOrder(data));

        });

    }

    init().then( result => { setupServer() });

}