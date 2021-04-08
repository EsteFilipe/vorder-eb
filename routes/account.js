var AWS = require('aws-sdk'),
    attr = require('dynamodb-data-types').AttributeValue,
	express = require('express'),
	amazonCognitoIdentity = require('amazon-cognito-identity-js'),
	binanceAPI = require('node-binance-api');

/*

router.post('/set-api-key', async function(req, res) {
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

router.get('/signup', function(req, res) {
    res.sendFile(path.join(__dirname + '/views/signup.html'));
});

router.post('/signup', function(req, res) {
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

*/

module.exports = function(serverCredentials){

	const router = express.Router();
	var ddb = new AWS.DynamoDB();

	const userPool = new amazonCognitoIdentity.CognitoUserPool({
	    UserPoolId : serverCredentials['cognito-user-pool'].user_pool_id,
	    ClientId : serverCredentials['cognito-user-pool'].client_id // App Client id
	});

	router.post('/auth', function(req, res) {
	    var email = req.body.email;
	    var password = req.body.password;

	    if (email && password) {
	        userLogin(email, password).then(function(result) {
	            req.session.order = -1;
	            req.session.cognitoData = result;
	            res.redirect('/');
	        }, function(err) {
	            res.send('Incorrect e-mail and/or password.');
	            console.log(err);
	        })
	    } else {
	        res.send('Please enter e-mail and password.');
	    }
	});

	router.get('/options', async function(req, res) {
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

    return router;
}