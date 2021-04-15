const spawn = require('await-spawn');

var Utils = function() {
	this.name = ''
}

SpeechService.prototype.runPython38Script = async function (scriptName, arg) {
	const scriptsDir = path.resolve(process.cwd()) + '/scripts/';
	const pythonProcess = await spawn('python3.8',[scriptName, arg], {cwd: scriptsDir});
    return pythonProcess.toString();
}

module.exports = new Utils();