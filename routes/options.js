const express = require('express');
const storageService = require('../services/storage');
const exchangeService = require('../services/exchange');

module.exports = function(){

	const router = express.Router();

	// Get API key status for user
	router.get('/options', async function(req, res) {

		console.log("here")

		// Verification has already been handled in the first middleware - we can trust the username
        const sub = req.headers.username;
        const keys = await storageService.getAPIKeys(sub, 'binance');

        if (keys.status == "API_KEY_DEFINED") {
            const hasValidAPIKeys = await exchangeService.validateAPIKeys({
            	apiKey: keys.output.api_key,
            	apiSecret: keys.output.api_secret
            }, 'binance');

            if (hasValidAPIKeys) {
                res.send({status: "API_KEY_VALID"});
            }
            else {
                res.send({status: "API_KEY_INVALID"});
            }
        }
        else {
            res.send({status: "API_KEY_UNDEFINED"});
        }

	});

	// Set new API key

	router.post('/options', async function(req, res) {
	    var apiKey = req.body.apiKey;
	    var apiSecret = req.body.apiSecret;

	    if (!req.session.cognitoData) {
	        return;
	    }
	    else {

	    	const keys = {apiKey: apiKey, apiSecret: apiSecret};
	        const hasValidAPIKeys = await exchangeService.validateAPIKeys(
	        	keys, 'binance');

	        if (hasValidAPIKeys) {
	            const sub = req.session.cognitoData.idToken.payload.sub;

	            const setAPIKeys = await storageService.setAPIKeys(sub, 'binance', keys);

	            if (setAPIKeys.status) {
					res.send('API Key updated.');
	            }
	            else {
	            	res.send("There's been an error updating the API Key");
	            }
	        }
	        else {
	            res.send("Invalid API key.");
	        }
	    }
	});


	router.post('/options', function(req, res) {
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




    return router;
}