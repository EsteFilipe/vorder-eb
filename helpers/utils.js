const spawn = require('await-spawn'),
	  path = require('path');

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

Utils.prototype.obfuscateAndReplaceJSFile = async function (targetFileName) {
	const viewsDir = path.resolve(process.cwd()) + '/views/';
	const targetFilePath = viewsDir + targetFileName;
	const tmpFilePath = '/tmp/' + targetFileName;

	console.log(`Obfuscating file '${targetFileName}'...`)


	const args = [targetFilePath, '--output', tmpFilePath, '--compact', 'true', '--self-defending', 'true']

	console.log(args);

	const obfResult = await spawn('javascript-obfuscator', args);
	console.log(obfResult);
	const mvResult = await spawn('sudo', ['mv', tmpFilePath, targetFilePath]);
	console.log(mvResult);

    return 0;
}

module.exports = new Utils();