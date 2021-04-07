const express = require('express');
const router = express.Router();

router.get('/', (req, res) => {
	if (!req.session.cognitoData) {
        res.render('login.ejs', {});
    } else {
        res.render('index.ejs', {
            static_path: 'static',
        });
    }
})

module.exports = router