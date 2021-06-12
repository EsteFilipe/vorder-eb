const spawn = require('await-spawn'),
	  path = require('path'),
      fs = require('fs').promises,
      fetch = require('node-fetch'),
      jsObfuscator = require('javascript-obfuscator');

var Utils = function() {
	this.name = ''
}

Utils.prototype.runPython38Script = async function (scriptName, arg) {
	const scriptsDir = path.resolve(process.cwd()) + '/scripts/';
	const pythonProcess = await spawn('python3.8', [scriptName, arg], {cwd: scriptsDir});
    return pythonProcess.toString();
}

Utils.prototype.getElasticBeanstalkEnvName = async function () {
	const scriptPath = '/opt/elasticbeanstalk/bin/get-config'
	const envName = await spawn(scriptPath, ['container', '-k', 'environment_name']);
    return envName.toString();
}

Utils.prototype.obfuscateAndReplaceJSFile = async function (targetFileName, url) {
	const viewsDir = path.resolve(process.cwd()) + '/views/';
	const targetFilePath = viewsDir + targetFileName;
	const tmpFilePath = '/tmp/' + targetFileName;

    const fileContent = await fs.readFile(targetFilePath, "utf8");

    console.log(`Obfuscating file '${targetFileName}'...`)

    //console.log(fileContent)

    var obfuscationResult = jsObfuscator.obfuscate(
	    fileContent,
	    {
	    	compact: true
	    	/*
	    	selfDefending: true,
	    	disableConsoleOutput: true,
	    	transformObjectKeys: true, 
	    	domainLock: ['vorder.io']
	    	*/
	    }
	);

    // Write obfuscated file
	const writeResult = await fs.writeFile(tmpFilePath, obfuscationResult);
	// Replace original file by the obfuscated one
	const mvResult = await spawn('mv', [tmpFilePath, targetFilePath]);

    return 0;
}

Utils.prototype.downloadCognitoPublicKeys = function (cognitoRegion, cognitoUserPoolId, targetFilePath) {

    const publicKeysURL = `https://cognito-idp.${cognitoRegion}.amazonaws.com/${cognitoUserPoolId}/.well-known/jwks.json`

	let settings = { method: "Get" };

	fetch(publicKeysURL, settings)
	    .then(res => res.json())
	    .then((json) => {
	        fs.writeFile(targetFilePath, JSON.stringify(json));
	    });
}

module.exports = new Utils();