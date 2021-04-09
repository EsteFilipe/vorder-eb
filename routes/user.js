const express = require('express');
const storageService = require('../services/storage');
const exchangeService = require('../services/exchange');

module.exports = function(serverCredentials){

	const router = express.Router();
	const userService = require('../services/user')(serverCredentials['cognito-user-pool']);

	router.post('/auth', function(req, res) {
	    var email = req.body.email;
	    var password = req.body.password;

	    if (email && password) {
	        userService.login(email, password).then(function(result) {
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

	router.get('/signup', function(req, res) {
        res.render('signup');
	});

	router.post('/signup', function(req, res) {
	    var email = req.body.email;
	    var password = req.body.password;
	    var repeatPassword = req.body.repeatPassword;

	    if (email && password && repeatPassword) {
	        if (password == repeatPassword) {
	        userService.registerUser(email, password).then(function(result) {
	            res.send('Success. Check your e-mail and click the confirmation link.');
	        }, function(err) {
	            res.send('Invalid data.');
	        })
	        }
	        else {
	            res.send("Passwords don't match.");
	        }
	    } else {
	        res.send('Please fill-in all fields.');
	    }
	});


	router.get('/options', async function(req, res) {
	    // TODO CHECK FOR JWT TOKEN VALIDITY?
	    if (!req.session.cognitoData) {
	        res.redirect('/');
	    } else {
	        const sub = req.session.cognitoData.idToken.payload.sub;

	        binanceAPIKey = await storageService.getAPIKey(sub, 'binance');

	        if (binanceAPIKey.status == "API_KEY_DEFINED") {
	            const apiKey = {apiKey: binanceAPIKey.output.api_key, apiSecret: binanceAPIKey.output.api_secret};
	            const hasValidAPIKey = await exchangeService.validateAPIKey(apiKey, 'binance');

	            console.log('---> hasValidAPIKey')
	            console.log(hasValidAPIKey)

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

    */

    return router;
}