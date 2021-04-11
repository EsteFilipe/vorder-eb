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
        http = require('http'),
        storageService = require('./services/storage'),
        config = require('./config/config')

    global.fetch = require('node-fetch');

    AWS.config.region = process.env.REGION;

    var ddb = new AWS.DynamoDB();
    var S3 = new AWS.S3();

    async function init() {

        // Get Speech to Text contexts
        const speechContexts = await storageService.getSTTContexts(config.speech.stt.contextFilePaths)
        config.speech.stt.contexts.order = speechContexts.orderSpeechContexts
        config.speech.stt.contexts.confirmation = speechContexts.confirmationSpeechContexts

        // Get server credentials
        const serverCredentials = await storageService.getServerCredentials()
        // Unpack
        config.server.credentials = Object.assign(...serverCredentials)

        console.log(config)

        return true
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
            secret: config.server.credentials['cookie-session-secret'],
            resave: false,
            saveUninitialized: false,
            cookie: {
                maxAge: config.server.cookieMaxAge,
                secure: true
            }
        });

        app.use(sess);
        app.use('/', require('./routes/routes'))
        app.use('/', require('./routes/user')(config.server.credentials['cognito-user-pool']))

        var server = http.createServer(app);

        server.listen(port, () => {
            console.log('Running server on port %s', port);
        });

        io = socketIo(server);
        // Share session variables with socket.io
        io.use(function(socket, next) {
            sess(socket.request, socket.request.res || {}, next);
        });
        // Listener, once the client connects to the server socket
        io.on('connect', (client) => {
            console.log(`[socket.io] Client connected [id=${client.id}]`);
            client.emit('server_setup', `[socket.io] Server connected [id=${client.id}]`);

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

    init().then( result => { setupServer() });

}