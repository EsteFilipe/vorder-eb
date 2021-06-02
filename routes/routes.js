const express = require('express');
const router = express.Router();

router.get('/', (req, res) => {
	if (!req.session.cognitoData) {
        res.render('login');

        // EXPERIMENTING FOR COGNITO TOKENS
        const amazonCognitoIdentity = require('amazon-cognito-identity-js');
        var poolData = {
            UserPoolId: 'us-east-1_wKO7h3kGU', // Your user pool id here
            ClientId: '32tdipotlt2o43i8m7oq3mjncq', // Your client id here
        };
        var userPool = new AmazonCognitoIdentity.CognitoUserPool(poolData);
        var cognitoUser = userPool.getCurrentUser();
        console.log(cognitoUser);
        // END EXPERIMENT

    } else {
        res.render('index', {
            static_path: 'static',
        });
    }
})

module.exports = router