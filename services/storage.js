// PUT HERE ALL THE METHODS TO INTERACT WITH DYNAMODB
const AWS = require('aws-sdk'),
	  attr = require('dynamodb-data-types').AttributeValue,
      fs = require('fs').promises,
      path = require('path'),
      util = require('util');

const ddb = new AWS.DynamoDB(),
	  S3 = new AWS.S3();

var StorageService = function() {
	this.name = '';
}

// Not used anymore. This was to load sentences from a json file, but now I'm
// using a python script to generate them on the fly
StorageService.prototype.getSTTContexts = async function(contextFilePaths) {

    const expectedSentencesFilePath = path.resolve(process.cwd()) + '/' + contextFilePaths.order;
    const orderExpectedSentences = await fs.readFile(expectedSentencesFilePath, "utf8");

    const orderSpeechContexts = [{
       phrases: JSON.parse(orderExpectedSentences),
       boost: 20.0
    }];
    const confirmationSpeechContexts = [{
       phrases: ['yes','no'],
       boost: 20.0
    }];

    return {orderSpeechContexts: orderSpeechContexts, confirmationSpeechContexts, confirmationSpeechContexts}

}

//  TODO do encryption in transit using https://github.com/aws/aws-dynamodb-encryption-python/tree/master/examples/src
// As it is, it only has encryption in rest, which is default in DynamoDB.
StorageService.prototype.getServerCredentials = function() {
    // Only resolved when all the data has been fetched
    return Promise.all([
        new Promise((resolve, reject) => {
            ddb.getItem({
                'TableName': process.env.CREDENTIALS_TABLE,
                'Key': {partition: {S: 'server'},
                        id: {S: 'google-service-account-key-1'}},
            }, function(err, data) {
                if (err) {
                    reject('DB_ERROR: getServerCredentials() [google-service-account-key-1] - ' + err);
                } else {
                    resolve({'google-service-account-key-1': attr.unwrap(data.Item).json});
                }
            });
        }),
        new Promise((resolve, reject) => {
            ddb.getItem({
                'TableName': process.env.CREDENTIALS_TABLE,
                'Key': {partition: {S: 'server'},
                        id: {S: 'google-service-account-key-2'}},
            }, function(err, data) {
                if (err) {
                    reject('DB_ERROR: getServerCredentials() [google-service-account-key-2] - ' + err);
                } else {
                    resolve({'google-service-account-key-2': attr.unwrap(data.Item).json});
                }
            });
        }),
        new Promise((resolve, reject) => {
            ddb.getItem({
                'TableName': process.env.CREDENTIALS_TABLE,
                'Key': {partition: {S: 'server'},
                        id: {S: 'cognito-user-pool'}},
            }, function(err, data) {
                if (err) {
                    reject('DB_ERROR: getServerCredentials() [cognito-user-pool] - ' + err);
                } else {
                    resolve({'cognito-user-pool': attr.unwrap(data.Item).json});
                }
            });
        }),
        new Promise((resolve, reject) => {
            ddb.getItem({
                'TableName': process.env.CREDENTIALS_TABLE,
                'Key': {partition: {S: 'server'},
                        id: {S: 'cookie-session-secret'}},
            }, function(err, data) {
                if (err) {
                    reject('DB_ERROR: getServerCredentials() [cognito-user-pool] - ' + err);
                } else {
                    resolve({'cookie-session-secret': attr.unwrap(data.Item).json.value});
                }
            });
        })
    ]);
}

StorageService.prototype.getAPIKeys = function(sub, exchange) {
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
                    resolve({status:'API_KEY_DEFINED', output: attr.unwrap(data.Item)[dbAPIkeyField]});
                }
                // If the user doesn't yet have an API key defined, reject
                else {
                    resolve({status:"API_KEY_UNDEFINED", output: "-"});
                }
            }
        });
    });
}

StorageService.prototype.setAPIKeys = async function(sub, exchange, keys) {
	const dbAPIkeyField = exchange + '_api_key';
    const item = {  
    	partition: {S: 'users'},
		id: {S: sub},
		[dbAPIkeyField]:
			{M: {
				api_key: {S: keys.apiKey},
				api_secret: {S: keys.apiSecret}
				}
			}
	}

	try {
		await ddbPut(item, process.env.CREDENTIALS_TABLE);
		return {status: true, output: ''};
	}
	catch (err) {
		return {status: false, output: err};
	}
}

StorageService.prototype.storeAudioData = async function (data){

    var fileName;
    s3PutResult = await this.s3Put(data.fileName, data.fileBuffer);

    //console.log('------> storeAudioData')
    //console.log(s3PutResult);
    //console.log(data);

    if (s3PutResult.status) {
        fileName = data.fileName;
    }
    else {
        fileName = "UPLOAD_ERROR";
    }

    const item = {sub: {S: data.sub},
            server_timestamp: {S: Date.now().toString()},
            event_type: {S: data.eventType + '-SAVE_AUDIO'},
            file_name: {S: fileName},
            client_timestamp: {S: data.clientTimestamp}};

	try {
	    await ddbPut(item, process.env.EVENTS_TABLE)
	    return {status: true, output: ''};
	}
	catch (err) {
		return {status: false, output: err};
	}
}

StorageService.prototype.storeProcessingData = async function (data) {
    const item = {sub: {S: data.sub},
            server_timestamp: {S: Date.now().toString()},
            event_type: {S: data.eventType + '-PROCESS'},
            status: {S: data.status},
            output: {S: data.output}};
            
	try {
	    await ddbPut(item, process.env.EVENTS_TABLE)
	    return {status: true, output: ''};
	}
	catch (err) {
		return {status: false, output: err};
	}
}

StorageService.prototype.s3Put = function (fileName, fileContent) {

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

StorageService.prototype.s3GetAll = function (bucketName, prefix) {

    var params = {
      Bucket: bucketName,
      Prefix: prefix // folder Name
    };

    return new Promise(function(resolve, reject) {

        S3.listObjectsV2(params, function(err, data) {
            if (err) {
                resolve({status: false, output: err});
            }
            else {
                resolve({status: true, output: data});
            }


           allFiles.push(data)
       }
    });


        S3.upload(params, function(err, data) {
            if (err) {
                resolve({status: false, output: err});
            } else {
                resolve({status: true, output: data});
            }
        });
    });



    return allFiles;

}

StorageService.prototype.ddbPut = async function(item, tableName) {
	try {
		await ddbPut(item, tableName);
		return {status: true, output: ''};
	}
	catch (err) {
		return {status: false, output: err};
	}
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

module.exports = new StorageService();