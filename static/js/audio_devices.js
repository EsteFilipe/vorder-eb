const audioInputSelect = document.querySelector('select#audioSource');

// Updates the select element with the provided set of microphones
function updateMicrophoneList(microphones) {
    // TODO note: select previously selected ID everytime we update (if it's available. else select the first index)
    audioInputSelect.innerHTML = '';
    for (let i = 0; i !== microphones.length; ++i) {
        const microphoneInfo = microphones[i];
        const microphoneOption = document.createElement('option');
        microphoneOption.textContent  = microphoneInfo.label || `microphone ${audioInputSelect.length + 1}`;
        microphoneOption.value = microphoneInfo.deviceId;
        audioInputSelect.add(microphoneOption);
    }
    
    // Every time an update happens, this avoids the selected microphone
    // from going back to default (index 0 in selector). 
    // Note although that the ID is dynamic. 
    // e.g.
    // Initially the laptop microphone device might have ID "communications",
    // but then when an headset with microphone is connected, the microphone
    // from the headset gets the "communications" ID.
    try {
        audioInputSelect.value = audioSourceDeviceId;
    } 
    catch (err) {
        audioInputSelect.value = 'default';
    }

}

// Fetch an array of devices of a certain type
async function getConnectedDevices(type) {
    const devices = await navigator.mediaDevices.enumerateDevices();
    return devices.filter(device => device.kind === type)
}

function changeAudioSource() {
    audioSourceDeviceId = audioInputSelect.value;
    console.log("Changed to microphone with ID: " + audioSourceDeviceId);
}

getConnectedDevices('audioinput').then(microphonesList => updateMicrophoneList(microphonesList));

// Listen for changes to media devices and update the list accordingly
navigator.mediaDevices.addEventListener('devicechange', event => {
    getConnectedDevices('audioinput').then(microphonesList => updateMicrophoneList(microphonesList));
});

audioInputSelect.onchange = changeAudioSource;