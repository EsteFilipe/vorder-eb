// PUT HERE ALL THE METHODS TO INTERACT WITH DYNAMODB
const AWS = require('aws-sdk'),
	  attr = require('dynamodb-data-types').AttributeValue;

const ddb = new AWS.DynamoDB(),
	  S3 = new AWS.S3(),



var StorageService = function() {

}

StorageService.prototype.getAPIKey = function(sub, exchange) {
	const dbAPIkeyField = exchange + '_api_key';
    return new Promise((resolve, reject) => {
        ddb.getItem({
            'TableName': process.env.CREDENTIALS_TABLE,
            'Key': {partition: {S: 'users'}, id: {S: sub}},
            'ProjectionExpression': dbAPIkeyField
        }, function(err, data) {
            if (err) {
                resolve({status:"DB_ERROR", output: err});
            } else {
                if(typeof data.Item !== 'undefined') {
                    resolve({status:'API_KEY_DEFINED', output: attr.unwrap(data.Item)});
                }
                // If the user doesn't yet have an API key defined, reject
                else {
                    resolve({status:"API_KEY_UNDEFINED", output: "-"});
                }
            }
        });
    });
}

StorageService.prototype.setAPIKey = async function(sub, exchange, apiKey) {

}


/*

async function storeAudioData(data){

    var fileName;
    s3PutResult = await s3Put(data.fileName, data.fileBuffer);

    //console.log('------> storeAudioData')
    //console.log(s3PutResult);
    //console.log(data);

    if (s3PutResult.status) {
        fileName = data.fileName;
    }
    else {
        fileName = "UPLOAD_ERROR";
    }

    ddbPut({sub: {S: data.sub},
            server_timestamp: {S: Date.now().toString()},
            event_type: {S: data.eventType + '-SAVE_AUDIO'},
            file_name: {S: fileName},
            client_timestamp: {S: data.clientTimestamp}},
           process.env.EVENTS_TABLE)
}

function storeProcessingData(data) {
    // Put processing result into database
    ddbPut({sub: {S: data.sub},
            server_timestamp: {S: Date.now().toString()},
            event_type: {S: data.eventType + '-PROCESS'},
            status: {S: data.status},
            output: {S: data.output}},
            process.env.EVENTS_TABLE);
}

function ddbPut(item, tableName) {

    return new Promise(function(resolve, reject) {
        ddb.putItem({
            'TableName': tableName,
            'Item': item,
        }, function(err, data) {
            if (err) {
                reject(err);
            } else {
                resolve(data);
            }
        });
    });

}

function s3Put(fileName, fileContent) {

    // Setting up S3 upload parameters
    const params = {
        Bucket: process.env.EVENTS_BUCKET,
        Key: fileName, // File name you want to save as in S3
        Body: fileContent
    };

    // Uploading files to the bucket
    return new Promise(function(resolve, reject) {
        S3.upload(params, function(err, data) {
            if (err) {
                resolve({status: false, output: err});
            } else {
                resolve({status: true, output: data});
            }
        });
    });

}

*/

module.exports = new StorageService();

