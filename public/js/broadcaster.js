const socket = io();

// Audio context and variables
let mediaRecorder;
let audioContext;
let audioStream;
let isRecording = false;

// DOM elements
const startButton = document.getElementById('startButton');
const stopButton = document.getElementById('stopButton');
const nameInput = document.getElementById('broadcasterName');
const statusElement = document.getElementById('status');
const listenerCountElement = document.getElementById('listenerCount');

// Check for supported media types
function getSupportedMimeType() {
  const types = [
    'audio/webm;codecs=opus',
    'audio/webm',
    'audio/ogg;codecs=opus',
    'audio/mp4;codecs=opus',
    'audio/mpeg'
  ];
  
  for (const type of types) {
    if (MediaRecorder.isTypeSupported(type)) {
      return type;
    }
  }
  
  return 'audio/webm'; // Fallback
}

// Start broadcasting
startButton.addEventListener('click', async () => {
  if (!nameInput.value.trim()) {
    alert('Please enter a name for your broadcast');
    return;
  }
  
  try {
    // Show audio source selection options
    const sourceType = document.querySelector('input[name="audioSource"]:checked').value;
    
    // Set up audio context first to avoid initialization issues
    audioContext = new (window.AudioContext || window.webkitAudioContext)({
      sampleRate: 44100, // Consistent sample rate
    });
    
    if (sourceType === 'microphone') {
      // Request microphone access
      audioStream = await navigator.mediaDevices.getUserMedia({ 
        audio: {
          echoCancellation: true,
          noiseSuppression: true,
          autoGainControl: true,
          sampleRate: 44100
        } 
      });
    } 
    else if (sourceType === 'system') {
      // Request display media with system audio
      audioStream = await navigator.mediaDevices.getDisplayMedia({
        video: {
          width: 1280, 
          height: 720,
          frameRate: 1 // Minimum frame rate to reduce overhead
        },
        audio: {
          echoCancellation: false,
          noiseSuppression: false,
          autoGainControl: false,
          sampleRate: 44100
        }
      });
      
      // Check if audio was actually captured
      const audioTracks = audioStream.getAudioTracks();
      if (audioTracks.length === 0) {
        throw new Error('No audio track available in the captured stream');
      }
      
      // Set video tracks to lowest possible quality to prioritize audio
      const videoTracks = audioStream.getVideoTracks();
      if (videoTracks.length > 0) {
        videoTracks.forEach(track => {
          track.enabled = false;
          // Apply constraints to minimize video resources
          try {
            track.applyConstraints({
              width: 1,
              height: 1,
              frameRate: 1
            });
          } catch (e) {
            console.log('Could not apply minimal video constraints:', e);
          }
        });
      }
    }
    
    // Get the supported mime type
    const mimeType = getSupportedMimeType();
    console.log('Using MIME type:', mimeType);
    
    // Process audio with Web Audio API for better compatibility
    const sourceNode = audioContext.createMediaStreamSource(audioStream);
    const destinationNode = audioContext.createMediaStreamDestination();
    
    // Add an audio processing node to standardize the audio
    const gainNode = audioContext.createGain();
    gainNode.gain.value = 0.8; // Slightly reduce volume to prevent clipping
    
    // Create a simple processing chain
    sourceNode.connect(gainNode);
    gainNode.connect(destinationNode);
    
    // Use the processed stream for recording
    const processedStream = destinationNode.stream;
    
    // Configure media recorder with processed stream
    mediaRecorder = new MediaRecorder(processedStream, {
      mimeType: mimeType,
      audioBitsPerSecond: 128000
    });
    
    // Start recording and broadcasting
    mediaRecorder.start(100); // Capture chunks every 100ms
    
    mediaRecorder.ondataavailable = (event) => {
      if (event.data.size > 0 && isRecording) {
        // Send the audio chunk to the server
        socket.emit('audio-chunk', {
          data: event.data,
          mimeType: mimeType
        });
      }
    };
    
    // Update UI
    startButton.disabled = true;
    stopButton.disabled = false;
    statusElement.textContent = 'Broadcasting...';
    statusElement.style.color = '#4CAF50';
    
    // Show which source is being broadcast
    const sourceName = sourceType === 'microphone' ? 'Microphone' : 'Desktop Audio';
    document.getElementById('sourceInfo').textContent = `Broadcasting from: ${sourceName} (${mimeType})`;
    
    // Notify server that we're broadcasting
    isRecording = true;
    socket.emit('start-broadcasting', nameInput.value.trim());
    
  } catch (error) {
    console.error('Error accessing audio source:', error);
    statusElement.textContent = `Error: ${error.message || 'Audio source access denied'}`;
    statusElement.style.color = 'red';
    
    // Clean up if there was an error
    if (audioContext) {
      audioContext.close();
    }
    if (audioStream) {
      audioStream.getTracks().forEach(track => track.stop());
    }
  }
});

// Stop broadcasting
stopButton.addEventListener('click', () => {
  if (mediaRecorder && isRecording) {
    mediaRecorder.stop();
    isRecording = false;
    
    // Stop all tracks on the stream
    if (audioStream) {
      audioStream.getTracks().forEach(track => track.stop());
    }
    
    // Update UI
    startButton.disabled = false;
    stopButton.disabled = true;
    statusElement.textContent = 'Not broadcasting';
    statusElement.style.color = 'black';
    listenerCountElement.textContent = '';
    document.getElementById('sourceInfo').textContent = '';
    
    // Clean up audio context
    if (audioContext) {
      audioContext.close();
    }
  }
});

// Handle disconnection
window.addEventListener('beforeunload', () => {
  if (isRecording) {
    // Stop all tracks on the stream
    if (audioStream) {
      audioStream.getTracks().forEach(track => track.stop());
    }
    
    // Clean up audio context
    if (audioContext) {
      audioContext.close();
    }
  }
});