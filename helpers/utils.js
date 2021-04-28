const spawn = require('await-spawn'),
	  path = require('path');

var Utils = function() {
	this.name = ''
}

Utils.prototype.runPython38Script = async function (scriptName, arg) {
	const scriptsDir = path.resolve(process.cwd()) + '/scripts/';
	const pythonProcess = await spawn('python3.8',[scriptName, arg], {cwd: scriptsDir});
    return pythonProcess.toString();
}

Utils.prototype.getElasticBeanstalkEnvName = async function () {
	const scriptPath = '/opt/elasticbeanstalk/bin/get-config'
	const envName = await spawn(scriptPath,['container', '-k', 'environment_name']);
    return envName.toString();
}

module.exports = new Utils();