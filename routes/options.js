const express = require('express');
const storageService = require('../services/storage');
const exchangeService = require('../services/exchange');
const router = express.Router();

// Get API key status for user
router.get('/options', async function(req, res) {

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

	console.log('got into post /options');


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
				res.send({status: "API_KEY_UPDATED"});
            }
            else {
            	res.send({status: "API_KEY_UPDATE_ERROR"});
            }
        }
        else {
            res.send({status: "API_KEY_INVALID"});
        }
    }
});

module.exports = router;