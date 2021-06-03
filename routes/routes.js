const express = require('express');
const router = express.Router();

router.get('/', (req, res) => {

    res.render('index', {
        static_path: 'static',
    });
})

module.exports = router