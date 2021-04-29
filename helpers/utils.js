const spawn = require('await-spawn'),
	  path = require('path'),
      fs = require('fs').promises,
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
	    {compact: true, selfDefending: true, domainLock: 'vorder.io'}
	);

	const res = await fs.writeFile(tmpFilePath, obfuscationResult);

	//const mvResult = await spawn('sudo', ['mv', tmpFilePath, targetFilePath]);
	//console.log(mvResult);

    return 0;
}

module.exports = new Utils();