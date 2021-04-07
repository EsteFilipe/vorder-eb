const express = require('express');
const router = express.Router();

router.get('/', (req, res) => {
	if (!req.session.cognitoData) {
        res.render('login', {});
    } else {
        res.render('index', {
            static_path: 'static',
        });
    }
})

module.exports = router