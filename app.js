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
        //session = require('express-session'),
        dbStore = require('connect-dynamodb')({session: session}),
        attr = require('dynamodb-data-types').AttributeValue,
        bodyParser = require('body-parser'),
        cors = require('cors'),
        socketIo = require('socket.io'),
        http = require('http'),
        storageService = require('./services/storage'),
        utils = require('./helpers/utils'),
        config = require('./config/config');

    global.fetch = require('node-fetch');

    AWS.config.region = process.env.REGION;

    var ddb = new AWS.DynamoDB();
    var S3 = new AWS.S3();


    async function init() {

        const ebEnvName = await utils.getElasticBeanstalkEnvName();

        // Production
        if (ebEnvName === 'Vorder-env') {
            if (config.server.obfuscateJS.production) {
                const r = await utils.obfuscateAndReplaceJSFile('vorder.ejs');
            }
        }
        // Development
        else if (ebEnvName === 'Vorder-env-dev') {
            process.env.EVENTS_TABLE += '-dev';
            process.env.SESSIONS_TABLE += '-dev';
            process.env.CREDENTIALS_TABLE += '-dev';
            process.env.EVENTS_BUCKET += '-dev';
            if (config.server.obfuscateJS.development) {
                const r = await utils.obfuscateAndReplaceJSFile('vorder.ejs');
            }
        }

        // Get server credentials
        const serverCredentials = await storageService.getServerCredentials()
        // Unpack
        config.server.credentials = Object.assign(...serverCredentials)

        // Get Speech to Text contexts
        if (!config.speech.stt.contextsConf && !config.speech.stt.adaptations) {
            return {status: false, 
                    output: "At least one of `contextsConf` and `adaptation` has to be non-null."}
        }

        const speechService = require('./services/speech')([
            config.server.credentials['google-service-account-key-1'],
            config.server.credentials['google-service-account-key-2']],
            config.speech
        )

        if (config.speech.stt.contextsConf) {
            const speechContexts = await speechService.getSTTContexts()
            config.speech.stt.contexts = {}
            config.speech.stt.contexts.process = speechContexts.processSpeechContexts;
            config.speech.stt.contexts.confirmation = speechContexts.confirmationSpeechContexts;
            console.log("---> Contexts have been set:");
            console.log(JSON.stringify(config.speech.stt.contexts, null, 4));
        }
        if (config.speech.stt.adaptations) {
            if (config.speech.stt.adaptations.create) {
                const output = await speechService.createAdaptationsFromConfig();
                console.log(output);
            }
            else {
                console.log("Adaptations have not been set anew - we'll be using the ones previously defined.");
                if (config.speech.stt.adaptations.list) {
                    const customClasses = await speechService.listCustomClasses();
                    const phraseSets = await speechService.listPhraseSet();
                    const classesAndSets = speechService.prettifyListAdaptations(customClasses, phraseSets);
                    console.log(classesAndSets);
                }
            }
        }

        if (config.speech.stt.testAccuracy) {
            // Test transcription performance
            const orderProcessingTest = require('./test/order-processing')(config);
            const o = await orderProcessingTest.test();
        }

        // Get JSON file with public key for validating the client Cognito JWTs
        const cognitoRegion = config.server.credentials['cognito-user-pool']['region']
        const cognitoUserPoolId = config.server.credentials['cognito-user-pool']['user_pool_id']
        utils.downloadCognitoPublicKeys(cognitoRegion, cognitoUserPoolId, process.env.JWT_PUBLIC_KEY_FILE_PATH);

        return {status: true, 
        output: ""}

    }

    function setupServer() {

        console.log('Setting up server...')

        var app = express();
        app.use(cors());
        app.set('view engine', 'ejs');
        app.set('views', __dirname + '/views');
        app.use(bodyParser.urlencoded({extended : true}));
        app.use(bodyParser.json());

        // Necessary for session.cookie.secure == true, as per
        //https://www.npmjs.com/package/express-session
        app.set('trust proxy', 1); 

        /*
        var sess = session({
            store: new dbStore ({
                table: process.env.SESSIONS_TABLE,
                prefix: '',
                hashKey: 'id',
                client: ddb
            }),
            secret: config.server.credentials['cookie-session-secret'],
            resave: false,
            saveUninitialized: false,
            cookie: {
                maxAge: config.server.cookieMaxAge,
                secure: true
            }
        });
        */

        app.use(sess);
        app.use('*', require('./routes/user')(config.server.credentials['cognito-user-pool']));

        var server = http.createServer(app);

        server.listen(config.server.port, () => {
            console.log('Running server on port %s', config.server.port);
        });

        io = socketIo(server);

        // Socket.io authentication using the Cognito JWT sent by the client
        io.use(async function(socket, next){
          if (socket.handshake.query && socket.handshake.query.idToken && socket.handshake.query.username){

            const validationResult = await utils.validateClientJWT(
                process.env.JWT_PUBLIC_KEY_FILE_PATH, 
                config.server.credentials['cognito-user-pool']['client_id'], 
                socket.handshake.query.idToken, 
            );

            // If validation script returned false status, fail
            if (!validationResult.status) {
                next(new Error('Authentication error'));
            }
            else {
                // If username doesn't match, fail
                if (socket.handshake.query.username != validationResult.output.sub) {
                    next(new Error("Authentication error: username doesn't match (something very wrong happened)"));
                }
                // Else succeed
                else {
                    console.log(`${validationResult.output.sub}: socket.io authentication succeeded`)
                    next();
                }
            }
          }
          else {
            next(new Error('Authentication error'));
          }    
        });

        // Share session variables with socket.io
        io.use(function(socket, next) {
            sess(socket.request, socket.request.res || {}, next);
        });

        // Listener, once the client connects to the server socket
        io.on('connect', (client) => {
            console.log(`[socket.io] Client connected [id=${client.id}; sub=${client.handshake.query.username}]`);
            client.emit('server_setup', `[socket.io] Server connected [id=${client.id}; sub=${client.handshake.query.username}]`);

            var orderService = require('./services/order')(
                client, 
                [
                 config.server.credentials['google-service-account-key-1'],
                 config.server.credentials['google-service-account-key-2']
                ],
                config.speech
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

    init().then( result => { 
        if (result.status) {
            console.log(`init() function success.`)
            setupServer();
        }
        else {
            console.log(`init() function: error: ${result.output}`)
            return
        }
    });

}